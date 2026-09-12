# 开发说明

[English](./DEVELOPMENT.en.md)

本文说明教室设备管理系统的架构、数据模型、存储与部署适配、前端行为、开发约束和维护流程。

## 目标

本项目提供一个面向校内使用的小型教室设备数据管理系统。

它不是简单替代 Excel，而是把直接改表格改为可审核、可导入导出、可追溯、可回滚、可备份的数据管理流程。

同一套业务代码支持三种运行环境：本地/服务器（Node.js 或 Docker）、Cloudflare Workers（Durable Objects 内置 SQLite）和 Vercel（Turso 远程 SQLite）。

## 技术栈

- Node.js 20 或更高版本
- Express 5
- SQLite：本地经 `better-sqlite3`；无服务器环境经 `src/db-driver.js` 的兼容驱动
- 使用 ExcelJS 处理 Excel 导入导出（按需动态加载）
- Express session，session 数据保存到 SQLite
- 标准 MCP 服务端（Streamable HTTP，端点 `/mcp`）
- 原生 HTML、CSS、JavaScript

## 目录结构

```text
teachingroom/
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src/
│   ├── server.js                  # Express 应用与全部路由
│   ├── database.js                # 连接单例、建表、字段与用户种子
│   ├── db-driver.js               # 存储驱动层（file / libsql / do-sqlite）
│   ├── libsql-bridge-worker.js    # libSQL 同步桥接 worker（仅 Vercel/本地测试加载）
│   ├── mcp.js                     # MCP 服务端（Streamable HTTP，只读工具）
│   ├── excel.js
│   ├── timeline-rollback.js
│   ├── seed.js
│   ├── worker.js                  # Cloudflare Workers 入口
│   └── do.js                      # Durable Object：绑定存储并加载应用
├── api/
│   └── index.js                   # Vercel 入口（导出 Express app）
├── tests/
│   ├── integration.test.js
│   ├── bootstrap.test.js
│   ├── mcp.test.js
│   └── libsql-driver.test.js
├── docs/
│   ├── README.md / README.en.md
│   ├── CHANGELOG.md / CHANGELOG.en.md
│   ├── DEPLOYMENT.md / DEPLOYMENT.en.md
│   ├── WORK_LOG_2026-05-18.md / .en.md
│   └── banner.svg                 # README 首页预览横幅
├── deploy/
│   ├── teachingroom.service       # systemd 模板
│   └── cloudflare/                # Cloudflare Containers 付费方案示例
├── docker/
│   ├── Dockerfile                 # node:24-alpine 多阶段构建
│   ├── docker-compose.yml         # 镜像名可用 TEACHINGROOM_IMAGE 覆盖
│   ├── .env.example                    # 配置模板，复制为 .env 使用
│   └── README.md
├── README.md / README.en.md
├── DEPLOYMENT.md / DEPLOYMENT.en.md
├── DEVELOPMENT.md / DEVELOPMENT.en.md
├── TIMESTAMP_LOG.md / TIMESTAMP_LOG.en.md
├── vercel.json                    # Vercel 配置（rewrites + 每日 Cron）
├── wrangler.jsonc                 # Workers 配置（DO + Assets + Cron）
└── package.json
```

运行目录不进入 Git：

```text
data/
backups/
uploads/
exports/
output/
node_modules/
```

## 后端

`src/server.js` 负责：

- 提供 `public/` 静态文件。
- 登录和 session 接口。
- 教室列表和筛选。
- 变更申请提交。
- 管理员审核流程。
- 超级管理员用户管理。
- 操作记录查询和筛选。
- 单条撤销和按记录整体还原。
- Excel 导出与上传生成待审核变更。
- 只读开放 API（`/api/open/*`）。
- MCP 服务端挂载（`/mcp`，与开放 API 共用令牌鉴权）。
- 数据库备份：本地为文件复制，无服务器为 SQL 转储（见"备份"）。
- `POST /api/cron/backup`：定时备份触发端点（`CRON_SECRET` Bearer 校验）。

`src/database.js` 负责：

- 经 `db-driver.js` 打开数据库连接（单例 `db`）。
- 数据表初始化与迁移。
- 默认字段定义与默认用户。
- 操作记录写入。
- 教室字段值写入。

`src/db-driver.js` 是存储驱动层，向上提供 better-sqlite3 兼容接口（`prepare/get/all/run/exec/transaction/pragma/close`）：

