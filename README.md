# GPT2Image-Pro

GPT2Image-Pro 是一个面向生图业务的 SaaS 平台。当前版本采用 pnpm workspace monorepo，核心包含用户站、管理后台、套餐能力矩阵、生图后端账号池、OpenAI 兼容外接 API、支付、积分、工单、审核、存储和定时任务。

> 运行时配置优先读取数据库中的系统设置；未配置时回退到环境变量。后台“系统设置”保存后会尽量同步到常见的 `apps/web/.env.local` 路径，数据库仍是后台配置的主来源。

## 主要功能

- 文生图、图生图/编辑、对话生图、历史瀑布流、逐行批量和 Codex 式 Agent 自动迭代生图。
- 分辨率与格式：支持 `auto`、1K/2K/4K/自定义尺寸、输出格式 PNG/JPEG/WebP、压缩参数、参考图原尺寸编辑和实际输出尺寸结算。
- OpenAI 风格外接 API：`/v1/images/generations`、`/v1/images/edits`、`/v1/responses`、`/v1/agents/images`、`/v1/credits`、`/v1/models`，同时提供 `/api/v1/*` 镜像路径；`/v1/chat/completions` 仅保留兼容路由，当前返回 unsupported。
- 生图后端池：支持 Web 账号、Codex/Responses 账号和外接 OpenAI 兼容 API；支持账号多分组、`mixed` 一层子分组、分组倍率、默认分组、优先级、权重、并发、冷却、错误标记和额度显示。
- Sub2API 同步：从 Sub2API PostgreSQL 同步 OpenAI OAuth 账号，支持按来源分组、套餐过滤、排除 free、排除错误账号、去重导入、托管同步任务、立即运行和定时同步。
- RT/AT 导入：支持直接导入 RT、从 Auth Session 整段文本解析 RT、Web AT 导入；Mobile RT 需要显式勾选后才走 mobile client 路线。
- 能力矩阵：管理员可按套餐配置 API 权限、外接流式、上传大小、参考图数量、批量数量、并发、月积分、审核能力和审核失败结算规则。
- 账单与用量：订阅账单、按量付费积分包、积分流水、API Key 独立额度和用量记录分 Tab 管理。
- 内容审核：阿里云内容安全、OpenAI moderation、代理审核，支持套餐级审核强度和审核拦截结算策略。
- 工单系统：用户工单、管理员回复、邮件通知和用户侧红点提醒。
- 运营后台：三级管理员、公告、状态监控、SLA/成功率/耗时/历史错误筛选、用户积分增减/覆盖/套餐修改。
- 运维能力：静态资源版本前缀、cron 任务、Go ChatGPT Web TLS sidecar、Pino/Axiom 日志、Sentry、Upstash 限流和可配置显示时区。

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
| 图库 | `/dashboard/gallery` | 生成结果瀑布流，含成品图和 Agent 中间草图 Tab |
| 历史 | `/dashboard/history` | 任务历史、失败原因、积分结算和计价明细 |
| 系统文档 | `/dashboard/backend-help`、`/docs/system` | 后端与接口说明；`/docs/system` 可用于对外查看和复制 |
| 外接 API | `/dashboard/external-api` | 用户创建本站对外 API Key、设置 Key 额度、查看已用额度 |
| 账单与用量 | `/dashboard/billing` | 账单和用量两个子 Tab；订阅和按量包归到账单 |
| 设置 | `/dashboard/settings` | 用户个人设置和接入其他站 API |
| 工单 | `/dashboard/support` | 用户工单，未读回复有红点提示 |
| 公告 | `/dashboard/announcements` | 用户公告、维护通知和活动说明 |

管理员入口：

