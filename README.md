# 教室设备管理系统

[English](./README.en.md)

教室设备管理系统是一个轻量级 Web 系统，用于把教室设备 Excel 台账转成可持续维护、可审核、可备份的数据管理工具。

仓库附带 `初始化数据表格（虚拟）.xlsx`，用于演示首次初始化。该文件只包含虚构数据；系统支持教室台账、巡查更新、审核流程、Excel 导入导出、操作记录、数据回滚、数据库备份，以及面向其他部门的只读基础数据接口。

本系统面向校内小团队使用，预计用户规模约 10 人，因此技术栈保持简单：Node.js、Express、SQLite 和原生前端页面。

## 文档导航

- [精简部署指南](./DEPLOYMENT.md)
- [完整部署与运维手册](./docs/DEPLOYMENT.md)
- [开发说明](./DEVELOPMENT.md)
- [更新日志](./docs/CHANGELOG.md)
- [项目工作记录](./docs/WORK_LOG_2026-05-18.md)
- [版本与上传记录](./TIMESTAMP_LOG.md)
- [全部文档](./docs/README.md)

## 功能

- 首次启动时从虚构 Excel 模板自动导入演示数据。
- 支持桌面表格视图，以及手机、平板卡片视图。
- 支持按楼栋、级部、更新计划、待审核状态和关键字快速筛选。
- 支持超级管理员、管理员、巡查员三类角色。
- 巡查员和管理员提交的数据变更会进入审核流程。
- 除超级管理员外，新增教室、字段变更、照片上传和照片删除均需其他管理员交叉审核。
- 管理员对字段级新旧值进行审核后，正式数据才会更新。
- 每间教室提供独立配置历史，按北京时间展示字段旧值/新值、提交人、审核人、来源、说明、照片和回滚记录。
- 用户管理和操作记录仅超级管理员可见。
- 支持撤销单次已审核修改，以及跨字段、教室新增和照片操作还原到某条记录之前。
- 支持按当前筛选结果导出 Excel。
- Excel 上传不会直接覆盖正式数据，而是生成待审核变更。
- 登录 session 保存到 SQLite。
- 弱网提交会进入浏览器持久队列，并通过幂等请求自动补交。
- 支持自动备份、手动备份、下载备份、上传备份和启用备份。
- 提供只读基础数据 API，便于其他部门或内部系统接入。
- 内置标准 MCP 服务端（`/mcp`，Streamable HTTP），可对接 AstrBot 等机器人框架。

## 快速开始

```bash
npm install
npm test
npm start
```

打开：

```text
http://localhost:3000/
```

首次管理员账号：

```text
超级管理员用户名：admin
密码：优先使用 INITIAL_ADMIN_PASSWORD；未设置时写入 data/initial-admin-password.txt
```

系统不创建固定密码，也不自动创建巡查员。首次登录后请立即修改管理员密码；随机生成的临时密码文件会在改密成功后删除。巡查员和普通管理员可在用户管理页面创建。

## 默认运行参数

```text
PORT=3000
DATA_DIR=./data
DB_PATH=./data/teachingroom.sqlite
SESSION_SECRET=<optional; generated into data/session-secret.txt when omitted>
INITIAL_ADMIN_PASSWORD=<optional first-run password; at least 12 characters>
BASE_DATA_CORS_ORIGIN=<empty by default; comma-separated allowlist>
AUTO_BACKUP_KEEP=200
BACKUP_MIRROR_DIR=<optional second backup directory>
```

首次运行会创建 `data/teachingroom.sqlite`。如果数据库为空，系统会从以下 Excel 文件导入教室数据：

```text
初始化数据表格（虚拟）.xlsx
```

该文件中的楼栋、门牌号、班级、部门、设备和备注均为虚构示例。正式使用前请替换或删除这些记录。

## 数据和备份

运行数据不会提交到 Git：

```text
data/*.sqlite
data/base-data-api-token.txt
data/session-secret.txt
data/initial-admin-password.txt
backups/
uploads/
exports/
```

系统会在以下目录创建每日自动备份：

```text
backups/
```

超级管理员也可以在页面中手动创建、下载、上传并启用数据库备份。

备份不按天数清理。自动备份默认保留最新 200 份；手动备份和恢复前备份永久保留，需由管理员在系统外按制度归档或删除。可设置 `BACKUP_MIRROR_DIR` 将备份同步到第二块磁盘或网络目录。

## 基础数据 API

系统会生成只读 API 令牌文件：

```text
data/base-data-api-token.txt
```

示例：

```bash
TOKEN="$(cat data/base-data-api-token.txt)"
curl -H "X-API-Token: $TOKEN" http://localhost:3000/api/open/classrooms
```

令牌只能通过 `X-API-Token` 或 `Authorization: Bearer` 传递，不接受 URL 查询参数。接口仅返回明确标记为可发布的字段；未配置来源白名单时不启用跨域。

接口：

```text
GET /api/open/meta
GET /api/open/fields
GET /api/open/summary
GET /api/open/classrooms
GET /api/open/classrooms/:id
```

常用筛选参数：

```text
building=X栋
department=小学
orientation=南
side=南侧
planned=yes
planned=screen
planned=board
planned=audio
search=X101
```

## 部署

