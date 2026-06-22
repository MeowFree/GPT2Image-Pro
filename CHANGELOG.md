# Changelog

本文件记录各发布版本的变更。版本格式 `v<MAJOR>.<MINOR>.<PATCH>`。

## v0.6.1 (2026-06-22)

修复 Adobe gpt-image 图生图(`/v1/images/edits`)经 Adobe 后端 100% 失败;`/v1/models` 补全 Firefly 模型;创作页视频展示预估价格。

### 新增

- **控制台视频价格**:生视频面板新增「预计消耗 N 积分」及其构成(时长 × 每秒基价 × 模型族倍率,再叠加 Adobe 后端倍率),随模型族/时长实时更新。抽出纯函数 `applyVideoBackendMultiplier`,扣费侧与前端预估共用同一口径,确保展示价 = 实扣价。

### 修复

- **Adobe gpt-image 图生图全线失败**:`/v1/images/edits` 路由到 Adobe direct 后端时 Adobe 返 400「Image edit use case requires a reference image」,该路径自 v0.6.0 上线起从未成功(生产日志佐证)。
  - 根因:gpt-image edit 的 `referenceBlobs.usage` 用了 `general`,Adobe 不把它当作 edit 源图。v0.6.0 误判"与 nano-banana 一致用 general";而早期"subject 无效"的结论实为当时 `module` 仍是 `text2image`(漏改)导致退化成文生图、忽略了参考图。
  - 经对真实 Adobe API 实证(`scripts/probe-adobe-edit.ts`):gpt-image(2/1.5)edit 必须 `usage=subject`,nano-banana(pro/2)edit 必须 `usage=general`,两族恰好相反。故 gpt-image 分支改 `subject`、nano-banana 保持 `general`(现有实证背书)。完整 edit 链路(submit→轮询→下载)已实测出图。
- **`/v1/models` 不返回 Firefly 模型**:此前只列默认图像模型 + GPT chat/responses,API 用户无从发现 Firefly。现补入 5 个图像族级 id(`firefly-gpt-image-2`/`1.5`、`firefly-nano-banana`/`nano-banana2`/`nano-banana-pro`,分辨率/宽高比走 `size`)+ 58 个视频全量 id(参数编码在 id 内),由 `externalApi.images.generate` 能力门控。

## v0.6.0 (2026-06-21)

接入 Adobe Firefly 作为独立后端生态:图像(gpt-image / nano-banana 系列)与视频(sora2 / veo31 / kling 等 7 族)直连出图,经 Go TLS 旁路过风控,自管 Adobe 账号/token 池;统一到既有账号池调度、计费、监控与 v1 API 体系。迁移 0040-0044。

### 新增

- **Adobe Firefly 图像直连**:完整移植逆向逻辑直连 Firefly,不依赖外部进程。
  - 模型 id `firefly-<family>-<resolution>-<ratio>`,family ∈ gpt-image-2 / gpt-image-1.5 / nano-banana / nano-banana2 / nano-banana-pro;resolution 1k/2k/4k;ratio 1x1/16x9/9x16/4x3/3x4。可作 `model` 用于 `/v1/images/generations`、`/v1/images/edits`。
  - gpt-image **质量用户可控**(low/medium/high → Firefly detailLevel 1/3/5;auto 走后端默认),并区分 gpt-image **2 / 1.5** 版本(版本进 model 名,upstreamModelVersion 由名字定)。
  - 图生图走 gpt-image,参考媒体用 `referenceBlobs`。
- **Adobe Firefly 视频生成**:
  - 7 族(sora2 / sora2-pro / veo31 / veo31-ref / veo31-fast / kling-o3 / kling3),model id `firefly-<family>-<dur>s-<ratio>[-<res>]`;支持图生视频(首帧)。
  - 创作页新增「视频」tab(可 @ 历史图作首帧)、SSE 长任务路由 `/api/videos/generate`、外部 API `/v1/videos/generations`(OpenAI-images 风格响应)。
  - 计费 30 积分/秒 × 时长 × 模型族倍率;`video_generation` 表落库 + 幂等扣费/失败退款 + 产物 re-host。
