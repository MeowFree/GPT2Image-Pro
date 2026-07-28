# 首尔服务器精简部署

这套部署面向 2 核、4 GB 内存的首尔服务器。运行 PostgreSQL、一次性数据库
迁移和 Web 服务，不启动可选的 ChatGPT Web 代理与注册机。

## 构建镜像

从 GitHub Actions 手动运行 `docker-release.yml` 时必须填写：

- `next_public_app_url`：最终公网地址，例如 `https://image.example.com`。
- `generations_bucket_name`：生成图私有桶。
- `avatars_bucket_name`：头像桶。

这些值会写入浏览器端构建产物，只修改服务器环境变量不会完全生效。
标签推送仍使用本地开发默认值，生产部署应按站点重新手动构建。

## 最小环境变量

服务器环境文件至少包含：

```dotenv
GPT2IMAGE_IMAGE_TAG=sha-<commit>
WEB_PORT=3310
POSTGRES_DB=gpt2image
POSTGRES_USER=gpt2image
POSTGRES_PASSWORD=...

BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=https://image.example.com
BETTER_AUTH_TRUSTED_ORIGINS=https://image.example.com
NEXT_PUBLIC_APP_URL=https://image.example.com

STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
STORAGE_REGION=auto
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...
STORAGE_BUCKET_NAME=gpt2image-seoul-uploads
NEXT_PUBLIC_GENERATIONS_BUCKET_NAME=gpt2image-seoul-generations
NEXT_PUBLIC_AVATARS_BUCKET_NAME=gpt2image-seoul-avatars

SELF_USE_MODE_ENABLED=true
PAYMENT_PROVIDER=none
NEXT_PUBLIC_PAYMENT_PROVIDER=none
CONTENT_MODERATION_ENABLED=false
IMAGE_GENERATION_GLOBAL_CONCURRENCY=2
```

环境文件必须只保存在服务器，并设置为 `0600`。三个 R2 桶应相互隔离：
头像桶会按公开内容处理，不能与需要签名访问的生成图共用。

## 启动与验证

```bash
docker compose -f docker-compose.seoul.yml pull
docker compose -f docker-compose.seoul.yml up -d
docker compose -f docker-compose.seoul.yml ps
docker compose -f docker-compose.seoul.yml logs migrate
```

Web 默认只绑定 `127.0.0.1:3310`，应通过 Cloudflare Tunnel 对外提供 HTTPS。
确认迁移退出码为 `0`、Web 健康后，再把公网流量切到新端口。