支持三种方式：Docker Compose（推荐）、Cloudflare Containers（实验性）、Node.js 直接运行。Docker 相关文件集中在 `docker/` 目录，文件说明见 [docker/README.md](./docker/README.md)。

### 方式一：Docker Compose（推荐，适合服务器与群晖 NAS）

GitHub Actions 会在每次推送 main 或打 `v*` 标签时自动测试、构建 `linux/amd64` + `linux/arm64` 镜像并发布到 GHCR：

```text
ghcr.io/realkiro/teachingroom-manager-public:latest
```

首次拉取前请把 GHCR 包设为公开（仓库 Packages → teachingroom-manager-public → Package settings → Change visibility → Public），或先执行 `docker login ghcr.io`。

```bash
git clone https://github.com/RealKiro/teachingroom-manager-public.git
cd teachingroom-manager-public/docker
echo "SESSION_SECRET=$(openssl rand -hex 48)" > .env
docker compose pull
docker compose up -d
curl http://127.0.0.1:3000/api/health
```

`SESSION_SECRET` 未设置时系统会自动生成并持久化到 `data/session-secret.txt`。也可以完全本地构建：`docker compose up -d --build`。

### 群晖 NAS（Container Manager）

要求 DSM 7.2+（自带 Container Manager）：

1. 套件中心安装 Container Manager；通过 File Station 把仓库上传到 `/docker/teachingroom`（或在 SSH 中 `git clone`）。
2. 先让镜像可用：把 GHCR 包设为公开，然后在 SSH 中执行一次 `sudo docker compose -f /volume1/docker/teachingroom/docker/docker-compose.yml pull`；或者不拉取、直接在下一步让 Container Manager 本地构建。
3. Container Manager → 项目 → 新增：路径选择 `/docker/teachingroom/docker`，来源选"使用现有的 docker-compose.yml"，一路下一步并启动。
4. 运行数据保存在仓库目录下的 `data/`、`backups/`、`uploads/`、`exports/`，可直接纳入 Hyper Backup 计划。

纯 SSH 方式：

```bash
ssh <USER>@<NAS_IP>
cd /volume1/docker/teachingroom/docker
echo "SESSION_SECRET=$(openssl rand -hex 48)" | sudo tee .env >/dev/null
sudo docker compose pull
sudo docker compose up -d
sudo docker compose logs -f
```

### 方式二：Cloudflare Containers（实验性）

预构建镜像可以直接跑在 Cloudflare Containers 上（需要 Workers 付费计划，Containers 目前为 Beta），最小示例见 `deploy/cloudflare/`：

```bash
npm install -g wrangler
wrangler login
cd deploy/cloudflare
wrangler deploy
```

注意事项：

- **容器磁盘不持久**：重启或迁移后 SQLite 数据与上传的照片会丢失，仅适合演示与试用；正式数据请部署在 NAS/服务器上，依赖每日备份机制。
- 镜像必须可公开拉取（GHCR 公开包或 Docker Hub 公开仓库）。
- 配置字段以 [Cloudflare Containers 官方文档](https://developers.cloudflare.com/containers/) 为准。

### 方式三：Node.js 直接运行

见 [DEPLOYMENT.md](./DEPLOYMENT.md)，含 systemd 服务模板 `deploy/teachingroom.service`。

## MCP 接入（AstrBot 等机器人框架）

服务内置标准 MCP（Model Context Protocol）服务端，端点 `/mcp`，使用 Streamable HTTP 传输，符合 MCP 官方规范，任何支持 MCP 的客户端均可接入，已重点适配 AstrBot（远程 MCP 模式）。

- **鉴权**：与只读基础数据 API 共用同一令牌，读取 `data/base-data-api-token.txt`，通过 `X-API-Token` 或 `Authorization: Bearer` 头传递。
- **能力**：只读工具集；数据写入请继续使用 Web 界面审核流程。

| 工具 | 说明 |
| --- | --- |
| `list_classrooms` | 按楼栋、级部、更新计划、关键字筛选教室台账，支持 limit/offset 分页 |
| `get_classroom` | 按教室 ID 或教室编号查询单间教室详情 |
| `get_fields` | 获取公开字段定义（类型、可选项），便于构造筛选 |
| `get_summary` | 台账统计概览（总数、楼栋/级部分布、更新计划统计） |

### AstrBot 配置示例

在 AstrBot WebUI（工具 → MCP）添加 MCP 服务器，使用远程 Streamable HTTP 方式：

```json
{
  "url": "http://<SERVER_IP>:3000/mcp",
  "transport": "streamable_http",
  "timeout": 30,
  "headers": {
    "X-API-Token": "<TOKEN>"
  }
}
```

`<TOKEN>` 为服务器上 `data/base-data-api-token.txt` 的内容。保存后 AstrBot 会自动完成 MCP 握手并列出工具，机器人对话中即可直接查询教室设备与更新计划。

### 其他 MCP 客户端

任意标准 MCP 客户端按 Streamable HTTP 连接 `http://<SERVER_IP>:3000/mcp` 并携带同样的鉴权头即可。公网部署时请通过反向代理启用 HTTPS，并按需限制访问来源。

## 开发

架构、开发流程和仓库规范见 [DEVELOPMENT.md](./DEVELOPMENT.md)。

## 版本和上传记录

GitHub 上传、仓库地址、提交 ID 和交接记录见 [TIMESTAMP_LOG.md](./TIMESTAMP_LOG.md)。