- **调度接入**:Adobe 伪装成特殊 "firefly" account 成员,挂入分组按优先级参与调度(配低优先级即作兜底层);`force_firefly`(API,下划线/驼峰均收)强制把任意请求路由到 Adobe,标准参数兼容、默认族 gpt-image-2。
- **计费倍率体系**:整个 Adobe 后端倍率(后端表单)+ 图像/视频**每模型族倍率**(Adobe tab「模型计费倍率」表格);最终积分 = 基础 × 模型族倍率 × Adobe 后端倍率 × 分组倍率。
- **Adobe 账号管理**:admin「Adobe 后端」tab 支持 cookie 导入并验证、token 轮换、Firefly 余额展示;`gpt_image_quality`(auto 映射目标)后端可配。
- **全局状态监控接入**:后端健康新增「Adobe Firefly」块;时延/SLA 新增 adobe 桶;独立「视频生成」统计区块(读 `video_generation`,按状态/模型族/积分/时长)。
- **创作页**:选 Firefly 模型时隐藏 GPT 模型选择器与思考强度、置灰 adobe 不消费的参数;新增 Firefly 图像/视频选项。
- **基建**:Go TLS 旁路(chatgpt-web-proxy)白名单支持 `.adobe.io/.adobe.com/.adobelogin.com`;API 文档补充 Firefly 模型、`force_firefly`、`/v1/videos/generations`。

### 变更

- **模型计费倍率入口去重**:`IMAGE_MODEL_MULTIPLIERS`/`VIDEO_MODEL_MULTIPLIERS` 从「系统设置 · 积分」面板隐藏,统一在 Adobe tab 的表格编辑(同一份数据)。

### 修复

- **调度租约/touch 漏处理 adobe 成员**:`acquirePoolMemberInflightLease`/`touchSelectedMember` 把 adobe 当 account 查表 → 租约恒 "full" → adobe 永不被选中("无可用 Adobe 视频后端")。补 adobe 分支。
- **pool-adobe 生图无限递归**:`retryPoolBackendResult` 对 adobe 提前 return 未清 reportResult → 同步无限递归(Maximum call stack size exceeded)。改为带 reportResult 的池后端统一进主循环。
- **pool-adobe 结果未上报**:`reportPoolBackendResult` 类型守卫漏 pool-adobe → 成功/失败计数恒 0、监控显示"成功0·失败0"。补 pool-adobe。
- **gpt-image 质量锁死**:派发未传 qualityLevel → 一律落最低 detailLevel 1,medium/high 成死码。现透传质量。
- **gpt-image 图生图被拒**:Adobe 新 API 对 `referenceImages` 返 422,改用 `referenceBlobs`(usage=general)。
- **公开视频路由 404**:`/v1/videos/generations` 仅建在 `/api/v1`,补镜像到公开 `/v1` 树。
- **admin Adobe tab 不响应**:`BackendPoolTab` 类型与 Tabs onValueChange 白名单漏 `"adobe"` → 点 Adobe tab 回落到 groups、内容按钮 onClick 不被接管。两处补 adobe。
- **结果详情积分显示 0**:文生图结果经 visualResults fallback 解析时 `creditsConsumed` 写死 0(影响所有后端)。ResultState 携带真实积分。

## v0.5.6 (2026-06-20)

### 变更

- **Web-first 像素区间在 web_first 开启（含默认未传）时即生效**:此前默认/显式 `true` 无条件优先 Web、像素区间仅在显式 `false` 时才判定,导致超界尺寸(如 4K)被强制塞给出不了大图的 Web 账号。现 `web_first` 开启时一律按像素区间判定——尺寸落在区间内(默认 0.66MP-2MP)才优先 Web、超界(如 4K)走正常调度(Codex/Responses);`auto` 或无法解析的尺寸视为可优先 Web;显式 `false` 不优先 Web。仅 mixed 分组生效;同步更新接口文档。

## v0.5.5 (2026-06-19)

修复 always_active（遇错常驻）后端在终态/鉴权错误下不下线导致的"死号黑洞"。

### 修复

