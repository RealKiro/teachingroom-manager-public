# syntax=docker/dockerfile:1

# ---- deps: install production dependencies ----
# better-sqlite3 ships musl prebuilt binaries for Alpine; the build toolchain
# is kept here as a fallback for the rare case prebuild download fails.
FROM node:24-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime: minimal image, non-root, healthcheck ----
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p data uploads backups exports \
    && chown -R node:node data uploads backups exports
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 || exit 1
# node runs directly (not via npm) so it stays PID 1 and receives SIGTERM
CMD ["node", "src/server.js"]
