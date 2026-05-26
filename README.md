# GPT2Image-Pro

GPT2Image-Pro 是一个面向生图业务的 SaaS 平台。当前版本采用 pnpm workspace monorepo，核心包含用户站、管理后台、套餐能力矩阵、生图后端账号池、OpenAI 兼容外接 API、支付、积分、工单、审核、存储和定时任务。

> 运行时配置优先读取数据库中的系统设置；未配置时回退到环境变量。后台“系统设置”保存后会尽量同步到常见的 `apps/web/.env.local` 路径，数据库仍是后台配置的主来源。

## 主要功能

- 文生图、图生图/编辑、对话生图、批量生成、历史瀑布流和 Codex 式 Agent 自动迭代生图。
- OpenAI 风格外接 API：`/v1/images/generations`、`/v1/images/edits`、`/v1/responses`、`/v1/agents/images`、`/v1/chat/completions`、`/v1/models`，同时提供 `/api/v1/*` 镜像路径。
- 生图后端池：支持 Web 账号、Codex/Responses 账号和外接 OpenAI 兼容 API；支持分组、分组类型、默认分组、优先级、权重、并发、冷却、错误标记和额度显示。
- Sub2API 同步：从 Sub2API PostgreSQL 同步 OpenAI OAuth 账号，支持按来源分组、套餐过滤、排除 free、排除错误账号、去重导入和定时同步。
- RT/AT 导入：支持直接导入 RT、从 Auth Session 整段文本解析 RT、Web AT 导入；Mobile RT 需要显式勾选后才走 mobile client 路线。
- 能力矩阵：管理员可按套餐配置 API 权限、外接流式、上传大小、参考图数量、批量数量、并发、月积分、审核能力和审核失败结算规则。
- 账单与用量：订阅账单、按量付费积分包、积分流水和用量记录分 Tab 管理。
- 内容审核：阿里云内容安全、OpenAI moderation、代理审核，支持套餐级审核强度和审核拦截结算策略。
- 工单系统：用户工单、管理员回复、邮件通知和用户侧红点提醒。
- 运维能力：静态资源版本前缀、cron 任务、Go ChatGPT Web TLS sidecar、Pino/Axiom 日志、Sentry、Upstash 限流。

## 技术栈

| 分类 | 技术 |
| --- | --- |
| Monorepo | pnpm workspace, Turbo |
| Web | Next.js 16, React 19, TypeScript, next-intl, Fumadocs |
| UI | Tailwind CSS 4, Radix UI, shadcn 风格组件, lucide-react |
| 数据库 | PostgreSQL, Drizzle ORM |
| 认证 | Better Auth, 邮箱密码, OAuth |
| 支付 | Creem, Epay |
| 存储 | 本地存储, S3/R2/MinIO 兼容 |
| 队列/任务 | Inngest, crontab HTTP jobs |
| 日志监控 | Pino, Axiom, Sentry |
| Web 代理 | Go 1.24, tls-client sidecar |

## 项目结构

```text
apps/
  web/                 # 用户站、管理入口、外接 API、cron route
  admin/               # 独立管理站骨架
packages/
  shared/              # 认证、配置、积分、支付、审核、系统设置、能力矩阵
  database/            # Drizzle schema/client
  ui/                  # 基础 UI 组件
services/
  chatgpt-web-proxy/   # Go tls-client sidecar，用于 ChatGPT Web 请求
docs/                  # 文档内容
storage/               # 本地存储默认目录
```

> 仓库里仍保留了部分历史 `src/` 目录代码；当前主业务以 `apps/web` 和 `packages/*` 为准。

## 快速开始

```bash
git clone git@github.com:MoYeRanqianzhi/GPT2Image-Pro.git
cd GPT2Image-Pro
pnpm install
cp .env.example .env.local
# 至少填写 DATABASE_URL、BETTER_AUTH_SECRET、BETTER_AUTH_URL、NEXT_PUBLIC_APP_URL
mkdir -p apps/web
cp .env.local apps/web/.env.local
# 修改环境变量后记得同步这两份文件；根目录用于数据库/脚本，apps/web/.env.local 用于 Next 开发与构建
pnpm db:push
pnpm dev:web
```

默认开发地址为 `http://localhost:3000`。

常用命令：

