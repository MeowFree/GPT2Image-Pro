# GPT2Image-Pro

<p align="center">
  <strong>面向生图业务的 SaaS 平台</strong><br />
  套餐能力矩阵、Web + Codex 智能路由、4K Agent 生图和 OpenAI 兼容 API。
</p>

<p align="center">
  <a href="https://github.com/MeowFree/GPT2Image-Pro/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/MeowFree/GPT2Image-Pro?style=social" /></a>
  <a href="https://github.com/MeowFree/GPT2Image-Pro/blob/dev/LICENSE"><img alt="License" src="https://img.shields.io/github/license/MeowFree/GPT2Image-Pro" /></a>
  <a href="https://github.com/MeowFree/GPT2Image-Pro/releases"><img alt="Release" src="https://img.shields.io/github/v/release/MeowFree/GPT2Image-Pro?include_prereleases" /></a>
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" />
  <img alt="Docker" src="https://img.shields.io/badge/Docker-GHCR-2496ED?logo=docker&logoColor=white" />
</p>

<p align="center">
  <a href="https://gpt2image.superapi.buzz">免费体验</a>
  ·
  QQ 交流群：375682052
  ·
  <a href="#生产部署">生产部署</a>
  ·
  <a href="#docker-compose">Docker Compose</a>
  ·
  <a href="#常用命令">常用命令</a>
</p>

<p align="center">
  <img src="docs/images/admin-status-dashboard.png" alt="GPT2Image-Pro admin status dashboard" width="920" />
</p>

GPT2Image-Pro 主应用位于 `apps/web`，共享能力位于 `packages/*`。README 保留项目入口和部署骨架；接口字段、后端调度、计费、Agent、队列、Sub2API、管理员权限等细节以站内系统文档为准：

- 公开系统文档：`/docs/system`
- 登录后台文档：`/dashboard/backend-help`
- QQ 交流群：375682052

## 项目定位

GPT2Image-Pro 的目标不是做一个单机版生图 Demo，而是把 ChatGPT Web、Codex/Responses、OpenAI 兼容外接 API 等账号能力统一接入账号池，转换成可运营、可计费、可分套餐交付的页面服务和 API 服务。它既适合个人把自己的账号整理成稳定的自用生图入口，也适合团队把账号池能力包装成面向用户的 SaaS 平台。

项目围绕三个问题设计：

- **账号如何转成服务**：把 Web AT、Codex/Responses 账号、Sub2API 来源账号和外接 API 纳入统一后端池，提供页面生图、Chat/Agent 和 OpenAI 兼容 API。
- **服务如何可控交付**：通过套餐能力矩阵、API Key 额度、分组倍率、并发队列、审核策略、积分流水和 SLA 监控控制不同用户能用什么、能用多少、按什么价格用。
- **生图如何更像产品能力**：同时支持普通生图、图生图、批量、瀑布流、Chat 上下文生图和 Codex 风格 Agent 迭代，而不是只暴露单个裸接口。

## 核心特性

### 1. 套餐能力细化，方便客户分层

传统生图面板通常只区分“能不能用”和“还有多少额度”。GPT2Image-Pro 把套餐拆成可配置的能力矩阵，管理员可以按套餐控制：

- 页面功能：文生图、图生图、逐行批量、瀑布流、Chat、Agent。
- API 权限：`/v1/images/generations`、`/v1/images/edits`、`/v1/chat/completions`、`/v1/responses`、Agent API、额度查询等。
- 资源限制：上传图片大小、单次上传数量、批量生成数量、用户并发、API Key 独立额度。
- 计费规则：月赠积分、Chat 每轮基础价、Agent 每轮基础价、按量积分包价格、分组倍率、尺寸价格曲线。
- 风控策略：文本审核、图片审核、审核失败扣费规则、关闭提示词优化权限、审核拦截策略。

这样可以把免费体验、普通用户、高级用户、API 用户、内部测试用户拆成不同产品层级。高级套餐可以包含低级套餐能力，同时再放开更高并发、更大上传、更低倍率或 Agent/API 能力。

### 2. Web + Codex + 外接 API 统一账号池，智能路由

平台支持把不同来源的生图能力放进统一调度层：