| 页面 | 路径 | 说明 |
| --- | --- | --- |
| 用户管理 | `/dashboard/admin/users` | 用户、套餐、积分增减/覆盖、API Key 额度和角色管理 |
| 系统设置 | `/dashboard/admin/settings` 的“系统设置”Tab | 全局配置、显示时区、支付、审核、计价曲线、套餐能力矩阵、Sub2API 自动同步配置 |
| 生图后端池 | `/dashboard/admin/settings` 的“生图后端池”Tab | 分组、账号/API、RT/AT 导入、Sub2API 同步、批量管理、错误账号处理 |
| 状态监控 | `/dashboard/admin/status` | SLA、成功率、出图量、积分消耗、后端耗时、错误历史筛选 |
| 公告管理 | `/dashboard/admin/announcements` | 创建、发布、置顶、定时展示和撤回公告 |

管理员角色：

- `super_admin`：超管。`admin@gpt2image.local` 会在运行时自动提升为超管；可修改用户角色、套餐和积分。
- `admin`：管理员。可管理用户、账号池、设置、公告和工单，但不能修改用户权限。
- `observer_admin`：观察管理员。可查看生图后端池和状态信息，不能修改账号、配置、用户和积分。

## 生图后端池

后端池由“分组”和“成员”组成。分组类型决定请求调度时能不能被选中：

- `mixed`：Web 和 Codex/Responses 都可放入，但具体请求仍按能力筛选。`mixed` 可嵌套一层非 `mixed` 子分组，用于把 Web/Codex/外接 API 组合成一个用户可选分组。
- `web`：仅 Web 后端。适合页面文生图、图生图和对话生图；Web 生图分辨率不可严格控制，也不保证 4K。
- `responses`：仅 Codex/Responses 后端。适合 `/v1/responses` 和将 image API 转成 Responses 生图。

成员类型：

- Web 账号：使用 ChatGPT Web 访问令牌或 Mobile RT 路线。可显示额度、恢复时间和冷却状态。
- Codex/Responses 账号：走 Responses 语义，image generation/edit 可转换为 Responses image tool。
- 外接 API：用户或平台配置 OpenAI 兼容 Base URL + API Key，由上游能力决定支持模型和字段。

账号可以同时属于多个分组。重复导入同一账号会复用已有账号记录，并自动加入新的目标分组。批量操作支持修改账号优先级、权重、重置为可用、清理错误账号和删除。

调度会跳过已禁用、错误、冷却中、限流中和不匹配请求类型的账号。429、529、usage limit、quota exceeded、insufficient quota、billing hard limit、unsupported model、临时 5xx/timeout 等都有可配置冷却时间；上游返回 `Retry-After`、`resetAt`、`reset_at`、`reset_after`、`restoreAt` 等恢复时间时优先按上游时间恢复。命中不可恢复关键词时账号会标记为错误。

分组可配置计费倍率。直接命中某个分组时只使用该分组倍率；`mixed` 父分组嵌套子分组并实际调度到子分组成员时，父分组倍率和子分组倍率会相乘后用于预扣、成功结算、失败退款和用量记录。例如父分组 `x2`、子分组 `x1.5`，本次请求按 `x3` 结算。

Web 与 Codex/Responses 的关键差异：

- Web 后端走 ChatGPT 网页链路，可用于页面文生图、图生图和对话生图。分辨率和输出格式只是尽力提示，不能严格保证像素，也不能保证 4K。
- Codex/Responses 后端走 Responses 语义。页面 Chat/Agent、`/v1/responses`、外接 Agent 和需要真实图片引用的请求都会强制选择 Responses 能力账号或 Responses 接口的外接 API。
- 纯 Images 外接 API 只承接 `/v1/images/generations` 和 `/v1/images/edits`；不能承接 Agent 或 Responses 语义。
- ChatGPT Codex 的原生 `/backend-api/codex/images/*` fast path 已验证不可从服务端稳定访问，代码已移除。Codex 图片请求统一走 Responses `image_generation` tool。

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
- 开启“创建自动同步任务”时，手工同步会先创建或更新任务，再立即按同一任务 runner 全量执行；Cron、后台“立即运行”和手工同步使用同一套任务配置。
- 每次任务运行都会重新扫描当前 Sub2API 来源范围，导入新增账号、更新已有账号状态，并删除本站中由该任务管理但已从来源范围移出或在 Sub 中删除的账号；不会删除 Sub2API 源库账号。
- “每批扫描数量”只是服务端分页批大小，不是同步总数上限。
- Sub2API 标记错误的账号不会被当成正常可调度账号继续使用。
- 同步任务可配置是否用 Sub2API 状态覆盖本站错误/限流/冷却状态，默认开启；关闭后，本站最近调度产生的异常状态不会被 Sub 正常状态覆盖。
- Mobile RT 只有在启用 `allowMobileRtImport` 或 `SUB2API_AUTO_SYNC_ALLOW_MOBILE_RT=true` 后才会参与 Web 同步。

