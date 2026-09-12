# 部署指南

[English](./DEPLOYMENT.en.md)

这是适合快速交付的精简部署指南。更完整的部署、运维、Excel、用户、审计和回滚说明见[完整部署与运维手册](./docs/DEPLOYMENT.md)。

本文说明如何在校内或内网 Linux 服务器上部署教室设备管理系统。

文档中所有具体服务器地址、用户名、密钥和路径均使用占位符表示。

## 占位符

| 占位符 | 含义 |
| --- | --- |
| `<SERVER_IP>` | 用户浏览器访问的服务器地址 |
| `<SERVER_NAME>` | 可选域名 |
| `<DEPLOY_USER>` | 运行服务的 Linux 用户 |
| `<APP_DIR>` | 应用部署目录 |
| `<CHANGE_ME_LONG_RANDOM_SECRET>` | 长随机 session 密钥 |

## 环境要求

- Linux 服务器。
- Node.js 20 或更高版本，建议 Node.js 22+。
- 访问端口需要在防火墙中放行。
- 通过 `better-sqlite3` 使用 SQLite。

检查 Node.js：

```bash
node -v
npm -v
```

## 运行参数

服务通过环境变量配置：

```ini
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DATA_DIR=<APP_DIR>/data
Environment=DB_PATH=<APP_DIR>/data/teachingroom.sqlite
Environment=SESSION_SECRET=<CHANGE_ME_LONG_RANDOM_SECRET>
Environment=INITIAL_ADMIN_PASSWORD=<OPTIONAL_FIRST_RUN_PASSWORD_AT_LEAST_12_CHARACTERS>
Environment=AUTO_BACKUP_KEEP=200
```

可选参数：

```text
BASE_DATA_API_TOKEN=<固定开放 API 令牌>
BASE_DATA_CORS_ORIGIN=<允许的跨域来源，以逗号分隔；默认关闭>
BACKUP_MIRROR_DIR=<可选第二磁盘或网络挂载目录>
```

## 手动运行

将仓库复制或克隆到 `<APP_DIR>`：

```bash
cd <APP_DIR>
npm ci --omit=dev
npm test
npm start
```

打开：

```text
http://<SERVER_IP>:3000/
```

检查健康状态：

```bash
curl http://127.0.0.1:3000/api/health
```

## systemd 部署

编辑仓库中的服务模板：

```text
deploy/teachingroom.service
```

替换：

```ini
User=<DEPLOY_USER>
Group=<DEPLOY_USER>
WorkingDirectory=<APP_DIR>
Environment=DB_PATH=<APP_DIR>/data/teachingroom.sqlite
Environment=SESSION_SECRET=<CHANGE_ME_LONG_RANDOM_SECRET>
Environment=AUTO_BACKUP_KEEP=200
```

安装并启动：

```bash
sudo cp deploy/teachingroom.service /etc/systemd/system/teachingroom.service
sudo systemctl daemon-reload
sudo systemctl enable --now teachingroom.service
sudo systemctl status teachingroom.service --no-pager
```

查看日志：

```bash
journalctl -u teachingroom.service -n 100 --no-pager
```

更新后重启：

```bash
sudo systemctl restart teachingroom.service
systemctl is-active teachingroom.service
```

## Docker Compose 部署

Docker 相关文件集中在 `docker/` 目录（`Dockerfile`、`docker-compose.yml`）。在 `docker/` 目录内执行：

```bash
export SESSION_SECRET="$(openssl rand -hex 48)"
docker compose pull        # 使用 GHCR 预构建镜像（推荐）
docker compose up -d
docker compose ps
docker compose logs -f
```

也可以完全本地构建：

```bash
docker compose up -d --build
```

Compose 文件会把运行数据保存在仓库根目录：

```text
data/
exports/
```

正式部署前请设置强随机 `SESSION_SECRET`；未设置时系统会自动生成并持久化到 `data/session-secret.txt`。

### 预构建镜像

镜像基于 `node:24-alpine`（始终跟随 Alpine 最新版本），多阶段构建、以非 root 用户 `node` 运行，内置 `/api/health` 健康检查。推送到 main 分支或打 `v*` 标签时，GitHub Actions 自动构建 `linux/amd64` 和 `linux/arm64` 双架构镜像并发布到 GHCR：

```text
ghcr.io/realkiro/teachingroom-manager-public:latest
```

如已配置 `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` 仓库密钥，会同步发布到 Docker Hub。GHCR 包首次推送后默认私有，可在仓库 Packages 设置中改为公开。

不使用 Compose 时，也可以直接运行预构建镜像（把数据目录挂载到 `/app/data` 等路径）：

```bash
docker run -d --name teachingroom-manager -p 3000:3000 \
  -e SESSION_SECRET="$(openssl rand -hex 48)" \
  -v "$PWD/data:/app/data" \
  ghcr.io/realkiro/teachingroom-manager-public:latest
```

