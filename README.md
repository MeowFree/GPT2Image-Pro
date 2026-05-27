# GPT2Image-Pro

GPT2Image-Pro 是一个面向生图业务的 SaaS 平台，主应用位于 `apps/web`，共享能力位于 `packages/*`。

README 只保留项目入口和部署骨架。接口字段、后端调度、计费、Agent、队列、Sub2API、管理员权限等细节以站内系统文档为准：

- 公开系统文档：`/docs/system`
- 登录后台文档：`/dashboard/backend-help`
- 内部 AB 部署 Runbook：[docs/deploy-nginx-ab.md](docs/deploy-nginx-ab.md)。这是特定生产环境的运维记录，只有使用同样的 Nginx 静态 alias、systemd release 和 AB 切换方式时才需要照做；普通部署按下方生产部署即可。

## 能力概览

- 文生图、图生图、逐行批量、瀑布流、Chat 生图和 Codex 风格 Agent 自动迭代。
- OpenAI 兼容外接接口：`/v1/images/generations`、`/v1/images/edits`、`/v1/responses`、`/v1/agents/images`、`/v1/models`、`/v1/credits`。
- 后端池支持 Web 账号、Codex/Responses 账号、OpenAI 兼容外接 API、mixed 分组、优先级、权重、并发、冷却、错误标记和分组倍率。
- 套餐能力矩阵可配置功能权限、上传限制、批量数量、并发、月积分、审核策略、Chat/Agent 轮次计费和外接 API 权限。
- 支持订阅、按量积分包、API Key 独立额度、积分流水、工单、公告、状态监控、SLA 和三级管理员。

## 配置来源

- 运行时优先读取数据库 `system_setting`，未配置时回退环境变量。
- 首次启动会初始化缺失的非密钥默认配置，包括套餐能力矩阵、套餐价格、按量积分包、审核和后端冷却默认值；已有数据库配置不会被覆盖。
- 默认启用自用模式：公开注册关闭；如果没有超管，启动时会创建本地超管并随机生成密码。初始密码写入启动日志和 `.gpt2image/super-admin-credentials.txt`，可用 `GPT2IMAGE_BOOTSTRAP_CREDENTIALS_PATH` 覆盖路径。

## 本地开发

```bash
git clone <repo-url>
cd GPT2Image-Pro
pnpm install
cp .env.example .env.local
mkdir -p apps/web
cp .env.local apps/web/.env.local
pnpm db:push
pnpm dev:web
```

本地最少需要配置：

```env
DATABASE_URL=postgresql://user:password@host:5432/gpt2image
BETTER_AUTH_SECRET=<random-secret>
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=<random-secret>
```

开发地址默认是 `http://localhost:3000`。

## 生产部署

生产部署按模块拆开：Web 应用负责页面和 API，Go sidecar 负责 ChatGPT Web 账号，crontab 负责超时、过期、同步和清理任务。Sub2API、支付和对象存储按业务需要启用。

### 1. Web 应用

```bash
pnpm install --frozen-lockfile
pnpm db:push
pnpm build:web
pnpm --filter @repo/web start
```

生产环境建议明确配置：

```env
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=https://your-domain.example
NEXT_PUBLIC_APP_URL=https://your-domain.example
CRON_SECRET=...
```

普通 `next start` / standalone 部署不需要配置 `NEXT_PUBLIC_ASSET_PREFIX`，也不需要手工处理静态资源；Next 会从应用自身目录提供 `_next/static`。只有使用 Nginx 静态 alias 或 AB 上线时，才需要单独同步静态资源，详见 [docs/deploy-nginx-ab.md](docs/deploy-nginx-ab.md)。

### 2. Go Sidecar

Web 账号池依赖 `services/chatgpt-web-proxy`，生产环境应单独常驻运行；如果完全不使用 Web 后端，可以不启用这一模块。

```bash
cd services/chatgpt-web-proxy
go build -o chatgpt-web-proxy .
CHATGPT_WEB_PROXY_BIND=:3021 \
CHATGPT_WEB_PROXY_SECRET=<proxy-secret> \
./chatgpt-web-proxy
```

Web 应用侧配置：

```env
CHATGPT_WEB_PROXY_URL=http://127.0.0.1:3021
CHATGPT_WEB_PROXY_SECRET=<proxy-secret>
```

### 3. Crontab

crontab 模块安装并配置好即可，不要求手工逐条敲命令；确保它会携带 `Authorization: Bearer $CRON_SECRET` 调用任务接口。推荐最小任务：

```cron
*/5 * * * * curl -fsS -X POST -H "Authorization: Bearer <cron-secret>" https://your-domain.example/api/jobs/images/expire-pending >/dev/null
0 0 * * * curl -fsS -X POST -H "Authorization: Bearer <cron-secret>" https://your-domain.example/api/jobs/credits/expire >/dev/null
*/10 * * * * curl -fsS -X POST -H "Authorization: Bearer <cron-secret>" https://your-domain.example/api/jobs/image-backend/web-accounts/refresh >/dev/null
```

其中 `/api/jobs/images/expire-pending` 同时负责 pending 超时退款和“照片销毁”清理。后台「系统设置 > 存储 > 照片销毁时间（小时）」默认为 `0`，表示生成图永久保存；填入小时数后，超过保留时长的图片文件会被清理，生成记录和计费流水仍保留。

如果启用 Sub2API 自动同步，再增加：

```cron
0 */12 * * * curl -fsS -X POST -H "Authorization: Bearer <cron-secret>" https://your-domain.example/api/jobs/image-backend/sub2api/sync >/dev/null
```

### 推荐模块

- Sub2API 后端同步：推荐但可选。配置 `SUB2API_POSTGRES_URL` 后，在后台创建同步任务；同步规则以后台任务配置为准。
- 支付模块：公开运营建议配置 Creem 或 Epay。至少设置 `PAYMENT_PROVIDER`、对应支付密钥、回调密钥和前端价格 ID。
- 对象存储：未配置时可使用本地 `storage/`；生产公开访问建议配置 S3/R2/MinIO 兼容存储。

除上述密钥和域名外，尽量复用系统初始化写入的默认配置；启动后通过后台系统设置调整。

## 常用命令

```bash
pnpm dev:web
pnpm build:web
pnpm typecheck
pnpm test
pnpm --filter @repo/shared test:matrix
pnpm --filter @repo/web test -- responses-native-state
pnpm db:generate
pnpm db:push
pnpm db:studio
```

## License

MIT
