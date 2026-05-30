# MEMORY — 实时关键记忆索引

> 项目长期记忆索引。详细记忆见 `docs/memory/`，计划见 `docs/plan/`，待办见 `docs/TODO.md`。
> 这是所有贡献者 Agent 的共享长期记忆，请保持精简，每条一行。

## 安全

- [2026-05 安全审计](security-audit-2026-05.md) — 6 维度并发安全审查；高危经济/入侵口子已在 dev 修复（2beb0e0/b69c10b/14a88d8/07d7a18）
- [待办清单](TODO.md) — 仍存在的代码层问题 + 部署前必做

## 功能

- [纯中转 API Key](plan/2026-05-30-relay-only-api-key.md) — relay_only key：不记录/不存储/仍扣费仍审核；附带修复 consumeCredits 幂等（dev: 7c6da21→e957f48）

## 工程 / CI

- [CI/CD 流水线](CI-CD.md) — ci.yml 6 门禁（docs-mirror/lint/typecheck/test/build/docker-build）+ docker-release(tag) + dependabot
- lint 门禁**仅 PR、仅改动文件**用 `biome lint --changed`（非 `biome ci`——全仓历史未 biome 格式化；对齐团队 `turbo lint` 约定）；typecheck/test/build 全仓 push+PR 双跑
- typecheck job 必须先 `pnpm --filter @repo/web exec fumadocs-mdx` 生成 `.source`（gitignore 忽略、独立 tsc 不自生成），否则连锁 any 报错
- CLAUDE.md ≡ AGENTS.md 为镜像文件，CI `docs-mirror` job 强制逐字一致；改一个必须同步另一个
- **分支保护已启用**（dev+main，5 required checks，strict）；远端仓库已迁移至 `MeowFree/GPT2Image-Pro`（旧 `MoYeRanqianzhi/...` 会重定向）
- 第三方 GitHub Action 全部钉 40 位 SHA（dependabot 维护）；第三方 action major 升级是单独人工决策

## 关键架构事实

- 5 个 v1 handler 最终汇入 `apps/web/src/features/image-generation/operations.ts` 同一管线（`runImageGenerationForUser`）
- 财务真相在 `credits_transaction`（双重记账），不在 `generation` 行；`generation` 仅历史/画廊展示
- 扣费幂等键：`consumeCredits(sourceRef)` + `credits_transaction (type, source_ref)` 偏唯一索引（opt-in，不传则行为不变）
- 发放/退款幂等键：`credits_batch (source_type, source_ref)` 偏唯一索引