- `file`（默认）：直接包装 `better-sqlite3`，本地与 Docker 行为完全不变。
- `libsql`（设置 `LIBSQL_URL` 时启用）：worker_threads + Atomics 同步桥接 `@libsql/client`，用于 Vercel/Turso；嵌套事务降级为 SAVEPOINT，命名参数自动转为位置参数。
- `do-sqlite`（Workers）：同步包装 Durable Objects 的 `ctx.storage.sql`，事务使用 `storage.transactionSync`。

`src/mcp.js` 实现 MCP 服务端：`initialize`/`tools/list`/`tools/call` 等 JSON-RPC 方法，暴露只读工具（教室台账查询、教室详情、字段定义、统计概览），鉴权与开放 API 共用令牌。

`src/worker.js` + `src/do.js` 为 Cloudflare Workers 入口：请求转发到单例 Durable Object，DO 内绑定存储后动态加载现有 Express 应用，经官方 `node:http` 服务器兼容层处理请求。

`api/index.js` 为 Vercel 入口：直接导出 Express app。

`src/excel.js` 负责：

- 首次运行导入源 Excel（无服务器模式跳过）。
- 解析上传的 Excel（文件路径或 Buffer 两种入口）。
- 生成导出 Excel。

## 存储与部署适配

| 环境 | 驱动 | 入口 | 备份格式 |
| --- | --- | --- | --- |
| 本机 / systemd / Docker | `file`（better-sqlite3） | `npm start` / 镜像 CMD | SQLite 文件（`backups/`） |
| Vercel | `libsql`（Turso，同步桥接） | `api/index.js` | SQL 转储（`app_backups` 表） |
| Cloudflare Workers | `do-sqlite`（DO 内置 SQLite） | `src/worker.js` → DO | SQL 转储（`app_backups` 表） |

无服务器模式由 `isServerlessDatabase()` 统一判断，影响：跳过演示 Excel 导入与进程内定时器、multer 使用内存存储、令牌/密钥从环境变量读取或派生、备份走转储表、`/api/cron/backup` 替代进程内定时备份。

## 数据模型

核心数据表：

```text
users
field_definitions
classrooms
classroom_values
change_requests
change_request_items
classroom_create_requests
classroom_photos
classroom_photo_requests
audit_logs
classroom_history
user_sessions
app_backups（仅无服务器模式的备份转储表）
```

教室字段以 key/value 形式保存，因此新增字段时不需要修改 `classrooms` 主表结构。

`classroom_history` 是按教室组织的不可变生效历史。每条事件保存教室、发生时间、来源、提交人、审核人、变更说明、审核意见和字段级旧值/新值。系统升级时会从已审核申请和照片申请回填旧记录，并为现有教室生成一次启用快照；后续新增、审核、照片和回滚会在正式数据事务中同步写入。

## 角色

- 超级管理员：固定用户名 `admin`，可管理用户、操作记录、回滚和数据库备份。
- 管理员：可审核教室数据变更。
- 巡查员：可查看数据并提交变更申请。

系统中 `role=admin` 表示具备数据审核权限；超级管理员权限由用户名 `admin` 判断。

## 变更流程

1. 用户提交某间教室的字段级变更。
2. 系统写入 `change_requests` 和 `change_request_items`，保存旧值和新值。
3. 管理员审核变更申请。
4. 审核通过后写入 `classroom_values` 正式数据。
5. 审核拒绝的变更保留历史记录。
6. 操作记录保留完整流程。
7. 审核通过后同时写入该教室的配置历史。

除超级管理员外的正式数据变更均执行交叉审核。提交人不能审核自己的新增教室、字段变更、照片上传或照片删除；待审核请求通过 `clientRequestId` 保证幂等，审核通过前还会校验正式旧值是否已变化。

## 回滚

回滚仅超级管理员可用。

- 单条撤销会反向处理某一次已审核通过的修改。
- 整体还原会按操作记录逆序处理选中记录及之后受支持的字段、教室新增和照片变更。

回滚只影响教室基础数据，不回滚用户、session、字段定义或备份。旧版本记录若缺少完整逆向数据，系统会阻止不完整回滚，并提示超级管理员改用数据库备份。

## 备份

备份分双模式，由存储驱动决定：