```bash
pnpm dev:web                 # 启动用户站
pnpm build:web               # 构建用户站
pnpm typecheck               # workspace 类型检查
pnpm test                    # workspace 测试，目前包含 shared 能力矩阵测试
pnpm --filter @repo/shared test:matrix
pnpm db:generate
pnpm db:push
pnpm db:studio
```

## 关键页面入口

用户侧边栏入口：

| 页面 | 路径 | 说明 |
| --- | --- | --- |
| 生成 | `/dashboard/create` | 文生图、图生图、对话生图入口 |
| 图库 | `/dashboard/gallery` | 生成结果瀑布流 |
| 历史 | `/dashboard/history` | 任务历史、失败原因、积分结算 |
| 系统文档 | `/dashboard/backend-help` | 后端与接口说明 |
| 外接 API | `/dashboard/external-api` | 用户创建本站对外 API Key |
| 账单与用量 | `/dashboard/billing` | 账单和用量两个子 Tab；订阅和按量包归到账单 |
| 设置 | `/dashboard/settings` | 用户个人设置和接入其他站 API |
| 工单 | `/dashboard/support` | 用户工单，未读回复有红点提示 |

管理员入口：

| 页面 | 路径 | 说明 |
| --- | --- | --- |
| 用户管理 | `/dashboard/admin/users` | 用户、套餐、积分和账号状态管理 |
| 系统设置 | `/dashboard/admin/settings` 的“系统设置”Tab | 全局配置、支付、审核、套餐能力矩阵、Sub2API 自动同步配置 |
| 生图后端池 | `/dashboard/admin/settings` 的“生图后端池”Tab | 分组、账号/API、RT/AT 导入、Sub2API 同步、批量管理、错误账号处理 |

## 生图后端池

后端池由“分组”和“成员”组成。分组类型决定请求调度时能不能被选中：

- `mixed`：Web 和 Codex/Responses 都可放入，但具体请求仍按能力筛选。
- `web`：仅 Web 后端。适合页面文生图、图生图和对话生图；Web 生图分辨率不可严格控制，也不保证 4K。
- `responses`：仅 Codex/Responses 后端。适合 `/v1/responses` 和将 image API 转成 Responses 生图。

成员类型：

- Web 账号：使用 ChatGPT Web 访问令牌或 Mobile RT 路线。可显示额度、恢复时间和冷却状态。
- Codex/Responses 账号：走 Responses 语义，image generation/edit 可转换为 Responses image tool。
- 外接 API：用户或平台配置 OpenAI 兼容 Base URL + API Key，由上游能力决定支持模型和字段。

调度会跳过已禁用、错误、冷却中、限流中和不匹配请求类型的账号。429、529、usage limit、quota exceeded、insufficient quota、billing hard limit、unsupported model、临时 5xx/timeout 等都有可配置冷却时间；上游返回 `Retry-After`、`resetAt`、`reset_at`、`reset_after`、`restoreAt` 等恢复时间时优先按上游时间恢复。命中不可恢复关键词时账号会标记为错误。

分组可配置计费倍率。直接命中某个分组时只使用该分组倍率；`mixed` 父分组嵌套子分组并实际调度到子分组成员时，父分组倍率和子分组倍率会相乘后用于预扣、成功结算、失败退款和用量记录。例如父分组 `x2`、子分组 `x1.5`，本次请求按 `x3` 结算。

相关后台配置在“系统设置 -> 模型与后端”中：

- `IMAGE_BACKEND_DEFAULT_COOLDOWN_MINUTES`
- `IMAGE_BACKEND_RATE_LIMIT_COOLDOWN_MINUTES`
- `IMAGE_BACKEND_OVERLOAD_COOLDOWN_MINUTES`
- `IMAGE_BACKEND_USAGE_LIMIT_COOLDOWN_MINUTES`
- `IMAGE_BACKEND_UNSUPPORTED_MODEL_COOLDOWN_MINUTES`
- `IMAGE_BACKEND_TEMPORARY_ERROR_COOLDOWN_MINUTES`
- `IMAGE_BACKEND_UNRECOVERABLE_ERROR_KEYWORDS`

## Sub2API 同步

先在 `.env.prod` 或后台系统设置中配置：

