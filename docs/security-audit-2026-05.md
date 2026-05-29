# 安全审计报告 — 2026-05-29

多 Agent 并发安全审查（支付/积分/认证/公共 API/输入校验/密钥配置 6 个维度）的综合结论。
威胁模型重点：**经济损失（薅羊毛）** 与 **黑客入侵**。

分支：`dev`（测试）。所有代码修复在 dev 进行，**未**部署、**未**改动生产 DB、**未**推送 main。

---

## A. 关键代码漏洞（已在本次修复）

| # | 严重度 | 位置 | 问题 | 修复 |
|---|--------|------|------|------|
| A1 | CRITICAL | `credits/actions.ts:337` `grantMonthlySubscriptionCredits` | `"use server"` 导出的**未鉴权** action，`userId` 由客户端传入，可给任意账户发积分。零调用方（死代码但端点存活） | 删除 |
| A2 | CRITICAL | `credits/actions.ts:400` `purchaseCredits` | 任意登录用户可调用，`amount` 无上限、无支付校验、无幂等，给自己铸积分。零调用方 | 删除 |
| A3 | CRITICAL | `credits/core.ts` `grantCredits` + `schema.ts` `credits_batch` | 所有发放幂等性都是 SELECT-then-INSERT，`source_ref` **无唯一约束** → 并发/重放 webhook 双重发放 | 加 `UNIQUE(source_type, source_ref)` 偏索引 + `onConflictDoNothing`，冲突即跳过余额更新 |
| A4 | CRITICAL | `api/payments/epay/return/route.ts:56` | 浏览器 GET 同步回跳页**会发放积分**，签名 URL 可被用户并发重放 → 多次发放 | 改为纯展示，仅 `/api/webhooks/epay` 异步通知可发放 |
| A5 | HIGH | `features/payment/epay-fulfillment.ts` | `updateEpayOrderStatus` 无条件 UPDATE，订单状态机不作为发放门闩 | 条件 `UPDATE ... WHERE status='pending' RETURNING`，0 行则跳过 |
| A6 | HIGH | `external-api/handlers/chat-completions.ts:164`, `responses.ts:463` | `image_url` 仅校验 http(s) 前缀，**无内网/元数据过滤** → SSRF（云元数据 169.254.169.254） | 接入 `assertPublicImageUrl` |
| A7 | CRITICAL | `settings/actions/api-config.ts` + `image-generation/service.ts` | 用户自定义 `baseUrl` 的 SSRF 校验**仅在保存时**，请求时不复检；且上游响应体被回显 → 重定向/DNS 重绑定 → 窃取云凭证 | 请求时复检 + 不回显原始上游响应体 |
| A8 | HIGH | `auth/email-domain.ts:12` `normalizeEmail` | 仅 trim+lowercase，未规范化 Gmail 点/加号别名 → 单邮箱 N×100 积分薅羊毛 | 规范化：gmail 去点、所有域去 `+tag` |
| A9 | HIGH | `rate-limit/index.ts:182` | 未配置 Upstash 时限流**静默失效（fail-open）**，默认部署无任何限流 | auth/strict 类型在无后端时 fail-closed |
| A10 | MED→HIGH | `auth/registration-verification.ts` | 6 位验证码无尝试次数限制、错误不失效 → 可暴力破解（配合 A9） | 加尝试计数 + 失败上限失效 |
| A11 | MED | `webhooks/creem/route.ts` | 未交叉校验 `order.amount`/`currency` 与套餐价 | **推迟**：Creem `order.amount`（分）与套餐 `price`（展示币种）单位/币种不一致，硬校验会误拒真实支付；HMAC 已防篡改，纵深防御价值有限。需先对齐 Creem 产品价配置再实现 |
| A12 | MED | `moderation/index.ts:705` | 仅配置代理审核时，代理失败被吞 → fail-open 放行 | 代理失败计入 errors → fail-closed |
| A13 | MED | `app/moderate/route.ts:33` | 未配置 secret 时审核端点完全公开（成本放大/绕过探测） | 无 secret 时 fail-closed |
| A14 | MED | `api/upload/presigned/route.ts` | 大小/Content-Type 仅信客户端声明，未策略强制 | 服务端派生 MIME + 严格大小校验 |
| A15 | LOW/MED | `api/storage/[bucket]/[...key]/route.ts` | generations 桶对象**无鉴权/属主校验**，仅靠 URL 不可猜 | **推迟**：key 为 `userId/nanoid(32)`（≈190bit 不可枚举），属于能力 URL；加鉴权/属主校验风险高（可能破坏全站图片渲染、外链分享、og:image），需先做 UI 测试。建议：generations 桶走 session+属主校验或短时签名 URL，avatars 保持公开 |
| A16 | LOW/MED | `logger/index.ts` / `bootstrap-super-admin.ts:48` | Pino 无 redact；超管引导密码打到 stdout 日志 | 加 redact；日志只记路径不记密码 |

## B. 误报（审计纠正）
- **epay_order 迁移缺失**：实为读错目录。Live 迁移在 `packages/database/drizzle/0012_epay_order.sql`，存在。根 `drizzle/` 是死的 legacy 目录（root `drizzle.config.ts` 指向死的 `./src/db/schema.ts`）。
- **根 `src/` 树**：不在 pnpm workspace，`turbo build` 不构建，未部署 = 死代码。其中重复的漏洞副本不影响生产，但建议整体删除以减小混淆与攻击面。

## C. 运维层补救（**用户必须手动执行，代码无法修复**）

> ⚠️ 优先级最高的是 C1：数据库口令暴露在公网。

| # | 行动 | 原因 |
|---|------|------|
| C1 | **轮换 DB 口令**并将 `104.248.226.34:8888` 限制为仅应用出口 IP | `.env.local` 中 `postgresql://root:XXll...@104.248.226.34:8888` 为公网可达 root 连接串，泄露即全库失守 |
| C2 | **轮换 `PLATFORM_API_KEY`** (`sk-317Wgs...`) | 上游图像 API 花费凭证 |
| C3 | 生产配置 **Upstash**（或令限流 fail-closed） | 否则限流失效（A9） |
| C4 | 生产设强 `BETTER_AUTH_SECRET`（`openssl rand -base64 32`），勿用 `...change-in-production` | 弱密钥可伪造会话 |
| C5 | `git rm --cached 注册机/ChatGPTRegister.exe`，gitignore `注册机/*.exe` | 14MB 不可审计二进制随仓库分发 |
| C6 | 给 `/sign-up` 与验证码发送加 CAPTCHA/Turnstile | 阻断批量注册薅羊毛 |

## D. 待评估（产品/成本，本次未改）
- **成本放大**：`quality`、`thinking/reasoning.effort` 不计入积分定价，上游成本数倍于收费（`resolution.ts`）。需产品定价决策。
- **文本代理**：`/v1/chat/completions` 纯文本按固定 1 积分/轮，可被当作廉价 LLM 代理。
- **每 key 限流**：v1 端点无 per-key/per-user 频率限流；`X-Forwarded-For` 可伪造绕过 per-IP 限流（需可信代理跳数配置）。
- **内存态存储**：异步任务/续连缓存为单实例内存，多实例部署会丢状态（可靠性，非安全）。
