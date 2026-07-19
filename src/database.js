// TeachingRoom Manager — Database layer
// Uses the adapter pattern to support SQLite / MySQL / PostgreSQL.
// All exported functions are async.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { createAdapter } from "./db/index.js";

// ── Adapter initialization ──────────────────────────────────

let adapter = null;

export async function initDb() {
  adapter = await createAdapter();
  // 确保数据目录存在（仅在 SQLite 时需要）
  if (adapter.constructor.name === "SQLiteAdapter") {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  await adapter.connect();
  const type = adapter.constructor.name;
  if (type === "SQLiteAdapter") {
    await initSqlite();
  } else if (type === "MySQLAdapter") {
    await initMysql();
  } else {
    await initPostgres();
  }
  await migrateSchema();
  await seedFields();
  await seedUsers();
  await migrateDoorFields();
  return adapter;
}

// ── Exports ─────────────────────────────────────────────────

export { adapter };
export const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
export const dbPath = process.env.DB_PATH || path.join(dataDir, "teachingroom.sqlite");
export const initialAdminPasswordPath = path.join(dataDir, "initial-admin-password.txt");

// ── SQLite DDL ──────────────────────────────────────────────

async function initSqlite() {
  await adapter.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'inspector')),
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (${adapter.nowSql}),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS field_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      group_name TEXT NOT NULL DEFAULT '其他',
      type TEXT NOT NULL DEFAULT 'text',
      options_json TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 1000,
      filterable INTEGER NOT NULL DEFAULT 0,
      editable INTEGER NOT NULL DEFAULT 1,
      required INTEGER NOT NULL DEFAULT 0,
      public_api INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (${adapter.nowSql})
    );

    CREATE TABLE IF NOT EXISTS classrooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      building TEXT NOT NULL,
      room TEXT NOT NULL,
      client_request_id TEXT,
      created_at TEXT NOT NULL DEFAULT (${adapter.nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${adapter.nowSql}),
      UNIQUE(building, room)
    );

    CREATE TABLE IF NOT EXISTS classroom_create_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submitter_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
      reason TEXT NOT NULL DEFAULT '',
      values_json TEXT NOT NULL DEFAULT '{}',
      client_request_id TEXT,
      reviewer_id INTEGER REFERENCES users(id),
      review_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (${adapter.nowSql}),
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS classroom_values (
      classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (${adapter.nowSql}),
      PRIMARY KEY (classroom_id, field_key)
    );

    CREATE TABLE IF NOT EXISTS classroom_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      uploader_id INTEGER REFERENCES users(id),
      original_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      photo_data BLOB NOT NULL,
      client_request_id TEXT,
      created_at TEXT NOT NULL DEFAULT (${adapter.nowSql}),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS classroom_photo_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      submitter_id INTEGER NOT NULL REFERENCES users(id),
      action TEXT NOT NULL CHECK (action IN ('upload', 'delete')),
      photo_id INTEGER REFERENCES classroom_photos(id),
      original_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      photo_data BLOB,
      client_request_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
      reviewer_id INTEGER REFERENCES users(id),
      review_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (${adapter.nowSql}),
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS change_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      submitter_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
      reason TEXT NOT NULL DEFAULT '',
      client_request_id TEXT,
      reviewer_id INTEGER REFERENCES users(id),
      review_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (${adapter.nowSql}),
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS change_request_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL,
      old_value TEXT NOT NULL DEFAULT '',
      new_value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER,
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (${adapter.nowSql})
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      sid TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      user_id INTEGER,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${adapter.nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${adapter.nowSql})
    );

    ${createIndexesSql()}
  `);
}

// ── MySQL DDL ───────────────────────────────────────────────

async function initMysql() {
  await adapter.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL UNIQUE,
      display_name VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      active TINYINT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT ${adapter.nowSql},
      deleted_at DATETIME NULL
    );

    CREATE TABLE IF NOT EXISTS field_definitions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      \`key\` VARCHAR(255) NOT NULL UNIQUE,
      label VARCHAR(255) NOT NULL,
      group_name VARCHAR(255) NOT NULL DEFAULT '其他',
      type VARCHAR(50) NOT NULL DEFAULT 'text',
      options_json TEXT NOT NULL,
      sort_order INT NOT NULL DEFAULT 1000,
      filterable TINYINT NOT NULL DEFAULT 0,
      editable TINYINT NOT NULL DEFAULT 1,
      required TINYINT NOT NULL DEFAULT 0,
      public_api TINYINT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT ${adapter.nowSql}
    );

    CREATE TABLE IF NOT EXISTS classrooms (
      id INT AUTO_INCREMENT PRIMARY KEY,
      building VARCHAR(255) NOT NULL,
      room VARCHAR(255) NOT NULL,
      client_request_id VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT ${adapter.nowSql},
      updated_at DATETIME NOT NULL DEFAULT ${adapter.nowSql},
      UNIQUE KEY uk_building_room (building, room)
    );

    CREATE TABLE IF NOT EXISTS classroom_create_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      submitter_id INT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      reason TEXT NOT NULL,
      values_json TEXT NOT NULL,
      client_request_id VARCHAR(255) NULL,
      reviewer_id INT NULL,
      review_note TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT ${adapter.nowSql},
      reviewed_at DATETIME NULL
    );

    CREATE TABLE IF NOT EXISTS classroom_values (
      classroom_id INT NOT NULL,
      field_key VARCHAR(255) NOT NULL,
      value TEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT ${adapter.nowSql},
      PRIMARY KEY (classroom_id, field_key)
    );

    CREATE TABLE IF NOT EXISTS classroom_photos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      classroom_id INT NOT NULL,
      uploader_id INT NULL,
      original_name VARCHAR(255) NOT NULL DEFAULT '',
      mime_type VARCHAR(100) NOT NULL,
      size INT NOT NULL DEFAULT 0,
      photo_data LONGBLOB NOT NULL,
      client_request_id VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT ${adapter.nowSql},
      deleted_at DATETIME NULL
    );

    CREATE TABLE IF NOT EXISTS classroom_photo_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      classroom_id INT NOT NULL,
      submitter_id INT NOT NULL,
      action VARCHAR(20) NOT NULL,
      photo_id INT NULL,
      original_name VARCHAR(255) NOT NULL DEFAULT '',
      mime_type VARCHAR(100) NOT NULL DEFAULT '',
      size INT NOT NULL DEFAULT 0,
      photo_data LONGBLOB NULL,
      client_request_id VARCHAR(255) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      reviewer_id INT NULL,
      review_note TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT ${adapter.nowSql},
      reviewed_at DATETIME NULL
    );

    CREATE TABLE IF NOT EXISTS change_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      classroom_id INT NOT NULL,
      submitter_id INT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      reason TEXT NOT NULL,
      client_request_id VARCHAR(255) NULL,
      reviewer_id INT NULL,
      review_note TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT ${adapter.nowSql},
      reviewed_at DATETIME NULL
    );

    CREATE TABLE IF NOT EXISTS change_request_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      request_id INT NOT NULL,
      field_key VARCHAR(255) NOT NULL,
      old_value TEXT NOT NULL,
      new_value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      actor_id INT NULL,
      action VARCHAR(255) NOT NULL,
      target_type VARCHAR(255) NOT NULL,
      target_id INT NULL,
      detail_json TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT ${adapter.nowSql}
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      sid VARCHAR(255) PRIMARY KEY,
      data TEXT NOT NULL,
      user_id INT NULL,
      expires_at BIGINT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT ${adapter.nowSql},
      updated_at DATETIME NOT NULL DEFAULT ${adapter.nowSql}
    );

    ${createIndexesSql()}
  `);
}

