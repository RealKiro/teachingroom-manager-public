# Docker 部署文件

本目录集中存放 Docker 相关文件。构建上下文始终是仓库根目录（`.dockerignore` 因此必须保留在仓库根目录，无法移入本文件夹）。

## 文件说明

| 文件 | 用途 |
| --- | --- |
| `Dockerfile` | 镜像定义：`node:24-alpine` 多阶段构建、非 root 运行、内置健康检查 |
| `docker-compose.yml` | 编排文件：默认拉取 GHCR 预构建镜像，也支持 `--build` 本地构建 |

## 常用命令

在 `docker/` 目录内执行：

```bash
# 方式一：使用预构建镜像（推荐，NAS/服务器无需安装构建依赖）
docker compose pull
docker compose up -d

# 方式二：本地构建
docker compose up -d --build

# 查看状态与日志
docker compose ps
docker compose logs -f
```

建议在 `docker/` 目录下创建 `.env` 文件保存配置（compose 会自动读取）：

```bash
echo "SESSION_SECRET=$(openssl rand -hex 48)" > .env
# Fork 用户：把镜像指向自己账号下的 GHCR 包
echo "TEACHINGROOM_IMAGE=ghcr.io/<你的用户名>/teachingroom-manager-public:latest" >> .env
```

`SESSION_SECRET` 未设置时系统会在首次启动时自动生成并持久化到 `data/session-secret.txt`；`TEACHINGROOM_IMAGE` 未设置时默认拉取 `ghcr.io/realkiro/teachingroom-manager-public:latest`。

数据目录位于仓库根目录的 `data/`、`backups/`、`uploads/`、`exports/`。

更多部署方式（Cloudflare、群晖 NAS、MCP 机器人接入）见仓库根目录 [README.md](../README.md) 与 [DEPLOYMENT.md](../DEPLOYMENT.md)。
