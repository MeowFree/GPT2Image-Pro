# TODO

> 来源：2026-05-29 多 Agent 安全审计（`docs/security-audit-2026-05.md`）。
> 高危的经济损失 / 入侵口子已在 `dev` 修复（提交 2beb0e0 / b69c10b / 14a88d8 / 07d7a18）。
> 本清单只记录**仍真实存在的代码层问题**。

## CI/CD（已落地，待仓库侧启用）

> 流水线说明见 `docs/CI-CD.md`。文件：`.github/workflows/ci.yml`、`.github/workflows/docker-release.yml`、`.github/actions/setup/action.yml`、`.github/dependabot.yml`。

- [ ] **开启分支保护**：在 GitHub 仓库 Settings → Branches，对 `dev` 与 `main` 将 `docs-mirror`/`lint`/`typecheck`/`test`/`build`（PR 另含 `docker-build`）设为 **Required status checks**，并勾选「Require branches up to date」。否则 CI 只报告、不拦截。
- [ ] **（可选）全仓格式化**：仓库历史代码未全量 biome 格式化，故 `lint` 门禁目前仅查改动文件。若做一次性 `biome format --write` 全仓重排（会产生大 diff），可将门禁升级为全仓 `biome ci`。
- [ ] **（可选）修复存量 lint**：`biome lint` 全仓有 38 errors / 299 warnings 的历史债（不阻塞改动文件门禁），可逐步清理。

## 仍存在的代码层问题（待办）

- [ ] **成本放大（中危·经济）**：`quality`、`thinking/reasoning.effort` 等高成本参数不计入积分定价（`resolution.ts`）；`/v1/chat/completions` 纯文本按固定 1 积分/轮。上游成本可能数倍于收费，长期亏损。需做定价决策后实现。
- [ ] **v1 无 per-key / per-user 频率限流（中危）**：单个 key 可高频刷请求拖垮上游成本。需在各 v1 handler 顶部加滑窗限流（独立于中间件的 per-IP）。
- [ ] **generations 存储对象无鉴权（中低危）**：仅靠 `userId/nanoid(32)` 不可猜 URL 保护。建议 generations 桶走 session+属主校验或短时签名 URL（avatars 保持公开）。**改动前需 UI 实测**，避免破坏全站图片渲染 / 外链分享 / og:image。
- [ ] **SSRF DNS 重绑定残留（低危）**：已堵静态内网 + 重定向跳内网；"校验后连接时重解析到内网"需在连接层 pin 已校验 IP 才能根除。

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