// ── PostgreSQL DDL ──────────────────────────────────────────

async function initPostgres() {
  await adapter.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'inspector')),
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT ${adapter.nowSql},
      deleted_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS field_definitions (
      id SERIAL PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      group_name TEXT NOT NULL DEFAULT '其他',
      type TEXT NOT NULL DEFAULT 'text',
      options_json TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 1000,
      filterable INTEGER NOT NULL DEFAULT 0,
      editable INTEGER NOT NULL DEFAULT 1,
      required INTEGER NOT NULL DEFAULT 0,
      public_api INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT ${adapter.nowSql}
    );

    CREATE TABLE IF NOT EXISTS classrooms (
      id SERIAL PRIMARY KEY,
      building TEXT NOT NULL,
      room TEXT NOT NULL,
      client_request_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT ${adapter.nowSql},
      updated_at TIMESTAMP NOT NULL DEFAULT ${adapter.nowSql},
      UNIQUE(building, room)
    );

    CREATE TABLE IF NOT EXISTS classroom_create_requests (
      id SERIAL PRIMARY KEY,
      submitter_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      reason TEXT NOT NULL DEFAULT '',
      values_json TEXT NOT NULL DEFAULT '{}',
      client_request_id TEXT,
      reviewer_id INTEGER REFERENCES users(id),
      review_note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT ${adapter.nowSql},
      reviewed_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS classroom_values (
      classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMP NOT NULL DEFAULT ${adapter.nowSql},
      PRIMARY KEY (classroom_id, field_key)
    );

    CREATE TABLE IF NOT EXISTS classroom_photos (
      id SERIAL PRIMARY KEY,
      classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      uploader_id INTEGER REFERENCES users(id),
      original_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      photo_data BYTEA NOT NULL,
      client_request_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT ${adapter.nowSql},
      deleted_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS classroom_photo_requests (
      id SERIAL PRIMARY KEY,
      classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      submitter_id INTEGER NOT NULL REFERENCES users(id),
      action TEXT NOT NULL CHECK (action IN ('upload', 'delete')),
      photo_id INTEGER REFERENCES classroom_photos(id),
      original_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      photo_data BYTEA,
      client_request_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      reviewer_id INTEGER REFERENCES users(id),
      review_note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT ${adapter.nowSql},
      reviewed_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS change_requests (
      id SERIAL PRIMARY KEY,
      classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      submitter_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      reason TEXT NOT NULL DEFAULT '',
      client_request_id TEXT,
      reviewer_id INTEGER REFERENCES users(id),
      review_note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT ${adapter.nowSql},
      reviewed_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS change_request_items (
      id SERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL,
      old_value TEXT NOT NULL DEFAULT '',
      new_value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      actor_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER,
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TIMESTAMP NOT NULL DEFAULT ${adapter.nowSql}
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      sid TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      user_id INTEGER,
      expires_at BIGINT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT ${adapter.nowSql},
      updated_at TIMESTAMP NOT NULL DEFAULT ${adapter.nowSql}
    );

    ${createIndexesSql()}
  `);
}

// ── Shared helpers ──────────────────────────────────────────

function createIndexesSql() {
  return `
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at
      ON user_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_classroom_photos_classroom_id
      ON classroom_photos(classroom_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_classroom_create_requests_status
      ON classroom_create_requests(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_classroom_create_requests_client_request_id
      ON classroom_create_requests(client_request_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
      ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_change_requests_status_classroom
      ON change_requests(status, classroom_id);
    CREATE INDEX IF NOT EXISTS idx_change_requests_client_request_id
      ON change_requests(client_request_id);
    CREATE INDEX IF NOT EXISTS idx_change_request_items_request_field
      ON change_request_items(request_id, field_key);
    CREATE INDEX IF NOT EXISTS idx_classroom_photos_client_request_id
      ON classroom_photos(client_request_id);
    CREATE INDEX IF NOT EXISTS idx_photo_requests_status
      ON classroom_photo_requests(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_photo_requests_client_request_id
      ON classroom_photo_requests(client_request_id);
  `;
}

// ── Schema migration ───────────────────────────────────────

async function addColumnIfMissing(table, column, definition) {
  // SQLite-specific; other dialects handle via init DDL
  if (adapter.constructor.name === "SQLiteAdapter") {
    const columns = await adapter.all(`PRAGMA table_info(${table})`);
    const names = columns.map((item) => item.name);
    if (!names.includes(column)) {
      await adapter.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

async function migrateSchema() {
  if (adapter.constructor.name !== "SQLiteAdapter") return; // migrated via DDL
  await addColumnIfMissing("users", "deleted_at", "TEXT");
  await addColumnIfMissing("field_definitions", "public_api", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("classrooms", "client_request_id", "TEXT");
  await addColumnIfMissing("classroom_photos", "client_request_id", "TEXT");
  await addColumnIfMissing("change_requests", "client_request_id", "TEXT");
  await addColumnIfMissing("user_sessions", "user_id", "INTEGER");
}

// ── Seed data ───────────────────────────────────────────────

export const defaultFields = [
  { key: "building", label: "楼栋", group: "位置", type: "select", sort: 10, filterable: 1, editable: 0, required: 1, publicApi: 1 },
  { key: "orientation", label: "楼侧", group: "位置", type: "select", sort: 20, filterable: 1, editable: 1, publicApi: 1 },
  { key: "room", label: "教室编号", group: "位置", type: "text", sort: 30, filterable: 1, editable: 0, required: 1, publicApi: 1 },
  { key: "front_door", label: "前门门牌号", group: "位置", type: "text", sort: 31, filterable: 1, editable: 1, publicApi: 1 },
  { key: "back_door", label: "后门门牌号", group: "位置", type: "text", sort: 32, filterable: 1, editable: 1, publicApi: 1 },
  { key: "class_name", label: "班级/用途", group: "现有情况", type: "text", sort: 40, filterable: 1, editable: 1, publicApi: 1 },
  { key: "current_screen", label: "现有屏幕", group: "现有情况", type: "text", sort: 50, filterable: 1, editable: 1, publicApi: 1 },
  { key: "current_board", label: "书写板类型", group: "现有情况", type: "text", sort: 60, filterable: 1, editable: 1, publicApi: 1 },
  { key: "current_audio", label: "教师扩声", group: "现有情况", type: "select", options: ["有", ""], sort: 70, filterable: 1, editable: 1, publicApi: 1 },
  { key: "current_recording", label: "录播", group: "现有情况", type: "select", options: ["有", ""], sort: 75, filterable: 1, editable: 1, publicApi: 1 },
  { key: "monitoring", label: "监控", group: "现有情况", type: "select", options: ["有", ""], sort: 76, filterable: 1, editable: 1, publicApi: 1 },
  { key: "install_date", label: "安装日期", group: "现有情况", type: "month", sort: 80, filterable: 1, editable: 1, publicApi: 1 },
  { key: "department", label: "级部", group: "2026暑期更新计划", type: "select", options: ["小学", "初中", "高中"], sort: 90, filterable: 1, editable: 1, publicApi: 1 },
  { key: "plan_screen", label: "计划屏幕", group: "2026暑期更新计划", type: "checkbox", sort: 100, filterable: 1, editable: 1, publicApi: 1 },
  { key: "plan_board", label: "计划书写板", group: "2026暑期更新计划", type: "checkbox", sort: 110, filterable: 1, editable: 1, publicApi: 1 },
  { key: "plan_audio", label: "计划教师扩声", group: "2026暑期更新计划", type: "checkbox", sort: 120, filterable: 1, editable: 1, publicApi: 1 },
  { key: "plan_recording", label: "计划录播", group: "2026暑期更新计划", type: "checkbox", sort: 130, filterable: 1, editable: 1, publicApi: 1 },
  { key: "inspection_note", label: "巡查备注", group: "巡查", type: "textarea", sort: 200, filterable: 0, editable: 1, publicApi: 0 }
];

async function seedFields() {
  const count = await adapter.get("SELECT COUNT(*) AS count FROM field_definitions");
  if (count && count.count > 0) return;

  const upsert = adapter.upsertSql("field_definitions", "key",
    ["label", "group_name", "type", "options_json", "sort_order", "filterable", "editable", "required", "public_api"]);

  for (const field of defaultFields) {
    await adapter.run(`
      INSERT INTO field_definitions
        (key, label, group_name, type, options_json, sort_order, filterable, editable, required, public_api)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${upsert}
    `, [
      field.key, field.label, field.group, field.type,
      JSON.stringify(field.options || []),
      field.sort, field.filterable || 0, field.editable ?? 1,
      field.required || 0, field.publicApi || 0
    ]);
  }
}

async function seedUsers() {
  const count = await adapter.get("SELECT COUNT(*) AS count FROM users");
  if (count && count.count > 0) return;

  const configuredPassword = String(process.env.INITIAL_ADMIN_PASSWORD || "").trim();
  if (configuredPassword && configuredPassword.length < 12) {
    throw new Error("INITIAL_ADMIN_PASSWORD must contain at least 12 characters");
  }
  const password = configuredPassword || crypto.randomBytes(18).toString("base64url");

  await adapter.run(
    "INSERT INTO users (username, display_name, role, password_hash) VALUES (?, ?, ?, ?)",
    ["admin", "超级管理员", "admin", bcrypt.hashSync(password, 10)]
  );

  if (!configuredPassword) {
    fs.mkdirSync(path.dirname(initialAdminPasswordPath), { recursive: true });
    fs.writeFileSync(
      initialAdminPasswordPath,
      `username=admin\npassword=${password}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
  }
}

async function migrateDoorFields() {
  // Copy room value to front_door for existing classrooms that lack it
  await adapter.run(`
    INSERT INTO classroom_values (classroom_id, field_key, value, updated_at)
    SELECT c.id, 'front_door', c.room, ${adapter.nowSql}
    FROM classrooms c
    WHERE NOT EXISTS (
      SELECT 1 FROM classroom_values cv
      WHERE cv.classroom_id = c.id AND cv.field_key = 'front_door'
    )
  `);
}

// ── Public helpers (all async) ──────────────────────────────

export async function getFields() {
  const rows = await adapter.all(`
    SELECT key, label, group_name AS "group", type, options_json,
           sort_order AS sort, filterable, editable, required, public_api AS publicApi
    FROM field_definitions
    ORDER BY sort_order, id
  `);
  return rows.map((field) => ({
    ...field,
    options: typeof field.options_json === "string"
      ? JSON.parse(field.options_json || "[]")
      : (field.options_json || []),
    filterable: Boolean(field.filterable),
    editable: Boolean(field.editable),
    required: Boolean(field.required),
    publicApi: Boolean(field.public_api === 1 || field.public_api === true || field.publicApi === true)
  }));
}

export async function logAudit(actorId, action, targetType, targetId, detail = {}) {
  const result = await adapter.run(
    `INSERT INTO audit_logs (actor_id, action, target_type, target_id, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ${adapter.nowSql})`,
    [actorId || null, action, targetType, targetId || null, JSON.stringify(detail)]
  );
  return Number(result.lastInsertRowid);
}

export async function setClassroomValue(classroomId, fieldKey, value) {
  const upsert = adapter.upsertSql("classroom_values", "classroom_id, field_key",
    ["value", "updated_at"]);
  await adapter.run(
    `INSERT INTO classroom_values (classroom_id, field_key, value, updated_at)
     VALUES (?, ?, ?, ${adapter.nowSql})
     ${upsert}`,
    [classroomId, fieldKey, normalizeClassroomValue(fieldKey, value)]
  );
}

export function normalizeClassroomValue(fieldKey, value) {
  const text = String(value ?? "").trim();
  if (fieldKey === "orientation") return text.replace(/侧$/, "");
  if (fieldKey !== "current_board") return String(value ?? "");
  return {
    "白": "白板",
    "绿": "绿板",
    "假绿": "白板 + 绿板贴",
    "光": "光能板"
  }[text] || text;
}

export async function classroomCount() {
  const row = await adapter.get("SELECT COUNT(*) AS count FROM classrooms");
  return row ? row.count : 0;
}
