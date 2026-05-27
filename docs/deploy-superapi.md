# Superapi 生图站部署 Runbook

本文档记录 `https://gpt2image.superapi.buzz` 当前线上部署方式，只适用于本站这套 Nginx 静态 alias、systemd release 和 AB 切换环境。普通部署不需要照这个 runbook 手动处理静态资源；按 README 的生产部署即可。

## 当前拓扑

- 公网域名：`https://gpt2image.superapi.buzz`
- Nginx upstream：`gpt2image_pool`
- 当前公网主 upstream：`127.0.0.1:3308`
- 备用 upstream：`127.0.0.1:3307`
- 主服务旁路验证端口：`3303`
- Next 静态 alias：`/var/www/gpt2image.superapi.buzz/_next/static/`
- release 根目录：`/home/user1/gpt2image-releases/`
- Node：`/home/user1/.nvm/versions/node/v24.15.0/bin`

注意：公网当前主要走 `3308`，不是 `3303`。只重启 `gpt2image-web.service` 不等于公网已切换。

## 部署原则

- 每次前端构建必须更换 `NEXT_PUBLIC_ASSET_PREFIX`，不要复用旧前缀。
- `NEXT_PUBLIC_ASSET_PREFIX` 必须写在 `apps/web/.env.local`，这是 Next 构建实际读取的文件。
- release 不能复制 `storage`，否则会把用户生成图复制进 release，目录可能膨胀到几十 GB。
- release 不能排除 `apps/web/.next/standalone/node_modules`，否则 standalone 启动会报 `Cannot find module 'next'`。
- Nginx 静态 alias 不会读 release 目录，必须单独同步 `apps/web/.next/static` 到 `/var/www/gpt2image.superapi.buzz/_next/static/`。
- systemd 有 drop-in 覆盖路径，必须改 drop-in，不要只看主 unit。

## 标准部署流程

以下命令假设在仓库根目录 `/home/user1/GPT2Image-Pro` 执行。

### 1. 确认工作区和 commit

```bash
git status --short
git log --oneline -1
```

如果有代码改动，先测试并提交。

### 2. 更新静态资源前缀

把 `apps/web/.env.local` 里的 `NEXT_PUBLIC_ASSET_PREFIX` 改成唯一值：

```env
NEXT_PUBLIC_ASSET_PREFIX=/gpt2-assets-vYYYYMMDD-brief-<commit>-HHMMSS
```

验证：

```bash
rg -n "NEXT_PUBLIC_ASSET_PREFIX" apps/web/.env.local
```

### 3. 构建

```bash
PATH=/home/user1/.nvm/versions/node/v24.15.0/bin:$PATH pnpm --filter @repo/web build
```

如果出现 `.next/lock` 残留且确认没有构建进程：

```bash
ps -ef | rg "next build|pnpm|turbo|node"
rm -f apps/web/.next/lock
```

构建后验证前缀：

```bash
rg -n '"assetPrefix"|gpt2-assets' apps/web/.next/required-server-files.json
```

### 4. 补齐 standalone static

```bash
mkdir -p apps/web/.next/standalone/apps/web/.next/static
rsync -a --delete apps/web/.next/static/ apps/web/.next/standalone/apps/web/.next/static/
```

### 5. 创建 release

示例：

```bash
release=/home/user1/gpt2image-releases/gpt2image-brief-<commit>-YYYYMMDD-HHMMSS
mkdir -p "$release"

rsync -a --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.turbo' \
  --exclude='storage' \
  --exclude='apps/web/.next/cache' \
  /home/user1/GPT2Image-Pro/ "$release"

# 关键：上面的全局 node_modules 排除会影响 standalone，必须重新补齐 standalone。
rsync -a --delete \
  /home/user1/GPT2Image-Pro/apps/web/.next/standalone/ \
  "$release/apps/web/.next/standalone/"
```

验证 release：

```bash
du -sh "$release"
test -e "$release/apps/web/.next/standalone/node_modules/.pnpm/next"* && echo ok
test -L "$release/apps/web/.next/standalone/apps/web/node_modules/next" && echo ok
rg -n '"assetPrefix"|gpt2-assets' "$release/apps/web/.next/standalone/apps/web/.next/required-server-files.json"
```

正常 release 体积应在几百 MB 量级，不应出现几十 GB。

### 6. 同步 Nginx 静态资源

```bash
rsync -a --delete \
  "$release/apps/web/.next/static/" \
  /var/www/gpt2image.superapi.buzz/_next/static/
```

注意：先同步静态资源，再切服务。否则 Cloudflare 可能缓存新版 chunk 的 404。

### 7. 切 3308 公网服务

当前公网 upstream 是 `3308`，先切它：

