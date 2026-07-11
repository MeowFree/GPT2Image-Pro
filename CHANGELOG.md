# Changelog

本文件记录各发布版本的变更。版本格式 `v<MAJOR>.<MINOR>.<PATCH>`。

## 未发布

### 修复

- **首页影片主角与主旨重修**:v0.8.0 影片的主角是一张 GPT2IMAGE 占位排版海报,与 prompt 描述互相矛盾,展墙 16 格为同图滤镜变体,整片主旨(一次生成)无从成立。以确定性程序化水墨引擎(笔毫束几何 + 飞白 + 颗粒 + 洇痕 + 朱印,node+sharp 离线渲染)重绘全部资产:主角「一笔圆」+ 深度图 + 15 件不同题材展墙作品(竹/山/舟/梅/月/苇/瀑/松/鱼/塔/燕/莲/桥/雨/草书),样张清单抽为 `cinema-artworks` 单一事实源,promptSample 与铭牌题名(Cinema.wallTitles)全部对齐。
- **影片走查缺陷成批修复**:首屏标题空白(加载入显影时间线);画布两幕不同位(generate 幕改绝对居中与序幕同规格);显影呈数字网点纹(阈值改结构噪声主导 + 按亮度偏置,深色笔画先显影,未显影区为纸灰墨云);增殖粒子无形灰云(墨键控 + 两段编排:先原位爆散保住圆相轮廓再向格位收敛);被选中画从画外瞬移(PICKED_INDEX 按推轨几何改为 14,就近取画);观展低语挤在画缝不可读(几何层插入专属栏位并附署名);铭牌罗马编号无题名(启用 16 个真实作品名);暗场上页头漂浮(darkWindow 联动退场);增殖长段死黑(墨罩 12% 起平滑撤除);节奏偏快(行程 1550->1860vh,显影完成留静止一拍);主旨无指示(全片常驻章节导轨 01 输入/02 生成/03 万象/04 交付,随暗场反色);"查看示例"死锚点(改为滚动直达展墙)。

## v0.8.0 (2026-07-11)

UI 全站重构版:全站衬线化(Noto Serif / Noto Serif SC 自托管)对齐 GPT2IMAGE 单色设计体系,首页重构为 WebGL2 影片化滚动「一次生成 + 墨线」,dashboard/图库/创作页/设置/工单/管理后台/认证/内容页完成两轮视觉重构,并修复 create 页 hydration mismatch 与 a11y 问题、清理 278+6 个死文件。计划与逐 Phase 完成情况见 `docs/plan/2026-07-04-ui-overhaul.md`。

### 新增

- **首页影片化滚动「一次生成 + 墨线」**:首页重构为一部滚动驱动的影片——整页演绎一次真实的生成任务(prompt 打字 → 蓝噪声阈值去噪显影 → 穿越/墨反转 → 粒子增殖成展墙 → 选中回中 → 反向显影 bookend)。手写 WebGL2 摄影棚(扩散显影/GPU 粒子/流体墨/2.5D 深度推轨/胶片后处理五个 pass,零新依赖),七幕 1550vh 主行程 + 终幕独立舞台,墨线全页衔接章节;DOM 承载全部真实内容(SEO/i18n key 不变),GL 层动态挂载不入首屏关键路径;三层回退(完整 GL/中端简化/静态编排)与帧耗时自适应质量调控保证可读性与流畅度。旧首页区块组件(Hero/FeatureGrid/HowItWorks/Manifesto/UseCases/Testimonials/CTA)内容全数迁入各幕后退役(开发期第一轮 scroll-fx 动效层亦被其吸收)。设计稿与完成情况见 `docs/plan/2026-07-10-homepage-cinema-design.md`。
- **全站衬线字体**:中英文统一 Noto Serif / Noto Serif SC(可变字体,自托管),等宽仅保留给代码;html lang 按 locale 修复。
- **主题圆形揭幕与 token 补全**:主题切换 clip-path 圆形揭幕动画;whisper/menu/modal 阴影与 success/warning 语义色进入 token 体系。

### 变更

