const SERVER_VERSION = "vector-search-public.1";
const INDEX_VERSION = "vector-search-qwen3-embedding-0.6b";
const EMBEDDING_MODEL = "@cf/qwen/qwen3-embedding-0.6b";
const MANIFEST_PREFIX = "__vector_manifest__:";
const LIMITS = Object.freeze({ key: 200, value: 100_000, query: 500, results: 5 });
const MIN_BEARER_TOKEN_LENGTH = 24;
const MIN_URL_TOKEN_LENGTH = 43;
const URL_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const bearerEndpoint = url.pathname === "/mcp";
    const secretUrlEndpoint = isAuthorizedUrlPath(url.pathname, env.MCP_URL_TOKEN);
    if (!bearerEndpoint && !secretUrlEndpoint) return new Response("Not Found", { status: 404 });
    if (request.method === "OPTIONS") return corsResponse(env);
    if (bearerEndpoint && !isAuthorized(request, env.AUTH_TOKEN)) {
      return new Response("Unauthorized", { status: 401 });
    }
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
          serverInfo: { name: "personal-ai-memory-vector-search", version: SERVER_VERSION },
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
    description: "Save one memory in KV and maintain its Vectorize chunks.",
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
    description: "Find a bounded number of memory keys using a query or prefix.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: LIMITS.query },
        prefix: { type: "string", maxLength: LIMITS.key },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
    },
  },
  {
    name: "search_memories",
    description: "Search indexed chunks by semantic similarity.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: LIMITS.query },
        limit: { type: "integer", minimum: 1, maximum: LIMITS.results },
      },
      required: ["query"],
    },
  },
  {
    name: "delete_memory",
    description: "Delete one memory and its vectors only when confirmKey exactly matches key.",
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
  if (name === "save_memory") return saveMemory(args, env);
  if (name === "get_memory") {
    validateKey(args.key);
    const value = await env.MEMORY.get(args.key);
    return value === null ? `Not found: ${args.key}` : value;
  }
  if (name === "find_memory_keys") return findMemoryKeys(args, env);
  if (name === "search_memories") return searchMemories(args, env);
  if (name === "delete_memory") return deleteMemory(args, env);
  throw new Error(`Unknown tool: ${name}`);
}

async function saveMemory({ key, value }, env) {
  validateKey(key);
  validateValue(value);
  const manifestKey = await manifestKeyFor(key);
  const previous = await readManifest(env.MEMORY, manifestKey);
  await env.MEMORY.put(key, value);
  try {
    const chunks = splitText(value);
    if (!chunks.length) {
      if (previous.ids.length) await env.VECTORIZE_INDEX.deleteByIds(previous.ids);
      await env.MEMORY.put(manifestKey, JSON.stringify({ status: "ok", ids: [], version: INDEX_VERSION }));
      return { key, kv: "ok", index: "skipped", chunks: 0 };
    }
    const ids = await Promise.all(chunks.map((_, index) => vectorIdFor(key, index)));
    const embeddings = parseEmbeddings(await env.AI.run(EMBEDDING_MODEL, { text: chunks }));
    if (embeddings.length !== chunks.length) throw new Error("embedding count does not match chunk count");
    await env.VECTORIZE_INDEX.upsert(chunks.map((chunk, index) => ({
      id: ids[index],
      values: embeddings[index],
      metadata: { key, chunkIndex: index, chunk, version: INDEX_VERSION },
    })));
    await env.MEMORY.put(manifestKey, JSON.stringify({ status: "ok", ids, version: INDEX_VERSION }));
    const staleIds = previous.ids.filter((id) => !ids.includes(id));
    if (staleIds.length) await env.VECTORIZE_INDEX.deleteByIds(staleIds);
    return { key, kv: "ok", index: "ok", chunks: chunks.length };
  } catch (error) {
    await env.MEMORY.put(manifestKey, JSON.stringify({
      status: "pending",
      ids: previous.ids,
      version: INDEX_VERSION,
      error: safeError(error),
    }));
    return { key, kv: "ok", index: "pending", error: safeError(error) };
  }
}

async function searchMemories(args, env) {
  const query = normalizeQuery(args.query);
  const limit = clampInt(args.limit, 3, 1, LIMITS.results);
  const [queryVector] = parseEmbeddings(await env.AI.run(EMBEDDING_MODEL, { text: [query] }));
  const vectorResult = await env.VECTORIZE_INDEX.query(queryVector, {
    topK: Math.min(limit * 4, 20),
    returnMetadata: "all",
  });
  const bestPerKey = new Map();
  for (const match of vectorResult.matches || []) {
    const key = match.metadata?.key;
    if (!key || !await isCurrentVector(env.MEMORY, key, match.id)) continue;
    if (!bestPerKey.has(key) || Number(match.score) > Number(bestPerKey.get(key).score)) {
      bestPerKey.set(key, match);
    }
  }
  const results = [...bestPerKey.values()]
    .sort((left, right) => Number(right.score) - Number(left.score))
    .slice(0, limit)
    .map((match) => ({
      key: match.metadata.key,
      chunkIndex: Number(match.metadata.chunkIndex),
      score: Number(Number(match.score).toFixed(6)),
      chunk: match.metadata.chunk,
    }));
  return { query, count: results.length, results };
}