```env
SUB2API_POSTGRES_URL=postgresql://user:password@localhost:5432/sub2api
SUB2API_POSTGRES_SYNC_LIMIT=100
SUB2API_AUTO_SYNC_ENABLED=true
SUB2API_AUTO_SYNC_INTERVAL_MINUTES=720
SUB2API_AUTO_SYNC_SOURCE_GROUP_ID=
SUB2API_AUTO_SYNC_MODE=responses
SUB2API_AUTO_SYNC_ALLOW_MOBILE_RT=false
SUB2API_AUTO_SYNC_PLAN_FILTER=non_free
```

同步规则：

- 默认只同步 Sub2API OpenAI OAuth 账号到 Codex/Responses。
- 默认排除 `plan_type=free`。
- 手工同步可选择来源分组、目标 Web 分组、目标 Responses 分组、同步模式和套餐过滤。
- 同步是去重导入/更新本站后端池记录，不会删除 Sub2API 源库账号。
- Sub2API 标记错误的账号不会被当成正常可调度账号继续使用。
- Mobile RT 只有在启用 `allowMobileRtImport` 或 `SUB2API_AUTO_SYNC_ALLOW_MOBILE_RT=true` 后才会参与 Web 同步。

手工入口：`/dashboard/admin/settings` -> “生图后端池” -> “同步 Sub2API”。

定时入口见下面的 crontab 部分。

## 外接 API

用户在 `/dashboard/external-api` 创建本站 API Key 后，可使用 OpenAI 风格接口。Base URL 使用站点地址，例如：

```text
https://your-domain.com/v1
```

也兼容：

```text
https://your-domain.com/api/v1
```

文生图示例：

```bash
curl https://your-domain.com/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "A cute baby sea otter",
    "n": 1,
    "size": "1024x1024",
    "response_format": "url",
    "force_web": true
  }'
```

`force_web`/`forceWeb` 是本站扩展字段，仅对 `/v1/images/generations` 和 `/v1/images/edits` 生效。用户已启用“接入其他站 API”时仍优先使用用户自接 API，并忽略该字段；进入平台账号池后，只有命中的后端分组为 `mixed` 时才会强制本次 image 请求只调度 Web 账号。非 mixed 分组也会忽略该字段并按原分组规则调度。Web 后端仍不能严格保证输出分辨率或 4K。

`n`/`count` 批量张数是一次 HTTP 发送；一次生成 10 张会创建 10 条 generation 记录并按 10 张结算。运行时按套餐的“生图并发”受限并行，超过并发上限的图片会在本批次内排队等待，不会一次性吃掉 10 个并发。

流式文生图示例：

```bash
curl -N https://your-domain.com/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "A studio product photo of a glass perfume bottle",
    "stream": true
  }'
```

典型 SSE 事件：

```text
event: image_generation.partial_image
data: {"type":"image_generation.partial_image","index":0,"partial_image_index":0,"b64_json":"..."}

event: image_generation.completed
data: {"type":"image_generation.completed","index":0,"generation_id":"...","url":"...","data":[{"url":"..."}]}

data: [DONE]
```

Responses 生图示例：

```bash
curl https://your-domain.com/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \
  -d '{
    "model": "gpt-5.4",
    "input": "Generate a 1:1 icon of a chrome camera",
    "tools": [
      {
        "type": "image_generation",
        "model": "gpt-image-2",
        "size": "1024x1024",
        "quality": "high"
      }
    ],
    "tool_choice": { "type": "image_generation" }
  }'
```

Agent 生图外接接口是本站扩展接口，不是 OpenAI 官方接口。它把页面 Agent 的 Codex/Responses 工具循环开放给 API 用户，支持联网、附件上下文、自动迭代和流式任务事件；默认要求 Ultra/旗舰版，可在能力矩阵的 `externalApi.agent` 调整。

```bash
curl -N https://your-domain.com/v1/agents/images \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \
  -d '{
    "model": "gpt-5.4",
    "image_model": "gpt-image-2",
    "prompt": "先联网查询资料，再迭代生成一张企业宣传海报",
    "size": "1536x1024",
    "stream": true,
    "agent_max_rounds": 2,
    "agent_force_max_rounds": true,
    "response_format": "url"
  }'
```

