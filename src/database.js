import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

const rootDir = process.cwd();
const dataDir = process.env.DATA_DIR || path.join(rootDir, "data");
const dbPath = process.env.DB_PATH || path.join(dataDir, "teachingroom.sqlite");
const initialAdminPasswordPath = path.join(dataDir, "initial-admin-password.txt");

fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(dbPath);
export { dataDir, dbPath, initialAdminPasswordPath };
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export const nowSql = "datetime('now')";

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

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'inspector')),
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
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
      created_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS classrooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      building TEXT NOT NULL,
      room TEXT NOT NULL,
      client_request_id TEXT,
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql}),
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
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS classroom_values (
      classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL REFERENCES field_definitions(key) ON DELETE CASCADE,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (${nowSql}),
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
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
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
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
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
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS change_request_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL REFERENCES field_definitions(key),
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
      created_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      sid TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      user_id INTEGER,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at
      ON user_sessions(expires_at);

    CREATE INDEX IF NOT EXISTS idx_classroom_photos_classroom_id
      ON classroom_photos(classroom_id, deleted_at);

    CREATE INDEX IF NOT EXISTS idx_classroom_create_requests_status
      ON classroom_create_requests(status, created_at);

    CREATE INDEX IF NOT EXISTS idx_classroom_create_requests_client_request_id
      ON classroom_create_requests(client_request_id);
  `);

  migrateSchema();
  seedFields();
  seedUsers();
  migrateDoorFields();
}

function migrateSchema() {
  addColumnIfMissing("users", "deleted_at", "TEXT");
  addColumnIfMissing("field_definitions", "public_api", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("classrooms", "client_request_id", "TEXT");
  addColumnIfMissing("classroom_photos", "client_request_id", "TEXT");
  addColumnIfMissing("change_requests", "client_request_id", "TEXT");
  addColumnIfMissing("user_sessions", "user_id", "INTEGER");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_change_requests_status_classroom ON change_requests(status, classroom_id);
    CREATE INDEX IF NOT EXISTS idx_change_requests_client_request_id ON change_requests(client_request_id);
    CREATE INDEX IF NOT EXISTS idx_change_request_items_request_field ON change_request_items(request_id, field_key);
    CREATE INDEX IF NOT EXISTS idx_classroom_photos_client_request_id ON classroom_photos(client_request_id);
    CREATE INDEX IF NOT EXISTS idx_photo_requests_status ON classroom_photo_requests(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_photo_requests_client_request_id ON classroom_photo_requests(client_request_id);
  `);
}

function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
  if (!columns.includes(column)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

function seedFields() {
  const stmt = db.prepare(`
    INSERT INTO field_definitions
      (key, label, group_name, type, options_json, sort_order, filterable, editable, required, public_api)
    VALUES
      (@key, @label, @group, @type, @options, @sort, @filterable, @editable, @required, @publicApi)
    ON CONFLICT(key) DO UPDATE SET
      label = excluded.label,
      group_name = excluded.group_name,
      type = excluded.type,
      options_json = excluded.options_json,
      sort_order = excluded.sort_order,
      filterable = excluded.filterable,
      editable = excluded.editable,
      required = excluded.required,
      public_api = excluded.public_api
  `);

  const insertMany = db.transaction(() => {
    for (const field of defaultFields) {
      stmt.run({
        ...field,
        options: JSON.stringify(field.options || []),
        filterable: field.filterable || 0,
        editable: field.editable ?? 1,
        required: field.required || 0,
        publicApi: field.publicApi || 0
      });
    }
  });

  insertMany();
}

function seedUsers() {
  const count = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (count > 0) return;

  const configuredPassword = String(process.env.INITIAL_ADMIN_PASSWORD || "").trim();
  if (configuredPassword && configuredPassword.length < 12) {
    throw new Error("INITIAL_ADMIN_PASSWORD must contain at least 12 characters");
  }
  const password = configuredPassword || crypto.randomBytes(18).toString("base64url");

  const stmt = db.prepare(`
    INSERT INTO users (username, display_name, role, password_hash)
    VALUES (?, ?, ?, ?)
  `);

  stmt.run("admin", "超级管理员", "admin", bcrypt.hashSync(password, 10));

  if (!configuredPassword) {
    fs.writeFileSync(
      initialAdminPasswordPath,
      `username=admin\npassword=${password}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
  }
}

function migrateDoorFields() {
  db.prepare(`
    INSERT INTO classroom_values (classroom_id, field_key, value, updated_at)
    SELECT c.id, 'front_door', c.room, ${nowSql}
    FROM classrooms c
    WHERE NOT EXISTS (
      SELECT 1
      FROM classroom_values cv
      WHERE cv.classroom_id = c.id AND cv.field_key = 'front_door'
    )
  `).run();
}

export function getFields() {
  return db.prepare(`
    SELECT key, label, group_name AS "group", type, options_json, sort_order AS sort,
           filterable, editable, required, public_api AS publicApi
    FROM field_definitions
    ORDER BY sort_order, id
  `).all().map((field) => ({
    ...field,
    options: JSON.parse(field.options_json || "[]"),
    filterable: Boolean(field.filterable),
    editable: Boolean(field.editable),
    required: Boolean(field.required),
    publicApi: Boolean(field.publicApi)
  }));
}

export function logAudit(actorId, action, targetType, targetId, detail = {}) {
  const result = db.prepare(`
    INSERT INTO audit_logs (actor_id, action, target_type, target_id, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?, ${nowSql})
  `).run(actorId || null, action, targetType, targetId || null, JSON.stringify(detail));
  return Number(result.lastInsertRowid);
}

export function setClassroomValue(classroomId, fieldKey, value) {
  db.prepare(`
    INSERT INTO classroom_values (classroom_id, field_key, value, updated_at)
    VALUES (?, ?, ?, ${nowSql})
    ON CONFLICT(classroom_id, field_key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(classroomId, fieldKey, normalizeClassroomValue(fieldKey, value));
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

export function classroomCount() {
  return db.prepare("SELECT COUNT(*) AS count FROM classrooms").get().count;
}
