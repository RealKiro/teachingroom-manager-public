# 时间戳记录

[English](./TIMESTAMP_LOG.en.md)

本文档仅记录公开仓库的发布和交接事件，不包含私有仓库历史、真实部署地址、本机路径、账号密码或校内业务数据。

## 当前仓库

| 字段 | 值 |
| --- | --- |
| 仓库 | `https://github.com/bd4rex/teachingroom-manager-public.git` |
| 默认分支 | `main` |
| 可见性 | `public` |
| 数据策略 | 只提交虚构初始化数据；数据库、备份、上传、导出和运行时密钥全部排除 |

## 记录

### 2026-09-13 00:20:00 CST

- 事件：公开脱敏版升级为校园设备资产管理系统，新增多类别台账、备件库存、设备登记与二维码追踪。
- 分支：`main`
- 备注：台账支持班级教室/教师/办公室三类别（classrooms 加 category 列，字段按类别适用范围显示）；内置字段新增鼠标、键盘、加装音箱、体温计及型号、维修日期/明细/保修期；新增备件库存（inventory_items）与设备登记（equipment_registry，唯一资产编码 + equipment_transfers 转移记录）两个模块，管理员直接生效并写审计；新增免登录扫码查询端点 `/api/scan/:code`、二维码生成 `/api/qrcode` 与标签打印页 labels.html、扫码落地页 scan.html；README banner 与界面文案同步改名为校园设备资产管理系统。不包含学校部署信息或运行数据。
- 验证：新增 assets 测试 6 项全部通过；全量 Node 测试 21 项通过 20 项（1 项为 Windows 本机 POSIX 权限断言限制，CI Ubuntu 环境通过）。

### 2026-09-12 22:10:00 CST

- 事件：公开脱敏版更新开发说明（DEVELOPMENT 双语），补充新特性后的架构与约束。
- 分支：`main`
- 备注：目录结构补齐存储驱动层、MCP 服务端、Workers/Vercel 入口与部署配置；新增"存储与部署适配"对照、"开发约束"章节（数据库单例访问、模块顶层禁止 createRequire、大依赖按需加载、文件系统守卫、备份双模式、SQL 方言边界、Docker 文件归位、文档双语同步）、`app_backups` 备份表与四组测试说明；文档中心索引补充 Docker 文件说明链接。不包含学校部署信息或运行数据。
- 验证：本次仅文档改动，不影响测试结果；上一提交 CI 与 Docker 工作流均通过。

### 2026-09-12 21:30:00 CST

- 事件：公开脱敏版新增 README 首页 SVG 预览横幅，并把 Docker 与无服务器部署说明改为面向非开发者的"一键/少操作"流程。
- 分支：`main`
- 备注：新增自绘 `docs/banner.svg`（系统界面预览 + 部署平台徽标，中英 README 顶部引用）；Docker Compose 与群晖 NAS 合并为一节，流程改为"Fork → 启用 Actions 构建 → 修改 .env → 启动"，compose 镜像名支持 `TEACHINGROOM_IMAGE` 环境变量覆盖；Cloudflare Workers / Vercel 章节加入一键部署按钮（deploy.workers.cloudflare.com / vercel.com/new）与控制台步骤，`wrangler.jsonc` 内置每日 Cron Trigger。不包含学校部署信息或运行数据。
- 验证：SVG 通过 XML 良构校验；`wrangler.jsonc` 解析通过；本次仅文档与部署配置改动，不影响测试结果。

### 2026-09-12 20:30:00 CST

- 事件：公开脱敏版新增无服务器部署支持（Cloudflare Workers / Vercel）。
- 分支：`main`
- 备注：新增存储驱动层 `src/db-driver.js`（better-sqlite3 兼容接口）：本地保持 better-sqlite3 不变；Vercel 经 worker_threads + Atomics 同步桥接接入 Turso/libSQL；Workers 经 Durable Objects 内置 SQLite 驱动（Express 经官方 node:http 服务器兼容运行，无需重写路由）。备份模块双模式（本地文件复制 / 无服务器 SQL 转储表），新增 `POST /api/cron/backup` 定时备份端点；新增 `vercel.json`、`wrangler.jsonc`、`src/worker.js`、`src/do.js`、`api/index.js`；CI 新增 `workers-smoke` 作业（wrangler dev 冒烟）。不包含学校部署信息或运行数据。
- 验证：新增 libsql 桥接应用级测试 4 项（启动、登录会话、备份转储与恢复、事务/嵌套保存点回滚）全部通过；全量 Node 测试 15 项通过 14 项（1 项为 Windows 本机 POSIX 权限断言限制，CI Ubuntu 环境通过）；Workers 冒烟由 CI 验证。

### 2026-09-12 17:40:00 CST

- 事件：公开脱敏版重写 README，补充免费部署对比说明。
- 分支：`main`
- 备注：README 与英文版重构为"功能 / 快速开始 / 部署方式怎么选 / MCP 接入 / API / CI/CD"结构，新增各平台免费额度与数据持久性对比表（Cloudflare Containers 需付费计划、Render 等免费实例磁盘不持久等结论），并补充 Oracle Cloud / Google Cloud 永久免费 VM 部署要点。不包含学校部署信息或运行数据。
- 验证：Markdown 结构人工核对；本次仅文档改动，不影响测试结果。

