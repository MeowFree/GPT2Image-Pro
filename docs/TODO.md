# TODO

## 🔴 安全运维补救（用户必须手动执行 — 代码无法修复）

> 来源：2026-05-29 多 Agent 安全审计，详见 `docs/security-audit-2026-05.md`。
> 代码层修复已在 `dev` 分支完成（提交 2beb0e0 / b69c10b / 14a88d8 / 07d7a18）。

- [ ] **C1（最高优先级）轮换数据库口令**：`.env.local` 中 `postgresql://root:...@104.248.226.34:8888/...` 为公网可达 root 连接串。轮换口令，并将 `104.248.226.34:8888` 防火墙限制为仅应用出口 IP。
- [ ] **C2 轮换 `PLATFORM_API_KEY`**（`sk-317Wgs...`）—上游图像 API 花费凭证。
- [ ] **C3 生产配置 Upstash**（`UPSTASH_REDIS_REST_URL/_TOKEN`）以获得分布式限流；否则仅有单实例内存兜底（auth/strict）。
- [ ] **C4 设置强 `BETTER_AUTH_SECRET`**（`openssl rand -base64 32`），勿用 `...change-in-production`。
- [ ] **C5** `git rm --cached 注册机/ChatGPTRegister.exe` 并 gitignore `注册机/*.exe`（14MB 不可审计二进制随仓库分发）。
- [ ] **C6** 给 `/sign-up` 与验证码发送加 CAPTCHA/Turnstile（阻断批量注册薅羊毛）。

## 🟠 数据库迁移（部署前）

- [ ] 应用 `0025_credits_batch_idempotency.sql` 前，先排查 `credits_batch` 是否已有重复 `(source_type, source_ref)`（历史双发遗留），否则唯一索引创建会失败。排查 SQL 见迁移文件头注释。

## 🟡 已记录、推迟实现（需进一步评估/测试）

- [ ] A11 Creem webhook `order.amount`/`currency` 交叉校验（需先对齐 Creem 产品价单位/币种，避免误拒真实支付）。
- [ ] A15 generations 存储对象鉴权/属主校验或短时签名 URL（需 UI 测试，避免破坏全站图片渲染/外链分享）。
- [ ] 成本放大：将 `quality`、`thinking/reasoning.effort` 计入积分定价（`resolution.ts`），并对 v1 文本代理按上下文/推理计量。
- [ ] v1 端点增加 per-apiKey / per-user 频率限流。
- [ ] SSRF 残留：在连接层 pin 已校验 IP 以根除 DNS 重绑定。