```bash
sudo python3 - <<'PY'
from pathlib import Path
release = "/home/user1/gpt2image-releases/gpt2image-brief-<commit>-YYYYMMDD-HHMMSS"
path = Path("/etc/systemd/system/gpt2image-3308-nopending.service.d/20-agenttools.conf")
path.write_text(f"""[Service]
WorkingDirectory={release}/apps/web/.next/standalone/apps/web
EnvironmentFile=
EnvironmentFile={release}/apps/web/.env.local
Environment=
Environment=PORT=3308
Environment=HOSTNAME=0.0.0.0
Environment=NODE_ENV=production
Environment=PATH=/home/user1/.nvm/versions/node/v24.15.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=
ExecStart=/home/user1/.nvm/versions/node/v24.15.0/bin/node server.js
""")
PY

sudo systemctl daemon-reload
sudo systemctl restart gpt2image-3308-nopending.service
systemctl is-active gpt2image-3308-nopending.service
```

如果 3308 有长请求，restart 可能等待旧请求退出。可以先看日志确认是否仍在处理请求：

```bash
journalctl -u gpt2image-3308-nopending.service --since "2 minutes ago" --no-pager
```

### 8. 切 3303 主服务

`3303` 当前主要用于旁路验证和保留一份同版本服务，也要切到同一 release：

```bash
sudo python3 - <<'PY'
from pathlib import Path
release = "/home/user1/gpt2image-releases/gpt2image-brief-<commit>-YYYYMMDD-HHMMSS"
path = Path("/etc/systemd/system/gpt2image-web.service.d/10-release-15bc77b.conf")
path.write_text(f"""[Service]
WorkingDirectory={release}/apps/web/.next/standalone/apps/web
ExecStart=
ExecStart=/bin/bash -lc 'set -a; . {release}/apps/web/.env.local; set +a; PORT=3303 HOSTNAME=0.0.0.0 NODE_ENV=production exec /home/user1/.nvm/versions/node/v24.15.0/bin/node server.js'
""")
PY

sudo systemctl daemon-reload
sudo systemctl restart gpt2image-web.service
systemctl is-active gpt2image-web.service
```

### 9. 验证

确认进程运行目录：

```bash
readlink -f /proc/$(systemctl show -p MainPID --value gpt2image-3308-nopending.service)/cwd
readlink -f /proc/$(systemctl show -p MainPID --value gpt2image-web.service)/cwd
```

确认 3308 返回新前缀：

```bash
curl -s http://127.0.0.1:3308/zh \
  | rg -o '/gpt2-assets-[^"<> ]+' \
  | head
```

确认公网返回新前缀：

```bash
curl -k -s https://gpt2image.superapi.buzz/zh \
  | rg -o '/gpt2-assets-[^"<> ]+' \
  | head
```

抽查公网静态资源：

```bash
curl -k -I https://gpt2image.superapi.buzz/<asset-prefix>/_next/static/chunks/<chunk>.js
curl -k -I https://gpt2image.superapi.buzz/<asset-prefix>/_next/static/chunks/<chunk>.css
```

看服务日志：

```bash
journalctl -u gpt2image-3308-nopending.service --since "5 minutes ago" --no-pager
journalctl -u gpt2image-web.service --since "5 minutes ago" --no-pager
```

## 回滚

回滚只需要把两个 systemd drop-in 改回上一个 release，并重启：

- `/etc/systemd/system/gpt2image-3308-nopending.service.d/20-agenttools.conf`
- `/etc/systemd/system/gpt2image-web.service.d/10-release-15bc77b.conf`

如果新静态前缀已经被页面引用，回滚后页面会重新引用旧前缀。旧静态资源目录如果仍在 `/var/www/gpt2image.superapi.buzz/_next/static/` 就无需额外操作。

## 常见故障

### 页面还是旧前缀

优先检查 3308，而不是 3303：

```bash
curl -s http://127.0.0.1:3308/zh | rg -o '/gpt2-assets-[^"<> ]+' | head
systemctl cat gpt2image-3308-nopending.service
```

### `Cannot find module 'next'`

release 中 standalone 的 `node_modules` 缺失。重新执行：

```bash
rsync -a --delete \
  /home/user1/GPT2Image-Pro/apps/web/.next/standalone/ \
  "$release/apps/web/.next/standalone/"
sudo systemctl restart gpt2image-3308-nopending.service
```

### ChunkLoadError 或样式丢失

确认 Nginx 静态目录已同步，并抽查资源：

```bash
rsync -a --delete "$release/apps/web/.next/static/" /var/www/gpt2image.superapi.buzz/_next/static/
curl -k -I https://gpt2image.superapi.buzz/<asset-prefix>/_next/static/chunks/<chunk>.js
```

### release 目录异常巨大

通常是误复制了 `storage`。不要上线这个 release，删除或隔离后按标准命令重建。