- **两轮全站视觉重构**:第一轮分区对齐衬线单色体系(dashboard 壳/认证、图库/历史/灯箱、设置/工单/账单/积分/公告、管理后台、营销/博客/pSEO/文档、UI 基础原语);第二轮 v2 精修(dashboard 悬浮玻璃顶栏、图库高端画廊气质、创作页分段控件与统一气泡语言)。
- **死代码清理**:删除仓库根游离旧单体应用残留 278 个文件,分区重构中另清理 6 个死文件/死组件。

### 修复

- **create 页 hydration mismatch**:持久化激活模式改为挂载后按套餐能力校验再恢复,并补全 chat-web/video 模式白名单。
- **lint 与 a11y**:create-page-client 由 7 个既有 error 清至 0(余 70 条告警级 warning);管理后台等 label 关联 a11y 修复。
- **hover 微交互**:修复 hover 位移/缩放过渡失效与首页示例卡分层问题。

## v0.7.0 (2026-07-01)

本版围绕「号池自动化」与「出图质量/一致性」两条线:后台新增 ChatGPT 注册机(可随主镜像发布的 sidecar,自助注册养号 + 号池自动维持 + 代理/域名/IP 策略),给出图接上「分辨率超分校准」(上游图偏小时自动放大到目标尺寸)与可选的「高清修复」,并从根上修掉「同参考图/同提示词串出同一张图」的上游内容缓存问题;部署侧改为 standalone 自服务静态 + 3308(主)/3307(备)蓝绿。

### 新增

- **ChatGPT 注册机(号池自动化)**:后台新增「注册机」Tab,集成 ChatGPTRegister 自助注册养号,产出账号直接进生图号池。打包为可随主镜像一起发布的 **sidecar 容器**。支持:**号池自动维持**(把可用号数量稳定在设定值,低于阈值自动补注册);**IP 自动刷新**(「每分钟一次」与「每 100 次尝试一次」取其慢者,刷新 URL/参数可配);**禁用代理**开关(不配代理时直连本机 IP,单独按钮);**轮换域名**开关(每一轮用不同的启动域名)。相关配置收在注册机 Tab 内、不进总配置面板;启用/停用等开关点击即时保存。
- **出图分辨率超分校准(Real-ESRGAN)**:上游(尤其 codex)常返回分辨率明显低于请求的图;当实际较长边 < 目标较长边的 **2/3** 时,用 Real-ESRGAN general-x4v3 放大并增强细节,再按比例缩到目标边长(不裁剪、不改宽高比),其余情况原样返回。由管理端主开关 `IMAGE_SUPER_RESOLUTION_ENABLED` 控制,CPU 单张 512→2048 约 1.6s;是否触发为纯函数(便于单测),失败回退原图、不阻断出图。
- **高清修复(SCUNet,可选、默认关)**:与超分**相互独立**的请求级「高清修复」开关——勾选时用 SCUNet 对最终图做盲复原(去噪 / 去压缩块 / 增强质感,**不改分辨率**);超分负责「放大到目标尺寸」、修复负责「提质感」,两者可叠加(先修复再超分)。CPU 推理较重(512 约 11 秒、1024 约 35 秒),服务端**全局串行排队**防并发打满机器;由管理端主开关 `IMAGE_RESTORATION_ENABLED` 门控,需用户手动勾选,默认关。

### 修复

- **同参考图/同提示词串出同一张图(上游内容缓存)**:客户直连(未经中间代理)时,相同输入被上游按 `prompt_cache_key`/内容缓存命中,反复返回同一张图。三处收口:`prompt_cache_key` 并入完整输入签名(含参考图),杜绝不同参考图命中同一缓存;每请求追加唯一盐,支持「同图不同结果」;images 直连路径注入每请求**零宽 nonce** 破上游内容缓存(对最终图不可见)。
- **用户侧输入错误不再误判/误重试**:提示词过长、参考图超数、输入图过大等**用户错误**归类为 `user_error`——不计入平台 SLA、也不触发换号重试;SLA 侧与调度侧两处分类器共用同一份模式,避免口径漂移。

### 部署与文档

- **注册机 sidecar 化 + 运行时 env 迁出 release**:注册机改为独立 sidecar 容器,可打入镜像并随主应用发布;部署 runbook 记录运行时 env 从 release 目录迁出、standalone 自服务静态、3308/3307 蓝绿发布流程(删除过时的 `/var/www` alias 与 3303)。
- **文档订正**:更正「codex 直连 images 端点尊重 size」的错误注释;补充图像后端池调度策略文档与索引。

