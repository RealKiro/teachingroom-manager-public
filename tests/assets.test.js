import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// 校园资产扩展：多类别台账、备件库存、设备登记与转移、扫码查询

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "teachingroom-assets-"));
process.env.NODE_ENV = "test";
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
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("creates teacher and office ledger entries with categories", async () => {
  const teacher = await api("/api/classrooms", {
    method: "POST",
    body: JSON.stringify({
      category: "teacher",
      values: { building: "数学组", room: "张老师", current_screen: "触控一体机" },
      clientRequestId: "assets-teacher-create-001"
    })
  });
  assert.equal(teacher.response.status, 201, JSON.stringify(teacher.data));
  assert.equal(teacher.data.record.category, "teacher");

  const office = await api("/api/classrooms", {
    method: "POST",
    body: JSON.stringify({
      category: "office",
      values: { building: "行政楼", room: "校长办公室" }
    })
  });
  assert.equal(office.response.status, 201);
  assert.equal(office.data.record.category, "office");

  // 教室类别必填楼栋；教师类别只需名称
  const missingBuilding = await api("/api/classrooms", {
    method: "POST",
    body: JSON.stringify({ category: "teacher", values: { room: "李老师" } })
  });
  assert.equal(missingBuilding.response.status, 201);

  const missingName = await api("/api/classrooms", {
    method: "POST",
    body: JSON.stringify({ category: "teacher", values: { building: "语文组" } })
  });
  assert.equal(missingName.response.status, 400);
});

test("filters ledger records by category", async () => {
  const teachers = await api("/api/classrooms?category=teacher");
  assert.ok(teachers.data.records.length >= 2);
  assert.ok(teachers.data.records.every((record) => record.category === "teacher"));

  const offices = await api("/api/classrooms?category=office");
  assert.ok(offices.data.records.every((record) => record.category === "office"));

  const all = await api("/api/classrooms");
  assert.ok(all.data.records.some((record) => record.category === "office"));
});

test("exposes new built-in fields with category scopes", async () => {
  const { data } = await api("/api/fields");
  const byKey = new Map(data.fields.map((field) => [field.key, field]));
  for (const key of ["mouse", "keyboard", "speaker", "thermometer", "repair_date"]) {
    assert.ok(byKey.has(key), `missing field ${key}`);
  }
  assert.deepEqual(byKey.get("mouse").options, ["无", "无线", "有线"]);
  assert.deepEqual(byKey.get("mouse").categories, ["classroom", "teacher", "office"]);
  assert.deepEqual(byKey.get("plan_screen").categories, ["classroom"]);
  assert.deepEqual(byKey.get("front_door").categories, ["classroom"]);
});

test("manages spare part inventory with audit trail", async () => {
  const created = await api("/api/inventory", {
    method: "POST",
    body: JSON.stringify({ name: "触控笔", model: "CP-100", location: "仓库A", status: "全新", quantity: 5 })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  const id = created.data.data.id;

  const updated = await api(`/api/inventory/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "旧有", quantity: 4 })
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.data.status, "旧有");
  assert.equal(updated.data.data.quantity, 4);

  const searched = await api("/api/inventory?search=触控笔");
  assert.equal(searched.data.data.length, 1);

  const auditRows = db.prepare("SELECT action FROM audit_logs WHERE target_type = 'inventory_item' ORDER BY id").all();
  assert.deepEqual(auditRows.map((row) => row.action), ["create_inventory_item", "update_inventory_item"]);

  const removed = await api(`/api/inventory/${id}`, { method: "DELETE" });
  assert.equal(removed.response.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_items WHERE id = ?").get(id).count, 0);
});

test("registers equipment with asset codes and transfer history", async () => {
  const created = await api("/api/equipment", {
    method: "POST",
    body: JSON.stringify({ name: "移动投影仪", model: "PJ-500", holder: "总务处", location: "仓库B", status: "在用" })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  const equipment = created.data.data;
  assert.match(equipment.asset_code, /^EQ-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);

  const duplicateCode = db.prepare(`
    SELECT COUNT(*) AS count FROM equipment_registry WHERE asset_code = ?
  `).get(equipment.asset_code).count;
  assert.equal(duplicateCode, 1);

  const transferred = await api(`/api/equipment/${equipment.id}/transfer`, {
    method: "POST",
    body: JSON.stringify({ toHolder: "张老师", toLocation: "X栋 X102", reason: "公开课借用" })
  });
  assert.equal(transferred.response.status, 200);
  assert.equal(transferred.data.data.holder, "张老师");
  assert.equal(transferred.data.data.location, "X栋 X102");

  const transfers = await api(`/api/equipment/${equipment.id}/transfers`);
  assert.equal(transfers.data.data.length, 1);
  assert.equal(transfers.data.data[0].fromHolder, "总务处");
  assert.equal(transfers.data.data[0].toHolder, "张老师");

  const auditRows = db.prepare("SELECT action FROM audit_logs WHERE target_type = 'equipment' ORDER BY id").all();
  assert.deepEqual(auditRows.map((row) => row.action), ["create_equipment", "transfer_equipment"]);
});

test("scan endpoint serves public summaries without login", async () => {
  const classroom = db.prepare("SELECT asset_code FROM classrooms WHERE category = 'teacher' LIMIT 1").get();
  const anonymous = await fetch(`${baseUrl}/api/scan/${classroom.asset_code}`);
  assert.equal(anonymous.status, 200);
  const payload = await anonymous.json();
  assert.equal(payload.kind, "ledger");
  assert.equal(payload.category, "teacher");
  assert.ok(payload.title.includes("老师"));

  const equipment = db.prepare("SELECT asset_code FROM equipment_registry LIMIT 1").get();
  const equipmentScan = await fetch(`${baseUrl}/api/scan/${equipment.asset_code}`);
  const equipmentPayload = await equipmentScan.json();
  assert.equal(equipmentPayload.kind, "equipment");
  assert.equal(equipmentPayload.title, "移动投影仪");

  const missing = await fetch(`${baseUrl}/api/scan/AS-NOPE00`);
  assert.equal(missing.status, 404);
});
