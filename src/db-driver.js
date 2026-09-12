import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// 惰性创建 require：workerd 打包后模块顶层 import.meta.url 为 undefined，
// 而 native 模块加载仅存在于本地/Vercel 分支
let nodeRequire = null;
function getNodeRequire() {
  if (!nodeRequire) nodeRequire = createRequire(import.meta.url);
  return nodeRequire;
}

// 存储驱动层：为业务代码提供 better-sqlite3 兼容接口。
//  - file      本地文件（better-sqlite3 原样返回，本机/Docker 行为不变）
//  - libsql    远程 libSQL/Turso，经 worker_threads + Atomics 同步桥接（Vercel）
//  - do-sqlite Cloudflare Workers Durable Objects 内置 SQLite（原生同步）
let doStorage = null;

export function registerDoStorage(storage) {
  doStorage = storage;
}

export function currentDriverName() {
  if (doStorage) return "do-sqlite";
  if (process.env.LIBSQL_URL) return "libsql";
  return "file";
}

export function isServerlessDatabase() {
  return currentDriverName() !== "file";
}

export function openDatabase({ dbPath } = {}) {
  const driver = currentDriverName();
  if (driver === "libsql") return createLibsqlCompat();
  if (driver === "do-sqlite") return createDoSqliteCompat(doStorage);
  const Database = getNodeRequire()("better-sqlite3");
  return new Database(dbPath);
}

// ---------- 共享的行值规整（libSQL / DO 返回 Uint8Array 与 BigInt，better-sqlite3 返回 Buffer / number） ----------

function reviveRowValues(row) {
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (value instanceof Uint8Array) {
      row[key] = Buffer.from(value);
    } else if (typeof value === "bigint") {
      row[key] = Number(value);
    }
  }
  return row;
}

function reviveRows(rows) {
  return Array.from(rows ?? []).map((row) => reviveRowValues(row));
}

function normalizeParams(args) {
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args.map((value) => (value === undefined ? null : value));
}

// 命名参数（@key / :key / $key）转位置参数；跳过字符串字面量内的冒号
function compileStatement(sql) {
  if (!/[@:$][A-Za-z_]/.test(sql)) return { sql, names: null };
  let inString = false;
  let out = "";
  const names = [];
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inString) {
      out += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          out += "'";
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      out += ch;
      continue;
    }
    if ((ch === ":" || ch === "@" || ch === "$") && /[A-Za-z_]/.test(sql[i + 1] || "")) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
      names.push(sql.slice(i + 1, j));
      out += "?";
      i = j - 1;
      continue;
    }
    out += ch;
  }
  return { sql: out, names };
}

function bindParams(compiled, args) {
  if (!compiled.names) return normalizeParams(args);
  const single = args.length === 1 ? args[0] : undefined;
  const named = single && typeof single === "object" && !Array.isArray(single) && !Buffer.isBuffer(single)
    ? single
    : null;
  if (!named) return normalizeParams(args);
  return compiled.names.map((name) => {
    const value = named[name] ?? named[`:${name}`] ?? named[`@${name}`] ?? named[`$${name}`];
    return value === undefined ? null : value;
  });
}

// ---------- libSQL 同步桥 ----------

const BRIDGE_RESPONSE_CAP = 64 * 1024 * 1024;
const BRIDGE_WAIT_MS = 10 * 60 * 1000;

function resolveBridgeWorkerPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "libsql-bridge-worker.js"),
    path.join(process.cwd(), "src", "libsql-bridge-worker.js")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`找不到 libsql 桥接 worker 文件：${candidates.join("、")}`);
}