async function deleteMemory({ key, confirmKey }, env) {
  validateKey(key);
  if (confirmKey !== key) throw new Error("confirmKey must exactly match key");
  const manifestKey = await manifestKeyFor(key);
  const manifest = await readManifest(env.MEMORY, manifestKey);
  if (manifest.ids.length) await env.VECTORIZE_INDEX.deleteByIds(manifest.ids);
  await Promise.all([env.MEMORY.delete(key), env.MEMORY.delete(manifestKey)]);
  return { key, deleted: true };
}

async function findMemoryKeys(args, env) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const prefix = typeof args.prefix === "string" ? args.prefix.trim() : "";
  if (!query && !prefix) throw new Error("query or prefix is required; unfiltered listing is disabled");
  if (query.length > LIMITS.query) throw new Error(`query must not exceed ${LIMITS.query} characters`);
  if (prefix.length > LIMITS.key) throw new Error(`prefix must not exceed ${LIMITS.key} characters`);
  const limit = clampInt(args.limit, 10, 1, 20);
  const needle = query.toLocaleLowerCase("zh-CN");
  const results = [];
  let cursor;
  do {
    const page = await env.MEMORY.list({ cursor, prefix: prefix || undefined, limit: 1_000 });
    for (const item of page.keys) {
      if (item.name.startsWith(MANIFEST_PREFIX)) continue;
      if (!needle || item.name.toLocaleLowerCase("zh-CN").includes(needle)) results.push(item.name);
      if (results.length >= limit) break;
    }
    cursor = page.list_complete || results.length >= limit ? undefined : page.cursor;
  } while (cursor);
  return { count: results.length, results };
}

function splitText(text) {
  const normalized = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const chunks = [];
  for (let index = 0; index < normalized.length; index += 200) chunks.push(normalized.slice(index, index + 300));
  return chunks;
}

function parseEmbeddings(result) {
  const data = result?.data || result?.result?.data;
  if (!Array.isArray(data)) throw new Error("unrecognized embedding response");
  if (Array.isArray(data[0])) return data;
  if (data[0]?.embedding) return data.map((item) => item.embedding);
  throw new Error("embedding response contains no vectors");
}

async function manifestKeyFor(key) { return `${MANIFEST_PREFIX}${await sha256Hex(key)}`; }
async function readManifest(kv, manifestKey) {
  const raw = await kv.get(manifestKey);
  if (!raw) return { status: "missing", ids: [] };
  try {
    const parsed = JSON.parse(raw);
    return { ...parsed, ids: Array.isArray(parsed.ids) ? parsed.ids : [] };
  } catch {
    return { status: "invalid", ids: [] };
  }
}

async function isCurrentVector(kv, key, id) {
  const manifest = await readManifest(kv, await manifestKeyFor(key));
  return manifest.status === "ok" && manifest.version === INDEX_VERSION && manifest.ids.includes(id);
}

async function vectorIdFor(key, chunkIndex) {
  return (await sha256Hex(`${INDEX_VERSION}\0${key}\0${chunkIndex}`)).slice(0, 40);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateKey(key) {
  if (typeof key !== "string" || !key.trim()) throw new Error("key is required");
  if (key.length > LIMITS.key) throw new Error(`key must not exceed ${LIMITS.key} characters`);
  if (key.startsWith(MANIFEST_PREFIX)) throw new Error("key uses a reserved prefix");
  if (/[\u0000-\u001f\u007f]/u.test(key)) throw new Error("key must not contain control characters");
}

function validateValue(value) {
  if (typeof value !== "string") throw new Error("value must be a string");
  if (value.length > LIMITS.value) throw new Error(`value must not exceed ${LIMITS.value} characters`);
}

function normalizeQuery(query) {
  const value = typeof query === "string" ? query.trim() : "";
  if (!value) throw new Error("query is required");
  if (value.length > LIMITS.query) throw new Error(`query must not exceed ${LIMITS.query} characters`);
  return value;
}

function clampInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function isAuthorized(request, token) {
  return typeof token === "string"
    && token.length >= MIN_BEARER_TOKEN_LENGTH
    && request.headers.get("Authorization") === `Bearer ${token}`;
}

function isAuthorizedUrlPath(pathname, token) {
  return typeof token === "string"
    && token.length >= MIN_URL_TOKEN_LENGTH
    && URL_TOKEN_PATTERN.test(token)
    && pathname === `/mcp/${token}`;
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
