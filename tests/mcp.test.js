import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "teachingroom-mcp-"));
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

const token = fs.readFileSync(path.join(process.env.DATA_DIR, "base-data-api-token.txt"), "utf8").trim();

db.prepare("INSERT INTO classrooms (building, room) VALUES (?, ?)").run("X栋", "X101");
const insertValue = db.prepare("INSERT INTO classroom_values (classroom_id, field_key, value) VALUES (?, ?, ?)");
const classroomId = db.prepare("SELECT id FROM classrooms WHERE room = ?").get("X101").id;
for (const [fieldKey, value] of [["building", "X栋"], ["room", "X101"], ["department", "小学"], ["class_name", "一年级一班"]]) {
  insertValue.run(classroomId, fieldKey, value);
}

const server = await new Promise((resolve) => {
  const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function rpc(method, params, { auth = true, id = 1, headers = {} } = {}) {
  const message = id === null
    ? { jsonrpc: "2.0", method, params }
    : { jsonrpc: "2.0", id, method, params };
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(auth ? { "x-api-token": token } : {}),
      ...headers
    },
    body: JSON.stringify(message)
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : null;
  return { response, data };
}

function parseToolText(data) {
  assert.equal(data.result.isError, false);
  const [block] = data.result.content;
  assert.equal(block.type, "text");
  return JSON.parse(block.text);
}

test("rejects MCP requests without a valid token", async () => {
  const { response } = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" }
  }, { auth: false });
  assert.equal(response.status, 401);
});

test("completes the standard MCP initialize handshake", async () => {
  const { response, data } = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "astrbot-test", version: "1.0.0" }
  });
  assert.equal(response.status, 200);
  assert.equal(data.jsonrpc, "2.0");
  assert.equal(data.result.protocolVersion, "2024-11-05");
  assert.equal(data.result.serverInfo.name, "teachingroom-manager");
  assert.ok(data.result.capabilities.tools);
});

test("accepts initialized notification without a response body", async () => {
  const { response } = await rpc("notifications/initialized", undefined, { id: null });
  assert.equal(response.status, 202);
});

test("lists the read-only classroom tools", async () => {
  const { data } = await rpc("tools/list");
  const names = data.result.tools.map((tool) => tool.name);
  assert.deepEqual(names, ["list_classrooms", "get_classroom", "get_fields", "get_summary"]);
  for (const tool of data.result.tools) {
    assert.equal(tool.inputSchema.type, "object");
  }
});

test("list_classrooms returns seeded public classroom data", async () => {
  const { data } = await rpc("tools/call", { name: "list_classrooms", arguments: { building: "X栋" } });
  const payload = parseToolText(data);
  assert.equal(payload.total, 1);
  assert.equal(payload.returned, 1);
  assert.equal(payload.data[0].code, "X101");
  assert.equal(payload.data[0].department, "小学");
  assert.equal(payload.data[0].current.screen, "");
});

test("get_classroom resolves by room code and reports missing rooms as tool errors", async () => {
  const found = await rpc("tools/call", { name: "get_classroom", arguments: { room: "X101" } });
  const payload = parseToolText(found.data);
  assert.equal(payload.code, "X101");
  assert.equal(payload.building, "X栋");

  const missing = await rpc("tools/call", { name: "get_classroom", arguments: { room: "Y999" } });
  assert.equal(missing.data.result.isError, true);
  assert.match(missing.data.result.content[0].text, /Y999/);

  const noArgs = await rpc("tools/call", { name: "get_classroom", arguments: {} });
  assert.equal(noArgs.data.result.isError, true);
});

test("get_fields and get_summary expose public metadata", async () => {
  const fields = await rpc("tools/call", { name: "get_fields", arguments: {} });
  const fieldPayload = parseToolText(fields.data);
  const keys = fieldPayload.fields.map((field) => field.key);
  assert.ok(keys.includes("building"));
  assert.ok(keys.includes("room"));

  const summary = await rpc("tools/call", { name: "get_summary", arguments: {} });
  const summaryPayload = parseToolText(summary.data);
  assert.equal(summaryPayload.count, 1);
  assert.ok(summaryPayload.summary);
});

test("unknown tools and methods return proper MCP errors", async () => {
  const unknownTool = await rpc("tools/call", { name: "delete_classrooms" });
  assert.equal(unknownTool.data.result.isError, true);

  const unknownMethod = await rpc("resources/list");
  assert.equal(unknownMethod.data.error.code, -32601);
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
