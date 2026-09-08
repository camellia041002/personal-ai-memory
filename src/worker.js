import {
  INDEX_VERSION,
  LIMITS,
  clampInt,
  classifyKey,
  isIsoDate,
  normalizeDailyNote,
  normalizeOwner,
  normalizeQuery,
  normalizeSearchFilters,
  scoreCandidate,
  splitText,
  validateKeyValue,
  vectorIdFor,
} from "./core.js";

const SERVER_VERSION = "8.0.0-public.2";
const EMBEDDING_MODEL = "@cf/qwen/qwen3-embedding-0.6b";
const FINAL_TOP_K = 5;
const VECTOR_CANDIDATES = 40;
const MAX_RESULTS_PER_KEY = 2;
const MIN_BEARER_TOKEN_LENGTH = 24;
const MIN_URL_TOKEN_LENGTH = 43;
const URL_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") return landingPage();
    if (url.pathname.startsWith("/admin/")) return handleAdmin(request, env, url);
    const bearerEndpoint = url.pathname === "/mcp";
    const secretUrlEndpoint = isAuthorizedUrlPath(url.pathname, urlToken(env));
    if (!bearerEndpoint && !secretUrlEndpoint) return new Response("Not Found", { status: 404 });
    if (request.method === "OPTIONS") return corsResponse(env);
    if (bearerEndpoint && !isAuthorized(request, memoryToken(env))) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (request.method === "GET") return sseInit(env);
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400, env);
    }

    const { method, params, id } = body;
    try {
      if (method === "initialize") {
        return jsonResponse(rpcResult(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "personal-ai-memory", version: SERVER_VERSION },
        }), 200, env);
      }
      if (method === "tools/list") return jsonResponse(rpcResult(id, { tools: TOOLS }), 200, env);
      if (method === "tools/call") {
        const result = await callTool(params?.name, params?.arguments ?? {}, env);
        const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        return jsonResponse(rpcResult(id, { content: [{ type: "text", text }] }), 200, env);
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
    description: "Save one memory to KV and maintain its search indexes.",
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
    name: "save_daily",
    description: "Save one dated journal entry for a generic owner identifier.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$", maxLength: LIMITS.owner },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        value: { type: "string", maxLength: LIMITS.value },
        note: { type: "string", maxLength: LIMITS.note },
        overwrite: { type: "boolean" },
      },
      required: ["owner", "date", "value"],
    },
  },
  {
    name: "get_memory",
    description: "Read one memory when its complete key is known.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string", maxLength: LIMITS.key } },
      required: ["key"],
    },
  },
  {
    name: "find_memory_keys",
    description: "Find a small, filtered set of keys. Unfiltered enumeration is rejected.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: LIMITS.query },
        prefix: { type: "string", maxLength: LIMITS.key },
        category: { type: "string", maxLength: 40 },
        owner: { type: "string", maxLength: LIMITS.owner },
        scope: { type: "string", enum: ["active", "cold"] },
        limit: { type: "integer", minimum: 1, maximum: LIMITS.findKeys },
      },
    },
  },
  {
    name: "get_recent_dailies",
    description: "Read a bounded number of recent journal dates.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Use an owner identifier or all." },
        days: { type: "integer", minimum: 1, maximum: LIMITS.recentDays },
      },
    },
  },
  {
    name: "search_memories",
    description: "Combine exact phrase and semantic retrieval, returning at most five chunks.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: LIMITS.query },
        category: { type: "string", maxLength: 40 },
        owner: { type: "string", maxLength: LIMITS.owner },
        dateFrom: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        dateTo: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      },
      required: ["query"],
    },
  },
  {
    name: "delete_memory",
    description: "Permanently delete one key only when confirmKey exactly matches key.",
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
  switch (name) {
    case "save_memory": return saveMemory(args, env);
    case "save_daily": return saveDaily(args, env);
    case "get_memory": return getMemory(args, env);
    case "find_memory_keys": return findMemoryKeys(args, env);
    case "get_recent_dailies": return getRecentDailies(args, env);
    case "search_memories": return searchMemories(args, env);
    case "delete_memory": return deleteMemory(args, env);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

async function saveMemory({ key, value }, env) {
  validateKeyValue(key, value);
  await env.MEMORY.put(key, value);
  try {
    const indexResult = await indexMemory(key, value, env);
    return { key, kv: "ok", ...indexResult };
  } catch (error) {
    await markIndexPending(env.DB, key, classifyKey(key), safeError(error));
    return { key, kv: "ok", index: "pending", error: safeError(error) };
  }
}

async function saveDaily({ owner, date, value, note, overwrite = false }, env) {
  const safeOwner = normalizeOwner(owner);
  if (!isIsoDate(date)) throw new Error("date must be YYYY-MM-DD");
  validateKeyValue(`${safeOwner}_daily_${date}`, value);
  const prefix = `${safeOwner}_daily_${date}`;
  const existing = await listAllKeys(env.MEMORY, { prefix });
  const conflicts = existing.filter((key) => key === prefix || key.startsWith(`${prefix}_`));
  if (conflicts.length && !overwrite) throw new Error("an entry already exists for this owner and date");

  const cleanNote = normalizeDailyNote(note);
  const key = cleanNote ? `${prefix}_${cleanNote}` : prefix;
  const result = await saveMemory({ key, value }, env);
  if (overwrite && result.index === "ok") {
    for (const oldKey of conflicts) {
      if (oldKey !== key) await removeMemoryEverywhere(oldKey, env, true);
    }
  }
  return {
    ...result,
    retainedConflicts: result.index === "ok" ? [] : conflicts.filter((oldKey) => oldKey !== key),
  };
}

async function getMemory({ key }, env) {
  validateKeyValue(key, "");
  const value = await env.MEMORY.get(key);
  return value === null ? `Not found: ${key}` : value;
}

async function findMemoryKeys(args, env) {
  const { query, prefix, category, owner, scope = "active" } = args;
  if (!["active", "cold"].includes(scope)) throw new Error("scope must be active or cold");
  if (![query, prefix, category, owner].some((value) => typeof value === "string" && value.trim())) {
    throw new Error("query, prefix, category, or owner is required; unfiltered listing is disabled");
  }
  if (query) normalizeQuery(query);
  if (prefix && prefix.length > LIMITS.key) throw new Error(`prefix must not exceed ${LIMITS.key} characters`);
  const limit = clampInt(args.limit, 10, 1, LIMITS.findKeys);
  const keys = await listAllKeys(env.MEMORY, { prefix: prefix?.trim() || undefined });
  const needle = query?.trim().toLocaleLowerCase("zh-CN");
  const results = [];
  for (const key of keys) {
    const meta = classifyKey(key);
    if (scope === "active" && !meta.index) continue;
    if (scope === "cold" && meta.index) continue;
    if (needle && !key.toLocaleLowerCase("zh-CN").includes(needle)) continue;
    if (category && meta.category !== category) continue;
    if (owner && meta.owner !== owner) continue;
    results.push({ key, category: meta.category, owner: meta.owner, date: meta.date });
    if (results.length >= limit) break;
  }
  return { count: results.length, results };
}

async function getRecentDailies(args, env) {
  const owner = args.owner || "all";
  if (owner !== "all") normalizeOwner(owner);
  const days = clampInt(args.days, 3, 1, LIMITS.recentDays);
  const keys = await listAllKeys(env.MEMORY);
  const matches = keys
    .map((key) => ({ key, meta: classifyKey(key) }))
    .filter(({ meta }) => meta.category === "daily" && (owner === "all" || meta.owner === owner))
    .sort((left, right) => right.meta.date.localeCompare(left.meta.date) || left.key.localeCompare(right.key));
  const selectedDates = [...new Set(matches.map(({ meta }) => meta.date))].slice(0, days);
  const selected = matches.filter(({ meta }) => selectedDates.includes(meta.date));
  const results = await Promise.all(selected.map(async ({ key, meta }) => ({
    key,
    owner: meta.owner,
    date: meta.date,
    value: await env.MEMORY.get(key),
  })));
  results.sort((left, right) => left.date.localeCompare(right.date) || left.owner.localeCompare(right.owner));
  return { days: selectedDates.length, count: results.length, results };
}

async function searchMemories(args, env) {
  const query = normalizeQuery(args.query);
  const filters = normalizeSearchFilters(args);
  const [exactRows, vectors] = await Promise.all([
    exactSearch(env.DB, query, filters, 30),
    getEmbeddings([buildQueryText(query)], env),
  ]);

  const vectorOptions = { topK: VECTOR_CANDIDATES, returnMetadata: "all" };
  const vectorFilter = buildVectorFilter(filters);
  if (Object.keys(vectorFilter).length) vectorOptions.filter = vectorFilter;
  const vectorResult = await env.VECTORIZE_INDEX.query(vectors[0], vectorOptions);
  const matches = vectorResult.matches || [];
  const validRows = await loadIndexedChunksByIds(env.DB, matches.map((match) => match.id));
  const matchById = new Map(matches.map((match) => [match.id, match]));

  const candidates = new Map();
  for (const row of validRows) {
    const match = matchById.get(row.vector_id);
    if (match) candidates.set(row.vector_id, scoreCandidate(row, query, Number(match.score) || 0, false));
  }
  for (const row of exactRows) {
    const semanticScore = candidates.get(row.vector_id)?.semanticScore || 0;
    candidates.set(row.vector_id, scoreCandidate(row, query, semanticScore, true));
  }

  const perKey = new Map();
  const results = [];
  for (const item of [...candidates.values()].sort((left, right) => right.score - left.score)) {
    const count = perKey.get(item.key) || 0;
    if (count >= MAX_RESULTS_PER_KEY) continue;
    perKey.set(item.key, count + 1);
    results.push(item);
    if (results.length >= FINAL_TOP_K) break;
  }
  return { query, count: results.length, results };
}

async function deleteMemory({ key, confirmKey }, env) {
  validateKeyValue(key, "");
  if (confirmKey !== key) throw new Error("confirmKey must exactly match key");
  await removeMemoryEverywhere(key, env, true);
  return { key, deleted: true };
}

async function indexMemory(key, value, env) {
  const meta = classifyKey(key);
  const contentHash = await sha256Hex(value);
  if (!meta.index) {
    await purgeIndexForKey(key, env);
    await writeIndexState(env.DB, key, meta, contentHash, [], "skipped", null);
    return { index: "skipped", reason: meta.category, chunks: 0 };
  }

  const chunks = splitText(value);
  if (!chunks.length) {
    await purgeIndexForKey(key, env);
    await writeIndexState(env.DB, key, meta, contentHash, [], "skipped", "empty_content");
    return { index: "skipped", reason: "empty_content", chunks: 0 };
  }

  const ids = await Promise.all(chunks.map((_, index) => vectorIdFor(key, index)));
  const embeddings = await getEmbeddings(chunks.map((chunk) => buildEmbeddingText(key, meta, chunk)), env);
  if (embeddings.length !== chunks.length) throw new Error("embedding count does not match chunk count");
  const vectors = chunks.map((chunk, index) => ({
    id: ids[index],
    values: embeddings[index],
    metadata: {
      key,
      i: index,
      cat: meta.category,
      owner: meta.owner,
      date: meta.date || "",
      ver: INDEX_VERSION,
      preview: chunk.slice(0, 500),
    },
  }));
  await env.VECTORIZE_INDEX.upsert(vectors);
  const oldIds = await readVectorIds(env.DB, key);
  await replaceD1Chunks(env.DB, key, meta, contentHash, ids, chunks);
  const staleIds = oldIds.filter((id) => !ids.includes(id));
  if (staleIds.length) await env.VECTORIZE_INDEX.deleteByIds(staleIds);
  return { index: "ok", chunks: chunks.length, model: EMBEDDING_MODEL, contentHash };
}

async function handleAdmin(request, env, url) {
  if (!isAuthorized(request, env.ADMIN_TOKEN)) return new Response("Unauthorized", { status: 401 });
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, env);
  }
  try {
    if (url.pathname === "/admin/keys") {
      const limit = clampInt(body.limit, 100, 1, LIMITS.adminPage);
      const prefix = typeof body.prefix === "string" && body.prefix ? body.prefix : undefined;
      const page = await env.MEMORY.list({ cursor: body.cursor || undefined, prefix, limit });
      return jsonResponse({
        keys: page.keys.map(({ name }) => ({ key: name, ...classifyKey(name) })),
        listComplete: page.list_complete,
        cursor: page.list_complete ? null : page.cursor,
      }, 200, env);
    }
    if (url.pathname === "/admin/reindex-key") {
      const key = String(body.key || "");
      validateKeyValue(key, "");
      const value = await env.MEMORY.get(key);
      if (value === null) throw new Error("key does not exist in KV");
      return jsonResponse({ key, ...(await indexMemory(key, value, env)) }, 200, env);
    }
    if (url.pathname === "/admin/index-status") {
      const result = await env.DB.prepare(
        "SELECT status, COUNT(*) AS count FROM memory_index_state GROUP BY status ORDER BY status",
      ).all();
      return jsonResponse({ indexVersion: INDEX_VERSION, rows: result.results || [] }, 200, env);
    }
    return new Response("Not Found", { status: 404 });
  } catch (error) {
    return jsonResponse({ error: safeError(error) }, 500, env);
  }
}

