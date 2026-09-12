# Docker 部署文件

本目录集中存放 Docker 相关文件。构建上下文始终是仓库根目录（`.dockerignore` 因此必须保留在仓库根目录，无法移入本文件夹）。

## 文件说明

| 文件 | 用途 |
| --- | --- |
| `Dockerfile` | 镜像定义：`node:24-alpine` 多阶段构建、非 root 运行、内置健康检查 |
| `docker-compose.yml` | 编排文件：默认拉取官方 GHCR 预构建镜像，镜像名可用 `TEACHINGROOM_IMAGE` 覆盖，也支持 `--build` 本地构建 |
| `.env.example` | 配置模板：复制为 `.env` 后按注释修改 |

## 最简部署（不需要整个仓库）

只需要两个文件，放在任意目录（例如群晖 `docker/teachingroom/`）：

```bash
curl -O https://raw.githubusercontent.com/RealKiro/teachingroom-manager-public/main/docker/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/RealKiro/teachingroom-manager-public/main/docker/.env.example
# 编辑 .env：把 SESSION_SECRET 换成长随机字符串（建议同时设置 INITIAL_ADMIN_PASSWORD）
docker compose up -d
curl http://127.0.0.1:3000/api/health
```

运行数据保存在 compose 文件同目录的 `data/`、`backups/`、`uploads/`、`exports/` 四个文件夹里；更新版本只需 `docker compose pull && docker compose up -d`。

## 在仓库内构建/开发

检出整个仓库后在本目录执行：

```bash
docker compose up -d --build
```

`SESSION_SECRET` 未设置时系统会在首次启动时自动生成并持久化到 `data/session-secret.txt`。

更多部署方式（Cloudflare Workers、Vercel、MCP 机器人接入）见仓库根目录 [README.md](../README.md) 与 [DEPLOYMENT.md](../DEPLOYMENT.md)。
