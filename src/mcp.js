import express from "express";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { name, version } = require("../package.json");

// 标准 MCP（Model Context Protocol）服务端：Streamable HTTP 传输，
// 遵循 https://modelcontextprotocol.io 规范，任何标准 MCP 客户端均可接入。
const JSON_RPC_VERSION = "2.0";
const LATEST_PROTOCOL_VERSION = "2025-06-18";
const supportedProtocolVersions = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);

const serverInfo = {
  name,
  title: "教室设备管理系统",
  version
};

const toolDefinitions = [
  {
    name: "list_classrooms",
    description:
      "查询教室设备台账列表。返回教室编号、楼栋、楼侧、班级、现有设备（屏幕/书写板/扩声/录播/监控）和 2026 暑期更新计划等公开字段。支持按楼栋、级部、更新计划和关键字筛选。",
    inputSchema: {
      type: "object",
      properties: {
        building: { type: "string", description: "楼栋名称，如 X栋" },
        department: { type: "string", description: "级部：小学 / 初中 / 高中", enum: ["小学", "初中", "高中"] },
        orientation: { type: "string", description: "楼侧关键字，如 南" },
        side: { type: "string", description: "楼侧（含“侧”字），如 南侧" },
        planned: {
          type: "string",
          description: "更新计划筛选：yes=有任何计划，screen/board/audio/recording=具体设备"
        },
        search: { type: "string", description: "关键字，匹配公开文本字段，如教室编号或班级" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "返回条数上限，默认 50" },
        offset: { type: "integer", minimum: 0, description: "分页偏移量，默认 0" }
      }
    }
  },
  {
    name: "get_classroom",
    description: "按教室 ID 或教室编号查询单间教室的设备详情（只读公开字段）。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "教室 ID（list_classrooms 返回的 id）" },
        room: { type: "string", description: "教室编号，如 X101" }
      }
    }
  },
  {
    name: "get_fields",
    description: "获取公开字段定义（字段键、显示名、类型、可选项），用于了解可查询字段和筛选条件。",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_summary",
    description: "获取教室台账统计概览：总数、按楼栋/级部分布、更新计划统计，支持与 list_classrooms 相同的筛选参数。",
    inputSchema: {
      type: "object",
      properties: {
        building: { type: "string", description: "楼栋名称，如 X栋" },
        department: { type: "string", description: "级部：小学 / 初中 / 高中", enum: ["小学", "初中", "高中"] },
        planned: { type: "string", description: "更新计划筛选：yes/screen/board/audio/recording" },
        search: { type: "string", description: "关键字" }
      }
    }
  }
];

export function createMcpRouter({ authenticate, listClassrooms, getClassroom, getFields, getSummary }) {
  const router = express.Router();
  router.use(authenticate);

  router.post("/", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const body = req.body;
    const isBatch = Array.isArray(body);
    const messages = isBatch ? body : [body];
    const responses = [];
    for (const message of messages) {
      const response = await handleMessage(message, req);
      if (response) responses.push(response);
    }
    if (!responses.length) return res.status(202).end();
    return res.json(isBatch ? responses : responses[0]);
  });

  // 服务端不提供 SSE 推送流；按规范返回 405，客户端继续使用 POST 请求即可。
  router.get("/", (_req, res) => {
    res.status(405).set("Allow", "POST").json({
      jsonrpc: JSON_RPC_VERSION,
      id: null,
      error: { code: -32000, message: "SSE stream not supported; use HTTP POST requests" }
    });
  });

  router.delete("/", (_req, res) => {
    res.status(405).set("Allow", "POST").end();
  });

  async function handleMessage(message, req) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return rpcError(null, -32600, "Invalid Request");
    }
    const { jsonrpc, id, method, params } = message;
    if (jsonrpc !== JSON_RPC_VERSION || typeof method !== "string") {
      return rpcError(id ?? null, -32600, "Invalid Request");
    }
    const isNotification = id === undefined || id === null;
    if (isNotification) return null;
    try {
      const result = await dispatch(method, params);
      if (result === null) return null;
      return rpcResult(id, result);
    } catch (error) {
      if (error?.methodNotFound) return rpcError(id, -32601, `Method not found: ${method}`);
      return rpcError(id, -32603, "Internal error", String(error?.message || error));
    }
  }

  async function dispatch(method, params) {
    switch (method) {
      case "initialize":
        return {
          protocolVersion: normalizeProtocolVersion(params),
          capabilities: { tools: { listChanged: false } },
          serverInfo,
          instructions:
            "教室设备管理系统的只读查询工具。可查询教室设备台账、更新计划与统计信息；数据写入请使用 Web 界面。"
        };
      case "ping":
        return {};
      case "tools/list":
        return { tools: toolDefinitions };
      case "tools/call":
        return await callTool(params);
      default:
        throw Object.assign(new Error(`Method not found: ${method}`), { methodNotFound: true });
    }
  }

  async function callTool(params) {
    const toolName = String(params?.name || "");
    const tool = toolDefinitions.find((item) => item.name === toolName);
    if (!tool) {
      return errorTextContent(`未知工具：${toolName}。可用工具：${toolDefinitions.map((item) => item.name).join("、")}`);
    }
    const args = params?.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
      ? params.arguments
      : {};
    try {
      switch (toolName) {
        case "list_classrooms": {
          const payload = listClassrooms(pickFilters(args));
          const limit = clampInt(args.limit, 1, 200, 50);
          const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
          const data = payload.data.slice(offset, offset + limit);
          return textContent({
            total: payload.count,
            returned: data.length,
            offset,
            data,
            summary: payload.summary,
            updatedAt: payload.updatedAt
          });
        }
        case "get_classroom": {
          const id = Number(args.id);
          const room = String(args.room || "").trim();
          const hasId = Number.isInteger(id) && id > 0;
          if (!hasId && !room) {
            return errorTextContent("请提供教室 id（整数）或 room（教室编号）其中一个参数");
          }
          const record = getClassroom(room || id);
          if (!record) return errorTextContent(`教室不存在：${room || id}`);
          return textContent(record);
        }
        case "get_fields": {
          return textContent({ fields: getFields() });
        }
        case "get_summary": {
          return textContent(getSummary(pickFilters(args)));
        }
        default:
          return errorTextContent(`工具未实现：${toolName}`);
      }
    } catch (error) {
      return errorTextContent(`工具执行失败：${String(error?.message || error)}`);
    }
  }

  return router;
}

function pickFilters(args) {
  const filters = {};
  for (const key of ["building", "department", "orientation", "side", "planned", "search"]) {
    const value = String(args[key] ?? "").trim();
    if (value) filters[key] = value;
  }
  return filters;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function normalizeProtocolVersion(params) {
  const requested = String(params?.protocolVersion || "");
  if (supportedProtocolVersions.has(requested)) return requested;
  return LATEST_PROTOCOL_VERSION;
}

function rpcError(id, code, message, data) {
  return { jsonrpc: JSON_RPC_VERSION, id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function rpcResult(id, result) {
  return { jsonrpc: JSON_RPC_VERSION, id, result };
}

function textContent(payload) {
  return {
    content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }],
    isError: false
  };
}

function errorTextContent(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}