## v0.6.4 (2026-06-28)

在早期改动(对话生图同图修复、工具限流按 429 处理、健康度实时化、文档目录与外部 API 并入)基础上,本版新增 Adobe 伪账号批量导入真实账号与 cookie 导出扩展;把 Adobe 直连改为「伪账号内换号重试到底、再交外层切后端」;让「遇错常驻」后端不再被 dead-relay 踢空;并把后台 SLA 状态页重写为按窗口聚合 SQL 的精确统计。

### 新增

- **Adobe 伪账号下批量导入真实 Adobe 账号**:在某个 direct 模式 Adobe 后端(伪账号)下,一次粘贴多份 IMS cookie 批量导入真实 Adobe 账号——逐条刷新验证(best-effort,单条失败不阻断、逐条回报原因),按 Adobe 稳定身份(accountUserId/邮箱)去重,每条成功即落库(整体请求超时也不丢已导入,重新粘贴自动跳过已导入)。配套仓库附带 `tools/adobe-cookie-exporter/`(Chrome/Edge MV3 浏览器扩展,思路参照原 adobe2api)一键导出 Adobe/Firefly 登录 cookie(含 HttpOnly),导出 JSON 与后台导入框兼容。

### 后端调度与稳定性

- **Adobe 后端按所在分组「车道」隔离参与候选**:此前 Adobe 后端对所有图像请求始终参与候选、不分 web/codex 偏好,导致 web 偏好请求在 web 账号失败后**漏到 codex 车道的 Adobe 直连后端**,被其单账号 429 接盘、整站图像失败堆在它名下。现按其所在分组的 `backendType` 隔离:`web` 分组的 Adobe 只服务 web 阶段、`responses(codex)` 分组的只服务 codex 阶段、`mixed` 分组不限车道(谁都可请求);`force_firefly`/`firefly-*` 请求不受限(必走 Adobe)。与账号/API 的「web 请求只走 web 分组内」范围隔离对齐。
- **Adobe 直连「伪账号内换号重试到底」**:Adobe 直连(图像+视频)此前只取一个账号 token 调一次,撞 `submit failed: 429`/配额/鉴权即整次失败;现改为在单个 Adobe 后端内逐账号轮换重试(撞可轮换错误就标记当前 token、换下一个可用账号),本后端账号轮完才上抛,再由外层池切换到其它 Adobe 后端继续轮换——两级都重试到底,本后端下批量导入的多账号不再一撞 429 即失败。
- **「遇错常驻」(always_active)后端遇 dead-relay 不再被踢**:常驻 API/Adobe 后端遇 502「HTML response body」等 dead-relay 终态错误不再被自动标 error 踢出(此前只豁免临时错误,导致常驻 relay 撞 502 被踢空触发「没有可用的默认生图后端」);账号(web/codex)OAuth 终态错误维持原样。
- **firefly/nano-banana 请求不再泄漏到非 Adobe 后端**:换号重试保持 `fireflyOnly`、chat/agent 拒绝 firefly,并加不变量兜底。
- **上游不可用按 dead-relay 踢出轮换**:502「service temporarily unavailable」、504「HTML response body」标 error 踢出(按运维要求)。

### 可观测性 / SLA

- **后台 SLA 状态页按窗口精确统计**:24h 与 7d 改用按各自窗口的聚合 SQL,修复「7 天与 24 小时显示相同」(原因是 1 万行带帽样本在高峰塌缩成同一批最近行);耗时分布、审核修剪重试也按窗口精确。
- **Web 后端静默超时归因为「疑似审核拒绝」**:ChatGPT 网页后端对违规内容常静默挂到 20 分钟超时(无审核码/拒绝文本),现按标记从「平台错误」移到「审核拦截」,避免隐性审核被淹没在平台超时里。

### 导入与设置

- **Web AT 导入更稳/更清晰**:容忍任意分隔符按 `eyJ` JWT 形态兜底提取;导入结果与报错明晰化(识别/写入/失败计数 + 首个错误)。
- **审核拦截级别注明生效条件**:用户档案与 API Key 的审核级别均注明「仅当启用审核拦截时生效」,并标注用户档案设置仅作用于网页端生成。

