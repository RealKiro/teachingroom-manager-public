// TeachingRoom Manager — MySQL / MariaDB adapter
// NOT bundled — requires `npm install mysql2` when using MySQL

export class MySQLAdapter {
  constructor(uri) {
    this.uri = uri || "";
    this.pool = null;
  }

  get nowSql() {
    return "NOW()";
  }

  async connect() {
    let mysql;
    try {
      mysql = await import("mysql2/promise");
    } catch {
      throw new Error(
        "MySQL/MariaDB support requires: npm install mysql2\n" +
        "Or use the default SQLite backend (no additional dependencies needed)."
      );
    }
    const url = this.uri || process.env.DATABASE_URL || "";
    if (url) {
      this.pool = mysql.createPool(url);
    } else {
      this.pool = mysql.createPool({
        host: process.env.DB_HOST || "localhost",
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || "root",
        password: process.env.DB_PASSWORD || "",
        database: process.env.DB_NAME || "teachingroom",
        waitForConnections: true,
        connectionLimit: 10,
        timezone: "+00:00"
      });
    }
    const conn = await this.pool.getConnection();
    conn.release();
  }

  async close() {
    if (this.pool) await this.pool.end();
    this.pool = null;
  }

  async exec(sql) {
    await this.pool.execute(sql);
  }

  async get(sql, params = []) {
    const [rows] = await this.pool.execute(sql, Array.isArray(params) ? params : [params]);
    return rows.length > 0 ? rows[0] : null;
  }

  async all(sql, params = []) {
    const [rows] = await this.pool.execute(sql, Array.isArray(params) ? params : [params]);
    return rows;
  }

  async run(sql, params = []) {
    const [result] = await this.pool.execute(sql, Array.isArray(params) ? params : [params]);
    return { changes: result.affectedRows, lastInsertRowid: result.insertId };
  }

  prepare(sql) {
    return {
      get: async (...params) => {
        const [rows] = await this.pool.execute(sql, params);
        return rows.length > 0 ? rows[0] : null;
      },
      all: async (...params) => {
        const [rows] = await this.pool.execute(sql, params);
        return rows;
      },
      run: async (...params) => {
        const [result] = await this.pool.execute(sql, params);
        return { changes: result.affectedRows, lastInsertRowid: result.insertId };
      },
    };
  }

  async transaction(callback) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const tx = {
        get: async (sql, params) => {
          const [rows] = await conn.execute(sql, Array.isArray(params) ? params : [params]);
          return rows[0] || null;
        },
        all: async (sql, params) => {
          const [rows] = await conn.execute(sql, Array.isArray(params) ? params : [params]);
          return rows;
        },
        run: async (sql, params) => {
          const [result] = await conn.execute(sql, Array.isArray(params) ? params : [params]);
          return { changes: result.affectedRows, lastInsertRowid: result.insertId };
        }
      };
      const result = await callback(tx);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  jsonParse(str) {
    try {
      return typeof str === "string" ? JSON.parse(str) : (str ?? {});
    } catch {
      return {};
    }
  }

  jsonStringify(val) {
    return JSON.stringify(val ?? {});
  }

  boolean(val) {
    return val === 1 || val === true || val === "1" || val === "true";
  }

  upsertSql(table, constraint, setCols) {
    const assignments = setCols.map((col) => `${col} = VALUES(${col})`).join(", ");
    return `ON DUPLICATE KEY UPDATE ${assignments}`;
  }
}