手工入口：`/dashboard/admin/settings` -> “生图后端池” -> “同步 Sub2API”。

任务管理入口同在“同步 Sub2API”面板，可查看任务配置、上次运行结果、立即运行和删除任务。未配置 `SUB2API_POSTGRES_URL` 时，Cron 同步会安全跳过；后台手工入口会提示配置缺失。

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

当前支持的对外接口是 `/v1/images/generations`、`/v1/images/edits`、`/v1/responses`、`/v1/agents/images`、`/v1/models` 和 `/v1/credits`。`/v1/chat/completions` 不是当前可用能力，会返回 `unsupported_endpoint`；需要多模态或 Responses 语义时使用 `/v1/responses`，需要 Agent 自动迭代时使用 `/v1/agents/images`。

文生图示例：

```bash
curl https://your-domain.com/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "A cute baby sea otter",
    "n": 1,
    "size": "auto",
    "output_format": "png",
    "response_format": "url",
    "force_web": true
  }'
```

`size` 支持 `auto` 或 `宽x高`。自定义尺寸会校验并贴近到模型允许范围：单边 256-3840、16px 步进、宽高比不超过 3:1、总像素 655,360 到 8,294,400。`output_format` 支持 `png`、`jpeg`、`webp`，`output_compression` 用于支持压缩的格式。Web 后端无法严格保证输出格式；存储时会按实际图片头识别扩展名和 MIME。

`force_web`/`forceWeb` 是本站扩展字段，仅对 `/v1/images/generations` 和 `/v1/images/edits` 生效。用户已启用“接入其他站 API”时仍优先使用用户自接 API，并忽略该字段；进入平台账号池后，只有命中的后端分组为 `mixed` 且请求尺寸总像素落在 `IMAGE_FORCE_WEB_MIN_PIXELS` 到 `IMAGE_FORCE_WEB_MAX_PIXELS` 内时，才会强制本次 image 请求只调度 Web 账号。默认范围为 660,000 到 2,000,000 像素，4K 请求默认不会强制 Web。非 mixed 分组也会忽略该字段并按原分组规则调度。Web 后端仍不能严格保证输出分辨率或 4K。

`n`/`count` 批量张数是一次 HTTP 发送；一次生成 10 张会创建 10 条 generation 记录并按 10 张结算。运行时按套餐的“生图并发”受限并行，超过并发上限的图片会在本批次内排队等待，不会一次性吃掉 10 个并发。

并发与排队规则：底层只有一条进程内生图队列，任务按套餐 `queuePriority` 排序，优先级相同则先进先出；队列同时用全局并发 `IMAGE_GENERATION_GLOBAL_CONCURRENCY` 和单用户 `imageGenerationConcurrency` 计数器控制启动。全局并发可在后台「系统设置 > 模型 > 全局生图并发」配置，环境变量只作为兜底默认值。批量请求还有一层请求内 runner：只同时启动套餐允许的并发数，剩余图片留在本批次内等待，等前一张完成后再进入底层队列。排队等待没有创建 generation，也不会扣图像生成积分；底层队列排队超过 `IMAGE_GENERATION_QUEUE_TIMEOUT_MS` 会返回 429 类错误。单张任务真正开始执行后才进入 20 分钟运行超时，运行超时会按失败结算规则处理积分。

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

普通 image/edit API 的 JSON 和 SSE 响应会返回本站扩展字段 `credits_consumed`，表示本次实际扣除积分。失败时错误体也会尽量返回 `credits_consumed`，用于展示审核失败只扣审核积分、运行失败部分退款后的真实扣费。

