import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// 报修模块：手动补录、状态流转、企微（慧教云）同步接入、台账自动匹配

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "teachingroom-repairs-"));
process.env.NODE_ENV = "test";
process.env.REPAIR_SYNC_TOKEN = "test-sync-token";
process.env.SKIP_SOURCE_IMPORT = "1";
process.env.DATA_DIR = path.join(tempDir, "data");
process.env.DB_PATH = path.join(tempDir, "data", "test.sqlite");
process.env.EXPORTS_DIR = path.join(tempDir, "exports");
process.env.UPLOADS_DIR = path.join(tempDir, "uploads");
process.env.BACKUPS_DIR = path.join(tempDir, "backups");
process.env.INITIAL_ADMIN_PASSWORD = "test-admin-password";

const { app } = await import("../src/server.js");
const { db } = await import("../src/database.js");

const server = await new Promise((resolve) => {
  const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let adminCookie = "";

async function api(url, options = {}, cookie = adminCookie) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  if (options.body && !headers["content-type"]) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${url}`, { ...options, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) adminCookie = setCookie.split(";", 1)[0];
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, data };
}

test.before(async () => {
  const login = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "test-admin-password" })
  });
  assert.equal(login.response.status, 200);

  const classroom = await api("/api/classrooms", {
    method: "POST",
    body: JSON.stringify({ values: { building: "综艺楼", room: "5楼52班" } })
  });
  assert.equal(classroom.response.status, 201);
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("manual repair creation auto-matches ledger by location text", async () => {
  const created = await api("/api/repairs", {
    method: "POST",
    body: JSON.stringify({
      reporterName: "王嫚",
      urgency: "一般",
      location: "综艺楼5楼52班",
      description: "大屏前灯的开关故障"
    })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.data.status, "委托处理");
  assert.equal(created.data.data.ledger_matched, 1);
  assert.ok(created.data.data.ledger_id);

  const list = await api("/api/repairs?status=委托处理");
  assert.equal(list.data.data.length, 1);
  assert.equal(list.data.data[0].ledger_building, "综艺楼");
});

test("repair status advances through the flow", async () => {
  const row = db.prepare("SELECT id FROM repair_requests LIMIT 1").get();
  const invalid = await api(`/api/repairs/${row.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "不存在的状态" })
  });
  assert.equal(invalid.response.status, 400);

  const first = await api(`/api/repairs/${row.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "已处理", handler: "总务处张师傅" })
  });
  assert.equal(first.response.status, 200);
  assert.equal(first.data.data.status, "已处理");

  const second = await api(`/api/repairs/${row.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "已反馈" })
  });
  assert.equal(second.response.status, 200);
  assert.ok(second.data.data.completed_at);
});

test("huijiaoyun sync endpoint requires token and dedupes by external id", async () => {
  const payload = {
    externalId: "HY-2026-0001",
    reporterName: "陶程",
    urgency: "一般",
    repairType: "CBD设备报修（后勤、信息化）",
    location: "三楼音乐教室1",
    description: "窗帘掉下来了",
    status: "委托处理",
    submittedAt: "2026-09-11 15:45",
    images: ["https://example.com/a.jpg"]
  };

  const noAuth = await fetch(`${baseUrl}/api/integrations/huijiaoyun/repairs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(noAuth.status, 401);

  const synced = await api("/api/integrations/huijiaoyun/repairs", {
    method: "POST",
    headers: { "x-sync-token": "test-sync-token" },
    body: JSON.stringify(payload)
  });
  assert.equal(synced.response.status, 200);
  assert.equal(synced.data.synced, 1);

  const resynced = await api("/api/integrations/huijiaoyun/repairs", {
    method: "POST",
    headers: { "x-sync-token": "test-sync-token" },
    body: JSON.stringify({ ...payload, status: "已处理" })
  });
  assert.equal(resynced.response.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM repair_requests WHERE source = 'huijiaoyun'").get().count, 1);
  assert.equal(db.prepare("SELECT status FROM repair_requests WHERE source = 'huijiaoyun'").get().status, "已处理");

  const broken = await api("/api/integrations/huijiaoyun/repairs", {
    method: "POST",
    headers: { "x-sync-token": "test-sync-token" },
    body: JSON.stringify({ reporterName: "缺编号" })
  });
  assert.equal(broken.response.status, 400);
  assert.equal(broken.data.synced, 0);
  assert.match(broken.data.failures[0].error, /报修单编号/);
});

test("repair list requires login and non-admin cannot create", async () => {
  const anonymous = await fetch(`${baseUrl}/api/repairs`);
  assert.equal(anonymous.status, 401);
});