`/v1/agents/images` 一次只运行一个 Agent 任务，`n`/`count` 传入时必须为 `1`。JSON 可传 `images`/`image_url`/`image_urls` 公网参考图；multipart 可传 `image[]` 参考图和 `file`/`attachment` 文本、代码或 PDF 附件。流式事件包括 `agent.event`、`agent.partial_image`、`agent.text_delta`、`agent.thinking_delta` 和 `agent.completed`。

外接 API 权限由能力矩阵控制。默认 Responses 接口要求 Pro+，Agent 生图要求 Ultra+，普通 image/chat/model 接口默认 Starter+，流式默认 Starter+。可在后台“系统设置 -> 套餐 -> 套餐能力矩阵”调整。

## 套餐能力矩阵

后台路径：`/dashboard/admin/settings` -> “系统设置” -> “套餐” -> “套餐能力矩阵”。

矩阵可配置：

- 功能门槛：文生图、图生图、对话生图、Agent、生图批量、提示词优化开关、GPT-5.5、选择后端分组、外接 API Key、外接 Chat/Images/Responses/Agent/Models/Streaming、审核能力。
- 套餐限制：月积分配额、单用户生图并发、单文件大小、单次上传总量、批量张数、编辑参考图数量、对话参考图数量、对话上下文字符、队列优先级。
- 审核策略：默认拦截等级、最高可选等级、审核失败只扣审核积分。

高级套餐自动继承低级套餐能力。留空时使用代码默认矩阵，并兼容旧的上传限制/月积分环境变量。当前已为矩阵核心逻辑补充自动测试：

```bash
pnpm --filter @repo/shared test:matrix
```

## Chat 与 Agent

页面 Chat 是普通多模态对话/生图：一次请求保留上下文，先扣 1 积分；如果本轮产出图片，再按实际输出尺寸和数量追加计费。

页面 Agent 面向 Codex 式任务执行：后端默认提供 `image_generation`、`web_search` 和线性续跑工具 `continue_generation`，不强制 `tool_choice`。一次用户请求内会自动执行多轮，每轮把上一轮文字、工具结果和生成草图作为下一轮上下文，模型可自行决定继续搜索、读上传的文本/代码附件、生成草图或改版。每个自动轮次的基础积分由套餐能力矩阵 `agentRoundCredits` 配置，默认 3 积分/轮；图片输出另按实际尺寸和数量计费。

Agent 最大自动轮数由系统设置 `IMAGE_AGENT_MAX_ROUNDS` 控制，默认 `3`，后台“系统设置 -> 模型与后端”可改。上传的文本/代码类文件会作为上下文读取；不会开放服务器本地路径读取。

TODO：

- Agent 批量生图工具：参考 `generate_image_batch` 模式，让模型规划多张独立图片后由后端并发执行，并把每张图作为独立任务卡展示。该能力暂未接入运行时；接入前需要先设计它与 Responses `previous_response_id` 粘性会话的关系，避免并发子请求打散主会话链。
- 原子化 `@` 图片引用：将 `@图1`、`@第N轮图M` 做成不可半删的输入标签，支持弹窗选择、图片重排后自动重映射，以及缺失引用提示。
- Agent 分支对话/轮次树：编辑或重生成历史某一轮时，不覆盖后续记录，而是从该轮派生新分支；支持在旧分支和新分支之间切换，并重映射 `@第N轮图M` / `<ref id="...">` 图片引用，避免引用错位。

## 部署

`https://gpt2image.superapi.buzz` 当前线上实例使用 systemd release + Nginx 静态 alias + 3308 upstream，详细操作见 [Superapi 生图站部署 Runbook](docs/deploy-superapi.md)。通用部署说明如下。

### 1. 服务器依赖

建议 Ubuntu/Debian：

```bash
sudo apt update
sudo apt install -y git curl build-essential postgresql-client nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pnpm pm2
```

如果需要 Web 账号稳定访问 ChatGPT Web，再安装 Go 1.24+：

```bash
wget https://go.dev/dl/go1.24.13.linux-amd64.tar.gz
sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf go1.24.13.linux-amd64.tar.gz
echo 'export PATH=/usr/local/go/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
go version
```

### 2. 生产环境变量

从模板开始：

```bash
cp .env.production.example .env.prod
```

至少需要确认：