图生图/编辑示例：

```bash
# multipart 上传参考图
curl https://your-domain.com/v1/images/edits \
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \
  -F model="gpt-image-2" \
  -F prompt="Turn the reference image into a cinematic poster" \
  -F size="1024x1024" \
  -F response_format="url" \
  -F output_format="webp" \
  -F 'image[]=@/path/to/reference.png'

# JSON 传公网参考图 URL，images / image_url / image_urls 会合并去重
curl https://your-domain.com/v1/images/edits \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "Make a clean ecommerce hero image from the reference",
    "images": ["https://example.com/reference.png"],
    "image_url": "https://example.com/another-reference.png",
    "size": "auto",
    "response_format": "url"
  }'
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

`/v1/responses` 是 Responses 兼容接口，不会启用页面 Agent 工具循环。请求会按 Responses 语义调度到 Codex/Responses 账号或支持 `/responses` 的外接 API 后端；不会选择 Web 账号。`input_image.image_url` 支持公网 URL 或 data URL；本站当前不把外部 `file_id` 作为图片引用上传代理。成功响应会在 `metadata` 中尽量写入 `generation_id`、`credits_consumed` 和实际 `size`。

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

外接 API 权限由能力矩阵控制。默认 Responses 接口要求 Pro+，Agent 生图要求 Ultra+，普通 image/model/credits 接口默认 Starter+，流式默认 Starter+。`externalApi.chat.completions` 目前只控制保留路由的鉴权门槛；接口本身仍返回 unsupported。可在后台“系统设置 -> 套餐 -> 套餐能力矩阵”调整。

API Key 额度：

- 每个 API Key 可配置独立 `creditLimit`，为空表示不限额；仍会消耗用户账户余额。
- 请求开始时预留 Key 额度，失败退款时同步回退 Key 已用额度。
- `/dashboard/external-api` 可查看 Key 已用额度和剩余额度。
- `GET /v1/credits` 用于外部系统查询余额和当前 Key 额度。

```bash
curl https://your-domain.com/v1/credits \
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY"
```

返回会包含账户余额、总获得/总消耗、Key 的 `credit_limit`、`credits_used`、`credits_remaining` 和 `unlimited`。

外接 API 与用户自接 API 的区别：

- `/v1/*` 是本站对外服务，按本站 API Key 计费、限额、记录用量。
- 用户在 `/dashboard/settings` 里配置的“接入其他站 API”只影响页面内个人生成；不会改变本站对外 API Key 的计费主体。
- `/v1/agents/images` 和页面 Agent 会忽略用户自接 API，强制走平台可调度的 Codex/Responses 能力后端。

## 尺寸、格式与积分计价

后台路径：`/dashboard/admin/settings` -> “系统设置” -> “积分与套餐”。

基础出图积分不再按单一 4K 像素比例写死，而是由两端点线性插值得出：

- `IMAGE_BASE_CREDITS_1024`：1024x1024 基础生图积分，默认 `1.27`。低于 1024x1024 的合法尺寸按该价格封底。
- `IMAGE_BASE_CREDITS_4K`：3840x2160 / 2160x3840 基础生图积分，默认 `10`。高于 4K 的尺寸按该价格封顶。
- 1024x1024 到 4K 之间按像素数线性推算。用户控制台会展示价格折线图、计算公式和带分组倍率的示例。

最终扣费由以下部分组成：

- 基础出图积分：按实际输出尺寸和数量结算；如果 Web 或上游输出尺寸与请求不一致，完成后按实际尺寸修正。
- Chat 基础轮次积分：能力矩阵 `chatRoundCredits`，默认 1 积分/轮。
- Agent 基础轮次积分：能力矩阵 `agentRoundCredits`，默认 3 积分/自动轮。
- 文本审核积分：每次最新输入文本默认 0.04 积分。
- 图片审核积分：每张输入图默认 0.06 积分。
- 分组倍率：实际命中的后端分组倍率会参与预扣、成功结算、失败退款和用量记录；父子分组倍率相乘。

审核拦截失败时可按能力矩阵配置“只扣审核积分”。除审核拦截外的上游失败、超时、空响应和平台错误会按失败结算规则退还应退积分；20 分钟运行超时会把任务置为失败并退还生成积分。

用户可在 `/dashboard/history` 查看每条记录的扣费明细；管理员可在状态页按时间范围筛选历史错误和用量。

## 套餐能力矩阵

后台路径：`/dashboard/admin/settings` -> “系统设置” -> “套餐” -> “套餐能力矩阵”。

矩阵可配置：

- 功能门槛：文生图、图生图、对话生图、Agent、生图批量、提示词优化开关、GPT-5.5、选择后端分组、外接 API Key、外接 Images/Responses/Agent/Models/Streaming、审核能力；`externalApi.chat.completions` 当前只用于保留路由鉴权，不代表 Chat Completions 已实现。
- 套餐限制：月积分配额、单用户生图并发、单文件大小、单次上传总量、批量张数、编辑参考图数量、对话参考图数量、对话上下文字符、队列优先级。队列优先级不是多条队列，而是同一条底层队列的排序权重；高级优先级只影响等待任务的启动顺序，不会抢占已经运行的任务。
- 计费策略：页面 Chat 每轮基础积分 `chatRoundCredits`、页面 Agent 每轮基础积分 `agentRoundCredits`，可按套餐分别设置。
- 审核策略：默认拦截等级、最高可选等级、审核失败只扣审核积分。

高级套餐自动继承低级套餐能力。留空时使用代码默认矩阵，并兼容旧的上传限制/月积分环境变量。当前已为矩阵核心逻辑补充自动测试：

```bash
pnpm --filter @repo/shared test:matrix
```

## Chat 与 Agent

生成页现在分为文生图、图生图、对话模式、Agent 模式和瀑布流。瀑布流已经从 Chat 中独立，适合一条提示词批量发散灵感；Chat 保留普通多模态对话/生图语义，不强制注入 Agent 工具。

页面 Chat 是普通多模态对话/生图：一次请求保留上下文，先扣 `chatRoundCredits`；如果本轮产出图片，再按实际输出尺寸和数量追加计费。

在 Codex/Responses 后端下，图生图、Chat 和 Agent 支持显式图片引用：`@图1` 指当前附件第 1 张，`@第N轮图M` 指历史第 N 轮第 M 张图，`<ref id="..."/>` 指内部稳定引用。后端会把这些引用解析成真实 `input_image`，不是只把 URL 文本塞进 prompt。Mixed 分组中使用 `@` 引用会跳过 Web-first 路线并走 Codex/Responses；Web 分支暂不提供该入口。

页面 Agent 面向 Codex 式任务执行：后端默认提供 `image_generation`、`web_search` 和线性续跑工具 `continue_generation`，不强制 `tool_choice`。一次用户请求内会自动执行多轮，每轮把上一轮文字、工具结果和生成草图作为下一轮上下文，模型可自行决定继续搜索、读上传的文本/代码附件、生成草图或改版。每个自动轮次的基础积分由套餐能力矩阵 `agentRoundCredits` 配置，默认 3 积分/轮；图片输出另按实际尺寸和数量计费。

Agent 最大自动轮数由系统设置 `IMAGE_AGENT_MAX_ROUNDS` 控制，默认 `3`，后台“系统设置 -> 模型与后端”可改。`IMAGE_AGENT_FORCE_MAX_ROUNDS` 或请求参数 `agent_force_max_rounds` 可强制跑满轮数；关闭时由模型调用 `continue_generation` 和本站自检决定是否继续。上传的文本/代码类文件会作为上下文读取，PDF 会作为 Responses `input_file` 传入；不会开放服务器本地路径读取。

Agent 会产生结构化任务卡，包括联网搜索、工具兼容性调整、生图、流式预览、继续/停止决策和失败信息。`response.image_generation_call.partial_image` 这类流式预览会按“流式预览”展示；真正的 Agent 草图/改版会作为独立输出保存，并在图库的 Agent 草图 Tab 中和最终成品分开。

内部 Chat/Agent 的 Codex/Responses 可选开启 Responses 原生状态：`IMAGE_RESPONSES_PREVIOUS_RESPONSE_ENABLED=false` 时沿用本站手动历史重建；开启后，命中同一后端成员时会设置 `store: true` 并传 `previous_response_id`，后端成员切换、上游返回 invalid previous response 或 Store must be false 时，会自动回退到手动历史或 `store: false`。该开关只影响内部 Chat/Agent，不会改变普通单次文生图、图生图或外接 `/v1/responses` 的透传语义。

TODO：

- Agent 批量生图工具：参考 `generate_image_batch` 模式，让模型规划多张独立图片后由后端并发执行，并把每张图作为独立任务卡展示。该能力暂未接入运行时；接入前需要先设计它与 Responses `previous_response_id` 粘性会话的关系，避免并发子请求打散主会话链。
- 进一步原子化 `@` 图片引用交互：将 `@图1`、`@第N轮图M` 做成不可半删的输入标签，支持图片重排后自动重映射，以及缺失引用提示。
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

线上 Superapi 实例使用 Nginx 静态 alias，部署时必须先把 `apps/web/.next/static` 同步到 Nginx 静态目录，再切换公网 upstream；不要复用已经被浏览器或 Cloudflare 缓存过 404 的旧前缀。AB/灰度部署时保留上一版 release 和旧静态资源，先切当前公网端口验证新前缀，再按 runbook 同步旁路服务，方便随时回退。

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

# 每 10 分钟把卡在处理中超过 20 分钟的生图任务置为失败并退还积分
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
- `CREDIT_PACKAGE_MATRIX` 控制按量包、是否可见、数量、最低可购买套餐、各套餐价格和 Creem 产品 ID。后台以表格编辑，保存后仍写入同一个 JSON 设置；主页套餐区会尽量读取后台配置自动生成按量包文案。
- `CREDITS_EXPIRY_DAYS` 控制按量购买积分默认有效期，`0` 表示永不过期；`FREE_CREDITS_EXPIRY_DAYS` 控制注册奖励、管理员赠送等免费积分默认有效期。
- `PAYMENT_PROVIDER` 支持 `creem` 和 `epay`。
- Epay 回调地址使用 `EPAY_NOTIFY_URL`，Creem 使用 `/api/webhooks/creem`。

用户账单入口：`/dashboard/billing`，其中“账单”和“用量”是独立子 Tab。

管理员可在用户管理中给用户增加积分、扣减积分、覆盖余额、冻结/恢复积分账户、修改套餐。直接修改套餐不会额外发放套餐月积分；月积分由订阅/套餐周期和能力矩阵规则处理。

## 测试

```bash
pnpm test
pnpm --filter @repo/shared test:matrix
pnpm --filter @repo/web test -- responses-native-state
pnpm --filter @repo/shared typecheck
pnpm --filter @repo/web typecheck
```

矩阵测试覆盖默认矩阵、后台示例同步、自定义配置、非法值回退、高级套餐继承、审核等级、旧配置兼容、Chat/Agent 轮次计费和业务访问器。Responses native state 测试覆盖 `previous_response_id` 命中、账号轮换回退、Store must be false 回退、`@`/`<ref>` 图片引用、历史图输入、PDF input_file 和缓存读 usage 观察。

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

### `/v1/chat/completions` 为什么不可用

当前站点保留了该路由用于返回明确错误，但没有实现 Chat Completions。对外多模态和生图请接 `/v1/responses`、`/v1/images/generations`、`/v1/images/edits` 或 `/v1/agents/images`。

### Agent API 为什么不能走 Web

Agent 依赖 Responses 工具循环、`web_search`、`image_generation` 和 `continue_generation`，因此只调度 Codex/Responses 账号或支持 `/responses` 的外接 API 后端。Web 账号用于普通页面文生图、图生图和 Chat，不承接 `/v1/agents/images`。

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
