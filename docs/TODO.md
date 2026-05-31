# TODO

> 来源：2026-05-29 多 Agent 安全审计（`docs/security-audit-2026-05.md`）。
> 高危的经济损失 / 入侵口子已在 `dev` 修复（提交 2beb0e0 / b69c10b / 14a88d8 / 07d7a18）。
> 本清单只记录**仍真实存在的代码层问题**。

## CI/CD（已落地并启用）

> 流水线说明见 `docs/CI-CD.md`。文件：`.github/workflows/ci.yml`、`.github/workflows/docker-release.yml`、`.github/actions/setup/action.yml`、`.github/dependabot.yml`。

- [x] **分支保护已启用**（2026-05-30，经 gh API）：`dev` 与 `main` 均要求 5 个 status check 通过（`Docs mirror (CLAUDE == AGENTS)`/`Lint & format (changed files)`/`Typecheck`/`Unit tests`/`Build web`），strict（须先与目标分支同步）、禁 force-push/删除、要求会话解决。`enforce_admins=false`（管理员可应急直推）。
- [x] **`main` 分支已创建**（= 当时绿色的 dev HEAD `bc1b139`）。默认分支仍为 `dev`；如需以 main 为默认请在仓库设置切换。
- [x] **Dependabot 首批 11 个 PR（#3–#13）已处理**（2026-05-30）：在 `.github/dependabot.yml` 增加忽略 semver-major 规则（npm + github-actions）后，Dependabot **自动关闭**了全部 10 个大版本 PR（#3–#7 Action 大版本、#9–#13 npm 大版本）；#8（npm minor/patch 分组，42 项）非大版本未被自动关，已手动关闭——因其破坏 `Build web`（分组内含破坏性变更）。当前 0 个 open PR。
- [x] **#8 构建破坏点已定位并预修复**（2026-05-30，workflow 调查 + 对抗式复核）：元凶是 `better-auth ^1.4.17→^1.6.12`——它放宽 kysely peer 至 `^0.28.5 || ^0.29.0`，使 pnpm 把 kysely 浮到 0.29.2；而 kysely 0.29 把迁移导出迁到 `kysely/migration` 子路径，随 better-auth 1.6.12 打包的 `@better-auth/kysely-adapter` 编译产物仍从 kysely 根导入 → Turbopack 12 个 `Export ... doesn't exist` 编译错误。`drizzle-orm 0.45.2` 仅共谋非元凶。
  - **修复**：根 `package.json` 加 pnpm override `kysely: 0.28.17`（commit de3d6ca，已在 dev）。满足 adapter 1.6.12 与 drizzle 0.45.2 的 peer，且根入口仍导出迁移符号。当前 dev 仅 kysely 0.28.10→0.28.17；build 编译成功、typecheck+171 测试全绿。
  - [x] **Dependabot minor/patch 分组（PR #14，45 项）已合并 dev**（2026-05-31，squash 6798ed1）：含 better-auth 1.4.17→1.6.12、next 16.1.4→16.2.6、react 19.2.3→19.2.6、next-safe-action 8.0.11→8.5.3、vitest 4.0.18→4.1.7、biome/turbo/zod/drizzle 等，全 minor/patch 无 major。CI 6 门禁全绿（Build web 验证 kysely override 兜住 better-auth 1.6）；本地复跑 typecheck+test 全绿（shared 235 + web 272 = 507）。
  - [ ] **后续清理（override 仍需保留）**：kysely 0.28.17 override 仍在生效兜底（better-auth 1.6 的 kysely-adapter 仍从根导入）。待上游 `@better-auth/kysely-adapter` 改从 `kysely/migration` 导入（真正兼容 0.29）后，移除该 override。
- [ ] **（可选）docker-build 设为必需**：当前 `docker-build` 在 PR 上运行但未列为 required（保 PR 迭代速度）。如需强制可加入 required checks。
- [ ] **（可选）全仓格式化**：历史代码未全量 biome 格式化，故 `lint` 门禁用 `biome lint`（仅 lint、不查格式）。若做一次性 `biome format --write` 全仓重排（大 diff），可将门禁升级为含格式的 `biome ci`。
- [ ] **（可选）修复存量 lint**：`biome lint` 全仓有 38 errors / 299 warnings 历史债（不阻塞改动文件门禁），可逐步清理；其中 `system-settings-panel.tsx` 有 3 处 `noLabelWithoutControl`（a11y）。

