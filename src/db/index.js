// TeachingRoom Manager — Database adapter interface
// All adapters expose the same async interface:
//   connect()  → initialize connection
//   close()    → tear down
//   exec(sql)  → raw SQL (no params, for DDL)
//   get(sql, params)    → first row or null
//   all(sql, params)    → array of rows
//   run(sql, params)    → { changes, lastInsertRowid }
//   transaction(fn)     → run callback in transaction
//   nowSql              → SQL expression for current timestamp
//   jsonParse(str)      → parse JSON column value
//   jsonStringify(val)  → serialize to JSON string
//   boolean(val)        → convert integer to boolean
//   upsertSql(table, constraint, setCols) → dialect-specific upsert clause

import { url } from "./adapters/sqlite.js";
// Adapter URLs:
// SQLite:     sqlite:///path/to/db.sqlite  or  DB_PATH env var
// MySQL:      mysql://user:pass@host:port/dbname
// PostgreSQL: postgres://user:pass@host:port/dbname

export async function createAdapter(databaseUrl) {
  const url = databaseUrl || process.env.DATABASE_URL || "";
  const dbType = process.env.DB_TYPE || "";

  if (url.startsWith("mysql:") || url.startsWith("mariadb:") || dbType === "mysql" || dbType === "mariadb") {
    const { MySQLAdapter } = await import("./adapters/mysql.js");
    return new MySQLAdapter(url);
  }
  if (url.startsWith("postgres:") || url.startsWith("postgresql:") || dbType === "postgres" || dbType === "postgresql") {
    const { PostgresAdapter } = await import("./adapters/postgres.js");
    return new PostgresAdapter(url);
  }
  // Default: SQLite
  const { SQLiteAdapter } = await import("./adapters/sqlite.js");
  return new SQLiteAdapter(url);
}