- **ChatGPT Web 账号**：适合低分辨率、Web 能力、低成本或 Web-first 场景。Web 生图分辨率不可严格控制，不能保证 4K。
- **Codex/Responses 账号**：适合 Responses 语义、图片工具、Chat/Agent、多轮上下文和更高分辨率输出。
- **OpenAI 兼容外接 API**：适合接入第三方网关或用户自己的上游服务，平台尽量按 OpenAI 风格透传。
- **Mixed 分组**：可把 Web、Codex 和外接 API 放进同一业务分组，按尺寸、请求类型、force web 范围、优先级、权重、冷却和错误状态自动选择后端。

调度层内置账号状态管理：成功/失败统计、限流、冷却、过载、无效凭据、并发占用、分组倍率和错误记录。对外 API 和页面请求都可以复用这套调度能力，使账号不只是“登录态”，而是可被产品化管理的服务资源。

### 3. Codex 风格 Agent 生图，并可 API 接出

页面 Agent 不是简单把提示词丢给图片接口，而是尽量模拟 Codex 式工作流：

- 支持联网搜索、工具调用、任务卡展示、自动多轮迭代和最终图片生成。
- 可按轮收取 Agent 基础积分，最终图片再按尺寸、数量、审核和分组倍率计费。
- 可结合 Codex/Responses 后端生成高分辨率图片，包括 4K 场景。
- 可通过旗舰版能力把 Agent 生图作为 API 暴露给第三方产品。

Chat 模式和 Agent 模式分开：Chat 更适合用户主动对话和上下文创作；Agent 更适合自动查资料、生成、判断、继续迭代的任务型流程。

## 能力概览

- **页面创作**：文生图、图生图、逐行批量、瀑布流、Chat 生图、Agent 自动迭代、图库、历史记录、参考图引用和发送到其他创作入口。
- **OpenAI 兼容 API**：`/v1/chat/completions`、`/v1/images/generations`、`/v1/images/edits`、`/v1/images/{task_id}`、`/v1/responses`、`/v1/agents/images`、`/v1/models`、`/v1/credits`。
- **异步图片任务**：图片生成和编辑接口支持同步返回，也支持 `async`、`callback_url` 和任务查询。
- **账号池与调度**：Web 账号、Codex/Responses 账号、外接 API、mixed 分组、优先级、权重、并发、排队、冷却、错误标记、分组倍率和 Sub2API 同步任务。
- **计费与套餐**：能力矩阵、套餐订阅、按量积分包、API Key 独立额度、尺寸价格曲线、Chat/Agent 轮次价格、积分流水和用户侧计费明细。
- **运营后台**：三级管理员、用户管理、公告、工单红点、状态监控、SLA、历史错误、照片销毁、内置定时任务和系统设置。
- **注册机辅助工具**：仓库附带 `注册机/`，可按示例配置批量生成本项目可导入的 ChatGPT Web AT；在合适的代理和邮箱服务配置下，可支撑数百并发生成 Web AT。该工具是账号准备辅助，不是 Web 应用运行必需组件。

## 界面预览

<table>
  <tr>
    <td width="50%">
      <img src="docs/images/plan-capability-matrix.png" alt="Plan capability matrix" />
      <br />
      <strong>套餐能力矩阵</strong>
    </td>
    <td width="50%">
      <img src="docs/images/dashboard-pricing-curve.png" alt="Dashboard pricing curve" />
      <br />
      <strong>积分计价曲线</strong>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/images/admin-system-settings.png" alt="Admin system settings" />
      <br />
      <strong>系统设置</strong>
    </td>
    <td width="50%">
      <img src="docs/images/admin-user-management.png" alt="Admin user management" />
      <br />
      <strong>用户管理</strong>
    </td>
  </tr>
</table>

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
```

开发地址默认是 `http://localhost:3000`。

## 生产部署

生产部署按模块拆开：Web 应用负责页面、API 和默认内置定时任务，Go sidecar 负责 ChatGPT Web 账号。Sub2API、支付和对象存储按业务需要启用。

### 推荐部署方式

新部署优先使用 Docker Compose。Compose 会同时拉起 Web、PostgreSQL、数据库迁移任务和 Go sidecar，适合大多数单机生产场景。

源码部署适合已经有自己的 PostgreSQL、进程管理、Nginx、对象存储和发布流程的环境。源码部署需要自行守护 Web 进程和 Go sidecar。

### Docker Compose

Release 镜像发布在 GHCR（GitHub Container Registry）。GHCR 是 GitHub 自带的 Docker 镜像仓库，不需要单独使用 DockerHub。

```bash
cp .env.docker.example .env
docker compose pull
docker compose up -d
```