## Issue 修复（已落地 dev，待 UI 实测）

> 2026-05-31 经并行调研 workflow 产出经对抗复核的蓝图后实现。三处改动文件不重叠/串行落地。
> 提交：#1=a2dd4dc、#15=10d0bc8、#16=c8e9118。typecheck(web+shared)零错误、shared 45 + web 126 测试全绿。

- [x] **#1 管理员手动添加/编辑用户**：`admin-users.ts` 新增 3 个 superAdminAction（createUser/updateUserProfile/setUserPassword），密码走 `better-auth/crypto` 的 `hashPassword` 写 `account.password`（providerId=credential，与 bootstrap-super-admin 同款，绝不明文）；`admin-users-management.tsx` 加'新增用户'按钮与'编辑资料/重设密码'入口及 Dialog（仅超管可见）。无 DB 迁移。
- [x] **#15 瀑布流对齐原项目**：新增每批并发 tier 选择（预设[1,5,10,20]按 imageGenerationConcurrency 过滤）、补齐质量/尺寸控件（尺寸复用既有 chat 尺寸弹窗）、3 警告节点（首次使用 localStorage 持久化 / 里程碑[tier*10/100/1000]阻塞续批 / 余额不足既有逻辑）。新增 `waterfall-warning-popup.tsx`。
- [x] **#16 数量/并发改数字输入+滚轮**：根因=文本/编辑'数量'下拉用写死的 `[1,2,4,6,8,10]` 且挂错字段（maxBatchCount 默认恒 10）。改为 `ConcurrencyNumberInput`（数字输入+非被动 wheel 监听），上限=套餐 `imageGenerationConcurrency`；服务端 count 校验 4 处（generate/edit/chat 路由 + operations 管线）同步改挂 imageGenerationConcurrency；归一化硬顶 1000→10000、Zod count.max 100→10000。
  - [ ] **语义变化需知会运维**：单次最大张数(count)上限由 maxBatchCount(默认10)改为按套餐 `imageGenerationConcurrency`。默认 free=2/starter=5 等低于 10 的套餐**单次张数会下降**，需管理员在后台'生图并发'按需调高。`maxBatchCount` 字段保留但**不再约束 count**（vestigial）。
  - [ ] **UI/端到端实测**：#1 建号→登录验证哈希链路、改邮箱查重、重设密码；#15 瀑布流 tier/质量/尺寸/3 警告全流程；#16 数字输入+滚轮在 free/pro 账号下上限正确、count>10 能提交且服务端不再 400。
- [ ] **既有 lint 债（PR 门禁风险）**：`create-page-client.tsx` 有 5 个**既有** error（非本次引入）：`noLabelWithoutControl`×4(ImageSizeDialog)、`noUselessFragments`×2、`useHookAtTopLevel`×1。CI lint 门禁仅 PR、对改动文件全量 lint，故**未来任何 PR 触碰此文件都会被这些既有 error 卡住**。push 到 dev 不跑 lint 故不阻塞当前提交。需择机清理或在门禁中豁免。

## 2026-05-31 审计修复 workflow（已落地 dev，未修/defer backlog）

> 详见 `docs/plan/2026-05-31-audit-test-refactor.md`。本轮共修 94 条、未修 23 条、defer 4 个上帝组件；dev 9 主题提交 0babd1f..01906e0；终验 typecheck+test 全绿（shared235+web257=492）。

- [ ] **上帝组件结构性拆分（defer，需人在环专项 + 重新 UI 实测）**：
  - `image-generation/components/create-page-client.tsx` 9233 行（含已实测 #15/#16，拆分前须充分理解其状态机/runtime store）。
  - `image-backend-pool/service.ts` 5310 行（按 7+ 职责拆为 scheduler/error-classification/cooldown/oauth/import/sub2api-sync/crud）。
  - `image-backend-pool/admin-panel.tsx` 4350 行、`system-settings/components/system-settings-panel.tsx` 1825 行。
