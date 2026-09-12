# 教室设备管理系统

[English](./README.en.md)

<div align="center">
  <img src="docs/banner.svg" alt="教室设备管理系统 —— 把教室设备 Excel 台账变成可审核、可备份的在线系统" width="960" />
</div>

教室设备管理系统是一个轻量级 Web 系统，用于把教室设备 Excel 台账转成可持续维护、可审核、可备份的数据管理工具。

仓库附带 `初始化数据表格（虚拟）.xlsx`，用于演示首次初始化。该文件只包含虚构数据；系统支持教室台账、巡查更新、审核流程、Excel 导入导出、操作记录、数据回滚、数据库备份，以及面向其他部门的只读基础数据接口。

本系统面向校内小团队使用，因此技术栈保持简单：Node.js、Express、SQLite 和原生前端页面。

## 文档导航

- [精简部署指南](./DEPLOYMENT.md)
- [完整部署与运维手册](./docs/DEPLOYMENT.md)
- [Docker 文件说明](./docker/README.md)
- [开发说明](./DEVELOPMENT.md)
- [更新日志](./docs/CHANGELOG.md)
- [全部文档](./docs/README.md)

## 功能特性

- 首次启动时从虚构 Excel 模板自动导入演示数据。
- 支持桌面表格视图，以及手机、平板卡片视图。
- 支持按楼栋、级部、更新计划、待审核状态和关键字快速筛选。
- 超级管理员、管理员、巡查员三类角色；巡查数据提交后进入交叉审核流程，审核通过才更新正式数据。
- 每间教室提供独立配置历史：字段旧值/新值、提交人、审核人、照片和回滚记录，按北京时间展示。
- 支持撤销单次已审核修改，以及跨字段、教室新增和照片操作还原到某条记录之前。
- Excel 上传不直接覆盖数据，而是生成待审核变更；支持按筛选结果导出 Excel。
- 自动备份、手动备份、下载备份、上传并启用备份。
- 登录 session 保存到 SQLite；弱网提交进入浏览器持久队列并幂等补交。
- 提供只读基础数据 API 和内置标准 MCP 服务端，便于其他部门或机器人（如 AstrBot）接入。

## 部署

本项目的全部数据（SQLite 数据库、照片、备份）都需要**持久化存储**，这决定了各平台的适用边界：

| 平台 | 免费额度 | 能否白嫖 | 说明 |
| --- | --- | --- | --- |
| Docker Compose（服务器 / 群晖 NAS 等自有设备） | 已有硬件 | ✅ **首选** | 预构建 GHCR 镜像，数据在本机 |
| Cloudflare Workers | 10 万请求/天 + DO SQLite 存储 | ⚠️ 实验性 | 已适配，数据存 Durable Objects 内置 SQLite |
| Vercel | 函数执行 + 每日 Cron | ⚠️ 实验性 | 已适配，需外接 Turso 免费远程 SQLite |
| Oracle Cloud 永久免费 | 永久免费 ARM VM（4 核 24G） | ✅ | 公网访问的最佳免费 VM |
| Google Cloud Always Free | 永久免费 e2-micro VM | ✅ | 需绑卡验证，1G 内存够本项目用 |
| Render / Koyeb / HF Spaces | 有 | ⚠️ 仅演示 | 磁盘不持久，重启丢数据 |
| Railway / Fly.io | 一次性 $5 试用金 | ❌ | 额度用完即收费 |
| Cloudflare Containers | ❌ | ❌ | 必须 Workers 付费计划（$5/月起） |
| Node.js 直接运行（本地开发） | 已有电脑 | ✅ | 本地开发与轻量部署 |

推荐顺序：有服务器或 NAS 就用 Docker Compose；想免费上公网选 Workers 或 Vercel 两条无服务器路线（免费额度对小团队足够）；对数据可靠性要求更高时仍优先自有设备。各平台政策会变化，部署前以官方文档为准。

### Docker Compose（推荐，服务器与群晖 NAS 通用）

不需要懂开发：镜像由 GitHub Actions 在你自己的仓库里自动构建并发布，你只需要 Fork、点一次运行、然后启动容器。

**第 1 步：Fork 仓库，构建你自己的镜像**