- **终态/鉴权类错误即使 always_active 也标 error 并踢出轮换**：
  - 现象：常驻账号 token 失效/过期后被反复选中 → 必失败 → 再被选中，30 分钟内约 388 次 `401 token_expired`，并把最终失败 `image_generation_server_error` 返给用户。
  - 根因：always_active 原设计"遇错不下线"——失败时丢弃整个分类结果（不改 status、不进冷却），且入选条件对 always_active 无视 status。这对临时错误（overload/5xx）正确，但对终态错误（token 失效/过期、401/403、凭据失效、封号、GROUP_DISABLED；分类器 status="error"）形成持续吃流量的黑洞——死号无法靠常驻自愈。
  - 修法：always_active 仅豁免临时错误（status=active+cooldown）；`status="error"` 的终态错误照常标 error（账号与 API 两侧失败上报），且入选时 always_active 不再豁免 `status="error"`（仍豁免 cooldown 与临时故障）。请求侧不变——这些错误本就 switchable，自动切其他后端重试。

## v0.5.4 (2026-06-19)

修复 v0.5.3 引入的 codex 直连 images 端点请求格式问题(生成/图生图恢复正常并遵循尺寸),并统一下载文件名格式。

### 修复

- **codex 直连 images 请求格式适配**(v0.5.3 回归):codex 的 OpenAI 标准 images 端点要 JSON、不接受非标准参数,v0.5.3 的直连请求触发 400。
  - 生成:去掉非标准 `width`/`height` 与 gpt-image 不支持的 `response_format`(原 `Unknown parameter: 'width'`)。
  - 图生图:改走直连 JSON `/images/edits`(照 CPA codex 格式:输入图/mask 用 base64 data URL 放 `images[].image_url` / `mask.image_url`,`size` 顶层),不再用 multipart(原 `Unsupported content type`)。
  - 二者均确定性遵循 size;chat / agent / 瀑布流仍走 `/responses`;pool-api 后端不受影响。

### 新增

- **统一下载文件名格式**:图库 / 灯箱 / PSD 导出的下载文件名统一为 `gpt2image_<hash>_<ISO 8601 毫秒时间戳>`。

## v0.5.3 (2026-06-18)

图片清理新增「每用户最大保留张数」模式、codex 生图遵循尺寸、Web-first 默认开启,及全库审计 P0/P1 修复与画廊批量操作。

### 新增

- **图片清理「按每用户最大张数」模式**:在永久保存基础上,可选改为每个用户各自保留最新 N 张(默认 10000)、删除其更老的图;启用即后台执行一次清理,定时任务逐批收敛。清理模式三态(关闭=永久保存,默认 / 按时间过期 / 按每用户最大张数),只删图片文件与图库展示,生成记录与计费流水保留。
- **画廊批量操作**:多选 + Shift 范围选择、批量下载、两步确认批量删除;历史页新增页码输入框;修复创作页路由切回时残留上次输入。

### 改进

- **codex 生图遵循尺寸**:codex(Codex/Responses 账号)的普通生成与图生图改走该账号 `/images/generations`、`/images/edits` 直连端点(照 CPA codex 直连格式:JSON 体、`size` 走顶层、图生图输入图/mask 以 base64 data URL 放 `images[].image_url` / `mask.image_url`),确定性遵循尺寸;此前经 `/responses` 的 image_generation 托管工具不尊重 size。codex images 端点要 JSON(不接受 multipart→400 Unsupported content type),也不认非标准 `width`/`height` 与 `response_format`,直连请求已去掉。chat / agent / 瀑布流仍走 `/responses`。
- **Web-first 默认开启**:Web-first 优先路由改为默认开启(不传即优先 Web、失败回退 Codex/Responses);仅当显式传 false 时才用 Web-first 像素区间判定。chat 的 `mix_web_first` 并入同一决策。仅对 mixed 后端分组生效,agent 不受影响。

### 修复

- **全库安全/正确性审计 P0+P1**:存储失败路径积分消耗不落库(两次 UPDATE 第二次空命中)、管理员充值缺幂等键可重复入账、画廊与 admin 状态页无 LIMIT 全量加载、Creem webhook 乱序漏发积分;新增 `subscription(user_id, updated_at DESC)` 索引优化 getUserPlan 热路径(迁移 0039)。
- **onnxruntime .so / ISNet 固化进 standalone**:用 `outputFileTracingIncludes` 显式 trace,修复 standalone 缺 `libonnxruntime.so.1` 导致 dashboard 路由 server action 全 500、前端积分/套餐静默回退免费版的事故(裸机与 Docker 共用,不再需手工补拷)。
- **SLA 样本只取已完结记录**:卡片合计与样本数对齐(在途 pending 不再被静默跳过)。

