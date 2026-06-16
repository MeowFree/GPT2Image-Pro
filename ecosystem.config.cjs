/**
 * PM2 多进程配置
 *
 * 单容器内启动 4 个 Next.js 独立进程，分别绑定不同端口。
 * Nginx 按 Host header 反代到对应端口。
 *
 * 各 app 的 standalone 产物由 Dockerfile.multi 构建阶段产出，
 * COPY 后目录结构为 /app/apps/<name>/.next/standalone/apps/<name>/server.js。
 * 因为 Next.js standalone 会把 monorepo 根的 node_modules 拷到 standalone 根，
 * 而多 app 的 standalone 产物合并后共用同一份根 node_modules，
 * 所以 server.js 的路径为 apps/<name>/server.js（相对于 /app 工作目录）。
 */
module.exports = {
  apps: [
    {
      name: "web",
      script: "apps/web/server.js",
      env: {
        PORT: 3000,
        HOSTNAME: "0.0.0.0",
      },
    },
    {
      name: "admin",
      script: "apps/admin/server.js",
      env: {
        PORT: 3001,
        HOSTNAME: "0.0.0.0",
      },
    },
    {
      name: "api",
      script: "apps/api/server.js",
      env: {
        PORT: 3002,
        HOSTNAME: "0.0.0.0",
      },
    },
    {
      name: "platform",
      script: "apps/platform/server.js",
      env: {
        PORT: 3003,
        HOSTNAME: "0.0.0.0",
      },
    },
  ],
};
