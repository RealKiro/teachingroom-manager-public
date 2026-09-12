import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// 无服务器存储驱动验证：通过 LIBSQL_URL 让整套应用运行在 libSQL 桥接层上。
// file: URL 走与 Turso 远程完全相同的桥接代码路径，可离线验证。

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "teachingroom-libsql-"));
process.env.NODE_ENV = "test";
process.env.LIBSQL_URL = `file:${tempDir.replace(/\\/g, "/")}/bridge.sqlite`;
process.env.SKIP_SOURCE_IMPORT = "1";
process.env.DATA_DIR = path.join(tempDir, "data");
process.env.DB_PATH = path.join(tempDir, "data", "bridge.sqlite");
process.env.EXPORTS_DIR = path.join(tempDir, "exports");
process.env.UPLOADS_DIR = path.join(tempDir, "uploads");
process.env.BACKUPS_DIR = path.join(tempDir, "backups");
process.env.INITIAL_ADMIN_PASSWORD = "test-admin-password";
process.env.SESSION_SECRET = "bridge-test-session-secret";

const { app } = await import("../src/server.js");
const { db } = await import("../src/database.js");
const { currentDriverName } = await import("../src/db-driver.js");

assert.equal(currentDriverName(), "libsql");

const server = await new Promise((resolve) => {
  const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let cookie = "";

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  if (options.body && !headers["content-type"]) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${url}`, { ...options, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";", 1)[0];
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, data };
}

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  // 等待桥接 worker 完全退出后再清理（Windows 上文件句柄释放有延迟）
  await new Promise((resolve) => setTimeout(resolve, 300));
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("boots the full app on the libsql bridge driver", async () => {
  const { response, data } = await api("/api/health");
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
});

test("supports login, session persistence, and classroom CRUD through the bridge", async () => {
  const login = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "test-admin-password" })
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.data.user.username, "admin");

  const session = await api("/api/session");
  assert.equal(session.data.user.username, "admin");

  const fields = await api("/api/fields");
  assert.ok(Array.isArray(fields.data.fields));
  assert.ok(fields.data.fields.length > 0);

  const create = await api("/api/classrooms", {
    method: "POST",
    body: JSON.stringify({
      values: { building: "X栋", room: "X101", department: "小学" },
      clientRequestId: "bridge-test-request-0001"
    })
  });
  assert.equal(create.response.status, 201, JSON.stringify(create.data));
  const classroomId = create.data.record?.id ?? create.data.id;
  assert.ok(classroomId, JSON.stringify(create.data));

  const list = await api("/api/classrooms");
  assert.ok(JSON.stringify(list.data).includes("X101"));
});

test("creates and restores a serverless SQL dump backup through the bridge", async () => {
  const created = await api("/api/backups", { method: "POST" });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  const backup = created.data.backup;
  assert.match(backup.file, /\.sql$/);
  assert.ok(backup.size > 0);

  const list = await api("/api/backups");
  assert.ok(list.data.backups.some((item) => item.file === backup.file));

  const download = await api(`/api/backups/${encodeURIComponent(backup.file)}/download`);
  assert.equal(download.response.status, 200);
  assert.ok(String(download.data).startsWith("-- TeachingRoom database dump v1"));

  const restored = await api(`/api/backups/${encodeURIComponent(backup.file)}/restore`, { method: "POST" });
  assert.equal(restored.response.status, 200, JSON.stringify(restored.data));

  // 恢复会清空全部会话，需要重新登录（与文档行为一致）
  cookie = "";
  const relogin = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "test-admin-password" })
  });
  assert.equal(relogin.response.status, 200);

  const listAfter = await api("/api/backups");
  assert.ok(listAfter.data.backups.some((item) => item.file.endsWith("before_restore.sql")));
});

test("transaction rollback and nested savepoints behave like better-sqlite3", async () => {
  const insert = db.prepare("INSERT INTO classrooms (building, room) VALUES (?, ?)");
  const tx = db.transaction((rows) => {
    for (const row of rows) insert.run(row.building, row.room);
    return rows.length;
  });
  assert.equal(tx([{ building: "Y栋", room: "Y201" }, { building: "Y栋", room: "Y202" }]), 2);

  const failing = db.transaction(() => {
    insert.run("Y栋", "Y203");
    throw new Error("expected");
  });
  assert.throws(failing, /expected/);

  const count = db.prepare("SELECT COUNT(*) AS count FROM classrooms WHERE building = 'Y栋'").get().count;
  assert.equal(count, 2);

  const nested = db.transaction(() => {
    insert.run("Y栋", "Y204");
    const inner = db.transaction(() => {
      insert.run("Y栋", "Y205");
      throw new Error("inner");
    });
    assert.throws(inner, /inner/);
    return db.prepare("SELECT COUNT(*) AS count FROM classrooms WHERE building = 'Y栋'").get().count;
  });
  assert.equal(nested(), 3);
});