- [ ] **跨文件重构/DB 迁移类未修 23 条**：C-H2 门闩抽纯函数、S-M11 Creem 金额校验、S-L1/S-L7 财务/存储归属深防御、M-M7/M-M10/M-M15/M-M17 DRY 合并等，逐条理由见计划文档 backlog 节。
- [ ] **（复测新发现·既有 latent bug）create 页 hydration 不匹配**：硬加载创作页时客户端从 localStorage `gpt2image_create_active_mode_v1` 恢复激活模式（可能为锁定 tab），与服务端默认冲突触发 React hydration mismatch（低危，自愈）。修法：持久化模式恢复后置到 useEffect 或按当前套餐能力校正，避免恢复锁定/不可用模式。属 defer 的 create-page-client.tsx，随其重构一并修。

## 仍存在的代码层问题（待办）

- [x] **成本放大（已修复）**：`quality`/`thinking` 参数已加积分倍率（quality: low=0.5x/high=1.5x; thinking: medium=1.3x/high=1.6x），operations.ts 4 处扣费调用已传入参数。`/v1/chat/completions` 纯文本按固定 1 积分/轮仍为独立定价（不在此修）。
- [x] **v1 频率限流**：限流默认 fail-open 修复 + 可信代理头开关（d2a51f4）；**per-key 滑窗已补**（U6，commit 6f48522：authenticateExternalApiRequest 以 apiKey.id 复用 ai 桶）。残留(低)：复用 ai 桶且超限映射 401 非 429，如需独立阈值/语义码后续在 rate-limit 增 externalKey 类型。
- [x] **generations 存储对象鉴权���S-L7，已修复）**：签名 URL 方案（HMAC-SHA256 over bucket/key/expiry，用 BETTER_AUTH_SECRET 签名，1h 有效期）。avatars 保持公开，generations 须 ?sig=&exp= 参数。所有出口（operations.ts/service.ts/v1 handlers）已改为生成签名 URL。单测覆盖签名/验签/过期/篡改。
- [x] **SSRF DNS 重绑定（已修复主路��）**：`packages/shared/src/security/dns-pin.ts` 实现无条件 node:http/https DNS pin（不依赖 globalThis.fetch 比较）。`fetchPublicImage`/`fetchPublicCallback` 已改用 `fetchWithDnsPin`。测试 mock dns-pin 模块。
  - [ ] **残留裸 fetch（对抗复核发现）**：`operations.ts toImageBuffer`（L291）和 `images.ts getImageBase64`（L158）直接 fetch 上游返回的 imageUrl 无 SSRF 防护——恶意自定义后端可返回内网 URL。需改为 fetchWithDnsPin 或 fetchPublicImage。
- [x] **Creem 金额纯函数抽离（S-M11 已完成）**：`packages/shared/src/payment/creem-amount.ts` 导出 3 个纯函数 + 369 行��测覆盖（标准/零小数/三小数币种、金额匹配/不匹配、enforce/detect-only、边界值）。route.ts 已改为 import。
  - [ ] **启用硬拒前置**：软门闩默认仍仅告警（`CREEM_WEBHOOK_ENFORCE_AMOUNT` 可开启硬拒），须运维对齐 Creem 产品价目确认 `order.amount` 单位（minor units 假设待验证）和实际币种（CNY vs USD）。

## Agent 集成 / 统一接口层实现路线图（来源：docs/plan/2026-05-31-agent-integration-architecture.md）

> CLAUDE.md/AGENTS.md 已立"统一接口层优先"约束。以下为分阶段落地，每阶段可独立测试与回滚。

- [x] 阶段0 接口层脚手架：`packages/shared/src/uol/` 7 核心模块(types/principal/errors/registry/access/invoke/index) + 3 测试文件。已推送分支 `feat/uol-phase0-phase1`。
- [x] 阶段1 已干净 service-fn 直接注册：144 个操作注册覆盖 10 域（execute 为 stub）。已推送分支 `feat/uol-phase0-phase1`，待合并 dev。
- [ ] 阶段2 管理类 action 委托对接：仅对接 admin/管理操作（admin-users, system-settings, image-backend-pool, support, announcements, credits admin）的 execute stub 到真实 service-fn。v1 用户侧路由不动。逐个对拍新旧输出。
- [ ] 阶段3 管理员 MCP + 内置 Agent：仅暴露管理操作；管理秘钥鉴权（`MCP_ADMIN_SECRET`）；默认关闭；面向运维 agent。
- [ ] 阶段4（后续决策）用户 MCP — 生���能力面向全部用户：见下方"MCP 双层决策"。