```env
NEXT_PUBLIC_APP_URL=https://your-domain.com
BETTER_AUTH_URL=https://your-domain.com
BETTER_AUTH_SECRET=<openssl-rand-base64-32>
DATABASE_URL=postgresql://user:password@host:5432/gpt2image
CRON_SECRET=<openssl-rand-hex-32>
LOCAL_STORAGE_PATH=/root/GPT2Image-Pro/storage
NEXT_PUBLIC_GENERATIONS_BUCKET_NAME=generations
NEXT_PUBLIC_AVATARS_BUCKET_NAME=avatars
```

生成密钥：

```bash
openssl rand -base64 32
openssl rand -hex 32
```

生产运行建议同时准备根目录和 `apps/web` 两份 env 文件。根目录用于 workspace 工具，`apps/web/.env.local` 用于 Next 构建和运行：

```bash
cp .env.prod .env.local
mkdir -p apps/web
cp .env.prod apps/web/.env.local
chmod 600 .env.local apps/web/.env.local
```

后台系统设置保存后，会尽量同步到 `/root/GPT2Image-Pro/apps/web/.env.local` 和 `/home/user1/GPT2Image-Pro/apps/web/.env.local`。如果你的路径不同，以数据库设置为准，或手工同步 env 文件。

### 3. 数据库初始化

```bash
pnpm install
pnpm db:push
```

如需导入当前环境变量到后台系统设置，进入管理员后台：`/dashboard/admin/settings` -> “导入当前环境变量”。

首次启动会把缺失的非密钥默认配置写入 `system_setting`，例如套餐能力矩阵、套餐价格、按量积分包、审核和后端冷却默认值；已有数据库配置不会被覆盖。管理员也可在“系统设置”里点击“初始化默认配置”手工补齐旧库。

### 4. 源码部署（推荐）

推荐在服务器保留完整 monorepo 源码，构建 `@repo/web`，再用 PM2 托管 standalone server：

```bash
cd /root/GPT2Image-Pro
git pull
pnpm install --frozen-lockfile
cp .env.prod .env.local
cp .env.prod apps/web/.env.local
pnpm build:web
PORT=3303 NODE_ENV=production pm2 start apps/web/.next/standalone/apps/web/server.js \
  --name GPT2Image-Pro \
  --update-env \
  --time
pm2 save
```

如果你的 standalone 输出路径不同，先检查：

```bash
find apps/web/.next/standalone -maxdepth 4 -name server.js -print
```

常用 PM2 操作：

```bash
pm2 status
pm2 logs GPT2Image-Pro
pm2 restart GPT2Image-Pro --update-env
pm2 save
```

后续更新：

```bash
cd /root/GPT2Image-Pro
git pull
pnpm install --frozen-lockfile
cp .env.prod .env.local
cp .env.prod apps/web/.env.local
pnpm build:web
PORT=3303 NODE_ENV=production pm2 restart GPT2Image-Pro --update-env
```

### 5. Docker 部署

仓库提供 `Dockerfile.web`，可以把 `.env.local` 作为 build secret 和运行时 env_file：

```bash
cp .env.prod .env.local
# Docker 容器内本地存储路径应指向挂载目录；源码部署才使用 /root/GPT2Image-Pro/storage
# 将 .env.local 中 LOCAL_STORAGE_PATH 改为 /app/storage，或改用 S3/R2/MinIO
docker compose up -d --build web
```

默认 `docker-compose.yml` 暴露宿主机 `3000` 对应容器内 `3000`；源码部署示例使用 `3303`。Nginx `proxy_pass` 需要按实际运行端口调整。

如果使用 Docker 部署 Web 站，Go sidecar 也可以按下面的“Go ChatGPT Web TLS Sidecar”章节单独运行成容器或 systemd 服务。确保 Web 容器能访问 `CHATGPT_WEB_PROXY_URL`。

### 6. 静态资源版本

建议每次前端构建改一个新前缀，避免浏览器拿旧 chunk：

```env
NEXT_PUBLIC_ASSET_PREFIX=/next-assets-v20260522-yourtag
```

改动 `NEXT_PUBLIC_ASSET_PREFIX` 后必须重新构建并重启。应用 middleware 会把 `/next-assets-*` 或 `/gpt2-assets-*` 下的 `/_next/*` 请求重写回 Next 静态资源。

### 7. 历史打包脚本说明

