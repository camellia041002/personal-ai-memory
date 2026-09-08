import assert from "node:assert/strict";
import test from "node:test";

import kvOnlyWorker from "../examples/kv-only/worker.js";
import liteWorker from "../lite/worker.js";
import vectorSearchWorker from "../examples/vector-search/worker.js";

const token = "x".repeat(32);

class MemoryKv {
  constructor() { this.rows = new Map(); }
  async put(key, value) { this.rows.set(key, String(value)); }
  async get(key) { return this.rows.has(key) ? this.rows.get(key) : null; }
  async delete(key) { this.rows.delete(key); }
  async list({ prefix } = {}) {
    const names = [...this.rows.keys()].filter((key) => !prefix || key.startsWith(prefix)).sort();
    return { keys: names.map((name) => ({ name })), list_complete: true };
  }
}

class MemoryVectorize {
  constructor() { this.rows = new Map(); }
  async upsert(rows) { for (const row of rows) this.rows.set(row.id, row); }
  async deleteByIds(ids) { for (const id of ids) this.rows.delete(id); }
  async query() {
    return {
      matches: [...this.rows.values()].map((row, index) => ({
        id: row.id,
        score: 0.9 - index * 0.01,
        metadata: row.metadata,
      })),
    };
  }
}

const fakeAi = {
  async run(_model, { text }) {
    return { data: text.map((value) => [String(value).length, 1, 0]) };
  },
};

async function call(worker, env, name, args, id = 1) {
  const response = await worker.fetch(new Request("https://example.invalid/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
  }), { ...env, AUTH_TOKEN: token, ALLOWED_ORIGIN: "https://example.invalid" });
  assert.equal(response.status, 200);
  return response.json();
}

function toolJson(payload) {
  return JSON.parse(payload.result.content[0].text);
}

test("KV-only profile saves, finds, reads, and confirms deletion", async () => {
  const env = { MEMORY: new MemoryKv() };
  assert.equal(toolJson(await call(kvOnlyWorker, env, "save_memory", {
    key: "project_demo",
    value: "虚构项目记录",
  })).saved, true);

  const found = toolJson(await call(kvOnlyWorker, env, "find_memory_keys", { query: "demo" }));
  assert.deepEqual(found.results, ["project_demo"]);
  assert.equal((await call(kvOnlyWorker, env, "get_memory", { key: "project_demo" })).result.content[0].text, "虚构项目记录");

  const rejected = await call(kvOnlyWorker, env, "delete_memory", {
    key: "project_demo",
    confirmKey: "wrong",
  });
  assert.equal(rejected.error.code, -32603);
  assert.notEqual(await env.MEMORY.get("project_demo"), null);

  assert.equal(toolJson(await call(kvOnlyWorker, env, "delete_memory", {
    key: "project_demo",
    confirmKey: "project_demo",
  })).deleted, true);
  assert.equal(await env.MEMORY.get("project_demo"), null);
});

test("Lite uses one strong token for Bearer and URL-only connections", async () => {
  const memoryToken = "l".repeat(43);
  const env = { MEMORY: new MemoryKv(), MEMORY_TOKEN: memoryToken };
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });

  const missing = await liteWorker.fetch(new Request("https://example.invalid/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }), env);
  assert.equal(missing.status, 401);

  const bearer = await liteWorker.fetch(new Request("https://example.invalid/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${memoryToken}`, "Content-Type": "application/json" },
    body,
  }), env);
  assert.equal(bearer.status, 200);

  const urlOnly = await liteWorker.fetch(new Request(`https://example.invalid/mcp/${memoryToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }), env);
  assert.equal(urlOnly.status, 200);

  const landing = await liteWorker.fetch(new Request("https://example.invalid/"), env);
  assert.equal(landing.status, 200);
  assert.doesNotMatch(await landing.text(), new RegExp(memoryToken));
});

test("Vector profile indexes, searches, hides manifests, and deletes vectors", async () => {
  const env = { MEMORY: new MemoryKv(), VECTORIZE_INDEX: new MemoryVectorize(), AI: fakeAi };
  const saved = toolJson(await call(vectorSearchWorker, env, "save_memory", {
    key: "project_garden",
    value: "这是完全虚构的阳台种植计划。".repeat(30),
  }));
  assert.equal(saved.index, "ok");
  assert.ok(env.VECTORIZE_INDEX.rows.size > 0);

  const found = toolJson(await call(vectorSearchWorker, env, "find_memory_keys", { query: "project" }));
  assert.deepEqual(found.results, ["project_garden"]);
  const searched = toolJson(await call(vectorSearchWorker, env, "search_memories", { query: "种植" }));
  assert.equal(searched.results[0].key, "project_garden");

  const deleted = toolJson(await call(vectorSearchWorker, env, "delete_memory", {
    key: "project_garden",
    confirmKey: "project_garden",
  }));
  assert.equal(deleted.deleted, true);
  assert.equal(env.VECTORIZE_INDEX.rows.size, 0);
  assert.equal(await env.MEMORY.get("project_garden"), null);
});