### MCP 双层决策（已确认，后续实现）

> 管理员 MCP 与用户 MCP 是**完全独立的两套 MCP server**，不可混淆。

| | 管理员 MCP | 用户 MCP |
|---|---|---|
| 受众 | 站点运维人员/运维 agent | 全部注册用户/用户侧 agent |
| 暴露操作 | 管理功能（用户管理/设置/后端池/工单/公告/积分管理） | 生图功能（image.generate 及相关读操作） |
| 鉴权 | 管理秘钥 Bearer（`MCP_ADMIN_SECRET`，恒定时间比对） | **MCP 专有用户 Key**（per-user，类似 external API key 但独立字段/桶/权限位） |
| 默认状态 | 关闭（`MCP_ENABLED`） | 关闭（`MCP_USER_ENABLED`，独立开关） |
| 路由 | `/api/mcp/admin` | `/api/mcp/user` |
| 积分/计费 | 不涉及（管理操作不消耗用户积分） | 消耗调用者积分（复用现有计费��线） |
| 权限模型 | 管理员角色体系 | 用户套餐能力矩阵（plan-capabilities） |
| 限流 | 按管理秘���指纹 + 域 | 按用户 MCP key id（复用或独立于 external-api 桶） |

**要点**：
- 用户 MCP Key 与 v1 external API Key 是**独立的 key 体系**（不复用，避免权限混淆；MCP key 授权 MCP 工具调用，v1 key 授权 HTTP API）
- 用户 MCP 复用 `runImageGenerationForUser` 单一管线（扣费/审核/存储全链路不变）
- 用户 MCP 通过套餐能力位控制可用工具（free 用户只能 generate，Pro 解锁 edit/chat/batch 等）
- 管理员 MCP 与用户 MCP 物理隔离：独立路由、独立鉴权、独立开关、独立限流桶

**实现时机**：管理员 MCP（阶段3）先行；用户 MCP 在管理员 MCP 稳定后作为独立阶段实现。

---

## 多端口/多域名拆分（Turborepo 多 app 方案，已决策）

> 决策：Turborepo 多 app 彻底隔离。单容器 PM2 多进程部署。管理员独立 Better Auth 实例。

### 确定方案

| 子域名 | app | 端口 | 职责 | 账号体系 |
|---|---|---|---|---|
| `admin.gpt2image.pro` | apps/admin | :3001 | 管理后台全部页面 + 管理员 MCP + 内置 Agent | 独立 Better Auth 实例（admin_user/admin_session/admin_account 表） |
| `app.gpt2image.pro` | apps/web | :3000 | 用户前台（创作/画廊/设置/工单/公告） | 用户 Better Auth（现有） |
| `api.gpt2image.pro` | apps/api | :3002 | v1 外接 API + 用户 MCP | API Key / MCP Key（无 session） |
| `platform.gpt2image.pro` | apps/platform | :3003 | 落地页/文档/定价/注册入口 | 公开（Next.js SSR，同栈共享 packages/ui） |

### 关键决策点

**管理员账号**：独立 Better Auth 实例（隔离登录入口，共享数据操作权）
- apps/admin 有自己的 `auth` 配置（独立 `ADMIN_BETTER_AUTH_SECRET`）
- 独立表：`admin_user` / `admin_session` / `admin_account`（同一 DB 不同前缀）
- 管理员登录入口独立，用户无法通过 app.gpt2image.pro 进入管理后台
- **但管理员可操作主站全部数据**（同一 DB，admin 进程有全表读写权限）——隔离目的是防止用户越权和分离使用界面，不是限制管理员访问
- Cookie domain：`admin.gpt2image.pro`（不设 `.gpt2image.pro` 防 cookie 跨域泄露到用户侧）

**部署形态**：单容器 PM2 多进程
- 单个 Docker 镜像内含 4 个 Next.js build 产物
- PM2 ecosystem.config.js 启动 4 个进程绑定不同端口
- 共享文件系统（.env.local / local storage 目录）、共享同一 DATABASE_URL
- Nginx 按 Host header 反代到 127.0.0.1:3000-3003
- 进程间不共享内存（队列/inflight/缓存各进程独立）——需迁 Redis 或接受退化

