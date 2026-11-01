import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import worker from "../src/worker.js";

const adminToken = "a".repeat(43);
const legacyToken = "l".repeat(43);

class D1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }
  bind(...values) { return new D1Statement(this.database, this.sql, values); }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async first(column) {
    const row = this.database.prepare(this.sql).get(...this.values);
    return column && row ? row[column] : row;
  }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: result.changes } };
  }
}

class D1Database {
  constructor(database) { this.database = database; }
  prepare(sql) { return new D1Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

class MemoryKv {
  constructor() { this.values = new Map(); this.getCalls = 0; }
  async get(key) { this.getCalls += 1; return this.values.has(key) ? this.values.get(key) : null; }
  async put(key, value) { this.values.set(key, value); }
  async delete(key) { this.values.delete(key); }
  async list({ cursor, prefix, limit = 1_000 } = {}) {
    const all = [...this.values.keys()].filter((key) => !prefix || key.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const keys = all.slice(start, start + limit).map((name) => ({ name }));
    const next = start + keys.length;
    return { keys, list_complete: next >= all.length, cursor: next >= all.length ? undefined : String(next) };
  }
}

class VectorIndex {
  constructor() { this.vectors = new Map(); this.failQuery = false; this.failUpsert = false; }
  async upsert(vectors) {
    if (this.failUpsert) throw new Error("synthetic upsert failure");
    for (const vector of vectors) this.vectors.set(vector.id, vector);
  }
  async deleteByIds(ids) { for (const id of ids) this.vectors.delete(id); }
  async query(_embedding, options) {
    if (this.failQuery) throw new Error("synthetic semantic failure");
    const matches = [...this.vectors.values()].filter(({ metadata }) => matchesFilter(metadata, options.filter));
    return { matches: matches.slice(0, options.topK).map(({ id }) => ({ id, score: 0.75 })) };
  }
}

function matchesFilter(metadata, filter = {}) {
  for (const [key, expected] of Object.entries(filter)) {
    const actual = metadata[key];
    if (expected && typeof expected === "object") {
      if (expected.$in && !expected.$in.includes(actual)) return false;
      if (expected.$gte && actual < expected.$gte) return false;
      if (expected.$lte && actual > expected.$lte) return false;
    } else if (actual !== expected) return false;
  }
  return true;
}

async function makeSystem({ infra = false } = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(await readFile(new URL("../migrations/0001_schema.sql", import.meta.url), "utf8"));
  database.exec(await readFile(new URL("../migrations/0002_v9_access_spaces.sql", import.meta.url), "utf8"));
  if (infra) {
    database.exec(await readFile(new URL("../migrations/0003_v9_infra.sql", import.meta.url), "utf8"));
    database.exec(await readFile(new URL("../migrations/0004_v9_memory_rename.sql", import.meta.url), "utf8"));
  }
  const env = {
    MEMORY_TOKEN: legacyToken,
    ADMIN_TOKEN: adminToken,
    V9_AUTH_MODE: "shadow",
    V9_RECALL_ENABLED: "true",
    V9_INFRA_ENABLED: infra ? "true" : "false",
    MEMORY: new MemoryKv(),
    DB: new D1Database(database),
    AI: { async run(_model, { text }) { return { data: text.map(() => [0.25, 0.5]) }; } },
    VECTORIZE_INDEX: new VectorIndex(),
  };
  return { database, env };
}

async function admin(env, path, body = {}) {
  const response = await worker.fetch(new Request(`https://example.invalid${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), env);
  const payload = await response.json();
  return { response, payload };
}

async function rpc(env, token, method, params = {}) {
  const response = await worker.fetch(new Request("https://example.invalid/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }), env);
  if (response.status !== 200) return { status: response.status };
  return response.json();
}

async function tool(env, token, name, args = {}) {
  const payload = await rpc(env, token, "tools/call", { name, arguments: args });
  if (payload.error) return payload;
  const text = payload.result.content[0].text;
  try { return JSON.parse(text); } catch { return text; }
}

async function createSpace(env, spaceKey) {
  const { payload } = await admin(env, "/admin/v9/spaces/create", {
    spaceKey,
    confirmSpaceKey: spaceKey,
    spaceType: "private",
    displayName: `Space ${spaceKey}`,
  });
  return payload;
}

async function createClient(env, name, spaceKey, capabilities = ["read", "recall", "write", "delete"], expiresAt) {
  const { payload: created } = await admin(env, "/admin/v9/clients/create", {
    clientName: name, expiresAt, confirmCreate: true,
  });
  for (const capability of capabilities) {
    const { response } = await admin(env, "/admin/v9/grants/create", {
      clientId: created.clientId,
      spaceKey,
      capability,
      confirmGrant: `${created.clientId}:${spaceKey}:${capability}`,
    });
    assert.equal(response.status, 200);
  }
  return created;
}

test("V9 migration is additive and preserves V8 rows", async () => {
  const database = new DatabaseSync(":memory:");
  const v8 = await readFile(new URL("../migrations/0001_schema.sql", import.meta.url), "utf8");
  const v9 = await readFile(new URL("../migrations/0002_v9_access_spaces.sql", import.meta.url), "utf8");
  assert.doesNotMatch(v9, /^\s*(?:DROP|DELETE)\b/im);
  database.exec(v8);
  database.prepare(
    `INSERT INTO memory_index_state
     (memory_key, category, owner, vector_ids_json, index_version, status) VALUES (?, ?, ?, '[]', ?, 'ok')`,
  ).run("project_sample", "project", "none", "v8-public-qwen3-embedding-0.6b");
  database.exec(v9);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM memory_index_state").get().count, 1);
  assert.ok(database.prepare("SELECT space_id FROM memory_index_state WHERE memory_key = ?").get("project_sample"));
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM memory_spaces").get().count, 3);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
});

test("V9 infrastructure migration is additive and preserves earlier rows", async () => {
  const database = new DatabaseSync(":memory:");
  const migrations = await Promise.all([
    "0001_schema.sql", "0002_v9_access_spaces.sql", "0003_v9_infra.sql",
  ].map((name) => readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8")));
  database.exec(migrations[0]);
  database.exec(migrations[1]);
  database.prepare(
    `INSERT INTO memory_index_state
     (memory_key, category, owner, vector_ids_json, index_version, status, space_id)
     VALUES (?, ?, ?, '[]', ?, 'ok', ?)`,
  ).run("project_preserved", "project", "none", "v8-public-qwen3-embedding-0.6b", "legacy-unclassified");
  assert.doesNotMatch(migrations[2], /^\s*(?:DROP|DELETE)\b/im);
  database.exec(migrations[2]);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM memory_index_state").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM api_client_policies").get().count, 0);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
});

test("V9 rename migration is additive, fail-closed, and preserves infrastructure rows", async () => {
  const database = new DatabaseSync(":memory:");
  for (const name of ["0001_schema.sql", "0002_v9_access_spaces.sql", "0003_v9_infra.sql"]) {
    database.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  database.prepare(
    "INSERT INTO memory_spaces (space_id, space_key, space_type, display_name) VALUES (?, ?, ?, ?)",
  ).run("space-synthetic", "private:synthetic", "private", "Synthetic");
  const migration = await readFile(new URL("../migrations/0004_v9_memory_rename.sql", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /^\s*(?:DROP|DELETE)\b/im);
  database.exec(migration);
  assert.equal(database.prepare("SELECT protected_keys_ready FROM memory_rename_policy_state").get().protected_keys_ready, 0);
  assert.ok(database.prepare("SELECT space_id FROM memory_spaces WHERE space_id=?").get("space-synthetic"));
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
});

test("admin creates one-time tokens, stores only hashes, and requires confirmations", async () => {
  const { database, env } = await makeSystem();
  await createSpace(env, "private:alpha");
  const created = await createClient(env, "Alpha client", "private:alpha", ["read"]);
  assert.equal(created.tokenShownOnce, true);
  assert.equal(created.token.length, 64);
  const stored = database.prepare("SELECT token_hash FROM api_clients WHERE client_id = ?").get(created.clientId);
  assert.notEqual(stored.token_hash, created.token);
  assert.equal(stored.token_hash.length, 64);
  const listed = (await admin(env, "/admin/v9/clients/list")).payload;
  assert.equal(JSON.stringify(listed).includes(created.token), false);
  assert.equal(JSON.stringify(listed).includes("token_hash"), false);

  const rejected = await admin(env, "/admin/v9/clients/revoke", { clientId: created.clientId, confirmClientId: "wrong" });
  assert.equal(rejected.response.status, 500);
  const revoked = await admin(env, "/admin/v9/clients/revoke", {
    clientId: created.clientId,
    confirmClientId: created.clientId,
  });
  assert.equal(revoked.payload.revoked, true);
  assert.equal((await rpc(env, created.token, "initialize")).status, 401);

  const expiredAt = new Date(Date.now() - 60_000).toISOString();
  const expired = await createClient(env, "Expired", "private:alpha", ["read"], expiredAt);
  assert.equal((await rpc(env, expired.token, "initialize")).status, 401);
  assert.equal((await rpc(env, "x".repeat(64), "initialize")).status, 401);

  const { payload: grantExpired } = await admin(env, "/admin/v9/clients/create", {
    clientName: "Grant expired", confirmCreate: true,
  });
  await admin(env, "/admin/v9/grants/create", {
    clientId: grantExpired.clientId,
    spaceKey: "private:alpha",
    capability: "read",
    expiresAt: expiredAt,
    confirmGrant: `${grantExpired.clientId}:private:alpha:read`,
  });
  assert.deepEqual((await rpc(env, grantExpired.token, "tools/list")).result.tools, []);

  const urlResponse = await worker.fetch(new Request(`https://example.invalid/mcp/${legacyToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  }), env);
  const urlPayload = await urlResponse.json();
  assert.deepEqual(urlPayload.result.tools.map(({ name }) => name), [
    "save_memory", "save_daily", "get_memory", "find_memory_keys", "get_recent_dailies", "search_memories", "delete_memory",
  ]);
});

test("space authorization protects exact keys, tools, search, write, and delete", async () => {
  const { env } = await makeSystem();
  await createSpace(env, "private:alpha");
  await createSpace(env, "private:beta");
  const alpha = await createClient(env, "Alpha", "private:alpha");
  const beta = await createClient(env, "Beta", "private:beta");
  const reader = await createClient(env, "Reader", "private:alpha", ["read"]);

  const alphaTools = await rpc(env, alpha.token, "tools/list");
  const saveSchema = alphaTools.result.tools.find(({ name }) => name === "save_memory").inputSchema;
  assert.ok(saveSchema.required.includes("spaceKey"));
  const missingSpace = await tool(env, alpha.token, "save_memory", { key: "project_missing_space", value: "synthetic" });
  assert.match(missingSpace.error.message, /spaceKey/);

  const saved = await tool(env, alpha.token, "save_memory", {
    key: "project_alpha", value: "alpha synthetic milestone", spaceKey: "private:alpha",
  });
  assert.equal(saved.index, "ok");
  assert.match(await tool(env, alpha.token, "get_memory", { key: "project_alpha" }), /alpha synthetic/);
  assert.match((await tool(env, beta.token, "get_memory", { key: "project_alpha" })).error.message, /not authorized/);
  assert.match((await tool(env, beta.token, "delete_memory", {
    key: "project_alpha", confirmKey: "project_alpha",
  })).error.message, /not authorized/);
  assert.match((await tool(env, beta.token, "save_memory", {
    key: "project_alpha", value: "overwrite", spaceKey: "private:beta",
  })).error.message, /cannot be moved/);

  const alphaSearch = await tool(env, alpha.token, "search_memories", { query: "alpha synthetic" });
  assert.equal(alphaSearch.count, 1);
  const betaSearch = await tool(env, beta.token, "search_memories", { query: "alpha synthetic" });
  assert.equal(betaSearch.count, 0);

  const readerTools = await rpc(env, reader.token, "tools/list");
  assert.deepEqual(readerTools.result.tools.map(({ name }) => name).sort(), ["find_memory_keys", "get_memory", "get_recent_dailies"]);
  const hiddenCall = await tool(env, reader.token, "recall_memory", { query: "alpha" });
  assert.match(hiddenCall.error.message, /not authorized/);

  const legacyTools = await rpc(env, legacyToken, "tools/list");
  assert.deepEqual(legacyTools.result.tools.map(({ name }) => name), [
    "save_memory", "save_daily", "get_memory", "find_memory_keys", "get_recent_dailies", "search_memories", "delete_memory",
  ]);
  assert.match(await tool(env, legacyToken, "get_memory", { key: "project_alpha" }), /alpha synthetic/);
  await tool(env, legacyToken, "save_memory", { key: "project_alpha", value: "alpha legacy-compatible update" });
  const afterLegacyWrite = await tool(env, alpha.token, "search_memories", { query: "legacy-compatible" });
  assert.equal(afterLegacyWrite.count, 1);
});

test("foreign daily entries with distinct generated keys do not block the target space", async () => {
  const { env } = await makeSystem();
  await createSpace(env, "private:alpha");
  await createSpace(env, "private:beta");
  const alpha = await createClient(env, "Alpha", "private:alpha", ["write", "read"]);
  const beta = await createClient(env, "Beta", "private:beta", ["write", "read"]);
  const first = await tool(env, alpha.token, "save_daily", {
    owner: "sample", date: "2026-10-04", note: "alpha", value: "alpha daily", spaceKey: "private:alpha",
  });
  const second = await tool(env, beta.token, "save_daily", {
    owner: "sample", date: "2026-10-04", note: "beta", value: "beta daily", spaceKey: "private:beta",
  });
  assert.equal(first.index, "ok");
  assert.equal(second.index, "ok");
  assert.equal((await tool(env, alpha.token, "get_recent_dailies", { owner: "sample", days: 1 })).count, 1);
  assert.equal((await tool(env, beta.token, "get_recent_dailies", { owner: "sample", days: 1 })).count, 1);
});

test("identical generated daily keys remain global and fail closed across spaces", async () => {
  const { env } = await makeSystem();
  await createSpace(env, "private:alpha");
  await createSpace(env, "private:beta");
  const alpha = await createClient(env, "Alpha", "private:alpha", ["write"]);
  const beta = await createClient(env, "Beta", "private:beta", ["write"]);
  await tool(env, alpha.token, "save_daily", {
    owner: "sample", date: "2026-10-04", value: "alpha daily", spaceKey: "private:alpha",
  });
  const collision = await tool(env, beta.token, "save_daily", {
    owner: "sample", date: "2026-10-04", value: "must not overwrite", spaceKey: "private:beta",
  });
  assert.match(collision.error.message, /cannot be moved/);
  assert.equal(await env.MEMORY.get("sample_daily_2026-10-04"), "alpha daily");
});

test("concurrent new-key claims cannot move the authoritative space mapping", async () => {
  const { database, env } = await makeSystem();
  await createSpace(env, "private:alpha");
  await createSpace(env, "private:beta");
  const alpha = await createClient(env, "Alpha", "private:alpha", ["write"]);
  const betaSpaceId = database.prepare(
    "SELECT space_id FROM memory_spaces WHERE space_key = 'private:beta'",
  ).get().space_id;
  const delegate = env.DB;
  let injected = false;
  env.DB = {
    prepare(sql) {
      const statement = delegate.prepare(sql);
      if (!/FROM memory_key_spaces mks JOIN memory_spaces/i.test(sql)) return statement;
      return {
        bind(...values) {
          const bound = statement.bind(...values);
          return {
            all: () => bound.all(),
            run: () => bound.run(),
            async first(column) {
              const result = await bound.first(column);
              if (!injected && values[0] === "project_race" && !result) {
                injected = true;
                await delegate.prepare(
                  "INSERT INTO memory_key_spaces (memory_key, space_id, assignment_source) VALUES (?, ?, 'explicit')",
                ).bind("project_race", betaSpaceId).run();
              }
              return result;
            },
          };
        },
      };
    },
    batch(statements) { return delegate.batch(statements); },
  };
  const raced = await tool(env, alpha.token, "save_memory", {
    key: "project_race", value: "must not be written", spaceKey: "private:alpha",
  });
  assert.match(raced.error.message, /cannot be moved/);
  assert.equal(await env.MEMORY.get("project_race"), null);
  assert.equal(database.prepare(
    "SELECT space_id FROM memory_key_spaces WHERE memory_key = 'project_race'",
  ).get().space_id, betaSpaceId);
});

test("failed KV creation remains fail-closed and is recoverable by explicit admin transfer", async () => {
  const { database, env } = await makeSystem();
  await createSpace(env, "private:alpha");
  await createSpace(env, "private:beta");
  const alpha = await createClient(env, "Alpha", "private:alpha", ["write"]);
  const originalPut = env.MEMORY.put.bind(env.MEMORY);
  env.MEMORY.put = async () => { throw new Error("synthetic KV failure"); };
  const failed = await tool(env, alpha.token, "save_memory", {
    key: "project_failed_claim", value: "not stored", spaceKey: "private:alpha",
  });
  assert.match(failed.error.message, /synthetic KV failure/);
  assert.equal(await env.MEMORY.get("project_failed_claim"), null);
  assert.equal(database.prepare(
    `SELECT s.space_key FROM memory_key_spaces mks
     JOIN memory_spaces s ON s.space_id = mks.space_id
     WHERE mks.memory_key = 'project_failed_claim'`,
  ).get().space_key, "private:alpha");
  const moved = await admin(env, "/admin/v9/key-space/assign", {
    key: "project_failed_claim",
    confirmKey: "project_failed_claim",
    spaceKey: "private:beta",
    confirmFromSpaceKey: "private:alpha",
  });
  assert.equal(moved.response.status, 200);
  assert.equal(moved.payload.spaceKey, "private:beta");
  env.MEMORY.put = originalPut;
});

test("recall events bind client and space, feedback is idempotent, and stale versions are reported", async () => {
  const { database, env } = await makeSystem();
  await createSpace(env, "private:alpha");
  await createSpace(env, "private:beta");
  const alpha = await createClient(env, "Alpha", "private:alpha");
  const beta = await createClient(env, "Beta", "private:beta");
  await tool(env, alpha.token, "save_memory", {
    key: "project_alpha", value: "alpha recall candidate", spaceKey: "private:alpha",
  });
  const recalled = await tool(env, alpha.token, "recall_memory", { query: "alpha recall" });
  assert.equal(recalled.outcome, "match");
  assert.equal(recalled.tracking, "ok");
  assert.ok(recalled.candidates[0].eventId);
  const event = database.prepare("SELECT client_id, space_id FROM recall_events WHERE event_id = ?").get(recalled.candidates[0].eventId);
  assert.equal(event.client_id, alpha.clientId);

  const denied = await tool(env, beta.token, "report_recall_feedback", {
    eventId: recalled.candidates[0].eventId, signal: "presented", evidence: "model_reported",
  });
  assert.match(denied.error.message, /not returned to this client/);
  const first = await tool(env, alpha.token, "report_recall_feedback", {
    eventId: recalled.candidates[0].eventId, signal: "presented", evidence: "model_reported",
  });
  const retry = await tool(env, alpha.token, "report_recall_feedback", {
    eventId: recalled.candidates[0].eventId, signal: "presented", evidence: "model_reported",
  });
  assert.equal(first.created, true);
  assert.equal(retry.created, false);

  await tool(env, alpha.token, "save_memory", {
    key: "project_alpha", value: "alpha changed fragment version", spaceKey: "private:alpha",
  });
  const stale = await tool(env, alpha.token, "report_recall_feedback", {
    eventId: recalled.candidates[0].eventId, signal: "wrong", evidence: "user_explicit",
  });
  assert.equal(stale.stale, true);
  assert.equal(stale.rankingChanged, false);
});

test("recall returns at most two complete V8 chunks without reading KV source text", async () => {
  const { database, env } = await makeSystem();
  await createSpace(env, "private:alpha");
  const alpha = await createClient(env, "Alpha", "private:alpha");
  const fullValues = [];
  for (let index = 0; index < 3; index += 1) {
    const value = `shared-query-${index}-${"甲乙丙丁".repeat(120)}-complete-ending-${index}`;
    fullValues.push(value);
    await tool(env, alpha.token, "save_memory", {
      key: `project_complete_${index}`,
      value,
      spaceKey: "private:alpha",
    });
  }
  env.MEMORY.getCalls = 0;
  const recalled = await tool(env, alpha.token, "recall_memory", { query: "shared-query", limit: 3 });
  assert.equal(recalled.count, 2);
  assert.equal(recalled.candidates.length, 2);
  assert.equal(env.MEMORY.getCalls, 0);
  for (const candidate of recalled.candidates) {
    const row = database.prepare(
      "SELECT chunk_text FROM memory_chunks WHERE memory_key = ? AND chunk_index = ?",
    ).get(candidate.key, candidate.chunkIndex);
    assert.equal(candidate.chunk, row.chunk_text);
    assert.ok(candidate.chunk.length > 320);
    assert.equal("excerpt" in candidate, false);
    assert.equal("truncated" in candidate, false);
  }
  assert.ok(recalled.candidates.every(({ chunk }) => fullValues.includes(chunk)));
});

test("recall degrades softly for tracking and distinguishes retrieval lane failures", async () => {
  const { database, env } = await makeSystem();
  await createSpace(env, "private:alpha");
  const alpha = await createClient(env, "Alpha", "private:alpha");
  await tool(env, alpha.token, "save_memory", {
    key: "project_alpha", value: "alpha lane candidate", spaceKey: "private:alpha",
  });
  await tool(env, alpha.token, "save_memory", {
    key: "project_alpha_second", value: "alpha lane second candidate", spaceKey: "private:alpha",
  });

  const originalDb = env.DB;
  env.DB = interceptDb(originalDb, (sql) => /INSERT INTO recall_events/i.test(sql), "synthetic tracking failure");
  const degraded = await tool(env, alpha.token, "recall_memory", { query: "alpha lane" });
  assert.equal(degraded.tracking, "degraded");
  assert.equal(degraded.candidates.length, 2);
  assert.ok(degraded.candidates.every(({ eventId }) => eventId === null));
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM recall_events").get().count, 0);
  env.DB = originalDb;

  env.DB = interceptDb(originalDb, (sql) => /FROM memory_chunks mc/i.test(sql) && /instr\(/i.test(sql), "synthetic exact failure");
  const exactFailed = await tool(env, alpha.token, "recall_memory", { query: "alpha lane" });
  assert.deepEqual(exactFailed.retrieval, { status: "partial", exact: "error", semantic: "ok" });
  env.DB = originalDb;

  env.VECTORIZE_INDEX.failQuery = true;
  const semanticFailed = await tool(env, alpha.token, "recall_memory", { query: "alpha lane" });
  assert.deepEqual(semanticFailed.retrieval, { status: "partial", exact: "ok", semantic: "error" });

  env.DB = interceptDb(originalDb, (sql) => /FROM memory_chunks mc/i.test(sql) && /instr\(/i.test(sql), "synthetic exact failure");
  const bothFailed = await tool(env, alpha.token, "recall_memory", { query: "alpha lane" });
  assert.deepEqual(bothFailed.retrieval, { status: "error", exact: "error", semantic: "error" });
  assert.equal(bothFailed.outcome, "error");
});

test("key mapping transfer is explicit and prefix mapping remains dry-run only", async () => {
  const { database, env } = await makeSystem();
  await createSpace(env, "private:alpha");
  await createSpace(env, "private:beta");
  const alpha = await createClient(env, "Alpha", "private:alpha");
  await tool(env, alpha.token, "save_memory", {
    key: "project_alpha", value: "alpha mapping", spaceKey: "private:alpha",
  });
  const rejected = await admin(env, "/admin/v9/key-space/assign", {
    key: "project_alpha", confirmKey: "project_alpha", spaceKey: "private:beta", confirmFromSpaceKey: "wrong",
  });
  assert.equal(rejected.response.status, 500);
  database.exec(`CREATE TRIGGER reject_index_space_transfer
    BEFORE UPDATE OF space_id ON memory_index_state
    BEGIN SELECT RAISE(ABORT, 'synthetic transfer failure'); END`);
  const failed = await admin(env, "/admin/v9/key-space/assign", {
    key: "project_alpha", confirmKey: "project_alpha", spaceKey: "private:beta", confirmFromSpaceKey: "private:alpha",
  });
  assert.equal(failed.response.status, 500);
  const alphaSpaceId = database.prepare(
    "SELECT space_id FROM memory_spaces WHERE space_key = 'private:alpha'",
  ).get().space_id;
  assert.equal(database.prepare(
    "SELECT space_id FROM memory_key_spaces WHERE memory_key = 'project_alpha'",
  ).get().space_id, alphaSpaceId);
  assert.equal(database.prepare(
    "SELECT DISTINCT space_id FROM memory_chunks WHERE memory_key = 'project_alpha'",
  ).get().space_id, alphaSpaceId);
  assert.equal(database.prepare(
    "SELECT space_id FROM memory_index_state WHERE memory_key = 'project_alpha'",
  ).get().space_id, alphaSpaceId);
  database.exec("DROP TRIGGER reject_index_space_transfer");
  const moved = await admin(env, "/admin/v9/key-space/assign", {
    key: "project_alpha", confirmKey: "project_alpha", spaceKey: "private:beta", confirmFromSpaceKey: "private:alpha",
  });
  assert.equal(moved.payload.reindexRequired, true);
  const dryRun = await admin(env, "/admin/v9/key-space/dry-run-prefix", { prefix: "project_", spaceKey: "private:beta" });
  assert.equal(dryRun.payload.materialized, false);
  assert.equal(dryRun.payload.count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM memory_key_spaces").get().count, 1);
});

test("isolated writes and deletes serialize against administrator space transfers", async () => {
  const { database, env } = await makeSystem();
  await createSpace(env, "private:alpha");
  await createSpace(env, "private:beta");
  const alpha = await createClient(env, "Alpha", "private:alpha");
  const originalPut = env.MEMORY.put.bind(env.MEMORY);
  let transferDuringWrite;
  env.MEMORY.put = async (key, value) => {
    transferDuringWrite = await admin(env, "/admin/v9/key-space/assign", {
      key,
      confirmKey: key,
      spaceKey: "private:beta",
      confirmFromSpaceKey: "private:alpha",
    });
    await originalPut(key, value);
  };
  const saved = await tool(env, alpha.token, "save_memory", {
    key: "project_locked_write", value: "serialized write", spaceKey: "private:alpha",
  });
  assert.equal(saved.index, "ok");
  assert.equal(transferDuringWrite.response.status, 500);
  assert.match(transferDuringWrite.payload.error, /operation is in progress/);
  assert.equal(database.prepare(
    `SELECT s.space_key FROM memory_key_spaces mks
     JOIN memory_spaces s ON s.space_id = mks.space_id
     WHERE mks.memory_key = 'project_locked_write'`,
  ).get().space_key, "private:alpha");

  env.MEMORY.put = originalPut;
  const originalDelete = env.MEMORY.delete.bind(env.MEMORY);
  let transferDuringDelete;
  env.MEMORY.delete = async (key) => {
    transferDuringDelete = await admin(env, "/admin/v9/key-space/assign", {
      key,
      confirmKey: key,
      spaceKey: "private:beta",
      confirmFromSpaceKey: "private:alpha",
    });
    await originalDelete(key);
  };
  const deleted = await tool(env, alpha.token, "delete_memory", {
    key: "project_locked_write", confirmKey: "project_locked_write",
  });
  assert.equal(deleted.deleted, true);
  assert.equal(transferDuringDelete.response.status, 500);
  assert.match(transferDuringDelete.payload.error, /operation is in progress/);
  assert.equal(database.prepare(
    "SELECT COUNT(*) AS count FROM memory_key_operation_locks",
  ).get().count, 0);
});

test("legacy writes and administrator reindex serialize with space transfers in shadow mode", async () => {
  const { env } = await makeSystem();
  await createSpace(env, "private:alpha");
  await createSpace(env, "private:beta");
  const alpha = await createClient(env, "Alpha", "private:alpha", ["write"]);
  await tool(env, alpha.token, "save_memory", {
    key: "project_shadow_lock", value: "initial", spaceKey: "private:alpha",
  });

  const originalPut = env.MEMORY.put.bind(env.MEMORY);
  let transferDuringLegacyWrite;
  env.MEMORY.put = async (key, value) => {
    transferDuringLegacyWrite = await admin(env, "/admin/v9/key-space/assign", {
      key, confirmKey: key, spaceKey: "private:beta", confirmFromSpaceKey: "private:alpha",
    });
    await originalPut(key, value);
  };
  await tool(env, legacyToken, "save_memory", { key: "project_shadow_lock", value: "legacy update" });
  assert.equal(transferDuringLegacyWrite.response.status, 500);
  assert.match(transferDuringLegacyWrite.payload.error, /operation is in progress/);
  env.MEMORY.put = originalPut;

  const originalRun = env.AI.run;
  let transferDuringReindex;
  env.AI.run = async (...args) => {
    transferDuringReindex = await admin(env, "/admin/v9/key-space/assign", {
      key: "project_shadow_lock",
      confirmKey: "project_shadow_lock",
      spaceKey: "private:beta",
      confirmFromSpaceKey: "private:alpha",
    });
    return originalRun(...args);
  };
  const reindexed = await admin(env, "/admin/reindex-key", { key: "project_shadow_lock" });
  assert.equal(reindexed.response.status, 200);
  assert.equal(transferDuringReindex.response.status, 500);
  assert.match(transferDuringReindex.payload.error, /operation is in progress/);
});

test("grant revocation and space disable take effect on the next request", async () => {
  const { env } = await makeSystem();
  await createSpace(env, "private:alpha");
  const alpha = await createClient(env, "Alpha", "private:alpha", ["read"]);
  const revoked = await admin(env, "/admin/v9/grants/revoke", {
    clientId: alpha.clientId,
    spaceKey: "private:alpha",
    capability: "read",
    confirmGrant: `${alpha.clientId}:private:alpha:read`,
  });
  assert.equal(revoked.payload.revoked, true);
  assert.deepEqual((await rpc(env, alpha.token, "tools/list")).result.tools, []);

  await admin(env, "/admin/v9/grants/create", {
    clientId: alpha.clientId,
    spaceKey: "private:alpha",
    capability: "read",
    confirmGrant: `${alpha.clientId}:private:alpha:read`,
  });
  const disabled = await admin(env, "/admin/v9/spaces/disable", {
    spaceKey: "private:alpha", confirmSpaceKey: "private:alpha",
  });
  assert.equal(disabled.payload.disabled, true);
  assert.deepEqual((await rpc(env, alpha.token, "tools/list")).result.tools, []);
});

test("key listings batch space lookups instead of querying once per KV key", async () => {
  const { env } = await makeSystem();
  const reader = await createClient(env, "Legacy reader", "legacy-unclassified", ["read"]);
  const start = new Date("2026-09-30T00:00:00Z");
  for (let index = 0; index < 200; index += 1) {
    const date = new Date(start.valueOf() - index * 86_400_000).toISOString().slice(0, 10);
    await env.MEMORY.put(`sample_daily_${date}`, `synthetic-${index}`);
  }
  let mappingQueries = 0;
  const originalDb = env.DB;
  env.DB = {
    prepare(sql) {
      if (/SELECT memory_key, space_id FROM memory_key_spaces/i.test(sql)) mappingQueries += 1;
      return originalDb.prepare(sql);
    },
    batch(statements) { return originalDb.batch(statements); },
  };
  const result = await tool(env, reader.token, "get_recent_dailies", { owner: "sample", days: 1 });
  assert.equal(result.days, 1);
  assert.equal(result.count, 1);
  assert.equal(mappingQueries, 1);
  const found = await tool(env, reader.token, "find_memory_keys", { query: "sample_daily", limit: 5 });
  assert.equal(found.count, 5);
  assert.equal(mappingQueries, 2);
});

test("prefix mapping dry runs batch D1 lookups", async () => {
  const { env } = await makeSystem();
  await createSpace(env, "private:alpha");
  for (let index = 0; index < 200; index += 1) {
    await env.MEMORY.put(`project_dry_run_${index}`, `synthetic-${index}`);
  }
  let mappingQueries = 0;
  const originalDb = env.DB;
  env.DB = {
    prepare(sql) {
      if (/SELECT memory_key, space_id FROM memory_key_spaces/i.test(sql)) mappingQueries += 1;
      return originalDb.prepare(sql);
    },
    batch(statements) { return originalDb.batch(statements); },
  };
  const dryRun = await admin(env, "/admin/v9/key-space/dry-run-prefix", {
    prefix: "project_dry_run_", spaceKey: "private:alpha",
  });
  assert.equal(dryRun.payload.count, 200);
  assert.equal(dryRun.payload.alreadyMapped, 0);
  assert.equal(mappingQueries, 3);
});

test("V9 admin mutations require ADMIN_TOKEN, confirmations, and bounded identifiers", async () => {
  const { env } = await makeSystem();
  const unauthorized = await worker.fetch(new Request("https://example.invalid/admin/v9/clients/list", {
    method: "POST",
    headers: { Authorization: `Bearer ${legacyToken}`, "Content-Type": "application/json" },
    body: "{}",
  }), env);
  assert.equal(unauthorized.status, 401);

  const noClientConfirmation = await admin(env, "/admin/v9/clients/create", { clientName: "No confirmation" });
  assert.equal(noClientConfirmation.response.status, 500);
  const longClientName = await admin(env, "/admin/v9/clients/create", {
    clientName: "x".repeat(81), confirmCreate: true,
  });
  assert.equal(longClientName.response.status, 500);
  const noSpaceConfirmation = await admin(env, "/admin/v9/spaces/create", {
    spaceKey: "private:alpha", spaceType: "private", displayName: "Alpha",
  });
  assert.equal(noSpaceConfirmation.response.status, 500);

  await createSpace(env, "private:alpha");
  const { payload: client } = await admin(env, "/admin/v9/clients/create", {
    clientName: "Alpha", confirmCreate: true,
  });
  const noGrantConfirmation = await admin(env, "/admin/v9/grants/create", {
    clientId: client.clientId, spaceKey: "private:alpha", capability: "read",
  });
  assert.equal(noGrantConfirmation.response.status, 500);
  const invalidClientId = await admin(env, "/admin/v9/grants/create", {
    clientId: "not-a-uuid",
    spaceKey: "private:alpha",
    capability: "read",
    confirmGrant: "not-a-uuid:private:alpha:read",
  });
  assert.equal(invalidClientId.response.status, 500);
  const invalidPrefix = await admin(env, "/admin/v9/key-space/dry-run-prefix", {
    prefix: "bad\nkey", spaceKey: "private:alpha",
  });
  assert.equal(invalidPrefix.response.status, 500);
  const combined = JSON.stringify([
    noClientConfirmation.payload,
    longClientName.payload,
    noSpaceConfirmation.payload,
    noGrantConfirmation.payload,
    invalidClientId.payload,
    invalidPrefix.payload,
  ]);
  assert.equal(combined.includes("token_hash"), false);
  assert.equal(combined.includes(client.token), false);
});

test("V9 infrastructure soft delete is hidden, metadata-only, and restorable", async () => {
  const { database, env } = await makeSystem({ infra: true });
  await createSpace(env, "private:alpha");
  const alpha = await createClient(env, "Alpha", "private:alpha");
  const body = "synthetic body that must never appear in recycle metadata";
  await tool(env, alpha.token, "save_memory", {
    key: "project_recycle_sample", value: body, spaceKey: "private:alpha",
  });
  const deleted = await tool(env, alpha.token, "delete_memory", {
    key: "project_recycle_sample", confirmKey: "project_recycle_sample",
  });
  assert.equal(deleted.recycled, true);
  assert.equal(await env.MEMORY.get("project_recycle_sample"), body);
  assert.equal(await tool(env, alpha.token, "get_memory", { key: "project_recycle_sample" }), "Not found: project_recycle_sample");
  const listed = await tool(env, alpha.token, "list_recycle_bin", { status: "active" });
  assert.equal(listed.count, 1);
  assert.equal(listed.results[0].deletionId, deleted.deletionId);
  assert.equal(JSON.stringify(listed).includes(body), false);
  assert.equal(JSON.stringify(listed).includes(alpha.clientId), false);
  const restored = await tool(env, alpha.token, "restore_memory", {
    key: "project_recycle_sample", deletionId: deleted.deletionId, confirmKey: "project_recycle_sample",
  });
  assert.equal(restored.restored, true);
  assert.equal(await tool(env, alpha.token, "get_memory", { key: "project_recycle_sample" }), body);
  assert.equal(database.prepare("SELECT status FROM memory_recycle_bin WHERE deletion_id=?").get(deleted.deletionId).status, "restored");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM memory_mutation_audit WHERE status='pending'").get().count, 0);
});

test("V9 infrastructure borrow requires policy and a target-space allowlist", async () => {
  const { database, env } = await makeSystem({ infra: true });
  await createSpace(env, "private:alpha");
  await createSpace(env, "private:beta");
  await createSpace(env, "private:gamma");
  const alpha = await createClient(env, "Alpha", "private:alpha", ["read"]);
  const beta = await createClient(env, "Beta", "private:beta");
  await tool(env, beta.token, "save_memory", {
    key: "project_borrow_sample", value: "synthetic borrowed context", spaceKey: "private:beta",
  });
  assert.equal((await rpc(env, alpha.token, "tools/list")).result.tools.some(({ name }) => name === "borrow_memory"), false);
  await admin(env, "/admin/v9/client-policy/set", {
    clientId: alpha.clientId, borrowEnabled: true, borrowDailyLimit: 2,
    isolatedUrlAuthEnabled: false, confirmPolicy: `${alpha.clientId}:true:2:false`,
  });
  await admin(env, "/admin/v9/borrow-spaces/grant", {
    clientId: alpha.clientId, spaceKey: "private:beta",
    confirmBorrowGrant: `${alpha.clientId}:private:beta`,
  });
  await admin(env, "/admin/v9/borrow-spaces/grant", {
    clientId: alpha.clientId, spaceKey: "private:gamma",
    confirmBorrowGrant: `${alpha.clientId}:private:gamma`,
  });
  assert.equal((await rpc(env, alpha.token, "tools/list")).result.tools.some(({ name }) => name === "borrow_memory"), true);
  const borrowed = await tool(env, alpha.token, "borrow_memory", {
    targetSpace: "private:beta", key: "project_borrow_sample",
  });
  assert.equal(borrowed.results[0].value, "synthetic borrowed context");
  await tool(env, alpha.token, "borrow_memory", {
    targetSpace: "private:beta", key: "project_borrow_sample",
  });
  assert.match(JSON.stringify(await tool(env, alpha.token, "borrow_memory", {
    targetSpace: "private:gamma", key: "project_missing_in_gamma",
  })), /daily borrow limit reached/);
  assert.equal(database.prepare("SELECT status FROM memory_borrow_audit").get().status, "success");
});

test("V9 infrastructure isolated URL authentication is opt-in per client", async () => {
  const { env } = await makeSystem({ infra: true });
  await createSpace(env, "private:alpha");
  const alpha = await createClient(env, "Alpha", "private:alpha", ["read"]);
  const request = () => worker.fetch(new Request(`https://example.invalid/mcp/${alpha.token}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  }), env);
  assert.equal((await request()).status, 401);
  await admin(env, "/admin/v9/client-policy/set", {
    clientId: alpha.clientId, borrowEnabled: false, borrowDailyLimit: 20,
    isolatedUrlAuthEnabled: true, confirmPolicy: `${alpha.clientId}:false:20:true`,
  });
  assert.equal((await request()).status, 200);
});

test("V9 infrastructure preserves legacy delete and releases purged keys", async () => {
  const { env } = await makeSystem({ infra: true });
  await env.MEMORY.put("project_legacy_unmapped", "synthetic legacy value");
  assert.equal((await tool(env, legacyToken, "delete_memory", {
    key: "project_legacy_unmapped", confirmKey: "project_legacy_unmapped",
  })).deleted, true);
  assert.equal(await env.MEMORY.get("project_legacy_unmapped"), null);

  await createSpace(env, "private:alpha");
  await createSpace(env, "private:beta");
  const alpha = await createClient(env, "Alpha", "private:alpha");
  await tool(env, alpha.token, "save_memory", {
    key: "project_reusable", value: "synthetic value", spaceKey: "private:alpha",
  });
  const deleted = await tool(env, alpha.token, "delete_memory", {
    key: "project_reusable", confirmKey: "project_reusable",
  });
  assert.match(JSON.stringify(await tool(env, legacyToken, "delete_memory", {
    key: "project_reusable", confirmKey: "project_reusable",
  })), /active recycle records require restore or explicit administrator purge/);
  assert.equal(await env.MEMORY.get("project_reusable"), "synthetic value");
  const reassign = await admin(env, "/admin/v9/key-space/assign", {
    key: "project_reusable", spaceKey: "private:beta", confirmKey: "project_reusable",
    confirmFromSpaceKey: "private:alpha",
  });
  assert.equal(reassign.response.status, 500);
  const purged = await admin(env, "/admin/v9/recycle/purge-one", {
    deletionId: deleted.deletionId, key: "project_reusable",
    confirmPurge: `${deleted.deletionId}:project_reusable:PERMANENT`,
  });
  assert.equal(purged.payload.purged, true);
  assert.equal((await tool(env, alpha.token, "save_memory", {
    key: "project_reusable", value: "synthetic replacement", spaceKey: "private:alpha",
  })).kv, "ok");
});

test("V9 infrastructure daily conflicts ignore actively recycled entries", async () => {
  const { env } = await makeSystem({ infra: true });
  await createSpace(env, "private:alpha");
  const alpha = await createClient(env, "Alpha", "private:alpha");
  const first = await tool(env, alpha.token, "save_daily", {
    owner: "sample", date: "2026-10-20", note: "old", value: "synthetic old", spaceKey: "private:alpha",
  });
  await tool(env, alpha.token, "delete_memory", { key: first.key, confirmKey: first.key });
  assert.match(JSON.stringify(await tool(env, alpha.token, "save_daily", {
    owner: "sample", date: "2026-10-20", note: "old", value: "synthetic duplicate", spaceKey: "private:alpha",
  })), /entry already exists/);
  const replacement = await tool(env, alpha.token, "save_daily", {
    owner: "sample", date: "2026-10-20", note: "new", value: "synthetic new", spaceKey: "private:alpha",
  });
  assert.equal(replacement.kv, "ok");
  assert.equal(replacement.key, "sample_daily_2026-10-20_new");
});

test("V9 infrastructure reconciliation accepts intentionally skipped indexes", async () => {
  const { database, env } = await makeSystem({ infra: true });
  await createSpace(env, "private:alpha");
  const alpha = await createClient(env, "Alpha", "private:alpha");
  await tool(env, alpha.token, "save_memory", {
    key: "archive_sample", value: "synthetic archive", spaceKey: "private:alpha",
  });
  const state = database.prepare(
    "SELECT content_hash, space_id FROM memory_index_state WHERE memory_key='archive_sample'",
  ).get();
  database.prepare(
    `INSERT INTO memory_mutation_audit
     (operation_id, client_id, auth_kind, action, memory_key, space_id, content_hash, status, started_at)
     VALUES ('synthetic-pending', ?, 'isolated-bearer', 'create', 'archive_sample', ?, ?, 'pending', datetime('now','-20 minutes'))`,
  ).run(alpha.clientId, state.space_id, state.content_hash);
  const reconciled = await admin(env, "/admin/v9/audit/reconcile-pending", {
    confirmReconcile: true,
  });
  assert.equal(reconciled.payload.success, 1);
  assert.equal(database.prepare(
    "SELECT status FROM memory_mutation_audit WHERE operation_id='synthetic-pending'",
  ).get().status, "success");
});

test("rename requires intersecting write and delete grants and preserves body and space", async () => {
  const { database, env } = await makeSystem({ infra: true });
  await createSpace(env, "private:synthetic");
  const full = await createClient(env, "Synthetic full client", "private:synthetic");
  const writer = await createClient(env, "Synthetic writer", "private:synthetic", ["write"]);
  await admin(env, "/admin/v9/rename/protection-replace", {
    sourceVersion: "synthetic-v1",
    keys: [{ key: "project_continuity", reason: "synthetic continuity fixture" }],
    confirmReplace: true,
  });
  assert.equal((await rpc(env, full.token, "tools/list")).result.tools.some(({ name }) => name === "rename_memory"), true);
  assert.equal((await rpc(env, writer.token, "tools/list")).result.tools.some(({ name }) => name === "rename_memory"), false);
  await tool(env, full.token, "save_memory", {
    key: "project_original", value: "synthetic body", spaceKey: "private:synthetic",
  });
  const renamed = await tool(env, full.token, "rename_memory", {
    key: "project_original", newKey: "project_renamed", confirmKey: "project_original",
  });
  assert.equal(renamed.renamed, true);
  assert.equal(await env.MEMORY.get("project_original"), null);
  assert.equal(await env.MEMORY.get("project_renamed"), "synthetic body");
  assert.equal(database.prepare("SELECT status FROM memory_rename_journal WHERE old_key=?").get("project_original").status, "success");
});

test("rename fails closed for unready policy, protected, lifecycle, and existing target keys", async () => {
  const { database, env } = await makeSystem({ infra: true });
  await createSpace(env, "private:synthetic");
  const client = await createClient(env, "Synthetic guarded client", "private:synthetic");
  await tool(env, client.token, "save_memory", {
    key: "project_source", value: "source", spaceKey: "private:synthetic",
  });
  assert.match(JSON.stringify(await tool(env, client.token, "rename_memory", {
    key: "project_source", newKey: "project_target", confirmKey: "project_source",
  })), /protection list is not ready/);
  await admin(env, "/admin/v9/rename/protection-replace", {
    sourceVersion: "synthetic-v1",
    keys: [{ key: "project_source", reason: "synthetic protected fixture" }],
    confirmReplace: true,
  });
  assert.match(JSON.stringify(await tool(env, client.token, "rename_memory", {
    key: "project_source", newKey: "project_target", confirmKey: "project_source",
  })), /protected continuity/);
  database.prepare("DELETE FROM memory_rename_protected_keys").run();
  assert.match(JSON.stringify(await tool(env, client.token, "rename_memory", {
    key: "project_source", newKey: "owner_daily_2026-01-01", confirmKey: "project_source",
  })), /cannot be renamed/);
  await tool(env, client.token, "save_memory", {
    key: "project_existing", value: "occupied", spaceKey: "private:synthetic",
  });
  assert.match(JSON.stringify(await tool(env, client.token, "rename_memory", {
    key: "project_source", newKey: "project_existing", confirmKey: "project_source",
  })), /already exists/);
});

test("rename rollback removes its target and unresolved states hide only the non-authoritative name", async () => {
  const { database, env } = await makeSystem({ infra: true });
  await createSpace(env, "private:synthetic");
  const client = await createClient(env, "Synthetic state client", "private:synthetic");
  await admin(env, "/admin/v9/rename/protection-replace", {
    sourceVersion: "synthetic-v1", keys: [{ key: "project_guard", reason: "fixture" }], confirmReplace: true,
  });
  await tool(env, client.token, "save_memory", {
    key: "project_rollback", value: "rollback body", spaceKey: "private:synthetic",
  });
  env.VECTORIZE_INDEX.failUpsert = true;
  assert.match(JSON.stringify(await tool(env, client.token, "rename_memory", {
    key: "project_rollback", newKey: "project_rollback_target", confirmKey: "project_rollback",
  })), /synthetic upsert failure/);
  env.VECTORIZE_INDEX.failUpsert = false;
  assert.equal(await env.MEMORY.get("project_rollback_target"), null);
  assert.equal(database.prepare("SELECT status FROM memory_rename_journal WHERE old_key=?").get("project_rollback").status, "rolled_back");

  const spaceId = database.prepare("SELECT space_id FROM memory_spaces WHERE space_key='private:synthetic'").get().space_id;
  database.prepare(
    `INSERT INTO memory_rename_journal
     (operation_id, old_key, new_key, space_id, auth_kind, content_hash, status)
     VALUES (?, ?, ?, ?, 'synthetic', ?, ?)`,
  ).run("pending-fixture", "project_pending_old", "project_pending_new", spaceId, "a".repeat(64), "pending");
  await env.MEMORY.put("project_pending_old", "old authoritative");
  await env.MEMORY.put("project_pending_new", "uncommitted target");
  assert.equal(await tool(env, legacyToken, "get_memory", { key: "project_pending_old" }), "old authoritative");
  assert.equal(await tool(env, legacyToken, "get_memory", { key: "project_pending_new" }), "Not found: project_pending_new");

  database.prepare("UPDATE memory_rename_journal SET status='committed' WHERE operation_id='pending-fixture'").run();
  assert.equal(await tool(env, legacyToken, "get_memory", { key: "project_pending_old" }), "Not found: project_pending_old");
  assert.equal(await tool(env, legacyToken, "get_memory", { key: "project_pending_new" }), "uncommitted target");
  assert.match(JSON.stringify(await tool(env, legacyToken, "save_memory", {
    key: "project_pending_old", value: "blocked",
  })), /unresolved rename/);
});

test("rename commit fencing handles changes zero and a lost batch response", async () => {
  for (const mode of ["changes-zero", "response-lost"]) {
    const { env } = await makeSystem({ infra: true });
    await createSpace(env, `private:${mode}`);
    const client = await createClient(env, `Synthetic ${mode}`, `private:${mode}`);
    await admin(env, "/admin/v9/rename/protection-replace", {
      sourceVersion: "synthetic-v1", keys: [{ key: "project_guard", reason: "fixture" }], confirmReplace: true,
    });
    const oldKey = `project_${mode}_old`;
    const newKey = `project_${mode}_new`;
    await tool(env, client.token, "save_memory", { key: oldKey, value: mode, spaceKey: `private:${mode}` });
    const delegate = env.DB;
    if (mode === "changes-zero") {
      env.DB = interceptDb(delegate, (sql) => sql.includes("SET status='committed'"), "unused", { changesZero: true });
      assert.match(JSON.stringify(await tool(env, client.token, "rename_memory", {
        key: oldKey, newKey, confirmKey: oldKey,
      })), /rename commit did not take effect/);
      assert.equal(await env.MEMORY.get(oldKey), mode);
      assert.equal(await env.MEMORY.get(newKey), null);
    } else {
      let thrown = false;
      env.DB = {
        prepare: (sql) => delegate.prepare(sql),
        async batch(statements) {
          const result = await delegate.batch(statements);
          if (!thrown && statements.some((statement) => statement.sql.includes("SET status='committed'"))) {
            thrown = true;
            throw new Error("synthetic response lost");
          }
          return result;
        },
      };
      const result = await tool(env, client.token, "rename_memory", { key: oldKey, newKey, confirmKey: oldKey });
      assert.equal(result.renamed, true);
      assert.equal(await env.MEMORY.get(oldKey), null);
      assert.equal(await env.MEMORY.get(newKey), mode);
    }
  }
});

test("rename hidden-key batching stays below D1 bind limits", async () => {
  const { env } = await makeSystem({ infra: true });
  for (let index = 0; index < 121; index += 1) await env.MEMORY.put(`project_batch_${index}`, "fixture");
  const delegate = env.DB;
  env.DB = {
    prepare(sql) {
      const statement = delegate.prepare(sql);
      return {
        bind(...values) {
          if (values.length > 100) throw new Error("synthetic D1 bind limit exceeded");
          return statement.bind(...values);
        },
        all: () => statement.all(), first: (column) => statement.first(column), run: () => statement.run(),
      };
    },
    batch: (statements) => delegate.batch(statements),
  };
  const result = await tool(env, legacyToken, "find_memory_keys", { prefix: "project_batch_", limit: 20 });
  assert.equal(result.count, 20);
});

test("rename reconciliation repairs stale pre-commit and post-commit cleanup states", async () => {
  const { database, env } = await makeSystem({ infra: true });
  await createSpace(env, "private:synthetic");
  const client = await createClient(env, "Synthetic reconcile client", "private:synthetic");
  await admin(env, "/admin/v9/rename/protection-replace", {
    sourceVersion: "synthetic-v1", keys: [{ key: "project_guard", reason: "fixture" }], confirmReplace: true,
  });
  const saved = await tool(env, client.token, "save_memory", {
    key: "project_stale_old", value: "stale body", spaceKey: "private:synthetic",
  });
  const spaceId = database.prepare("SELECT space_id FROM memory_spaces WHERE space_key='private:synthetic'").get().space_id;
  await env.MEMORY.put("project_stale_new", "stale body");
  database.prepare(
    `INSERT INTO memory_rename_journal
     (operation_id, old_key, new_key, space_id, auth_kind, content_hash, status, started_at)
     VALUES ('stale-fixture', ?, ?, ?, 'synthetic', ?, 'pending', datetime('now','-21 minutes'))`,
  ).run("project_stale_old", "project_stale_new", spaceId, saved.contentHash);
  let repaired = await admin(env, "/admin/v9/rename/reconcile", { confirmReconcile: true });
  assert.equal(repaired.payload.repaired, 1);
  assert.equal(await env.MEMORY.get("project_stale_new"), null);
  assert.equal(database.prepare("SELECT status FROM memory_rename_journal WHERE operation_id='stale-fixture'").get().status, "rolled_back");

  const renamed = await tool(env, client.token, "rename_memory", {
    key: "project_stale_old", newKey: "project_committed_new", confirmKey: "project_stale_old",
  });
  assert.equal(renamed.renamed, true);
  database.prepare(
    "UPDATE memory_rename_journal SET status='reconcile_required' WHERE new_key='project_committed_new'",
  ).run();
  await env.MEMORY.put("project_stale_old", "stale body");
  repaired = await admin(env, "/admin/v9/rename/reconcile", { confirmReconcile: true });
  assert.equal(repaired.payload.repaired, 1);
  assert.equal(await env.MEMORY.get("project_stale_old"), null);
  assert.equal(await env.MEMORY.get("project_committed_new"), "stale body");
});

test("rename fails closed when its migration is missing and rejects disabled source spaces", async () => {
  const missing = await makeSystem({ infra: true });
  missing.database.exec("DROP TABLE memory_rename_journal");
  assert.match(JSON.stringify(await tool(missing.env, legacyToken, "get_memory", { key: "project_missing" })), /rename migration/);

  const { database, env } = await makeSystem({ infra: true });
  await createSpace(env, "private:synthetic");
  const client = await createClient(env, "Synthetic disabled client", "private:synthetic");
  await admin(env, "/admin/v9/rename/protection-replace", {
    sourceVersion: "synthetic-v1", keys: [{ key: "project_guard", reason: "fixture" }], confirmReplace: true,
  });
  await tool(env, client.token, "save_memory", {
    key: "project_disabled", value: "fixture", spaceKey: "private:synthetic",
  });
  database.prepare("UPDATE memory_spaces SET disabled_at=CURRENT_TIMESTAMP WHERE space_key='private:synthetic'").run();
  assert.match(JSON.stringify(await tool(env, legacyToken, "rename_memory", {
    key: "project_disabled", newKey: "project_disabled_new", confirmKey: "project_disabled",
  })), /active explicit access-space mapping/);
});

function interceptDb(delegate, predicate, message, options = {}) {
  return {
    prepare(sql) {
      if (predicate(sql)) {
        return {
          bind() {
            return {
              async all() { throw new Error(message); },
              async first() { throw new Error(message); },
              async run() {
                if (options.changesZero) return { success: true, meta: { changes: 0 } };
                throw new Error(message);
              },
            };
          },
          sql,
        };
      }
      return delegate.prepare(sql);
    },
    batch(statements) { return delegate.batch(statements); },
  };
}