### 修复

- **对话生图同提示词出同图(并发复用同一会话)**:对话生图(千问灵感等)走 ChatGPT web 原生会话续接(复用上一条 `conversationId`/`parentMessageId`),多个并发的同历史请求会锚定同一节点 fork 出几乎一样的图。修法:对「续接会话」加进程内并发互斥——同一会话同时只放行一个续接占用,其余并发请求一律改开新会话,从源头消除同图(不引入随机扰动)。
- **ChatGPT 画图工具限流被误判为「无图」**:账号画图工具(`image_gen.text2im`)被账号级限流时,上游不返图,而以 `content_type=system_error`、`name=ChatGPTAgentToolRateLimitException` 的消息塞进 o/v 流;此前 SSE 解析两条路径都不命中(`message` 字段是对象、文案无带空格的 "rate limit"),降级成 "no image output" → 丢进 15 分钟通用临时桶、SLA 看不出是限流。修法:新增 `extractWebSystemError` 优先抽出 system_error 的 name+text;`classifyFailure` 增设工具限流分支(置于 usage-limit 之前)按 `limited` 处理,上游给出「resets in …」时按真实重置时间冷却(实测多为每日上限约 22 小时),否则回落独立桶 `IMAGE_BACKEND_TOOL_RATE_LIMIT_COOLDOWN_MINUTES`(默认 3 分钟,可配);并入 `isRecoverableBackendError`/`isResetAwareLimitedBackendError` 保住换号重试。
- **健康度调度实时性不足**:调度健康评分对账号「变差/恢复」反应偏慢、且只重排不熔断。两处提速:EWMA 平滑系数 0.2→0.4(近期结果权重翻倍,双向反应更快);`backendHealthPenalty` 新增按 `lastObservedAt` 的指数时间衰减(半衰期 3 分钟)——刚失败全额降级、久未观测的旧惩罚淡出,让疑似已恢复/闲置的号重新进轮换、定期复探。硬失败仍由冷却兜底,健康衰减只管软降级。
- **ChatGPT web 原始流分片泄漏**:`extractWebStreamError` 命中错误条件却抽不到可读字段时,曾把原始 `{"o":"add","v":{…}}` 分片当错误回显;`webErrorPayloadMessage` 现递归进 `v`、抽不到则只回限流/配额关键词短语,绝不回显裸分片。

### 文档

- **外部 API 异步视频流程置顶**:外部 API 的「视频」小节由「同步默认 + async 选项」改为异步优先——新增「异步流程」三步(提交 `async:true` → 轮询 `GET /v1/videos/{id}` 或 `callback_url` 回调 → 取 `video_url`),补轮询间隔与终态/失败 `error` 形状,把同步降级为仅短片段兜底的 keep-alive 提示(契合站内 UI 默认异步:视频是长任务、同步直连易被中途掐断丢产物)。
- **外部 API 并入「系统文档」,文档结构收敛**:外部 API 参考(图像/视频)整体并入「系统文档」——控制台 `/dashboard/backend-help` 与公开 `/docs/system` 同源,均渲染「系统架构与请求路由 + 外部 API 参考」(`BackendDocs`)。因 dashboard 不能引 fumadocs 的 `.prose` CSS(会用 @layer 覆盖布局),外部 API 的 MDX 改用一套自带 Tailwind 样式、语义化 token 的 `docsMdxComponents` 内联渲染(零外部 CSS 依赖、深浅色自适应、保留标题锚点)。旧 `/docs/external-api` 307 重定向到 `/docs/system`。
- **文档目录落地页 + 侧栏收敛**:`/docs` 根改为渲染 `index.mdx` 的「文档目录」(列出系统文档〔含外部 API,带「视频 · 异步流程」直达锚点〕、Adobe 路由/兼容,附快速开始);`/docs` 侧栏经 `content/docs/meta.json` 收敛为「文档目录 / 系统文档(含外部 API)/ Adobe 路由 / Adobe 兼容」四个平级页。

## v0.6.3 (2026-06-23)

新增「Adobe 来源 api 后端」能力与外部 API 跨域(CORS);补齐外部 API 参考文档;修复用户侧格式错误被误判为平台错误。

### 新增

