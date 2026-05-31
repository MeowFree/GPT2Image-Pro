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

- [ ] **成本放大（中危·经济）**：`quality`、`thinking/reasoning.effort` 等高成本参数不计入积分定价（`resolution.ts`）；`/v1/chat/completions` 纯文本按固定 1 积分/轮。上游成本可能数倍于收费，长期亏损。需做定价决策后实现。
- [~] **v1 频率限流**：2026-05-31 已修限流默认 fail-open（未配 Upstash 时所有类型走内存兜底）+ 可信代理头开关（`RATE_LIMIT_TRUSTED_PROXY`，commit d2a51f4）。**残留**：仍缺各 v1 handler 顶部独立于 per-IP 的 per-key 滑窗限流（单 key 高频刷上游成本）。
- [ ] **generations 存储对象无鉴权（中低危·S-L7 未修）**：仅靠 `userId/nanoid(32)` 不可猜 URL 保护。建议 generations 桶走 session+属主校验或短时签名 URL（avatars 保持公开）。**改动前需 UI 实测**，避免破坏全站图片渲染 / 外链分享 / og:image。
- [ ] **SSRF DNS 重绑定残留（低危）**：已堵静态内网 + 重定向逐跳复检（含回调 S-H3）；"校验后连接时重解析到内网"需在连接层 pin 已校验 IP 才能根除。

## 部署前必做

- [ ] 应用 `packages/database/drizzle/0025_credits_batch_idempotency.sql` 前，先排查 `credits_batch` 是否已有重复 `(source_type, source_ref)`（历史双发遗留），否则唯一索引创建会失败。排查 SQL 见迁移文件头注释。
- [ ] 应用 `0026_external_api_key_relay.sql` / `0027_credits_transaction_idempotency.sql`（纯中转 Key 功能）。0027 给 `credits_transaction` 加 `source_ref` + 偏唯一索引 `(type, source_ref)`；历史交易 `source_ref` 均为 NULL，正常不冲突，仍建议按迁移头注释 SQL 先排查。

## 纯中转 API Key（已实现，待实测）

> 设计/实现见 `docs/plan/2026-05-30-relay-only-api-key.md`。提交：7c6da21 / bec842a / 8400260 / 48b717d / 6210de4 / e957f48（dev 分支）。

- [ ] **UI/端到端实测**：用 Pro+ 账号创建纯中转 key，分别用 `b64_json` 与 `url` 跑 `/v1/images/generations`、`/v1/images/edits`、`/v1/chat/completions`、`/v1/responses`、`/v1/agents/images`，确认：图片正常返回、扣费正确、`generation` 表无新行、对象存储无新对象、画廊不可见。
- [ ] **已知残留（低危）**：async/stream/callback 模式下含 base64 的结果会短暂驻留进程内存、callback 会 POST 到用户回调 URL——非落盘落库，但与"零服务器存储"字面有张力。如需绝对零驻留，再对中转 key 单独禁用 async。
- [ ] **已知残留**：扣费幂等为请求级（按 `generationId`），可防同一请求重复执行；**跨请求客户端重试**仍需客户端自带 `Idempotency-Key`（未来项）。

---

运维层补救（轮换密钥 / 配置 Upstash 等）见 `docs/security-audit-2026-05.md` C 节，本清单不展开。