- 本地（`file` 驱动）：`wal_checkpoint` 后复制 SQLite 文件到 `backups/`，可配 `BACKUP_MIRROR_DIR` 镜像到第二目录；恢复采用"校验 → before_restore 备份 → 换库文件 → 进程重启"。
- 无服务器（`libsql` / `do-sqlite`）：生成 SQL 转储文本（建表 + 逐行 INSERT，BLOB 十六进制编码），存入 `app_backups` 表并按 `AUTO_BACKUP_KEEP` 轮转；恢复在事务内 drop + 重建 + 灌数据，即时生效并清空全部会话；上传恢复支持本系统导出的 `.sql` 与 SQLite 二进制文件两种输入。

备份类型：

```text
auto
manual
before_restore
```

恢复前系统会校验（SQLite 二进制输入）：

- SQLite 完整性。
- 必要数据表。
- 是否存在 `admin` 超级管理员。

## 前端

`public/app.js` 只使用浏览器原生 API。

页面包括：

- 桌面表格视图。
- 手机卡片视图。
- 变更提交弹窗。
- 审核面板。
- 用户管理弹窗。
- 操作记录弹窗。
- 数据库备份弹窗。

时间以 UTC 风格 SQLite 字符串保存，浏览器端按 `Asia/Shanghai` 显示。

弱网下的教室变更、新增教室、照片上传和照片删除会进入 IndexedDB 持久队列。审核、回滚、用户管理和数据库恢复不会排队，避免延迟执行造成错误授权或状态覆盖。

## 开发流程

```bash
npm install
npm test
npm start
```

`npm test` 包含两部分：对 `src/` 与 `public/` 全部源码做 `node --check` 语法检查，然后运行 `tests/` 下的四组测试：

- `integration.test.js`：审核、会话、回滚、开放 API 与 Excel 全流程。
- `bootstrap.test.js`：首次启动生成一次性管理员凭据（依赖 POSIX 文件权限，Windows 本机会失败，CI 正常）。
- `mcp.test.js`：MCP 握手、鉴权、工具调用与错误码。
- `libsql-driver.test.js`：以 `LIBSQL_URL=file:` 让整套应用跑在 libSQL 同步桥接上，覆盖登录会话、备份转储与恢复、事务与嵌套保存点。

打开：

```text
http://localhost:3000/
```

## 开发约束

新增功能时必须维持以下不变量，否则会破坏某一运行环境：

1. **数据库访问只经单例 `db`**（`src/database.js` 导出）。业务代码不得直接 `import better-sqlite3`，原生模块一律通过 `db-driver.js` 惰性加载。
2. **模块顶层禁止 `createRequire(import.meta.url)`、`fileURLToPath(import.meta.url)` 等调用**——workerd 打包后模块顶层 `import.meta.url` 为 `undefined`，会让 Worker 启动即崩。需要时封装为惰性函数，且只允许在 `file`/`libsql` 驱动分支内执行。
3. **大体量依赖按需加载**：`exceljs` 经 `loadExcelModule()` 动态导入，避免 Workers 免费版 3MB 部署包超限。
4. **文件系统操作必须有 serverless 守卫**：用 `isServerlessDatabase()` 分支；无服务器模式没有可写文件系统（Vercel 仅 `/tmp`，Workers 无），持久数据一律进数据库或环境变量。
5. **备份双模式必须同时维护**：改动备份/恢复逻辑时，文件模式与 `app_backups` 转储模式都要覆盖测试。
6. **SQL 保持 SQLite 方言且兼容三驱动**：可用 `RETURNING`、`datetime('now')`；不要使用 `BEGIN`/`SAVEPOINT` 显式语句（DO SQL 禁止），事务交给 `db.transaction()`。
7. **Docker 文件集中在 `docker/`**；`.dockerignore` 因构建上下文约束必须留在仓库根目录。
8. **文档双语同步**：修改 README/DEPLOYMENT/DEVELOPMENT 时同步 `.en.md`，并检查双向链接。

## 提交前检查

```bash
npm audit
npm test
git status --short
```

手动浏览器检查：

- 使用 `admin` 登录。
- 打开操作记录。
- 打开数据库备份。
- 创建一次备份。
- 导出 Excel。
- 检查约 `375px` 手机宽度。

涉及部署改动时，CI 会自动运行 `workers-smoke` 作业（`wrangler dev` 验证健康检查、登录、建教室与备份），无需本地重复。

## 仓库规范

- 不提交真实部署 IP、用户名、密码、密钥、token 和本地路径。
- 运行数据不进入 Git。
- 只提交源码、静态资源、文档、部署模板和种子 Excel。
- GitHub 上传和交接信息记录到 `TIMESTAMP_LOG.md`。