1. 登录 GitHub，打开本仓库，点击右上角 **Fork**（创建到你自己的账号下）。
2. 进入你 Fork 后的仓库，打开 **Actions** 标签页，首次会提示工作流被禁用，点击 **I understand my workflows, go ahead and enable them** 启用。
3. 在 Actions 左侧选择 **Docker** 工作流 → 右侧 **Run workflow** → 确认运行，等待 5-10 分钟变绿 ✓。
4. 回到仓库首页，右侧栏出现 **Packages**（或点个人头像 → Your packages），里面就有镜像 `teachingroom-manager-public`。点进去 → **Package settings** → **Danger Zone** → **Change visibility** → 改为 **Public**（公开后 NAS 和服务器无需登录即可拉取镜像）。

**第 2 步：把仓库文件放到机器上**

- 群晖 NAS：在 GitHub 仓库页面点 **Code → Download ZIP**，解压后用 File Station 把整个文件夹上传到 NAS 的 `docker` 共享文件夹（例如 `/volume1/docker/teachingroom`）。注意是整个文件夹，不要只上传 `docker/` 子目录。
- 服务器：SSH 登录后 `git clone https://github.com/<你的用户名>/teachingroom-manager-public.git`（或同样下载 ZIP 解压）。

**第 3 步：写一个配置文件**

在仓库的 `docker` 子目录里创建 `.env` 文件，内容两行：

```bash
cd <仓库目录>/docker
echo "SESSION_SECRET=$(openssl rand -hex 48)" > .env
echo "TEACHINGROOM_IMAGE=ghcr.io/<你的用户名>/teachingroom-manager-public:latest" >> .env
```

把 `<你的用户名>` 换成你的 GitHub 用户名。`SESSION_SECRET` 是站点密钥，任意长随机字符串都可以（用密码生成器生成也行）。不需要改 `docker-compose.yml` 本身。

**第 4 步：启动**

```bash
docker compose pull
docker compose up -d
curl http://127.0.0.1:3000/api/health   # 返回 {"ok":true,...} 即成功
```

**群晖图形界面启动（全程不用 SSH）**：完成第 1-3 步后（`.env` 可在 File Station 里用文本编辑器创建），打开 Container Manager → **项目** → **新增** → 路径选择 `/docker/teachingroom/docker` → 来源选"使用现有的 docker-compose.yml" → 一路下一步并启动。

数据都保存在仓库目录下的 `data/`、`backups/`、`uploads/`、`exports/` 文件夹里，备份这些文件夹（或用 Hyper Backup）即可保全全部数据。日常更新版本：在 Fork 仓库页面点 **Sync fork → Update branch**，等 Actions 构建变绿后在 NAS/服务器上重新执行第 4 步即可。

### Cloudflare Workers（免费额度可跑，实验性）

应用已适配 Workers：整个 Express 应用跑在单个 Durable Object 里，数据存入 DO 内置 SQLite（业务代码与本地/Docker 完全一致）。**全程在浏览器中完成，无需本地安装任何工具。**

**第 1 步：Fork 仓库。** 与 Docker 部署共用同一个 Fork（见上文第 1 步；本方式无需运行 Docker 工作流）。

**第 2 步：一键部署到 Cloudflare。** 点击下方按钮，用 GitHub 账号登录 Cloudflare，选择你 Fork 的仓库并确认创建：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FRealKiro%2Fteachingroom-manager-public)

按钮会自动读取仓库中的 `wrangler.jsonc`，创建 Durable Object 与静态资源，并建立"提交即部署"的关联。也可以手动操作：Cloudflare 控制台 → **Workers 和 Pages** → **创建** → **导入现有存储库** → 连接 GitHub → 选你的 Fork → 部署。

**第 3 步：配置环境变量。** 打开 Worker → **设置** → **变量和机密**，添加（值用密码生成器生成）：

- `SESSION_SECRET`（类型：机密，必填）
- `INITIAL_ADMIN_PASSWORD`（建议：首次管理员密码，≥12 位）
- `CRON_SECRET`（建议：定时备份令牌）

**第 4 步：验证。** 打开 `https://<项目名>.<你的子域>.workers.dev/api/health`，返回 `{"ok":true,...}` 即成功；用 `admin` 和 `INITIAL_ADMIN_PASSWORD` 登录后立即改密。每日自动备份已由仓库内置的 Cron Trigger 完成（备份为 `.sql` 转储）。

