<p align="center">
  <img src="https://img.shields.io/badge/Node.js-24.x-339933?logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white" alt="Express">
  <img src="https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
  <br>
  <a href="https://github.com/teachingroom-manager-public/teachingroom-manager/actions/workflows/docker-publish.yml">
    <img src="https://github.com/teachingroom-manager-public/teachingroom-manager/actions/workflows/docker-publish.yml/badge.svg" alt="Docker build">
  </a>
  <img src="https://img.shields.io/badge/docker%20image-~150%20MB-2496ED?logo=docker&logoColor=white" alt="Docker image size">
  <img src="https://img.shields.io/badge/platform-amd64%20%7C%20arm64-lightgrey" alt="Platforms">
</p>

# 🏫 教室设备管理系统

> 把教室设备 Excel 台账变成可持续维护、可审核、可备份的 Web 管理工具。

[English](./README.en.md) · [文档中心](./docs/README.md) · [更新日志](./docs/CHANGELOG.md)

---

## 📋 目录

- [功能特性](#-功能特性)
- [快速开始](#-快速开始)
  - [Docker 部署（推荐）](#docker-部署推荐)
  - [传统部署](#传统部署)
- [技术栈](#-技术栈)
- [项目结构](#-项目结构)
- [环境变量](#-环境变量)
- [基础数据 API](#-基础数据-api)
- [部署选项](#-部署选项)
- [开发](#-开发)
- [许可证](#📄-许可证)

---

## ✨ 功能特性

<table>
<tr>
<td>

**📊 台账管理**
- 首次启动从 Excel 自动导入演示数据
- 桌面表格 + 手机/平板卡片双视图
- 按楼栋、级部、更新计划、关键字快速筛选
- 按当前筛选结果导出 Excel

</td>
<td>

**✅ 审核流程**
- 字段级变更提交 → 交叉审核 → 正式生效
- 新增教室、字段变更、照片上传/删除均需审核
- 提交人不能审核自己的变更
- Excel 上传生成待审核变更，不直接覆盖数据

</td>
</tr>
<tr>
<td>

**👥 权限管理**
- 超级管理员、管理员、巡查员三级角色
- 超级管理员管理用户、审计日志、回滚、备份
- 用户停用/降级/删除后 session 立即失效

</td>
<td>

**🔄 数据安全**
- 单条撤销 + 按时间线整体回滚
- 每日自动备份 + 手动备份 + 备份下载/上传/恢复
- 备份镜像到第二磁盘/网络目录
- 跨字段、教室新增和照片操作均可回滚

</td>
</tr>
<tr>
<td>

**📡 开放 API**
- 只读基础数据接口（教室列表、字段、汇总）
- Token 鉴权，可选 CORS 白名单
- 便于其他部门或信息系统对接

</td>
<td>

**📱 离线友好**
- 弱网提交进入浏览器 IndexedDB 持久队列
- 幂等请求自动补交
- Session 持久化到 SQLite

</td>
</tr>
</table>

---

## 🚀 快速开始

### Docker 部署（推荐）

> 💡 **建议先 Fork 此仓库**，自行构建镜像并保存到自己的 GHCR，确保来源可控。

**前置条件：** Docker & Docker Compose

```bash
# 1. 克隆仓库（或你的 fork）
git clone https://github.com/REPLACE_WITH_YOUR_USERNAME/teachingroom-manager.git
cd teachingroom-manager

# 2. 生成 Session 密钥并启动
export SESSION_SECRET="$(openssl rand -hex 32)"
docker compose -f docker/docker-compose.yml up -d

# 3. 打开浏览器
open http://localhost:3000/
```

> **首次管理员账号**
>
> | 用户名 | 密码 |
> |---|---|
> | `admin` | 优先使用 `INITIAL_ADMIN_PASSWORD` 环境变量；<br>未设置时自动生成，查看容器日志或 `data/initial-admin-password.txt` |

**自行构建：** 取消注释 `docker/docker-compose.yml` 中的 `build:` 块，注释 `image:` 行，然后：

```bash
cd docker
docker compose build
docker compose up -d
```

<details>
<summary><b>📦 镜像信息</b></summary>

| 属性 | 值 |
|---|---|
| 基础镜像 | `node:24-alpine` |
| 构建策略 | 3 阶段（依赖安装 → 前端压缩 → 运行镜像） |
| 最终体积 | ~150 MB（比单阶段 slim 构建小 ~70 MB） |
| 支持架构 | `linux/amd64` · `linux/arm64` |
| 运行用户 | `node`（非 root） |
| 健康检查 | 每 30s 检查 `/api/health` |

</details>

<details>
<summary><b>📂 数据持久化</b></summary>

| 主机目录 | 容器路径 | 内容 |
|---|---|---|
| `./data/` | `/app/data` | SQLite 数据库、令牌、Session 密钥 |
| `./backups/` | `/app/backups` | 数据库自动/手动备份 |
| `./uploads/` | `/app/uploads` | 照片上传 |
| `./exports/` | `/app/exports` | Excel 导出 |

</details>

### 传统部署

需要 Node.js 24+：

```bash
npm install
npm test
npm start
```

打开 http://localhost:3000/ ，管理员账号同上。

---

## 🛠️ 技术栈

| 类别 | 技术 |
|---|---|
| **运行时** | [Node.js](https://nodejs.org/) 24.x |
| **Web 框架** | [Express](https://expressjs.com/) 5 |
| **数据库** | [SQLite](https://www.sqlite.org/)（[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)） |
| **前端** | 原生 HTML · CSS · JavaScript（无框架） |
| **Excel** | [ExcelJS](https://github.com/exceljs/exceljs) |
| **密码** | [bcryptjs](https://github.com/dcodeIO/bcrypt.js) |
| **容器** | Docker · Docker Compose · GHCR |

---

## 🏗️ 项目结构

```
teachingroom-manager/
├── public/                        # 前端静态资源
│   ├── index.html                 #   单页应用入口
│   ├── styles.css                 #   全局样式（桌面 + 手机）
│   └── app.js                     #   客户端逻辑、IndexedDB 离线队列
├── src/                           # 后端源码
│   ├── server.js                  #   Express 服务端主文件（路由 + 中间件）
│   ├── database.js                #   SQLite 初始化、数据模型、字段读写
│   ├── excel.js                   #   Excel 导入解析与导出生成
│   ├── timeline-rollback.js       #   时间线回滚逻辑
│   └── seed.js                    #   独立种子数据导入脚本
├── tests/                         # 测试
│   ├── bootstrap.test.js          #   首次启动凭据生成测试
│   └── integration.test.js        #   全量 API 集成测试
├── docker/                        # Docker 部署
│   ├── Dockerfile                 #   多阶段构建（Alpine）
│   ├── docker-compose.yml         #   Compose 编排文件
│   ├── healthcheck.js             #   容器健康检查
│   └── .env.example               #   环境变量模板
├── docs/                          # 文档
│   ├── DEPLOYMENT.md              #   完整部署与运维手册
│   ├── DEPLOYMENT_QUICK.md        #   精简部署指南
│   ├── DEVELOPMENT.md             #   开发说明
│   ├── CHANGELOG.md               #   更新日志
│   ├── TIMESTAMP_LOG.md           #   版本与上传记录
│   └── README.md                  #   文档中心
├── deploy/                        # systemd 部署模板
│   └── teachingroom.service
├── .github/workflows/             # CI/CD
│   └── docker-publish.yml         #   自动构建推送至 GHCR
├── package.json
├── .dockerignore
├── .gitignore
└── 初始化数据表格（虚拟）.xlsx      # 首次启动演示数据
```

---

## 🗄️ 数据库配置

默认使用 **SQLite**（零依赖，开箱即用）。也支持 MySQL/MariaDB 和 PostgreSQL。

### 连接方式

```bash
# SQLite（默认）
npm start

# MySQL / MariaDB（需 npm install mysql2）
DATABASE_URL="mysql://user:pass@host:3306/dbname" npm start

# PostgreSQL（需 npm install pg）
DATABASE_URL="postgres://user:pass@host:5432/dbname" npm start
```

### 数据库相关环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_URL` | 空 | 统一连接串。设置后忽略其他 DB_* 变量 |
| `DB_TYPE` | `sqlite` | 数据库类型：`sqlite` / `mysql` / `postgres` |
| `DB_HOST` | `localhost` | 数据库主机地址 |
| `DB_PORT` | — | 数据库端口（MySQL: 3306, PG: 5432） |
| `DB_USER` | `root` / `postgres` | 数据库用户 |
| `DB_PASSWORD` | 空 | 数据库密码 |
| `DB_NAME` | `teachingroom` | 数据库名 |
| `DB_PATH` | `./data/teachingroom.sqlite` | SQLite 文件路径（仅 SQLite 模式） |

> 优先级：`DATABASE_URL` > `DB_TYPE` + `DB_*` 变量 > SQLite 默认。

---

## ⚙️ 通用环境变量

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `PORT` | 否 | `3000` | HTTP 监听端口 |
| `SESSION_SECRET` | **是** | 自动生成到文件 | Session 加密密钥 |
| `INITIAL_ADMIN_PASSWORD` | 否 | 自动生成到文件 | 首次管理员密码（≥12 位） |
| `AUTO_BACKUP_KEEP` | 否 | `200` | 自动备份保留份数（≥7） |
| `BACKUP_MIRROR_DIR` | 否 | 空 | 备份镜像目录 |
| `BASE_DATA_CORS_ORIGIN` | 否 | 空 | API CORS 白名单（逗号分隔） |
| `SKIP_SOURCE_IMPORT` | 否 | 空 | 设为 `1` 跳过首次 Excel 导入 |

---

## 🔌 基础数据 API

系统自动生成只读 API 令牌到 `data/base-data-api-token.txt`，用于其他部门或系统对接。

```bash
TOKEN="$(cat data/base-data-api-token.txt)"
curl -H "X-API-Token: $TOKEN" http://localhost:3000/api/open/classrooms
```

**接口列表：**

| 端点 | 说明 |
|---|---|
| `GET /api/open/meta` | API 元信息 |
| `GET /api/open/fields` | 可公开字段定义 |
| `GET /api/open/summary` | 汇总统计 |
| `GET /api/open/classrooms` | 教室列表（支持筛选） |
| `GET /api/open/classrooms/:id` | 单间教室详情 |

**常用筛选参数：** `building`、`department`、`orientation`、`planned`（`yes`/`screen`/`board`/`audio`）、`search`

---

## 📦 部署选项

| 方式 | 适用场景 | 参考文档 |
|---|---|---|
| **Docker Compose** | 快速部署、容器化环境 | [精简部署指南](./docs/DEPLOYMENT_QUICK.md) |
| **systemd** | Linux 服务器直接运行 | [完整部署与运维手册](./docs/DEPLOYMENT.md) |
| **手动运行** | 开发测试 | 见本页"传统部署" |

---

## 🛠️ 开发

详见 [开发说明](./docs/DEVELOPMENT.md)。

```bash
npm install
npm test
npm start
```

---

## 📄 许可证

[MIT](./LICENSE) © TeachingRoom Contributors

---

<p align="center">
  <sub>Built with Node.js, Express & SQLite · 面向校内小团队 · 约 10 人规模</sub>
  <br>
  <a href="https://github.com/teachingroom-manager-public/teachingroom-manager">GitHub</a> ·
  <a href="./docs/README.md">文档中心</a> ·
  <a href="./docs/CHANGELOG.md">更新日志</a>
</p>
