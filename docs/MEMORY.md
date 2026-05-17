# GPT2IMAGE Pro — 实时关键记忆

## 部署状态

- **用户站**: https://gpt2image.pro (port 3000)
- **管理站**: https://admin.gpt2image.pro (port 3001)
- **部署方式**: 本机 Next standalone 运行在 `3303`，由 Nginx 反代
- **数据库**: PostgreSQL on same host
- **SSL**: 由 Nginx/证书服务管理

## Creem 支付沙盒

- **Store ID**: 已配置，勿提交真实值
- **API Key**: 已配置，勿提交真实值
- **API Base**: `https://test-api.creem.io/v1`
- **Webhook Secret**: 未配置

### 产品 ID

| Plan | Monthly | Yearly |
|------|---------|--------|
| Starter ($5/$35) | 已配置，勿提交真实值 | 已配置，勿提交真实值 |
| Pro ($9/$65) | 已配置，勿提交真实值 | 已配置，勿提交真实值 |
| Ultra ($15/$109) | 已配置，勿提交真实值 | 已配置，勿提交真实值 |

## R2 存储

- **Endpoint**: 已配置，勿提交真实值
- **Bucket**: 已配置，勿提交真实值
- **状态**: 待配置 Access Key

## 待办

- [ ] 配置 R2 存储 Access Key
- [ ] 配置 Creem Webhook Secret
- [ ] 清理根目录旧 `src/` 代码
- [ ] 更新 README.md 为 monorepo 结构
- [ ] 迁移 Next.js 16 middleware 到 proxy convention

## 部署操作

```bash
# 本机更新部署
corepack pnpm --filter @repo/web build
cd apps/web/.next/standalone/apps/web
PORT=3303 HOSTNAME=0.0.0.0 NODE_ENV=production node server.js
```