async function purgeIndexForKey(key, env) {
  const ids = await readVectorIds(env.DB, key);
  if (ids.length) await env.VECTORIZE_INDEX.deleteByIds(ids);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM memory_chunks WHERE memory_key = ?").bind(key),
    env.DB.prepare("DELETE FROM memory_index_state WHERE memory_key = ?").bind(key),
  ]);
}

async function removeMemoryEverywhere(key, env, deleteKv) {
  await purgeIndexForKey(key, env);
  if (deleteKv) await env.MEMORY.delete(key);
}

async function replaceD1Chunks(db, key, meta, contentHash, ids, chunks) {
  const statements = [db.prepare("DELETE FROM memory_chunks WHERE memory_key = ?").bind(key)];
  for (let index = 0; index < chunks.length; index += 1) {
    statements.push(db.prepare(
      `INSERT INTO memory_chunks
       (vector_id, memory_key, chunk_index, chunk_text, category, owner, memory_date, content_hash, index_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(ids[index], key, index, chunks[index], meta.category, meta.owner, meta.date, contentHash, INDEX_VERSION));
  }
  statements.push(db.prepare(
    `INSERT INTO memory_index_state
     (memory_key, category, owner, memory_date, content_hash, vector_ids_json, chunk_count, index_version, status, error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ok', NULL, CURRENT_TIMESTAMP)
     ON CONFLICT(memory_key) DO UPDATE SET
       category=excluded.category, owner=excluded.owner, memory_date=excluded.memory_date,
       content_hash=excluded.content_hash, vector_ids_json=excluded.vector_ids_json,
       chunk_count=excluded.chunk_count, index_version=excluded.index_version,
       status='ok', error=NULL, updated_at=CURRENT_TIMESTAMP`,
  ).bind(key, meta.category, meta.owner, meta.date, contentHash, JSON.stringify(ids), ids.length, INDEX_VERSION));
  await db.batch(statements);
}

async function writeIndexState(db, key, meta, contentHash, ids, status, error) {
  await db.prepare(
    `INSERT INTO memory_index_state
     (memory_key, category, owner, memory_date, content_hash, vector_ids_json, chunk_count, index_version, status, error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(memory_key) DO UPDATE SET
       category=excluded.category, owner=excluded.owner, memory_date=excluded.memory_date,
       content_hash=excluded.content_hash, vector_ids_json=excluded.vector_ids_json,
       chunk_count=excluded.chunk_count, index_version=excluded.index_version,
       status=excluded.status, error=excluded.error, updated_at=CURRENT_TIMESTAMP`,
  ).bind(key, meta.category, meta.owner, meta.date, contentHash, JSON.stringify(ids), ids.length, INDEX_VERSION, status, error).run();
}

async function markIndexPending(db, key, meta, error) {
  await db.prepare(
    `INSERT INTO memory_index_state
     (memory_key, category, owner, memory_date, vector_ids_json, chunk_count, index_version, status, error, updated_at)
     VALUES (?, ?, ?, ?, '[]', 0, ?, 'pending', ?, CURRENT_TIMESTAMP)
     ON CONFLICT(memory_key) DO UPDATE SET
       category=excluded.category, owner=excluded.owner, memory_date=excluded.memory_date,
       status='pending', error=excluded.error, updated_at=CURRENT_TIMESTAMP`,
  ).bind(key, meta.category, meta.owner, meta.date, INDEX_VERSION, error).run();
}

async function readVectorIds(db, key) {
  const row = await db.prepare(
    "SELECT vector_ids_json FROM memory_index_state WHERE memory_key = ?",
  ).bind(key).first();
  if (!row?.vector_ids_json) return [];
  try {
    const ids = JSON.parse(row.vector_ids_json);
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

async function exactSearch(db, query, filters, limit) {
  const where = ["instr(lower(chunk_text), lower(?)) > 0"];
  const binds = [query];
  addSqlFilters(where, binds, filters);
  const sql = `SELECT vector_id, memory_key, chunk_index, chunk_text, category, owner, memory_date
               FROM memory_chunks WHERE ${where.join(" AND ")} LIMIT ?`;
  const result = await db.prepare(sql).bind(...binds, limit).all();
  return result.results || [];
}

async function loadIndexedChunksByIds(db, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const result = await db.prepare(
    `SELECT vector_id, memory_key, chunk_index, chunk_text, category, owner, memory_date
     FROM memory_chunks WHERE vector_id IN (${placeholders})`,
  ).bind(...ids).all();
  return result.results || [];
}

function addSqlFilters(where, binds, filters) {
  if (filters.category) { where.push("category = ?"); binds.push(filters.category); }
  if (filters.owner) { where.push("owner = ?"); binds.push(filters.owner); }
  if (filters.dateFrom) { where.push("memory_date >= ?"); binds.push(filters.dateFrom); }
  if (filters.dateTo) { where.push("memory_date <= ?"); binds.push(filters.dateTo); }
}

function buildVectorFilter(filters) {
  const filter = {};
  if (filters.category) filter.cat = filters.category;
  if (filters.owner) filter.owner = filters.owner;
  if (filters.dateFrom || filters.dateTo) {
    filter.date = {};
    if (filters.dateFrom) filter.date.$gte = filters.dateFrom;
    if (filters.dateTo) filter.date.$lte = filters.dateTo;
  }
  return filter;
}

async function listAllKeys(kv, options = {}) {
  const keys = [];
  let cursor;
  do {
    const page = await kv.list({ cursor, limit: 1_000, prefix: options.prefix });
    keys.push(...page.keys.map(({ name }) => name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

function buildEmbeddingText(key, meta, chunk) {
  return [
    `Key: ${key}`,
    `Category: ${meta.category}`,
    `Owner: ${meta.owner}`,
    meta.date ? `Date: ${meta.date}` : "",
    "",
    chunk,
  ].filter((line) => line !== "").join("\n");
}

function buildQueryText(query) {
  return `为中文个人记忆库检索相关片段。查询：${query}`;
}

async function getEmbeddings(texts, env) {
  const result = await env.AI.run(EMBEDDING_MODEL, { text: texts });
  const data = result?.data || result?.result?.data;
  if (!Array.isArray(data)) throw new Error("unrecognized embedding response");
  if (Array.isArray(data[0])) return data;
  if (data[0]?.embedding) return data.map((item) => item.embedding);
  throw new Error("embedding response contains no vectors");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

function memoryToken(env) {
  return env.MEMORY_TOKEN || env.AUTH_TOKEN;
}

function urlToken(env) {
  return env.MEMORY_TOKEN || env.MCP_URL_TOKEN;
}

function landingPage() {
  return new Response([
    "personal-ai-memory V8 is running.",
    "",
    "MCP endpoint: /mcp (Bearer) or /mcp/<MEMORY_TOKEN> (URL-only clients).",
    "Keep MEMORY_TOKEN and ADMIN_TOKEN secret. This page never displays them.",
  ].join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

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

function corsResponse(env) {
  return new Response(null, { status: 204, headers: corsHeaders(env) });
}

function sseInit(env) {
  const payload = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  return new Response(`data: ${payload}\n\n`, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      ...corsHeaders(env),
    },
  });
}