默认 compose 会启动 PostgreSQL、Web 应用、数据库迁移任务和 ChatGPT Web sidecar。首次启动默认自用模式，超管密码会写入 `app-bootstrap` volume 内的 `super-admin-credentials.txt`，也可通过日志查看。

启动后查看状态：

```bash
docker compose ps
docker compose logs -f web
```

升级到新版本：

```bash
docker compose pull
docker compose up -d
```

如果只修改 `.env` 里的运行时配置，不需要重新构建镜像，执行 `docker compose up -d` 让容器重新创建即可。

如果需要从源码本地构建镜像：

```bash
cp .env.docker.example .env
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

### 1. Web 应用

```bash
git clone https://github.com/MeowFree/GPT2Image-Pro.git
cd GPT2Image-Pro
cp .env.example .env.local
mkdir -p apps/web
cp .env.local apps/web/.env.local
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
```

普通 `next start` / standalone 部署不需要配置 `NEXT_PUBLIC_ASSET_PREFIX`，也不需要手工处理静态资源；Next 会从应用自身目录提供 `_next/static`。

源码部署更新：

```bash
git pull
pnpm install --frozen-lockfile
pnpm db:push
pnpm build:web
pm2 restart gpt2image-web
```

如果不用 PM2，请把最后一行替换成自己的 systemd、Docker 或进程管理命令。

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

### 3. 定时任务

Web 应用默认启用内置定时任务，会自动执行 pending 超时退款、照片销毁清理、积分过期、Web 账号刷新和 Sub2API 自动同步检查。多实例部署时会使用 PostgreSQL advisory lock，避免多个 Web 进程重复执行同一个任务。

普通部署不需要配置 crontab。后台可在系统设置里调整 `INTERNAL_JOB_SCHEDULER_ENABLED` 和各任务间隔。

其中 `/api/jobs/images/expire-pending` 同时负责 pending 超时退款和“照片销毁”清理。后台「系统设置 > 存储 > 照片销毁时间（小时）」默认为 `0`，表示生成图永久保存；填入小时数后，超过保留时长的图片文件会被清理，生成记录和计费流水仍保留。

### 推荐模块

- Sub2API 后端同步：推荐但可选。启动后在后台创建同步任务，任务规则会存入数据库，后续调整不需要重启 Docker。只有把 `SUB2API_POSTGRES_URL` 写进 `.env` 作为环境变量兜底时，改动后才需要执行 `docker compose up -d` 重新创建 Web 容器；不需要 `--build`，也不需要重新构建镜像。
- 支付模块：公开运营建议配置 Creem 或 Epay。至少设置 `PAYMENT_PROVIDER`、对应支付密钥、回调密钥和前端价格 ID。
- 对象存储：未配置时可使用本地 `storage/`；生产公开访问建议配置 S3/R2/MinIO 兼容存储。
- Upstash 限流：可选。配置 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN` 后启用；各类每分钟请求阈值可在后台系统设置中调整。

除上述密钥和域名外，尽量复用系统初始化写入的默认配置；启动后通过后台系统设置调整。

## 发布

仓库发布地址为 `MeowFree/GPT2Image-Pro`。打版本 tag 会触发 GitHub Actions：

- 构建并推送 `ghcr.io/meowfree/gpt2image-pro-web`
- 构建并推送 `ghcr.io/meowfree/gpt2image-pro-migrate`
- 构建并推送 `ghcr.io/meowfree/gpt2image-pro-chatgpt-web-proxy`
- 创建 GitHub Release 草稿，并附带 compose 部署包

```bash
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

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

## TODO

- **Sub2API 非数据库接口**：当前同步优先面向已有数据库接入方式，后续适配 Sub2API 管理员 API，减少部署时对 Sub2API 数据库直连的依赖。
- **Codex 登录接口**：补充 Codex/Responses 账号登录、凭据刷新和导入接口，降低手工维护账号池的成本。
- **Agent 分支能力**：补充类似 playground 的多轮分支/回退/重选路径，用于保留不同图片迭代方向，并处理历史图引用重映射。
- **Agent 批量图片工具**：评估 `generate_image_batch` 类工具接入，同时解决粘性会话、计费、任务卡展示和多图引用的一致性。
- **PSD 生成接口**：预留 PSD 生成/导出接口适配，方便后续对接分层设计图、海报编辑和素材交付场景。

## License

AGPL-3.0-only