**隔离本质**：
- 隔离的是**用户入口和界面**，不是数据——管理员需要操作主站所有数据（用户表/积分/生成记录等）
- 目的：防止用户通过 URL 猜测/越权进入管理页面；管理员和用户各有清晰的使用界面
- 4 个 app 连同一个 PostgreSQL，admin app 对全表有完整读写权限

**apps/admin 范围**：全部现有 admin 页面 + MCP + Agent
- 用户管理（列表/详情/封禁/角色/建号/改密）
- 系统设置面板
- 后端池管理（账号/组/Sub2API 同步）
- 工单管理（管理员视角）
- 公告管理
- 审计日志查看
- 管理员 MCP（`/api/mcp/admin` 迁入此 app）
- 内置 Agent UI

**apps/platform**：Next.js SSR（同栈）
- 共享 packages/ui 组件
- 落地页、功能介绍、定价表、文档（Fumadocs）
- 注册/登录入口（跳转 app.gpt2image.pro）
- SEO + i18n

### 实施步骤（TODO）

- [ ] Turborepo 新增 apps/admin（独立 Next.js，port 3001）
- [ ] Turborepo 新增 apps/api（独立 Next.js，port 3002，仅 API 路由无 UI）
- [ ] Turborepo 新增 apps/platform（独立 Next.js，port 3003）
- [ ] apps/admin 独立 Better Auth 配置 + admin_user/session/account 迁移
- [ ] 从 apps/web 迁移 admin 路由组到 apps/admin（`/dashboard/admin/*` 全部）
- [ ] 从 apps/web 迁移 v1 API 路由到 apps/api（`/api/v1/*`、`/api/mcp/user/*`）
- [ ] 管理员 MCP 从 apps/web 迁移到 apps/admin
- [ ] apps/web 仅保留用户前台路由（创作/画廊/设置/工单/公告/用户 profile）
- [ ] Nginx 配置：泛解析 `*.gpt2image.pro` + 4 个 upstream + SSL 泛域名证书
- [ ] PM2 ecosystem.config.js + Dockerfile 多进程启动
- [ ] Cookie domain 隔离验证（admin cookie 不泄露到 app/api/platform）
- [ ] 进程内态退化评估：队列/inflight/settings 缓存 在多进程下的行为（是否需 Redis）

---

## 组织空间 / 企业版（远期规划）

> 面向高级用户（企业版），支持创建组织，拥有独立子域名空间。

### 概念

- 企业用户购买组织版后，可创建组织（Organization）
- 每个组织拥有独立子域名：`<org-slug>.gpt2image.pro`（需 Nginx 泛解析 `*.gpt2image.pro` + 动态反代）
- 组织空间内：独立成员管理、独立积分池/配额、独立 API Key 命名空间、独立生成历史/画廊
- 组织管理员 vs 组织成员 vs 组织 API Key 的三级权限

### 技术要点

- **泛解析端口**：Nginx `server_name *.gpt2image.pro`，根据子域名查 DB 匹配组织，代理到同一 Next.js 实例但注入组织上下文
- **SSL**：Let's Encrypt 泛域名证书（DNS-01 challenge）或 Cloudflare 代理
- **多租户隔离**：
  - 数据层：所有表增 `organizationId` nullable FK，查询层自动注入过滤（RLS 或 Drizzle where 装饰）
  - 存储层：对象存储按 `org-<id>/` 前缀隔离
  - 计费层：组织积分池独立于个人（组织 credits_balance + 组织 credits_transaction）
- **UOL 影响**：Principal 新增 `organizationId?: string`，invokeOperation 自动注入组织上下文，MCP 工具按组织 scope 过滤
- **现有架构兼容**：无组织的用户（个人版）`organizationId = null`，行为完全不变

### 依赖
- 多端口/多域名拆分先行（组织子域名是在其之上的扩展）
- 多租户数据隔离方案确定
- 泛域名 SSL 自动签发方案

---

## UI 大规模重构（未来计划）

> 组件抽象统一 + 多主题风格可选。用户可在设置中切换 UI 风格。

### 目标