- **Adobe 来源 api 后端**:部分提供商 API 是 OpenAI/gpt 格式但上游实为 Adobe;现可把这类 `image_backend_api` 标记 `adobe_sourced`,使其(1)**按 Adobe 口径计费**——`config.backend.billingMultiplier = 命中组倍率 × 成员倍率`,复用 Adobe 伪账号同一两级倍率链(普通 api 仅组倍率);(2)**纳入 firefly 调度**——候选过滤 `(!fireflyOnly || adobeSourced)`,与真 Adobe 同池按 priority 竞争;(3)**firefly-\* 反向转换**——纯模块 `adobe-sourced-firefly.ts` 把 `firefly-*` 请求截家族名为出站 gpt 模型(`backendModel` 可选覆盖)、由全量 id 推 size,派发层对此绕开 `getModel` 的 gpt-image-only 校验,故 nano-banana 家族也可由 api 后端服务;`force_firefly` 下普通 gpt 请求直接以 gpt 格式服务。后台 api 表单新增「Adobe 来源」开关 + 成员倍率输入 + 实时倍率算例(nano-banana-pro 含模型×组×成员)。迁移 0045 加 `adobe_sourced` + `billing_multiplier` 两列。默认惰性:不开则行为不变。设计文档见 `docs/plan/2026-06-23-adobe-sourced-api-backend.md`。
- **外部 API 跨域(CORS)**:外部 API(`/v1`、`/api/v1`)开放浏览器跨域,Bearer 鉴权不带 cookie、不开凭据,故 `*` 安全;预检回显 `Access-Control-Request-Headers`(兼容 OpenAI SDK 的 `x-stainless-*`)。是否允许由管理员系统设置 `EXTERNAL_API_CORS_ENABLED`(默认开)控制;落在 Node 路由层(Edge middleware 读不到 DB 设置)。
- **外部 API 参考文档**:新增 `/docs/external-api`——鉴权、图像(`/v1/images/generations`、`/edits`、`GET /v1/images/{id}`)、视频(`/v1/videos/generations` 同步/异步 + `callback_url`、`GET /v1/videos/{id}`)、其它端点与错误码,对照真实 handler schema 编写。
- **视频各模型积分对照表**:创作页「视频」面板按族 × 时长展示各模型积分消耗(与预估、扣费同口径),选模型前即可比价。

### 修复

- **SLA 分类:用户侧上传格式错误被误判为平台错误**:`classifyGenerationError` 缺对管线 `image_generation_user_error` 标签的兜底,导致客户端上传 mpo/avif 被上游 400 拒绝这类用户错误落进 `platform` 默认分支——既在后台标成「平台」,又被计入平台 SLA 分母。修法:在审核判定之后加标签兜底归 `user_request`(审核拒绝同样带该标签,故必须排其后);分类读取时计算,历史行无需回填即自动纠正。

## v0.6.2 (2026-06-22)

视频生成支持异步 + 按 id 查询;图库新增「视频」tab;修复视频后端 inflight 租约泄漏导致的视频全线失败。

### 新增

- **视频生成异步**:`/v1/videos/generations` 支持 `async=true` / `callback_url`——立即返回 `task_...`,后台生成,凭 `task_id` 或 `generation_id` 轮询 `GET /v1/videos/{id}`(先查内存异步任务,未命中按 `generation_id` 从 `video_generation` 持久取回,跨重启/多实例可查;handler 校验 `userId` 归属防越权)。同步 keep-alive 保留为默认并补 `generation_id`。视频是长任务,异步避免长连接被代理/客户端掐断后产物丢失。
- **图库「视频」tab**:图库新增「视频」tab,按时间倒序内联 `<video>` 播放已生成视频,展示 时长·比例·分辨率(视频不参与多选/批量下载)。存储路由补 `.mp4`=`video/mp4`(及 webm/mov):此前视频被当 `application/octet-stream`、浏览器 `<video>` 拒播——同时修复创作页视频面板播放。历史记录不加 tab。

### 修复