### CI/CD 说明

- `.github/workflows/ci.yml`：在 Node.js 20/22/24 三个版本上运行 `npm test`。
- `.github/workflows/docker.yml`：先构建镜像并启动容器做 `/api/health` 冒烟测试，通过后发布镜像；Pull Request 只构建测试、不发布。
- `.github/dependabot.yml`：每周检查 npm 依赖、Dockerfile 基础镜像（`docker/Dockerfile`，锁定 Node 大版本）和 Actions 版本更新。

## 无服务器部署（Vercel / Cloudflare Workers）

应用已适配无服务器运行：存储层通过 `src/db-driver.js` 可插拔——本地/Docker 用 better-sqlite3，Vercel 用 Turso（libSQL 远程 SQLite，经同步桥接），Workers 用 Durable Objects 内置 SQLite。业务代码三个环境完全一致。

- Vercel：`api/index.js` + `vercel.json`（含每日 Cron 备份），数据库建库步骤与必填环境变量见 [README.md](./README.md)。
- Cloudflare Workers：`wrangler.jsonc` + `src/worker.js` + `src/do.js`，`npx wrangler deploy` 即可；备份为 `.sql` 转储。
- 通用环境变量（`SESSION_SECRET` 必填、`CRON_SECRET`、`INITIAL_ADMIN_PASSWORD` 等）见 [README.md](./README.md) 的无服务器环境变量表。
- CI 中的 `workers-smoke` 作业会在每次提交后用 `wrangler dev` 验证健康检查、登录、建教室与备份流程。

## MCP 服务端

服务在 `/mcp` 暴露标准 MCP（Model Context Protocol）端点，使用 Streamable HTTP 传输，供 AstrBot 等机器人框架接入。鉴权与开放 API 共用同一令牌（`X-API-Token` 或 `Authorization: Bearer` 头），工具集为只读查询（教室台账、教室详情、字段定义、统计概览）。AstrBot 配置示例见 [README.md](./README.md) 的 MCP 章节。

## 数据文件

运行文件不会提交到 Git：

```text
data/teachingroom.sqlite
data/base-data-api-token.txt
data/session-secret.txt
data/initial-admin-password.txt
backups/
uploads/
exports/
```

仓库提交的虚构种子 Excel 模板为：

```text
初始化数据表格（虚拟）.xlsx
```

首次启动时，如果 SQLite 数据库为空，系统会导入该 Excel 文件。文件内全部数据均为虚构示例，正式使用前应替换或删除。

## 备份和恢复

系统会在以下目录创建每日自动备份：

```text
backups/
```

超级管理员可以在页面中执行：

- 创建手动备份。
- 下载备份到本地。
- 启用服务器上的备份。
- 上传并启用 SQLite 数据库文件。

启用备份或上传数据库前，系统会校验 SQLite 完整性和必要数据表，并自动创建当前数据库的 `before_restore` 备份。

恢复后的数据库会清空其中保存的全部登录 session，因此所有用户都需要重新登录。

备份不按保存天数自动删除。自动备份保留最新 `AUTO_BACKUP_KEEP` 份；手动备份和 `before_restore` 备份永久保留，需由管理员在系统外归档或删除。需要异机或异盘容灾时，请挂载第二磁盘或网络目录并设置 `BACKUP_MIRROR_DIR`。

## 开放 API

只读基础数据 API 需要：

```text
X-API-Token: <TOKEN>
```

不要把令牌放到 URL 中，系统会拒绝查询参数令牌。仅为明确的调用方配置 `BASE_DATA_CORS_ORIGIN`，多个来源用逗号分隔。

读取自动生成的令牌：

```bash
cat data/base-data-api-token.txt
```

示例：

```bash
curl -H "X-API-Token: <TOKEN>" http://<SERVER_IP>:3000/api/open/classrooms
```

## 验证清单

- `npm test` 通过。
- `/api/health` 返回 `{ "ok": true }`。
- 管理员账号可以正常登录。
- 每间教室的历史弹窗可显示字段旧值/新值、人员和北京时间。
- 手机窄屏布局可用。
- Excel 导出正常。
- 数据库备份列表中至少有一条自动备份。
- 普通管理员不能审核自己提交的教室、字段或照片申请。
- 用户停用、降级、删除或重置密码后，其他活动 session 立即失效。
- 下载的备份可以在测试环境校验或恢复。

## 仓库规范

- 不提交密码、token、内网服务器 IP 或真实部署路径。
- 运行数据不进入 Git。
- 使用 `<SERVER_IP>`、`<APP_DIR>`、`<DEPLOY_USER>` 等占位符。
- 上传和交接记录写入 `TIMESTAMP_LOG.md`。
