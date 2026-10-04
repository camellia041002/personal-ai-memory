import assert from "node:assert/strict";
import test from "node:test";

import { INDEX_VERSION, splitText, vectorIdFor } from "../src/core.js";
import worker from "../src/worker.js";

const token = "v".repeat(43);

function request(method, params = {}, path = "/mcp", auth = token) {
  return worker.fetch(new Request(`https://example.invalid${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }),
  }), {
    MEMORY_TOKEN: token,
    V9_AUTH_MODE: "off",
    V9_RECALL_ENABLED: "false",
    DB: offModeDb(),
    AI: {
      async run() { return { data: [[0.5, 0.25]] }; },
    },
    VECTORIZE_INDEX: {
      async query() { return { matches: [] }; },
    },
  });
}

function offModeDb({ exactFailure = false } = {}) {
  return {
    prepare(sql) {
      assert.doesNotMatch(sql, /api_clients|memory_spaces|api_client_space_grants|memory_key_spaces|recall_/i);
      return {
        bind() {
          return {
            async all() {
              if (exactFailure) throw new Error("synthetic exact failure");
              return { results: [] };
            },
          };
        },
      };
    },
  };
}

async function rpcJson(response) {
  assert.equal(response.status, 200);
  return response.json();
}

test("flags off preserve the exact V8 tool list and initialize payload", async () => {
  const listed = await rpcJson(await request("tools/list"));
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), [
    "save_memory",
    "save_daily",
    "get_memory",
    "find_memory_keys",
    "get_recent_dailies",
    "search_memories",
    "delete_memory",
  ]);

  const initialized = await rpcJson(await request("initialize"));
  assert.deepEqual(initialized.result, {
    protocolVersion: "2024-11-05",
    capabilities: { tools: {} },
    serverInfo: { name: "personal-ai-memory", version: "8.0.0-public.2" },
  });
});

test("flags off preserve V8 search output and fail-closed route semantics", async () => {
  const searched = await rpcJson(await request("tools/call", {
    name: "search_memories",
    arguments: { query: "不存在的合成短语" },
  }));
  assert.deepEqual(JSON.parse(searched.result.content[0].text), {
    query: "不存在的合成短语",
    count: 0,
    results: [],
  });

  const failed = await worker.fetch(new Request("https://example.invalid/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "search_memories", arguments: { query: "故障" } },
    }),
  }), {
    MEMORY_TOKEN: token,
    V9_AUTH_MODE: "off",
    V9_RECALL_ENABLED: "false",
    DB: offModeDb({ exactFailure: true }),
    AI: { async run() { return { data: [[0.5, 0.25]] }; } },
    VECTORIZE_INDEX: { async query() { return { matches: [] }; } },
  });
  const failurePayload = await rpcJson(failed);
  assert.equal(failurePayload.error.code, -32603);
  assert.match(failurePayload.error.message, /synthetic exact failure/);
});

test("flags off preserve V8 chunking, index version, and vector identity", async () => {
  const text = `${"甲".repeat(500)}。${"乙".repeat(500)}。${"丙".repeat(500)}。`;
  const chunks = splitText(text, { target: 400, max: 600, overlap: 80 });
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((chunk) => chunk.length <= 600));
  assert.equal(INDEX_VERSION, "v8-public-qwen3-embedding-0.6b");
  assert.equal(await vectorIdFor("project_demo", 0), "d4de5847dad3b395a70ee15eeb47746e6de2cc52");
});

test("flags off preserve both legacy authentication routes", async () => {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 9, method: "initialize", params: {} });
  const bearer = await worker.fetch(new Request("https://example.invalid/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body,
  }), { MEMORY_TOKEN: token, V9_AUTH_MODE: "off", V9_RECALL_ENABLED: "false" });
  assert.equal(bearer.status, 200);

  const secretUrl = await worker.fetch(new Request(`https://example.invalid/mcp/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }), { MEMORY_TOKEN: token, V9_AUTH_MODE: "off", V9_RECALL_ENABLED: "false" });
  assert.equal(secretUrl.status, 200);
});
