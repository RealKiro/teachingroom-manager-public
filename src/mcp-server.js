// TeachingRoom Manager — MCP (Model Context Protocol) 服务器
// 提供给 AI 框架（如 AstrBot、Claude Desktop 等）调用教室数据的 CRUD 接口。
//
// 启动方式：  node src/mcp-server.js
// 协议：      JSON-RPC 2.0 over stdio（标准 MCP 协议）
//
// 连接配置连接到同一 SQLite 数据库（由 DB_PATH 或 DATABASE_URL 指定）。

import { createAdapter } from "./db/index.js";
import { normalizeClassroomValue } from "./database.js";

// ── 工具定义 ────────────────────────────────────────────────

const TOOLS = [
  {
    name: "list_classrooms",
    description: "查询教室列表，支持按楼栋、级部、关键字等筛选",
    inputSchema: {
      type: "object",
      properties: {
        building: { type: "string", description: "按楼栋筛选，如 A栋" },
        department: { type: "string", description: "按级部筛选：小学/初中/高中" },
        search: { type: "string", description: "关键字搜索（匹配所有字段）" },
        planned: { type: "string", description: "更新计划筛选：yes/no/screen/board/audio" },
        pending: { type: "string", description: "待审核筛选：yes/no" },
        limit: { type: "number", description: "返回条数上限", default: 50 }
      }
    }
  },
  {
    name: "get_classroom",
    description: "获取单间教室的完整信息",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "教室 ID" }
      },
      required: ["id"]
    }
  },
  {
    name: "search_classrooms",
    description: "快速搜索教室（按关键字匹配楼栋/编号/班级等）",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "搜索关键词" },
        limit: { type: "number", description: "返回条数上限", default: 20 }
      },
      required: ["keyword"]
    }
  },
  {
    name: "get_classroom_stats",
    description: "获取教室汇总统计（总数、按楼栋分布、更新计划）",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "get_buildings",
    description: "获取所有楼栋列表",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "get_departments",
    description: "获取所有级部列表",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "get_pending_requests",
    description: "获取待审核的变更请求列表",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "筛选类型：all/update/create/photo", default: "all" },
        limit: { type: "number", description: "返回条数上限", default: 30 }
      }
    }
  },
  {
    name: "list_fields",
    description: "获取所有字段定义（字段标识、名称、类型、选项等）",
    inputSchema: {
      type: "object",
      properties: {}
    }
  }
];

// ── 工具处理函数 ─────────────────────────────────────────────

