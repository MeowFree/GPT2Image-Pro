# CI/CD 流水线说明

> 落实 `CLAUDE.md` / `AGENTS.md` 第 0 章协作准则的**自动化执法层**。
> 所有协作者与 PR 贡献者的提交都必须通过本流水线的门禁。

## 总览

| 文件 | 触发 | 作用 |
|---|---|---|
| `.github/workflows/ci.yml` | PR / push → `dev`·`main`，手动 | 提交门禁：文档镜像、风格、类型、测试、构建、容器可构建性 |
| `.github/workflows/docker-release.yml` | push tag `v*.*.*`，手动 | 发布：构建并推送 3 个镜像到 GHCR + 起草 GitHub Release |
| `.github/actions/setup/action.yml` | 被 ci.yml 复用 | 统一 Node 22 + pnpm + frozen-lockfile 安装 |
| `.github/dependabot.yml` | 每周 | 依赖 / Action 安全更新自动开 PR |

## ci.yml —— 提交门禁（6 个 job）

并行运行，各自在 PR 的 Checks 面板独立显示，便于设为「必须通过」。

1. **docs-mirror**：断言 `CLAUDE.md` 与 `AGENTS.md` 逐字一致（镜像文件约束）。秒级、免依赖。
2. **lint（仅改动文件）**：用仓库锁定的 Biome 2.3.11，对本次 PR/push **触及的文件**执行 `biome ci --changed --since=<base>`（lint + 格式 + import 排序）。
   - **为何只查改动文件**：仓库历史代码尚未全量 biome 格式化（全仓 `biome ci` 有 300+ 格式告警）。改动文件门禁既强约束新代码，又不强迫一次性全仓重排。
   - 纯文档 PR（无 JS/TS 改动）→ `Checked 0 files` → 通过。
3. **typecheck**：`pnpm turbo typecheck`（全仓 strict `tsc --noEmit`）。当前全绿，硬性强制。
4. **test**：`pnpm turbo test`（全仓 vitest，DB-free）。覆盖积分/扣费/幂等/API 等核心逻辑。
5. **build**：`pnpm turbo build --filter=@repo/web`（Next standalone 生产构建，含整体类型与编译校验）。环境变量为占位值，与 `Dockerfile.web` 的 build-args 一致；**不设 `NODE_ENV=production`**（否则 pnpm 跳过 devDependencies 导致构建失败）。
6. **docker-build（仅 PR）**：用 `Dockerfile.web` 实打实构建 web 镜像但**不推送**，验证多阶段 Dockerfile（turbo prune → install → build → standalone）未损坏。在前 4 个 job 通过后才跑（`needs`），gha 缓存加速。

> 风格门禁的有效性已本地验证：含 `noExplicitAny` 的改动文件会令 `lint` job 失败（EXIT≠0）；纯文档改动通过。

## docker-release.yml —— 发布（tag 触发）

- 触发：推送形如 `v*.*.*` 的 tag（含预发布 `v1.0.0-rc.1`，glob `v*.*.*` 同样匹配）。
- 构建 + 推送到 GHCR（`ghcr.io`）3 个镜像：`web`、`migrate`、`chatgpt-web-proxy`，tag 含语义 tag、`latest`、`sha-<sha>`。
- 起草（draft）一份 GitHub Release，附 docker-compose 部署包（`.tar.gz` / `.zip`）。

## 版本与发布流程（对齐 §0.2）

版本格式：`v<MAJOR>.<MINOR>.<PATCH>-<alpha|beta|rc>.<N>`（正式版去后缀）。

```bash
# 在 dev 验证通过、（按需）合入 main 后，在目标提交上打 tag 触发发布：
git tag v0.2.0-rc.1
git push origin v0.2.0-rc.1   # → 触发 docker-release.yml
```

## 建议的分支保护（需在 GitHub 仓库设置手动开启）

为真正「约束」贡献者，应在 `dev` 与 `main` 的 Branch protection 中将以下 checks 设为 **Required**：
`docs-mirror`、`lint`、`typecheck`、`test`、`build`（以及 PR 场景的 `docker-build`）。
并开启「Require branches to be up to date before merging」。

## 已知边界 / 后续

- **第三方 Action 已钉 SHA**：`ci.yml` / `docker-release.yml` / `actions/setup` 中的第三方 Action 均钉到 40 位 commit SHA（行尾注释保留可读大版本），防 tag 重指向供应链攻击；由 dependabot 周更自动维护。升级大版本（如 checkout v5→v6）是单独的人工决策。
- **lint 仅覆盖改动文件**：若未来对全仓做一次性 `biome format` 重排，可将门禁升级为全仓 `biome ci`。
- **build 与 docker-build 在 PR 上各构建一次**：分别校验「代码可构建」与「镜像可打包」，刻意保留以提高鲁棒性；如需省额度可二选一。
- **测试为 DB-free 单测**：涉及真实 DB 的集成测试目前不在 CI 内（见 `docs/TODO.md` 端到端实测项）。
- **Windows 本地 `turbo build` 会在 standalone 拷贝阶段报 `EINVAL`**：Next 生成的 trace 文件名含冒号（`[externals]_node:fs_promises...`），Windows 文件名非法。编译本身成功；CI（Linux runner）与 Docker 构建不受影响——本仓库生产构建走 Docker/Linux。
- **行尾**：`.mjs` 等文件的 git blob 为 LF，CI（Linux）下 biome 检查通过；Windows 开发机因 `core.autocrlf=true` 本地工作副本为 CRLF，本地直接跑 `biome` 可能报 `format`（CRLF）告警，属本地假象，不影响 CI。
