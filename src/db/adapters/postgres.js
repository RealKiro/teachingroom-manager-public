// TeachingRoom Manager — PostgreSQL adapter
// NOT bundled — requires `npm install pg` when using PostgreSQL

export class PostgresAdapter {
  constructor(uri) {
    this.uri = uri || "";
    this.pool = null;
  }

  get nowSql() {
    return "NOW()";
  }

  async connect() {
    let pg;
    try {
      pg = await import("pg");
    } catch {
      throw new Error(
        "PostgreSQL support requires: npm install pg\n" +
        "Or use the default SQLite backend (no additional dependencies needed)."
      );
    }
    const { default: Pool } = pg;
    const url = this.uri || process.env.DATABASE_URL || "";
    if (url) {
      this.pool = new Pool({ connectionString: url });
    } else {
      this.pool = new Pool({
        host: process.env.DB_HOST || "localhost",
        port: Number(process.env.DB_PORT) || 5432,
        user: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD || "",
        database: process.env.DB_NAME || "teachingroom"
      });
    }
    const client = await this.pool.connect();
    client.release();
  }

  async close() {
    if (this.pool) await this.pool.end();
    this.pool = null;
  }

  _convertParams(sql, params = []) {
    const arr = Array.isArray(params) ? params : [params];
    if (/\$\d+/.test(sql)) return { sql, params: arr };
    let index = 0;
    const converted = sql.replace(/\?/g, () => `$${++index}`);
    return { sql: converted, params: arr };
  }

  async exec(sql) {
    await this.pool.query(sql);
  }

  async get(sql, params = []) {
    const { sql: converted, params: args } = this._convertParams(sql, params);
    const result = await this.pool.query(converted, args);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  async all(sql, params = []) {
    const { sql: converted, params: args } = this._convertParams(sql, params);
    const result = await this.pool.query(converted, args);
    return result.rows;
  }

  async run(sql, params = []) {
    const { sql: converted, params: args } = this._convertParams(sql, params);
    const result = await this.pool.query(converted, args);
    return { changes: result.rowCount, lastInsertRowid: null };
  }

  prepare(sql) {
    return {
      get: async (...params) => {
        const { sql: converted, params: args } = this._convertParams(sql, params);
        const result = await this.pool.query(converted, args);
        return result.rows[0] || null;
      },
      all: async (...params) => {
        const { sql: converted, params: args } = this._convertParams(sql, params);
        const result = await this.pool.query(converted, args);
        return result.rows;
      },
      run: async (...params) => {
        const { sql: converted, params: args } = this._convertParams(sql, params);
        const result = await this.pool.query(converted, args);
        return { changes: result.rowCount, lastInsertRowid: null };
      },
    };
  }

  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const tx = {
        get: async (sql, params) => {
          const { sql: converted, params: args } = this._convertParams(sql, params);
          const result = await client.query(converted, args);
          return result.rows[0] || null;
        },
        all: async (sql, params) => {
          const { sql: converted, params: args } = this._convertParams(sql, params);
          const result = await client.query(converted, args);
          return result.rows;
        },
        run: async (sql, params) => {
          const { sql: converted, params: args } = this._convertParams(sql, params);
          const result = await client.query(converted, args);
          return { changes: result.rowCount, lastInsertRowid: null };
        }
      };
      const result = await callback(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
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
    const assignments = setCols.map((col) => `${col} = EXCLUDED.${col}`).join(", ");
    return `ON CONFLICT(${constraint}) DO UPDATE SET ${assignments}`;
  }
}