仓库仍保留 `deploy-build.bat` 和 `start-prod.sh`，但它们来自早期单体 `.next` 打包流程。当前主应用位于 `apps/web`，生产环境优先使用上面的源码部署或 Docker 部署。如果继续使用旧脚本，需要先确认打包内容包含 `apps/web/.next`、`apps/web/public`、`packages/*`、`apps/web/package.json` 等 monorepo standalone 运行所需文件。

### 8. Nginx 反向代理

示例：

下面示例按源码部署的 `3303` 端口编写；如果使用默认 Docker compose，请改为 `http://127.0.0.1:3000`。

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 200m;

    location / {
        proxy_pass http://127.0.0.1:3303;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 360s;
        proxy_send_timeout 360s;
    }
}
```

配置 HTTPS 可使用 certbot 或你的面板工具。

## Go ChatGPT Web TLS Sidecar

Web 后端账号可直接从 Node 请求 ChatGPT Web；如果遇到 TLS 指纹、Cloudflare、连接稳定性问题，建议启用 Go sidecar。

源码位于：

```text
services/chatgpt-web-proxy
```

环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CHATGPT_WEB_PROXY_BIND` | `:3021` | Go 服务监听地址 |
| `CHATGPT_WEB_PROXY_SECRET` | 空 | 请求密钥；配置后主站必须带 `X-Proxy-Secret` |
| `CHATGPT_WEB_PROXY_PROFILE` | `chrome_146` | tls-client profile |
| `CHATGPT_WEB_PROXY_TIMEOUT_SECONDS` | `300` | 上游请求超时 |
| `CHATGPT_WEB_PROXY_MAX_BODY_MB` | `32` | 读取上游响应体上限 |
| `CHATGPT_WEB_UPSTREAM_PROXY_URL` | 空 | 可选上游 HTTP/SOCKS 代理 |

构建运行：

```bash
cd /root/GPT2Image-Pro/services/chatgpt-web-proxy
go mod download
go build -o chatgpt-web-proxy .
CHATGPT_WEB_PROXY_BIND=127.0.0.1:3021 \
CHATGPT_WEB_PROXY_SECRET=<same-secret> \
./chatgpt-web-proxy
```

systemd 示例：

```ini
[Unit]
Description=GPT2Image ChatGPT Web Proxy
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/GPT2Image-Pro/services/chatgpt-web-proxy
Environment=CHATGPT_WEB_PROXY_BIND=127.0.0.1:3021
Environment=CHATGPT_WEB_PROXY_SECRET=<same-secret>
Environment=CHATGPT_WEB_PROXY_PROFILE=chrome_146
Environment=CHATGPT_WEB_PROXY_TIMEOUT_SECONDS=300
ExecStart=/root/GPT2Image-Pro/services/chatgpt-web-proxy/chatgpt-web-proxy
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now chatgpt-web-proxy
curl http://127.0.0.1:3021/healthz
```

主站配置：

```env
CHATGPT_WEB_PROXY_URL=http://127.0.0.1:3021
CHATGPT_WEB_PROXY_SECRET=<same-secret>
```

也可在后台“系统设置 -> 模型与后端”填写这两个配置。修改后重启主站。

## Crontab 定时任务

先配置 `CRON_SECRET`。健康检查 GET 不需要鉴权，真正执行任务的 POST 必须带 Bearer Token：

```bash
export APP_URL=https://your-domain.com
export CRON_SECRET=<openssl-rand-hex-32>
```

健康检查：

```bash
curl "$APP_URL/api/jobs/credits/expire"
curl "$APP_URL/api/jobs/images/expire-pending"
curl "$APP_URL/api/jobs/image-backend/sub2api/sync"
curl "$APP_URL/api/jobs/image-backend/web-accounts/refresh"
```

手工触发：

```bash
curl -X POST "$APP_URL/api/jobs/credits/expire" \
  -H "Authorization: Bearer $CRON_SECRET"

curl -X POST "$APP_URL/api/jobs/images/expire-pending" \
  -H "Authorization: Bearer $CRON_SECRET"

curl -X POST "$APP_URL/api/jobs/image-backend/sub2api/sync?force=1" \
  -H "Authorization: Bearer $CRON_SECRET"

curl -X POST "$APP_URL/api/jobs/image-backend/web-accounts/refresh" \
  -H "Authorization: Bearer $CRON_SECRET"
```