- **视频后端 inflight 租约泄漏 → 视频全线失败**:视频管线经 `getEffectiveConfig` 为 Adobe 成员获取 inflight 租约(进程内计数 + DB 租约)但全程不释放(图像管线有 `releasePoolBackendConfigLease`,视频侧此前完全没有)。每个视频请求(成功/失败都)泄漏一个租约,堆到 concurrency(默认 10)后该 Adobe 成员被 `hasBackendCapacity` 判为满载、彻底踢出候选,后续视频请求一律解析失败为「无可用 Adobe 视频后端」(单进程内重启才清、DB 租约约 18 分钟才过期)。修法:`releaseInflightLease()` 在 `getEffectiveConfig` 之后所有退出路径(非 direct 后端 / 积分不足 / 失败退款 / 成功)释放租约。已实测异步出片全链路通(8/8)。
- **视频异步失败的错误 shape**:异步失败的错误信息此前被展开落在 `task.message`,改用 OpenAI 错误信封 → 规范 `task.error:{message,type,code}`(与图像异步一致)。

## v0.6.1 (2026-06-22)

修复 Adobe gpt-image 图生图(`/v1/images/edits`)经 Adobe 后端 100% 失败;`/v1/models` 补全 Firefly 模型;创作页视频展示预估价格。

### 新增

- **控制台视频价格**:生视频面板新增「预计消耗 N 积分」及其构成(时长 × 每秒基价 × 模型族倍率,再叠加 Adobe 后端倍率),随模型族/时长实时更新。抽出纯函数 `applyVideoBackendMultiplier`,扣费侧与前端预估共用同一口径,确保展示价 = 实扣价。

### 修复

- **Adobe gpt-image 图生图全线失败**:`/v1/images/edits` 路由到 Adobe direct 后端时 Adobe 返 400「Image edit use case requires a reference image」,该路径自 v0.6.0 上线起从未成功(生产日志佐证)。
  - 根因:gpt-image edit 的 `referenceBlobs.usage` 用了 `general`,Adobe 不把它当作 edit 源图。v0.6.0 误判"与 nano-banana 一致用 general";而早期"subject 无效"的结论实为当时 `module` 仍是 `text2image`(漏改)导致退化成文生图、忽略了参考图。
  - 经对真实 Adobe API 实证(`scripts/probe-adobe-edit.ts`):gpt-image(2/1.5)edit 必须 `usage=subject`,nano-banana(pro/2)edit 必须 `usage=general`,两族恰好相反。故 gpt-image 分支改 `subject`、nano-banana 保持 `general`(现有实证背书)。完整 edit 链路(submit→轮询→下载)已实测出图。
- **`/v1/models` 不返回 Firefly 模型**:此前只列默认图像模型 + GPT chat/responses,API 用户无从发现 Firefly。现补入 5 个图像族级 id(`firefly-gpt-image-2`/`1.5`、`firefly-nano-banana`/`nano-banana2`/`nano-banana-pro`,分辨率/宽高比走 `size`)+ 58 个视频全量 id(参数编码在 id 内),由 `externalApi.images.generate` 能力门控。
- **`/api/storage` 全 500、所有图片下载/缩略图挂掉**:sharp 升 0.35 后,其 `@img/sharp-libvips-linux-x64` 运行时 dlopen 的 libvips `.so`(约 18MB)未被 Next standalone 打包(只留 stub),`import sharp` 加载即抛「Could not load the sharp module」→ 存储路由整体 500 → image_url 下载与列表缩略图全失败。照 onnx `.so` 的办法,next.config `outputFileTracingIncludes` 显式 trace `@img/sharp-libvips-linux-x64@*` 与 `@img/sharp-linux-x64@*`(版本通配)。
- **生成失败把裸 DB 错误回传前端(issue #35)**:后端池查询瞬时失败时,Drizzle「Failed query: select …」(含列名)经兜底 catch 原样显示在用户「生成失败」toast。新增 `error-sanitize`:DB/内部异常记服务端日志 + 回通用可重试消息,已知用户级消息(积分不足等)原样透传。
- **`/v1/images/{id}` 按 generation_id 查返回 404**:该接口此前只查进程内异步任务存储(仅 `async=true` 创建、`task_<uuid>` 为键、30 分钟 TTL、多实例不共享、重启即清),同步请求拿到的是 `generation_id`,查必 404。新增 DB 回退:内存未命中时按 `generation_id` 经 `getGenerationById` 持久取回(handler 内校验 `userId` 归属防越权),对同步/异步、跨重启/多实例都稳。

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