注意事项：

- 免费版限制：10 万请求/天；DO SQLite 存储免费额度较小，照片请控制体积（单张上限 8MB）。
- 200MB 的整库上传恢复受 Worker 内存限制，建议用"启用服务器备份"功能恢复本系统导出的 `.sql` 备份。
- 兼容性依赖 `nodejs_compat` + `enable_nodejs_http_server_modules`（2025-09 起官方支持 Node HTTP 服务器与 Express），该能力较新，正式使用前请在自己的账号上完整验证。

### Vercel（免费额度可跑，实验性）

Vercel 上数据库使用 Turso（libSQL 免费远程 SQLite，SQLite 方言零改动）。**同样全程网页操作：**

**第 1 步：Fork 仓库。** 同上。

**第 2 步：一键部署到 Vercel。** 点击下方按钮，用 GitHub 账号登录 Vercel 并授权，按向导创建项目：

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FRealKiro%2Fteachingroom-manager-public&env=SESSION_SECRET,INITIAL_ADMIN_PASSWORD,CRON_SECRET&project-name=teachingroom-manager)

向导会要求填写 `SESSION_SECRET`（必填，用密码生成器生成）、`INITIAL_ADMIN_PASSWORD` 与 `CRON_SECRET`（可留空稍后补）。

**第 3 步：接入 Turso 数据库。** 部署完成后进入项目 → **Storage / 集成** 标签 → 添加 **Turso** 集成 → 创建或选择数据库，Vercel 会自动把 `LIBSQL_URL` 和 `LIBSQL_AUTH_TOKEN` 注入项目，无需手动复制粘贴。

**第 4 步：验证。** 打开 `https://<项目名>.vercel.app/api/health`，返回 `{"ok":true,...}` 即成功。每日自动备份已由 `vercel.json` 内置（备份为 `.sql` 转储，存于数据库内）。

<details>
<summary>进阶：命令行部署方式（可选）</summary>

```bash
npm install -g @turso/cli vercel
turso auth login
turso db create teachingroom
turso db show teachingroom --url          # → LIBSQL_URL
turso db tokens create teachingroom       # → LIBSQL_AUTH_TOKEN
vercel link
vercel env add LIBSQL_URL production
vercel env add LIBSQL_AUTH_TOKEN production
vercel env add SESSION_SECRET production   # openssl rand -hex 48
vercel --prod
```

</details>

注意事项：

- 平台限制：请求体上限 4.5MB（免费版）——照片（上限 8MB）与 Excel 大文件上传会失败，请压缩后使用；冷启动 1-3 秒。
- Turso 免费档额度（5GB 存储、5 亿行读/月量级）对小团队远够用；额度以官方文档为准。

### 无服务器环境变量（Workers / Vercel 通用）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `SESSION_SECRET` | ✅ | 会话密钥，多实例内存不共享，必须显式提供 |
| `LIBSQL_URL` | Vercel ✅ | Turso/libSQL 连接地址（如 `libsql://xxx.turso.io`）；Workers 不需要 |
| `LIBSQL_AUTH_TOKEN` | Vercel ✅ | Turso 数据库令牌；Workers 不需要 |
| `INITIAL_ADMIN_PASSWORD` | 建议 | 首次启动的管理员密码（≥12 位）；未设置时打印到部署平台日志 |
| `CRON_SECRET` | 建议 | 定时备份令牌；设置后 `POST /api/cron/backup` 需要 `Authorization: Bearer <CRON_SECRET>` |
| `BASE_DATA_API_TOKEN` | 可选 | 开放 API/MCP 令牌；未设置时从 `SESSION_SECRET` 派生稳定值 |
| `SKIP_SOURCE_IMPORT` | 可选 | 无服务器模式默认跳过演示 Excel 导入（数据库为空时可在界面中上传 Excel 导入） |

### 免费 VM（Oracle Cloud / Google Cloud）

在永久免费 VM 上安装 Docker 后，部署流程与 Docker Compose 完全一致。额外注意：

- Oracle Cloud 需要在控制台安全列表（Security List）和实例系统防火墙（iptables）中同时放行 3000 端口。
- GCP e2-micro 内存只有 1G，本项目足够（Node + SQLite 约占 100M），但不要在同机再跑其他服务。
- 公网暴露前建议配置反向代理 + HTTPS，并设置强随机 `SESSION_SECRET`。