const HANDLERS = {
  async list_classrooms(args, adapter) {
    const { building, department, search, planned, pending, limit = 50 } = args || {};
    let sql = "SELECT * FROM classrooms WHERE 1=1";
    const params = [];

    if (building) { sql += " AND building = ?"; params.push(building); }
    if (limit) { sql += " LIMIT ?"; params.push(Math.min(limit, 200)); }

    const classrooms = await adapter.all(sql, params);
    if (!classrooms.length) return "当前没有匹配的教室记录。";

    // Get classroom values
    const ids = classrooms.map((c) => c.id);
    const values = ids.length
      ? await adapter.all(
          `SELECT classroom_id, field_key, value FROM classroom_values WHERE classroom_id IN (${ids.map(() => "?").join(",")})`,
          ids
        )
      : [];

    const valuesByClassroom = {};
    for (const v of values) {
      if (!valuesByClassroom[v.classroom_id]) valuesByClassroom[v.classroom_id] = {};
      valuesByClassroom[v.classroom_id][v.field_key] = v.value;
    }

    let results = classrooms.map((c) => {
      const vals = valuesByClassroom[c.id] || {};
      return { id: c.id, building: c.building, room: c.room, ...vals };
    });

    // Apply filters (post-query for flexible field filtering)
    if (department) results = results.filter((r) => r.department === department);
    if (planned === "yes") results = results.filter((r) => r.plan_screen || r.plan_board || r.plan_audio || r.plan_recording);
    if (planned === "no") results = results.filter((r) => !r.plan_screen && !r.plan_board && !r.plan_audio && !r.plan_recording);
    if (search) {
      const q = search.toLowerCase();
      results = results.filter((r) => Object.values(r).some((v) => String(v || "").toLowerCase().includes(q)));
    }

    return JSON.stringify(results.slice(0, Math.min(limit, 200)), null, 2);
  },

  async get_classroom(args, adapter) {
    const { id } = args || {};
    if (!id) return "请提供教室 ID。";

    const classroom = await adapter.get("SELECT * FROM classrooms WHERE id = ?", [id]);
    if (!classroom) return `教室 #${id} 不存在。`;

    const values = await adapter.all("SELECT field_key, value FROM classroom_values WHERE classroom_id = ?", [id]);
    const detail = { id: classroom.id, building: classroom.building, room: classroom.room, updatedAt: classroom.updated_at };
    for (const v of values) detail[v.field_key] = v.value;

    return JSON.stringify(detail, null, 2);
  },

  async search_classrooms(args, adapter) {
    const { keyword, limit = 20 } = args || {};
    if (!keyword) return "请提供搜索关键词。";

    const classrooms = await adapter.all("SELECT * FROM classrooms ORDER BY building, room LIMIT ?", [Math.min(limit, 100)]);
    if (!classrooms.length) return "教室数据为空。";

    const ids = classrooms.map((c) => c.id);
    const values = ids.length
      ? await adapter.all(
          `SELECT classroom_id, field_key, value FROM classroom_values WHERE classroom_id IN (${ids.map(() => "?").join(",")})`,
          ids
        )
      : [];

    const valuesByClassroom = {};
    for (const v of values) {
      if (!valuesByClassroom[v.classroom_id]) valuesByClassroom[v.classroom_id] = {};
      valuesByClassroom[v.classroom_id][v.field_key] = v.value;
    }

    const q = keyword.toLowerCase();
    const matches = classrooms
      .map((c) => {
        const vals = valuesByClassroom[c.id] || {};
        const record = { id: c.id, building: c.building, room: c.room, ...vals };
        return { record, match: Object.values(record).some((v) => String(v || "").toLowerCase().includes(q)) };
      })
      .filter((m) => m.match)
      .slice(0, Math.min(limit, 100));

    if (!matches.length) return `未找到匹配 "${keyword}" 的教室。`;
    return JSON.stringify(matches.map((m) => m.record), null, 2);
  },

  async get_classroom_stats(args, adapter) {
    const total = await adapter.get("SELECT COUNT(*) AS count FROM classrooms");
    const byBuilding = await adapter.all("SELECT building, COUNT(*) AS count FROM classrooms GROUP BY building ORDER BY building");
    const planCounts = await adapter.all(`
      SELECT
        SUM(CASE WHEN plan_screen IS NOT NULL AND plan_screen != '' THEN 1 ELSE 0 END) AS screen,
        SUM(CASE WHEN plan_board IS NOT NULL AND plan_board != '' THEN 1 ELSE 0 END) AS board,
        SUM(CASE WHEN plan_audio IS NOT NULL AND plan_audio != '' THEN 1 ELSE 0 END) AS audio,
        SUM(CASE WHEN plan_recording IS NOT NULL AND plan_recording != '' THEN 1 ELSE 0 END) AS recording
      FROM classroom_values cv
      JOIN field_definitions fd ON fd.key = cv.field_key AND fd.group_name LIKE '%更新计划'
    `);
    const pending = await adapter.get("SELECT COUNT(*) AS count FROM change_requests WHERE status = 'pending'");

    return JSON.stringify({
      totalClassrooms: total?.count || 0,
      byBuilding: byBuilding.map((b) => ({ building: b.building, count: b.count })),
      pendingChanges: pending?.count || 0,
      planned: planCounts || { screen: 0, board: 0, audio: 0, recording: 0 }
    }, null, 2);
  },

  async get_buildings(args, adapter) {
    const rows = await adapter.all("SELECT DISTINCT building FROM classrooms ORDER BY building");
    if (!rows.length) return "暂无教室数据。";
    return rows.map((r) => r.building).join("\n");
  },

  async get_departments(args, adapter) {
    const rows = await adapter.all(
      "SELECT DISTINCT value FROM classroom_values WHERE field_key = 'department' ORDER BY value"
    );
    if (!rows.length) return "暂无级部数据。";
    return rows.map((r) => r.value).join("\n");
  },

  async get_pending_requests(args, adapter) {
    const { type = "all", limit = 30 } = args || {};
    const requests = await adapter.all(`
      SELECT cr.id, cr.status, cr.reason, cr.created_at, c.building, c.room
      FROM change_requests cr
      JOIN classrooms c ON c.id = cr.classroom_id
      WHERE cr.status = 'pending'
      ORDER BY cr.created_at DESC
      LIMIT ?
    `, [Math.min(limit, 100)]);

    if (!requests.length) return "暂无待审核变更请求。";
    return JSON.stringify(requests, null, 2);
  },

  async list_fields(args, adapter) {
    const fields = await adapter.all(`
      SELECT key, label, group_name AS "group", type, filterable, editable, public_api AS publicApi
      FROM field_definitions
      ORDER BY sort_order, id
    `);
    return JSON.stringify(fields, null, 2);
  }
};

// ── MCP 协议处理 ─────────────────────────────────────────────

async function handleRequest(request, adapter) {
  const { id, method, params } = request;

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params || {};
    const handler = HANDLERS[name];
    if (!handler) {
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } };
    }
    try {
      const result = await handler(args, adapter);
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: String(result) }] }
      };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: `Tool error: ${error.message}` }
      };
    }
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } };
}

// ── 启动 ─────────────────────────────────────────────────────

async function main() {
  const adapter = await createAdapter();
  await adapter.connect();
  await adapter.exec("SELECT 1"); // Verify connection

  // MCP 通过 stdio 通信
  process.stdin.setEncoding("utf8");
  let buffer = "";

  process.stdin.on("data", async (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const request = JSON.parse(trimmed);
        const response = await handleRequest(request, adapter);
        process.stdout.write(JSON.stringify(response) + "\n");
      } catch (err) {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: `Parse error: ${err.message}` }
        }) + "\n");
      }
    }
  });

  process.stdin.on("end", async () => {
    await adapter.close();
    process.exit(0);
  });

  // 输出服务器信息到 stderr（stdout 为 MCP 协议专用）
  console.error("TeachingRoom MCP server started");
  console.error(`MCP tools available: ${TOOLS.map((t) => t.name).join(", ")}`);
}

main().catch((err) => {
  console.error("MCP server failed:", err);
  process.exit(1);
});
