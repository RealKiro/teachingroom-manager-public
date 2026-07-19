# ============================================================
#  TeachingRoom Manager — 多阶段 Docker 构建（Alpine）
#  目标：最小化最终镜像体积，仅包含运行时必需文件
#  基础镜像：node:24-alpine（约 120MB，比 slim 小 60MB）
# ============================================================

# ---------- Stage 1: 安装生产依赖 ----------
FROM node:24-alpine AS deps

# 安装编译工具链（better-sqlite3 需要编译原生模块）
# 这些工具不会带入最终镜像（多阶段构建隔离）
RUN apk add --no-cache --virtual .build-deps python3 make g++

WORKDIR /app

# 只复制依赖清单，利用 Docker 层缓存
COPY package*.json ./

# 安装生产依赖，清理缓存以减小层体积
RUN npm ci --omit=dev && \
    npm cache clean --force && \
    rm -rf /tmp/* && \
    # 删除编译工具链（仅在本阶段内释放空间，最终镜像不受影响）
    apk del .build-deps

# ---------- Stage 2: 最小化运行镜像 ----------
FROM node:24-alpine

# ---- 镜像元数据 (GHCR / OCI 标准标签) ----
LABEL org.opencontainers.image.title="TeachingRoom Manager"
LABEL org.opencontainers.image.description="教室设备管理系统 — 轻量级教室设备 Excel 台账管理工具"
LABEL org.opencontainers.image.url="https://github.com/teachingroom-manager-public"
LABEL org.opencontainers.image.source="https://github.com/teachingroom-manager-public"
LABEL org.opencontainers.image.documentation="https://github.com/teachingroom-manager-public/docs"
LABEL org.opencontainers.image.vendor="TeachingRoom"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# 复制已安装的生产依赖（不含 devDependencies、npm 缓存、编译工具等）
COPY --from=deps /app/node_modules ./node_modules

# 仅复制运行时需要的应用文件
COPY package*.json ./
COPY src/          ./src/
COPY public/       ./public/
COPY docker/healthcheck.js ./

# 可选：首次启动自动导入的演示数据
COPY 初始化数据表格（虚拟）.xlsx ./

# 创建运行时数据目录（挂载卷时会被覆盖，但确保默认可写）
RUN mkdir -p /app/data /app/backups /app/uploads /app/exports && \
    chown -R node:node /app

# 以非 root 用户运行（提升安全性）
USER node

# 环境变量
ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

# 健康检查（每隔 30s 检查 /api/health 端点）
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node healthcheck.js

# 启动应用
CMD ["node", "src/server.js"]
