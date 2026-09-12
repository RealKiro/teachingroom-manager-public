import { registerDoStorage } from "./db-driver.js";

// Cloudflare Workers 入口：单个 Durable Object 承载整个 Express 应用。
// ctx.storage.sql 通过 db-driver.js 的 do-sqlite 驱动替代 better-sqlite3，
// 业务代码与本地/Docker 运行完全一致。
export class TeachingRoomApp {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.appPromise = null;
  }

  async getApp() {
    if (!this.appPromise) {
      this.appPromise = (async () => {
        registerDoStorage(this.ctx.storage);
        const { app } = await import("./server.js");
        const { createServer } = await import("node:http");
        const { httpServerHandler } = await import("cloudflare:node");
        const server = createServer(app);
        const handler = httpServerHandler(server);
        return { handler };
      })();
    }
    return this.appPromise;
  }

  async fetch(request) {
    const { handler } = await this.getApp();
    return typeof handler === "function"
      ? handler(request, this.env, this.ctx)
      : handler.fetch(request, this.env, this.ctx);
  }
}
