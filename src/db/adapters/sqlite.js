// TeachingRoom Manager — SQLite adapter
// Async wrapper around better-sqlite3

import Database from "better-sqlite3";

export class SQLiteAdapter {
  constructor(uri) {
    this.uri = uri || "";
    this.db = null;
  }

  get nowSql() {
    return "datetime('now')";
  }

  async connect() {
    const dbPath = this.uri.replace(/^sqlite:\/\//, "") || process.env.DB_PATH;
    if (!dbPath) throw new Error("SQLite: DB_PATH is required");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  async close() {
    this.db?.close();
    this.db = null;
  }

  async exec(sql) {
    return this.db.exec(sql);
  }

  async get(sql, params = []) {
    return this.db.prepare(sql).get(...(Array.isArray(params) ? params : [params])) || null;
  }

  async all(sql, params = []) {
    return this.db.prepare(sql).all(...(Array.isArray(params) ? params : [params]));
  }

  async run(sql, params = []) {
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...(Array.isArray(params) ? params : [params]));
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  }

  // Returns an object with .get(), .all(), .run() — async, matching better-sqlite3 signature
  prepare(sql) {
    const stmt = this.db.prepare(sql);
    return {
      get: (...params) => Promise.resolve(stmt.get(...params)),
      all: (...params) => Promise.resolve(stmt.all(...params)),
      run: (...params) => Promise.resolve(stmt.run(...params)),
    };
  }

  async transaction(callback) {
    // Use BEGIN/COMMIT/ROLLBACK (instead of better-sqlite3's db.transaction)
    // to support async callbacks. better-sqlite3's synchronous API ensures
    // no interleaving between awaits.
    this.db.exec("BEGIN");
    try {
      const result = await callback(this);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  jsonParse(str) {
    try {
      return JSON.parse(str || "{}");
    } catch {
      return {};
    }
  }

  jsonStringify(val) {
    return JSON.stringify(val ?? {});
  }

  boolean(val) {
    return Boolean(val);
  }

  upsertSql(table, constraint, setCols) {
    // SQLite: ON CONFLICT ... DO UPDATE SET
    const assignments = setCols.map((col) => `${col} = excluded.${col}`).join(", ");
    return `ON CONFLICT(${constraint}) DO UPDATE SET ${assignments}`;
  }
}
