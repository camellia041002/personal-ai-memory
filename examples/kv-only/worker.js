const SERVER_VERSION = "kv-only-public.1";
const LIMITS = Object.freeze({ key: 200, value: 100_000, query: 500, results: 20 });
const MIN_TOKEN_LENGTH = 24;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") return new Response("Not Found", { status: 404 });
    if (request.method === "OPTIONS") return corsResponse(env);
    if (!isAuthorized(request, env.AUTH_TOKEN)) return new Response("Unauthorized", { status: 401 });
    if (request.method === "GET") return sseInit(env);
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400, env); }
    const { method, params, id } = body;
    try {
      if (method === "initialize") {
        return jsonResponse(rpcResult(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "personal-ai-memory-kv-only", version: SERVER_VERSION },
        }), 200, env);
      }
      if (method === "tools/list") return jsonResponse(rpcResult(id, { tools: TOOLS }), 200, env);
      if (method === "tools/call") {
        const result = await callTool(params?.name, params?.arguments || {}, env);
        return jsonResponse(rpcResult(id, {
          content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
        }), 200, env);
      }
      return jsonResponse(rpcError(id, -32601, "Method not found"), 200, env);
    } catch (error) {
      return jsonResponse(rpcError(id, -32603, safeError(error)), 200, env);
    }
  },
};

const TOOLS = [
  {
    name: "save_memory",
    description: "Save or replace one memory in KV.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", maxLength: LIMITS.key },
        value: { type: "string", maxLength: LIMITS.value },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "get_memory",
    description: "Read one memory by its complete key.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string", maxLength: LIMITS.key } },
      required: ["key"],
    },
  },
  {
    name: "find_memory_keys",
    description: "Find a bounded number of keys using a query or prefix.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: LIMITS.query },
        prefix: { type: "string", maxLength: LIMITS.key },
        limit: { type: "integer", minimum: 1, maximum: LIMITS.results },
      },
    },
  },
  {
    name: "delete_memory",
    description: "Delete one memory only when confirmKey exactly matches key.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", maxLength: LIMITS.key },
        confirmKey: { type: "string", maxLength: LIMITS.key },
      },
      required: ["key", "confirmKey"],
    },
  },
];

async function callTool(name, args, env) {
  if (name === "save_memory") {
    validateKey(args.key);
    validateValue(args.value);
    await env.MEMORY.put(args.key, args.value);
    return { key: args.key, saved: true };
  }
  if (name === "get_memory") {
    validateKey(args.key);
    const value = await env.MEMORY.get(args.key);
    return value === null ? `Not found: ${args.key}` : value;
  }
  if (name === "find_memory_keys") return findMemoryKeys(args, env);
  if (name === "delete_memory") {
    validateKey(args.key);
    if (args.confirmKey !== args.key) throw new Error("confirmKey must exactly match key");
    await env.MEMORY.delete(args.key);
    return { key: args.key, deleted: true };
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function findMemoryKeys(args, env) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const prefix = typeof args.prefix === "string" ? args.prefix.trim() : "";
  if (!query && !prefix) throw new Error("query or prefix is required; unfiltered listing is disabled");
  if (query.length > LIMITS.query) throw new Error(`query must not exceed ${LIMITS.query} characters`);
  if (prefix.length > LIMITS.key) throw new Error(`prefix must not exceed ${LIMITS.key} characters`);
  const limit = clampInt(args.limit, 10, 1, LIMITS.results);
  const needle = query.toLocaleLowerCase("zh-CN");
  const results = [];
  let cursor;
  do {
    const page = await env.MEMORY.list({ cursor, prefix: prefix || undefined, limit: 1_000 });
    for (const item of page.keys) {
      if (!needle || item.name.toLocaleLowerCase("zh-CN").includes(needle)) results.push(item.name);
      if (results.length >= limit) break;
    }
    cursor = page.list_complete || results.length >= limit ? undefined : page.cursor;
  } while (cursor);
  return { count: results.length, results };
}

function validateKey(key) {
  if (typeof key !== "string" || !key.trim()) throw new Error("key is required");
  if (key.length > LIMITS.key) throw new Error(`key must not exceed ${LIMITS.key} characters`);
  if (/[\u0000-\u001f\u007f]/u.test(key)) throw new Error("key must not contain control characters");
}

function validateValue(value) {
  if (typeof value !== "string") throw new Error("value must be a string");
  if (value.length > LIMITS.value) throw new Error(`value must not exceed ${LIMITS.value} characters`);
}

function clampInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function isAuthorized(request, token) {
  return typeof token === "string"
    && token.length >= MIN_TOKEN_LENGTH
    && request.headers.get("Authorization") === `Bearer ${token}`;
}

function safeError(error) { return (error instanceof Error ? error.message : String(error)).slice(0, 500); }
function rpcResult(id, result) { return { jsonrpc: "2.0", id, result }; }
function rpcError(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }

function corsHeaders(env) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
  if (env.ALLOWED_ORIGIN) headers["Access-Control-Allow-Origin"] = env.ALLOWED_ORIGIN;
  return headers;
}

function jsonResponse(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(env) },
  });
}

function corsResponse(env) { return new Response(null, { status: 204, headers: corsHeaders(env) }); }
function sseInit(env) {
  const payload = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  return new Response(`data: ${payload}\n\n`, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...corsHeaders(env) },
  });
}