### Cloudflare Containers（$5/月起，零适配）

预构建镜像可以直接跑在 Cloudflare Containers 上，但该功能**必须 Workers 付费计划**，没有免费额度；最小示例见 `deploy/cloudflare/`：

```bash
npm install -g wrangler
wrangler login
cd deploy/cloudflare
wrangler deploy
```

注意事项：

- **容器磁盘不持久**：重启或迁移后 SQLite 数据与上传的照片会丢失，仅适合演示与试用。
- 镜像必须可公开拉取（GHCR 公开包或 Docker Hub 公开仓库）。
- 配置字段以 [Cloudflare Containers 官方文档](https://developers.cloudflare.com/containers/) 为准。

### Node.js 直接运行（本地开发与轻量部署）

```bash
git clone https://github.com/RealKiro/teachingroom-manager-public.git
cd teachingroom-manager-public
npm install
npm test          # 可选：运行完整测试
npm start
curl http://localhost:3000/api/health
```

本地长期运行建议配合 systemd 常驻（服务模板 `deploy/teachingroom.service`，完整步骤见 [DEPLOYMENT.md](./DEPLOYMENT.md)）。

### 首次启动

首次管理员账号：

```text
用户名：admin
密码：优先使用 INITIAL_ADMIN_PASSWORD；未设置时本地运行写入 data/initial-admin-password.txt，无服务器平台打印到部署日志
```

首次登录后请立即修改管理员密码（临时密码文件随之删除）；巡查员和普通管理员在用户管理页面创建。系统不创建固定密码，也不自动创建巡查员。

数据库为空时会自动导入 `初始化数据表格（虚拟）.xlsx`（虚构示例数据，正式使用前请替换或删除）；无服务器模式默认跳过该导入，可在界面中上传 Excel 完成初始化。

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

## 基础数据 API

系统会生成只读 API 令牌文件 `data/base-data-api-token.txt`：

```bash
TOKEN="$(cat data/base-data-api-token.txt)"
curl -H "X-API-Token: $TOKEN" http://localhost:3000/api/open/classrooms
```

令牌只能通过 `X-API-Token` 或 `Authorization: Bearer` 传递，不接受 URL 查询参数。接口仅返回明确标记为可发布的字段；未配置来源白名单时不启用跨域。

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

## 运行参数

```text
PORT=3000
DATA_DIR=./data
DB_PATH=./data/teachingroom.sqlite
SESSION_SECRET=<可选；未设置时自动生成到 data/session-secret.txt>
INITIAL_ADMIN_PASSWORD=<可选首次启动密码；至少 12 位>
BASE_DATA_CORS_ORIGIN=<默认为空；逗号分隔的跨域白名单>
AUTO_BACKUP_KEEP=200
BACKUP_MIRROR_DIR=<可选第二备份目录>
```

## 数据和备份

运行数据不进入 Git：

```text
data/*.sqlite
data/base-data-api-token.txt
data/session-secret.txt
data/initial-admin-password.txt
backups/
uploads/
exports/
```

每日自动备份写入 `backups/`；超级管理员也可在页面中手动创建、下载、上传并启用备份。自动备份默认保留最新 200 份（`AUTO_BACKUP_KEEP`），手动备份和恢复前备份永久保留。需要异机容灾时设置 `BACKUP_MIRROR_DIR` 同步到第二块磁盘或网络目录。

## CI/CD

- 推送 main 或打 `v*` 标签时，GitHub Actions 自动跑测试（Node 20/22/24 矩阵）、用 `wrangler dev` 冒烟验证 Workers 适配、构建双架构镜像、容器冒烟测试后发布到 GHCR（配置 Docker Hub 密钥后同步发布）。
- Pull Request 只构建和测试，不发布。
- Dependabot 每周检查 npm 依赖、基础镜像和 Actions 版本。

## 开发

架构、开发流程和仓库规范见 [DEVELOPMENT.md](./DEVELOPMENT.md)。

## 版本和上传记录

GitHub 上传、仓库地址、提交 ID 和交接记录见 [TIMESTAMP_LOG.md](./TIMESTAMP_LOG.md)。