- 将现有 UI 组件进行系统性抽象和统一，消除重复/不一致的组件实现
- 建立 Design Token 体系 + Theme Provider，支持多套视觉风格一键切换
- packages/ui 作为唯一组件源，所有 app 共享

### 可选风格（初期）

| 风格 | 关键词 | 色彩倾向 |
|---|---|---|
| 优雅简约风（默认） | 黑白灰、大留白、细线条、Claude/GPT 气质 | 纯黑白 + 极少强调色 |
| 时尚科技风 | 渐变、玻璃拟态、深色主导、赛博感 | 深蓝/紫渐变 + 亮色高光 |
| 工业硬核风 | 单色、等宽字体、终端风、数据密度高 | 深灰/绿色终端配色 |
| 软萌可爱风 | 圆角、柔色、插画元素、轻量动画 | 粉/淡蓝/奶油暖色调 |

### 技术要点

- Design Token：颜色/间距/圆角/字体/阴影 等变量化，按主题切换 CSS 变量集
- Theme Provider：React Context + localStorage 持久化用户选择
- 组件层：packages/ui 全部组件接受 theme token，不硬编码视觉属性
- 暗色模式：每种风格各有 light/dark 两套变体（共 8 套 token 集）
- 迁移路径：先抽象 token、再逐步替换硬编码样式值、最后新增风格

### 依赖

- 多 app 拆分完成后统一实施（packages/ui 供所有 app 消费）
- 上帝组件拆分完成（create-page-client.tsx 等重构后才能统一套 theme）

---

## 用户界面重构（未来计划）

> 参考 Claude/GPT 网页端交互模式，重新设计用户前台布局。

### 目标布局

- **左侧边栏**：上部为历史记录列表（类 ChatGPT 侧边栏，支持搜索/分组/固定/删除）；下部固定区域放置模型/风格选择、积分余额、用户头像/设置入口
- **主区域**：当前会话/创作画布（聊天式图像生成交互流）
- 响应式：移动端侧边栏可抽屉收起，主区域全屏

### 关键改动

- 创作页从"表单填写 → 提交"模式改为"对话式"交互（保留高级参数面板可展开）
- 历史记录从独立页面改为左侧边栏常驻（支持快速切换上下文）
- 画廊作为独立 tab 或子页面保留（瀑布流展示已生成图片）
- 会话概念：每次创作是一个 session，session 内可多轮修改/重生成

### 依赖

- UI 大规模重构（Theme Provider / 组件统一）先行
- 上帝组件 create-page-client.tsx 拆分完成

---

## 管理员功能重构（未来计划）

> 多级角色体系，支持自定义职位和细粒度权限分配。

### 角色层级

| 层级 | 角色 | 说明 |
|---|---|---|
| L0 | 站长（Owner） | 最高权限，可管理超管账号，全局配置不可降级 |
| L1 | 超级管理员（Super Admin） | 接近站长但不可修改 L0 配置和账号 |
| L2 | 管理员（Admin） | 日常管理操作（用户管理/审核/工单/公告），按分配权限受限 |
| L3 | 工作人员（Staff） | 自定义职位（如"审核员"/"客服"/"运维"），仅有分配的权限子集 |

### 核心设计

- **自定义职位**：L3 支持任意命名的职位（position），每个职位绑定一组权限位
- **权限位（Permission Bits）**：细粒度操作权限，如 `user.view`/`user.ban`/`credits.grant`/`settings.edit` 等
- **角色分配**：L0 可分配 L1；L1 可分配 L2/L3；L2 不可分配角色
- **权限继承**：高层级默认拥有低层级全部权限（可在 UI 上看到完整权限矩阵）
- **审计**：所有管理操作记录操作者角色+权限上下文

### 技术要点

- DB：`admin_role` 表（角色定义 + 权限位 JSON）、`admin_user` 增 `roleId` FK
- UOL：现有 AccessRequirement 扩展，支持 `{ role: 'admin', permission: 'user.ban' }` 粒度检查
- UI：apps/admin 角色管理页面（创建职位/分配权限/可视化权限矩阵）
- 迁移路径：先将现有 super_admin 概念映射为 L0，现有 admin 映射为 L1，再增 L2/L3

### 依赖

- 多 app 拆分完成（admin 独立 app + 独立 Better Auth 实例）
- UOL 全量对接完成（权限检查统一入口）