## v0.5.2 (2026-06-11)

错误分类与自动重试加固(未知错误兜底切换、GROUP_DISABLED 踢出)、`prompt_repair` / 透明背景开关贯通全部 v1 端点、后端池多分组与账号常驻,及若干计费 / 登录修复。

### 新增

- **外接 API 控制开关贯通**:全部 v1 端点(images / responses / chat/completions / agents)统一支持 `prompt_repair`(审核改写重试,可关;关闭后审核拦截直接返回真实错误,issue #24)与透明背景控制;文档将 `background`(OpenAI 标准参数)与 `transparent_matte`(本站扩展,服务端 ISNet 抠图)拆分说明,补齐英文文档与请求示例(issue #27)。
- **透明背景抠图回退改为显式开关**:仅当请求 `transparent_matte=true` 时才走"不透明重生成 + 服务端抠图"回退,默认不再隐式抠图;修复回退漏判 `result.error` 返回路径(issue #27)。
- **账单 / 用量显示 API Key**:每条记录标注消耗对应的 API Key,便于多 Key 用户对账(issue #26)。
- **后端池**:外接 API 后端支持多分组;账号后端新增「遇错常驻」(always_active,与 API 后端同名能力对齐——失败不下线、不进冷却);API 后端并发数上限 100 提至 10000。
- **输入图转发兜底**:上游下载我方输入图失败时,自动回退 base64 内联在同后端重试一次。

### 修复

- **错误分类与自动重试**(2026-06-10 生产事故复盘产物):
  - `GROUP_DISABLED`(API Key 所属分组被上游停用)按确定性坏配置处理:本次请求自动切换其他后端重试,该后端标记 error 踢出轮换——不再形成"持续吃流量且每次都失败"的黑洞。
  - 未被任何分类记录的未知错误允许最多切换 3 次后端兜底:切换判定是白名单制,首次出现的新形态平台错误此前会当场失败砸在用户头上。
  - SLA 统计移除裸 `insufficient_quota` / `unauthorized` 匹配:平台池配额耗尽(`no available image quota`)与池账号 401 不再被错记为"用户请求错误"而从成功率分母剔除。
  - 20 分钟生成超时的错误文案与实际结算行为一致(退生成费、保留已发生的审核费),不再笼统宣称"积分已全额退还"。
- **外接 API 积分不足返回 402**(原 502):语义正确,并止住客户端把它当服务端错误的自动重试风暴。
- **webview 内密码重置 403**:关闭 Origin 头 CSRF 校验(webview 请求不带 Origin 被误拦)。
- **sub2api 同步收敛**:不再覆盖本地优先级与最大并发,同步仅更新上游错误 / 限流状态,本地调度参数由管理员自控。
- **登录态下首页 CTA 直达创作页**,不再跳注册 / 登录(issue #20)。

## v0.5.1 (2026-06-07)

修复 Docker / 反代部署的一批登录、配置与镜像问题(issue #18 评论反馈)。

### 修复

- **反代后无法登录**:`trustedOrigins` 原用 `NEXT_PUBLIC_APP_URL`(被 Next 构建期内联成固定值,运行时改无效、默认 `localhost`),反代域名不被信任 → 登录 / 登出 / 改密均失败。改用运行时可读的 `BETTER_AUTH_URL`,并新增 `BETTER_AUTH_TRUSTED_ORIGINS`(逗号分隔)追加额外受信域名(反代 / 多域名部署填实际访问域名即可)。
- **后台改配置必须重启容器才生效**:系统设置只在启动时由 bootstrap 灌入 `process.env`,而邮件 / 鉴权等同步读取器只读 `process.env`,保存后未同步 → 改邮件配置不生效、SMTP 已配仍退回 Resend、发码 400。修复:保存设置时同步写回当前进程 `process.env`,即时生效、无需重启(单实例部署)。
- **关闭自用模式保存失败("支付模式值不对")**:支付通道 `select` 选项缺少自用部署默认的 `none` 值。新增「不启用(自用)」选项,自用模式可正常保存。
- **Docker 镜像 ISNet 抠图(PSD 导出 / 透明回退)无法运行**:基础镜像由 alpine(musl)改为 `node:22-slim`(glibc,onnxruntime-node 仅 glibc 预编译),补拷 Next 未 trace 的 `libonnxruntime.so.1` 与 ISNet 模型,并设 `ISNET_MODEL_PATH`。

> 注:登出失败、改密"密码错误"、注册"邮箱已被使用"多为上述反代 / 邮件问题的连带症状,随之修复;图库筛选(日期 / 提示词)为功能需求,后续版本提供。

## v0.5.0 (2026-06-06)

新增「打散元素生成 PSD」(生成式分层 PSD 导出);Agent 多轮更稳;创作页与图片加载性能、若干积分/后台/支付/部署修复。

### 新增

- **打散元素生成 PSD(生成式分层导出)**:创作页 Agent 模式新增「打散元素生成 PSD」开关——生成时先出整图,再把画面逐层打散(背景 + 每个前景元素各一层);在出图详情点「导出 PSD」按需组装成 Photoshop 可编辑的分层 `.psd`。抠图以 ISNet 为主(实心主体干净),对稀疏/接近白的元素(如樱花树)自动回退白底 chroma-key 兜底,逐层单独抠再用 ag-psd 进程内组装;导出异步执行 + 前端轮询,免疫 Cloudflare 100s 超时。整图归「成品」、各层归「中间图」,分层的每一轮图逐张计费。
- **透明背景回退**:后端不支持 `background=transparent`(400)时,自动改为不透明生成 + 服务端 ISNet 抠图得到透明结果(创作页透明选项 / 外部 API),不额外扣费。

### 修复 / 增强

- **Agent 多轮稳健性**:
  - 修复 codex(store 关闭)上游 `response.completed.output` 为空导致续轮(continue_generation)漏判、多轮/分层停在第一轮——改为用流式累积的输出项兜底。
  - 续轮遇可切换上游错误(token 失效 / 限流 / 账号不可用)时自动换号重跑,不再静默只保留首图。
  - 修复 `continue_generation` 参数被逐 token 刷屏的日志。
  - 分层运行轮数给足(上限 8、不强制跑满),避免前景元素被截断丢层。
- **前端性能 / 预览**:
  - 创作页最近面板/变体/卡片改走 `/w/` 路径段缩略图(绕开对带签名本地图返回 400 的 next/image 优化器),不再加载全分辨率原图,消除"最近生成页/图片加载超慢"。
  - 文生图/视觉模式结果点击预览修复(visualResults 也能解析,不再是"假按钮")。
  - 分层结果完成后的大图默认展示整图成品(而非最后生成的某个图层)。
- **积分 / 后台**:
  - 超管可给自己充值;管理员手动充值的积分不再设有效期(长期有效);扣减按「最快到期优先」。
  - 移除「覆盖积分余额」;修改套餐未配置月付 Price ID 时给出可操作提示,而非笼统"服务器错误"。
- **营销 / 支付 / 后端池**:
  - fumadocs CSS 下沉到 blog/legal 页,修复首页 Header 导航与控制台入口整片消失。
  - 套餐 `priceId` 永不为空,修新部署"未定义 priceId" / 误报 Creem Price ID。
  - sub2api 同步只取上游错误 / 限流,不再同步启停 / 可调度态(本地启停由管理员自控)。
- **部署 / 文档**:
  - `docker-compose` 强制 `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` 必填(缺失即启动失败并给中文提示),`.env.example` 强化"部署前必配"与域名一致性说明,避免新部署后(含超管)无法登录。
  - 给缺 `loading.tsx` 的 dashboard 路由补骨架屏,修软导航阻塞("点不动其他 Tab")。

## v0.4.0 (2026-06-04)

性能为主：显著降低前端卡顿、图片加载与大表查询开销;并修正若干生图后端错误分类与输入图转发。

### 性能

- **前端包体瘦身（每页 −~430KB，约 26%）**：定位到每个 dashboard 页此前强制下载/hydrate ~1.6MB JS，其中图表库 recharts（~107KB gzip）因模板残留的死图表卡经 barrel 被拖进每页公共包。移除 3 个从未渲染的死图表卡、修正 barrel 导入、并将控制台首页定价图表改为 `next/dynamic` 按需懒加载——recharts 仅在需要时异步加载，各页首屏 JS 由 1.6MB 降到 1.2MB。（服务端 SSR 本就 ~6ms，非瓶颈。）
- **图片缩略图按需缩放（单图 ~161x 更小）**：历史/图库等列表此前直接加载全分辨率生成图（平均 2.4MB、最大 14MB），拖垮浏览器内存与解码，导致"点历史/图库后整体发卡"。`/api/storage` 读取路由新增 `?w=<width>`，用 sharp 缩成小 webp 并按 (bucket,key,width) 进程内缓存；网格缩略图改请求小图，lightbox 仍取全图。单图实测 2.07MB → 13KB。
- **生图大表读路径加索引**：`generation`（686MB / 12 万行）与 `credits_transaction`（14 万行）此前仅主键索引，历史/计数/账单与"每次读触发的 pending 维护扫描"全是顺序扫（累计读 23 亿行）。新增 `generation(user_id, created_at)`、`generation(status, created_at)`、`credits_transaction(user_id, created_at)` 索引，转为索引扫描（历史计数 22ms→6ms、维护扫描 15ms→0.03ms、账单 0.1ms）。
- **画廊查询收敛**：成品主查询仅在对应标签页执行、移除与计数重复的查询，减少每次进画廊的无效 DB 往返。

### 修复

- **生图后端错误分类更准**：修正"为算 token 下载我方图片被限流（429）""未开通图像生成（403 permission）""分辨率/尺寸不符、无效图像"等的归类（可切换后端 vs 用户错误 vs 标记 error），减少误判与误下线。
- **输入图转发**：pool-api 分发前 re-host 输入图、不再把第三方外链直接交给上游；`fetchPublicImage` 对 429/5xx 有限重试。

## v0.3.1 (2026-06-03)

图像后端池（image-backend-pool）增强：更可观测、可控，调度在少量/不稳后端下更稳。

### 新增

- **启用/停用开关**：后端池 API 成员新增列表内「启用/停用」快捷按钮与编辑表单开关；用户自配外部 API 也补齐启用开关。
- **测活（真实出图）**：对后端发起一次真实最小生图请求、校验是否真的返回图片（取代仅探 `/models` 连通性，能识别"接口通但出不了图"）；用户自配 API 增加「测试出图」。
- **最大并发数可配置**：API 后端新增「最大并发数」（默认 10，范围 1-100）。整池可并发 = 各后端最大并发数之和。修复此前 API 并发被写死为 1、高并发下报「无可用账号或 API」的问题。
- **遇错常驻（always_active）**：API 后端可标记常驻——遇错不下线、永不冷却、无视并发上限始终参与调度。
- **失败冷却改每后端开关**：新增每后端 `failureCooldownEnabled`，取代全局 `IMAGE_BACKEND_API_FAILURE_COOLDOWN_ENABLED`。

### 变更 / 修复

- **失败分类**：
  - 上游缺 `image_generation` 工具（只回文字）→ 判为可切换到其他后端并标 `error`（此前会被"抱歉…"启发式误判为用户内容拒绝而当场失败）。
  - 坏中转（`没有可用token`、返回 HTML / 502）→ 升级为 `error` 下线（此前归"可恢复"、一直留在池里反复失败）。
- **error 粘性**：非常驻后端被置 `error` 后，不再被并发兄弟请求的偶发成功复活；仅由 测活通过 / 手动重新启用 / 编辑保存 / 勾选常驻 清除。
- **后台术语统一**为「最大并发数」，弃用含糊的「并发权重」文案。

### 数据库

- 迁移 `0032` / `0033` / `0034`：`image_backend_api` 增列 `always_active`、`concurrency`、`failure_cooldown_enabled`（均向后兼容，带默认值，无破坏性变更）。