function createLibsqlCompat() {
  const { Worker } = getNodeRequire()("node:worker_threads");
  const flags = new Int32Array(new SharedArrayBuffer(32));
  const resBuffer = new SharedArrayBuffer(BRIDGE_RESPONSE_CAP);
  const worker = new Worker(resolveBridgeWorkerPath());
  let workerError = null;
  worker.on("error", (error) => {
    workerError = error;
    Atomics.store(flags, 1, -1);
    Atomics.notify(flags, 1);
  });
  worker.postMessage({ type: "setup", flagSAB: flags.buffer, resSAB: resBuffer });
  let seq = 0;
  const decoder = new TextDecoder();

  function reviveRow(row) {
    if (!row) return row;
    for (const key of Object.keys(row)) {
      const value = row[key];
      if (value && typeof value === "object" && "__blob__" in value) {
        row[key] = Buffer.from(value.__blob__, "base64");
      } else if (value && typeof value === "object" && "__bigint__" in value) {
        row[key] = Number(value.__bigint__);
      }
    }
    return row;
  }

  function call(op, payload) {
    if (workerError) throw new Error(`libSQL 桥接线程已退出：${workerError.message}`);
    const id = ++seq;
    Atomics.store(flags, 1, 0);
    worker.postMessage({ type: "op", id, op, payload });
    const waitResult = Atomics.wait(flags, 1, 0, BRIDGE_WAIT_MS);
    const done = Atomics.load(flags, 1);
    if (done === -1) throw new Error(`libSQL 桥接线程已退出：${workerError?.message || "unknown"}`);
    if (waitResult === "timed-out" || done !== id) {
      throw new Error(`libSQL 桥接等待超时（${op}）`);
    }
    const length = Atomics.load(flags, 2);
    const parsed = JSON.parse(decoder.decode(new Uint8Array(resBuffer, 0, length)));
    if (!parsed.ok) throw new Error(parsed.message);
    return parsed;
  }

  call("init", {
    url: process.env.LIBSQL_URL,
    authToken: process.env.LIBSQL_AUTH_TOKEN || undefined
  });

  const db = {
    driver: "libsql",
    prepare(sql) {
      const compiled = compileStatement(sql);
      return {
        get(...args) {
          const result = call("get", { sql: compiled.sql, params: bindParams(compiled, args) });
          return reviveRow(result.row) ?? undefined;
        },
        all(...args) {
          const result = call("all", { sql: compiled.sql, params: bindParams(compiled, args) });
          return result.rows.map((row) => reviveRow(row));
        },
        run(...args) {
          const result = call("run", { sql: compiled.sql, params: bindParams(compiled, args) });
          return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
        }
      };
    },
    exec(sql) {
      call("exec", { sql });
    },
    pragma(directive) {
      try {
        call("exec", { sql: `PRAGMA ${directive}` });
      } catch {
        // 远程库对部分 PRAGMA 不支持，静默忽略（better-sqlite3 调用点不依赖返回值）
      }
    },
    transaction(fn) {
      return (...args) => {
        db._txDepth = (db._txDepth || 0) + 1;
        const depth = db._txDepth;
        try {
          if (depth === 1) call("txn-begin", {});
          else call("exec", { sql: `SAVEPOINT sp${depth}` });
          const result = fn(...args);
          if (depth === 1) call("txn-commit", {});
          else call("exec", { sql: `RELEASE SAVEPOINT sp${depth}` });
          return result;
        } catch (error) {
          if (depth === 1) {
            try { call("txn-rollback", {}); } catch { /* 连接已断开时忽略 */ }
          } else {
            try {
              call("exec", { sql: `ROLLBACK TO SAVEPOINT sp${depth}` });
              call("exec", { sql: `RELEASE SAVEPOINT sp${depth}` });
            } catch { /* 保持主错误 */ }
          }
          throw error;
        } finally {
          db._txDepth = depth - 1;
        }
      };
    },
    close() {
      try { call("close", {}); } catch { /* 忽略 */ }
      worker.terminate();
    }
  };
  db._txDepth = 0;
  return db;
}

// ---------- Cloudflare Durable Objects SQLite 驱动 ----------

function splitStatements(sql) {
  return sql
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/;\s*$/, "").trim())
    .filter(Boolean);
}

function createDoSqliteCompat(storage) {
  const sqlApi = () => storage.sql;
  // DO SQLite 禁止在 sql.exec 中执行 BEGIN/SAVEPOINT 语句，必须使用 storage 的事务 API；
  // SQLite-backed DO 提供 transactionSync（同步回调），异步 transaction 作为后备
  const storageTxMethod = typeof storage.transactionSync === "function"
    ? "transactionSync"
    : (typeof storage.transaction === "function" ? "transaction" : null);

  function query(sql, params = []) {
    const cursor = params.length
      ? sqlApi().exec(sql, ...params)
      : sqlApi().exec(sql);
    return reviveRows(cursor.toArray());
  }

  function execSingle(sql, params = []) {
    if (params.length) {
      sqlApi().exec(sql, ...params);
      return;
    }
    try {
      sqlApi().exec(sql);
    } catch (error) {
      // DO SQLite 对多语句脚本有限制，退化为逐条执行（仅用于无参数的 DDL）
      const statements = splitStatements(sql);
      if (statements.length <= 1) throw error;
      for (const statement of statements) sqlApi().exec(statement);
    }
  }

  const db = {
    driver: "do-sqlite",
    prepare(sql) {
      const compiled = compileStatement(sql);
      return {
        get(...args) {
          return query(compiled.sql, bindParams(compiled, args))[0] ?? undefined;
        },
        all(...args) {
          return query(compiled.sql, bindParams(compiled, args));
        },
        run(...args) {
          execSingle(compiled.sql, bindParams(compiled, args));
          const meta = query("SELECT last_insert_rowid() AS lastInsertRowid, changes() AS changes")[0] || {};
          return { changes: Number(meta.changes || 0), lastInsertRowid: Number(meta.lastInsertRowid || 0) };
        }
      };
    },
    exec(sql) {
      execSingle(sql);
    },
    pragma(directive) {
      try {
        sqlApi().exec(`PRAGMA ${directive}`);
      } catch {
        // DO SQLite 不支持的 PRAGMA 静默忽略
      }
    },
    transaction(fn) {
      return (...args) => {
        db._txDepth = (db._txDepth || 0) + 1;
        const depth = db._txDepth;
        try {
          if (depth === 1 && storageTxMethod) {
            return storage[storageTxMethod](() => fn(...args));
          }
          if (depth === 1) sqlApi().exec("BEGIN");
          const result = fn(...args);
          if (depth === 1) sqlApi().exec("COMMIT");
          return result;
        } catch (error) {
          if (depth === 1 && !storageTxMethod) {
            try { sqlApi().exec("ROLLBACK"); } catch { /* 保持主错误 */ }
          }
          throw error;
        } finally {
          db._txDepth = depth - 1;
        }
      };
    },
    close() {
      // DO SQLite 由运行时管理，无需显式关闭
    }
  };
  db._txDepth = 0;
  return db;
}
