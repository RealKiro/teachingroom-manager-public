import { parentPort } from "node:worker_threads";
import { createClient } from "@libsql/client";

// libSQL 同步桥接 worker：主线程以 Atomics.wait 阻塞等待，
// 本线程执行异步的 @libsql/client 调用并把结果写入共享缓冲区。
let client = null;
let txn = null;
let flagSAB = null;
let resSAB = null;
const encoder = new TextEncoder();

function serializeValue(value) {
  if (value instanceof ArrayBuffer) return { __blob__: Buffer.from(value).toString("base64") };
  if (ArrayBuffer.isView(value)) return { __blob__: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64") };
  if (typeof value === "bigint") return { __bigint__: value.toString() };
  return value;
}

function serializeRows(rows) {
  return Array.from(rows ?? []).map((row) => {
    const out = {};
    for (const key of Object.keys(row)) out[key] = serializeValue(row[key]);
    return out;
  });
}

async function handle(op, payload) {
  switch (op) {
    case "init":
      client = createClient({ url: payload.url, authToken: payload.authToken });
      return {};
    case "run": {
      const statement = { sql: payload.sql, args: payload.params };
      const metaSql = "SELECT last_insert_rowid() AS lastInsertRowid, changes() AS changes";
      if (txn) {
        await txn.execute(statement);
        const meta = Array.from((await txn.execute(metaSql)).rows)[0] || {};
        return { changes: Number(meta.changes || 0), lastInsertRowid: Number(meta.lastInsertRowid || 0) };
      }
      const results = await client.batch([statement, { sql: metaSql }], "write");
      const row = Array.from(results[1].rows)[0] || {};
      return { changes: Number(row.changes || 0), lastInsertRowid: Number(row.lastInsertRowid || 0) };
    }
    case "get": {
      const result = await (txn
        ? txn.execute({ sql: payload.sql, args: payload.params })
        : client.execute({ sql: payload.sql, args: payload.params }));
      const rows = serializeRows(result.rows);
      return { row: rows[0] ?? null };
    }
    case "all": {
      const result = await (txn
        ? txn.execute({ sql: payload.sql, args: payload.params })
        : client.execute({ sql: payload.sql, args: payload.params }));
      return { rows: serializeRows(result.rows) };
    }
    case "exec": {
      if (txn) await txn.execute(payload.sql);
      else await client.executeMultiple(payload.sql);
      return {};
    }
    case "txn-begin":
      txn = await client.transaction("write");
      return {};
    case "txn-commit":
      await txn.commit();
      txn = null;
      return {};
    case "txn-rollback":
      try {
        await txn.rollback();
      } finally {
        txn = null;
      }
      return {};
    case "close":
      if (txn) {
        try { await txn.close(); } catch { /* 忽略 */ }
        txn = null;
      }
      await client.close();
      return {};
    default:
      throw new Error(`未知的桥接操作：${op}`);
  }
}

parentPort.on("message", async (message) => {
  if (message.type === "setup") {
    flagSAB = message.flagSAB;
    resSAB = message.resSAB;
    return;
  }
  if (message.type !== "op") return;

  let response;
  try {
    response = { ok: true, ...(await handle(message.op, message.payload)) };
  } catch (error) {
    response = { ok: false, message: String(error?.message || error) };
  }
  let bytes = encoder.encode(JSON.stringify(response));
  if (bytes.length > resSAB.byteLength) {
    bytes = encoder.encode(JSON.stringify({ ok: false, message: "libSQL 响应超出桥接缓冲区上限（64MB）" }));
  }
  new Uint8Array(resSAB, 0, bytes.length).set(bytes);
  const flags = new Int32Array(flagSAB);
  Atomics.store(flags, 2, bytes.length);
  Atomics.store(flags, 1, message.id);
  Atomics.notify(flags, 1);
});