---

## 分布式负载均衡（远期超级计划）

> 从单服务器扩展到多节点分布式架构，避免单点承担全部流量。

### 目标

- 水平扩展：多个应用实例（Node.js 进程）分布在不同服务器
- 无单点故障：任一节点故障不影响整体服务
- 自动伸缩：根据请求量/队列深度动态增减实例

### 架构演进路径

```
当前：单容器 PM2 多进程（垂直扩展极限）
  |
  v
阶段 A：多容器单主机（Docker Compose 多副本 + Nginx 轮询）
  |
  v
阶段 B：多主机集群（K8s 或 Docker Swarm + 外部 LB）
  |
  v
阶段 C：地理分布（多区域部署 + CDN + 就近路由）
```

### 关键基础设施变更

- **Session 外置**：Better Auth session 存储迁移到 Redis（当前依赖 DB，已可水平扩展）
- **队列外置**：图像生成任务队列从进程内存迁移到 Redis/BullMQ（当前 inflight map 进程独占）
- **缓存外置**：系统设置/套餐能力缓存迁移到 Redis（当前内存缓存进程独占）
- **对象存储**：已用 S3 兼容存储（无状态，天然可水平扩展）
- **数据库**：PostgreSQL 读写分离（主写从读）或 PgBouncer 连接池
- **负载均衡器**：Nginx → HAProxy / AWS ALB / Cloudflare LB
- **健康检查**：每个实例暴露 `/healthz`，LB 根据健康状态路由
- **日志/监控**：集中式日志收集（ELK / Loki）+ 分布式追踪（OpenTelemetry）

### 依赖

- 多 app 拆分完成
- Redis 引入（Session/Queue/Cache 外置是分布式的前提）
- 组织空间/多租户方案确定（影响数据分片策略）

---

## 部署前必做

- [ ] 应用 `packages/database/drizzle/0025_credits_batch_idempotency.sql` 前，先排查 `credits_batch` 是否已有重复 `(source_type, source_ref)`（历史双发遗留），否则唯一索引创建会失败。排查 SQL 见迁移文件头注释。
- [ ] 应用 `0026_external_api_key_relay.sql` / `0027_credits_transaction_idempotency.sql`（纯中转 Key 功能）。0027 给 `credits_transaction` 加 `source_ref` + 偏唯一索引 `(type, source_ref)`；历史交易 `source_ref` 均为 NULL，正常不冲突，仍建议按迁移头注释 SQL 先排查。
- [ ] 应用 `0029_credits_transaction_idempotency_userid.sql`（S-L1）：把幂等偏唯一索引由全局 `(type, source_ref)` 收窄为 per-user `(user_id, type, source_ref)`。DROP 旧索引后 CREATE，**部署窗口内有短暂无唯一约束期**；放松约束历史数据天然兼容，仍建议按迁移头注释 SQL 先按 `(user_id,type,source_ref)` 查重。`schema.ts` 索引声明已同步。

## 纯中转 API Key（已实现，待实测）

> 设计/实现见 `docs/plan/2026-05-30-relay-only-api-key.md`。提交：7c6da21 / bec842a / 8400260 / 48b717d / 6210de4 / e957f48（dev 分支）。

- [ ] **UI/端到端实测**：用 Pro+ 账号创建纯中转 key，分别用 `b64_json` 与 `url` 跑 `/v1/images/generations`、`/v1/images/edits`、`/v1/chat/completions`、`/v1/responses`、`/v1/agents/images`，确认：图片正常返回、扣费正确、`generation` 表无新行、对象存储无新对象、画廊不可见。
- [ ] **已知残留（低危）**：async/stream/callback 模式下含 base64 的结果会短暂驻留进程内存、callback 会 POST 到用户回调 URL——非落盘落库，但与"零服务器存储"字面有张力。如需绝对零驻留，再对中转 key 单独禁用 async。
- [ ] **已知残留**：扣费幂等为请求级（按 `generationId`），可防同一请求重复执行；**跨请求客户端重试**仍需客户端自带 `Idempotency-Key`（未来项）。

---

运维层补救（轮换密钥 / 配置 Upstash 等）见 `docs/security-audit-2026-05.md` C 节，本清单不展开。