编辑 crontab：

```bash
crontab -e
```

推荐配置：

```cron
SHELL=/bin/bash
APP_URL=https://your-domain.com
CRON_SECRET=<openssl-rand-hex-32>

# 每天处理过期积分
5 0 * * * curl -fsS -X POST "$APP_URL/api/jobs/credits/expire" -H "Authorization: Bearer $CRON_SECRET" >> /var/log/gpt2image-cron.log 2>&1

# 每 10 分钟把卡在处理中超过 10 分钟的生图任务置为失败并退还积分
*/10 * * * * curl -fsS -X POST "$APP_URL/api/jobs/images/expire-pending" -H "Authorization: Bearer $CRON_SECRET" >> /var/log/gpt2image-cron.log 2>&1

# 每 15 分钟唤醒一次 Sub2API 同步；实际是否执行由 SUB2API_AUTO_SYNC_INTERVAL_MINUTES 控制，默认半天一次
*/15 * * * * curl -fsS -X POST "$APP_URL/api/jobs/image-backend/sub2api/sync" -H "Authorization: Bearer $CRON_SECRET" >> /var/log/gpt2image-cron.log 2>&1

# 每 10 分钟刷新过期的 Web 账号额度/状态
*/10 * * * * curl -fsS -X POST "$APP_URL/api/jobs/image-backend/web-accounts/refresh" -H "Authorization: Bearer $CRON_SECRET" >> /var/log/gpt2image-cron.log 2>&1
```

如果 `CRON_SECRET` 是后台系统设置而不是环境变量，`sub2api/sync` 和 `web-accounts/refresh` 会读取后台配置；`credits/expire` 和 `images/expire-pending` 当前读取进程环境变量，所以生产进程环境里也必须有 `CRON_SECRET`。

## 支付、积分和按量包

支持订阅套餐和按量积分包：

- `PLAN_CAPABILITY_MATRIX` 控制套餐能力与月积分。
- `CREDIT_PACKAGE_MATRIX` 控制按量包、是否可见、数量、套餐价格和 Creem 产品 ID。
- `PAYMENT_PROVIDER` 支持 `creem` 和 `epay`。
- Epay 回调地址使用 `EPAY_NOTIFY_URL`，Creem 使用 `/api/webhooks/creem`。

用户账单入口：`/dashboard/billing`，其中“账单”和“用量”是独立子 Tab。

## 测试

```bash
pnpm test
pnpm --filter @repo/shared test:matrix
pnpm --filter @repo/shared typecheck
pnpm --filter @repo/web typecheck
```

矩阵测试覆盖默认矩阵、后台示例同步、自定义配置、非法值回退、高级套餐继承、审核等级、旧配置兼容和业务访问器。

## 常见问题

### 修改前端后用户仍看到旧页面或 ChunkLoadError

更新 `NEXT_PUBLIC_ASSET_PREFIX`，重新构建并重启。示例：

```env
NEXT_PUBLIC_ASSET_PREFIX=/next-assets-v20260522-readme
```

### Web 生图不能严格按 size 输出

ChatGPT Web 后端主要能控制比例提示，不能稳定指定精确分辨率，也不保证 4K。需要严格尺寸时优先使用 Codex/Responses 或外接 API 后端。

### 外接 API 填了自己的 API 仍扣本站积分

本站对外 API Key 调用会走本站计费。用户在“设置”里配置“接入其他站 API”用于页面内个人上游时，才会按个人自带上游调用。外接出去的 `/v1/*` API 是本站对外服务，默认仍会记录用量和扣积分。

### Sub2API 同步没有新增账号

检查 `SUB2API_POSTGRES_URL` 权限、来源分组、套餐过滤、是否排除了 free、Sub2API 账号是否为错误状态，以及目标分组类型是否匹配 Web/Responses。

### Go sidecar 502

检查 Go 服务健康：

```bash
curl http://127.0.0.1:3021/healthz
journalctl -u chatgpt-web-proxy -n 100 --no-pager
```

确认 `CHATGPT_WEB_PROXY_SECRET` 两端一致，主站可以访问 `CHATGPT_WEB_PROXY_URL`。

## License

MIT