### 2026-09-12 17:16:48 CST

- 事件：公开脱敏版新增标准 MCP 服务端并整理 Docker 文件。
- 分支：`main`（提交 `d1636ad`）
- 备注：新增 `/mcp` 端点（Streamable HTTP，只读工具集：台账查询、教室详情、字段定义、统计概览），鉴权复用基础数据 API 令牌，适配 AstrBot 远程 MCP 接入；`Dockerfile` 与 `docker-compose.yml` 迁入 `docker/` 目录，compose 默认拉取 GHCR 预构建镜像；新增 Cloudflare Containers 示例（`deploy/cloudflare/`）；README 与部署指南补充 Cloudflare、群晖 NAS、MCP 对接说明。不包含学校部署信息或运行数据。
- 验证：新增 MCP 测试 8 项全部通过，11 项 Node 测试通过 10 项（1 项为 Windows 本机 POSIX 权限断言限制，CI Ubuntu 环境通过）；GitHub Actions CI 与 Docker 工作流均成功。

### 2026-09-12 16:46:09 CST

- 事件：公开脱敏版新增 Alpine Docker 构建与 CI/CD 自动化工作流。
- 分支：`main`（提交 `9642020`）
- 备注：Dockerfile 改为 `node:24-alpine` 多阶段构建（非 root、健康检查）；新增 GitHub Actions 测试矩阵（Node 20/22/24）与 Docker 构建、冒烟测试、GHCR/Docker Hub 发布工作流；新增 Dependabot 配置；双语部署文档补充预构建镜像与 CI/CD 说明。不包含学校部署信息或运行数据。
- 验证：GitHub Actions CI 与 Docker 工作流均成功；集成测试全部通过。

- 事件：公开脱敏版调整历史起始记录的显示名称。
- 分支：`codex/rename-history-baseline`
- 备注：将“历史功能启用快照”改为“启用历史记录时的教室配置”，不包含学校部署信息或运行数据。
- 验证：3 项 Node 测试通过，中英文变更日志同步更新。

### 2026-07-27 11:33:10 CST

- 事件：公开脱敏版统一教师扩声、录播和监控三列的显示间距。
- 分支：`codex/align-boolean-columns`
- 备注：三列统一为等宽、相同内边距和居中对齐，不包含学校部署信息或运行数据。
- 验证：三列实测宽度均约 75.3px，徽标宽度均为 42px，中心偏差为 0；1280px 页面无横向溢出；3 项 Node 测试通过。

### 2026-07-27 11:23:45 CST

- 事件：公开脱敏版修复级部标签重叠并收紧设备列间距。
- 分支：`codex/rebalance-classroom-columns`
- 备注：扩大级部列，适度收紧班级/用途和现有屏幕列，不包含学校部署信息或运行数据。
- 验证：五字级部标签不再越过单元格；书写板起点前移约 6px；1280px 页面无新增横向溢出；3 项 Node 测试通过。

### 2026-07-27 10:56:45 CST

- 事件：公开脱敏版调整教室操作按钮顺序。
- 分支：`codex/reorder-classroom-actions`
- 备注：桌面表格和手机卡片均调整为 `变更` 在前、`历史` 在后，不涉及学校部署信息或运行数据。
- 验证：3 项 Node 测试通过，并检查桌面与手机 DOM 顺序一致。

### 2026-07-27 10:32:10 CST

- 事件：公开脱敏版修复新增历史入口后的列表和弹窗显示问题。
- 分支：`codex/fix-history-display`
- 备注：仅同步响应式显示修复和双语文档，不包含学校部署信息或运行数据。
- 验证：1280px 桌面表格横向溢出由 40px 降为 0；390px 手机页面无横向溢出，弹窗标题与关闭按钮不重叠；3 项 Node 测试通过。

### 2026-07-27 09:57:11 CST

- 事件：公开脱敏版新增教室配置历史并完成全项目复核。
- 分支：`codex/classroom-configuration-history`
- 备注：仅同步应用代码、双语文档和虚构初始化数据规则；新增教室时间线、旧审核记录回填、session ID 轮换、照片事务一致性、备份配置保护和依赖修复。
- 验证：3 项 Node 测试通过；生产依赖审计为 0 个已知漏洞；桌面和 390px 手机浏览器验收通过；公开仓库隐私扫描不包含私有 Git 历史或运行数据。

### 2026-07-18

- 事件：创建教室设备管理系统公开脱敏版。
- 数据：仅包含 `初始化数据表格（虚拟）.xlsx`，其中 12 条记录全部为虚构示例。
- 历史：公开仓库从干净快照建立，不继承任何私有仓库提交、分支或 PR 引用。
- 账号：不使用固定默认密码；首次管理员密码由环境变量提供或随机生成。
- 文档：中文为默认版本，英文使用同名 `.en.md` 文件，双方互相链接。
- 验证：3 项测试全部通过，生产依赖审计为 0 个已知漏洞，隐私扫描未发现真实台账标识、内网地址、个人路径、私钥或常见 Token。
