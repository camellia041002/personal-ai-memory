import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import worker from "../src/worker.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(fullPath));
    else result.push(fullPath);
  }
  return result;
}

test("public worker accepts no URL-carried token", async () => {
  const worker = await readFile(path.join(root, "src", "worker.js"), "utf8");
  assert.doesNotMatch(worker, /pathname\.startsWith\(["']\/mcp\//);
  assert.doesNotMatch(worker, /searchParams\.get\(["']token["']\)/i);
  assert.match(worker, /request\.headers\.get\(["']Authorization["']\)/);
});

test("runtime routing rejects path tokens and accepts only a sufficiently long header token", async () => {
  const token = "example-only-token-with-32-chars";
  const env = { AUTH_TOKEN: token, ALLOWED_ORIGIN: "https://example.invalid" };
  const pathResponse = await worker.fetch(new Request(`https://example.invalid/mcp/${token}`), env);
  assert.equal(pathResponse.status, 404);

  const shortTokenResponse = await worker.fetch(new Request("https://example.invalid/mcp", {
    headers: { Authorization: "Bearer short" },
  }), { AUTH_TOKEN: "short" });
  assert.equal(shortTokenResponse.status, 401);

  const initializeResponse = await worker.fetch(new Request("https://example.invalid/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  }), env);
  assert.equal(initializeResponse.status, 200);
  const payload = await initializeResponse.json();
  assert.equal(payload.result.serverInfo.version, "8.0.0-public.1");
});

test("CORS preflight exposes no data and does not require a bearer token", async () => {
  const response = await worker.fetch(new Request("https://example.invalid/mcp", {
    method: "OPTIONS",
    headers: { Origin: "https://example.invalid" },
  }), { ALLOWED_ORIGIN: "https://example.invalid" });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://example.invalid");
});

test("public worker has no unconditional all-memory tools", async () => {
  const worker = await readFile(path.join(root, "src", "worker.js"), "utf8");
  assert.doesNotMatch(worker, /name:\s*["']get_all_memories["']/);
  assert.doesNotMatch(worker, /name:\s*["']list_memories["']/);
  assert.match(worker, /confirmKey must exactly match key/);
});

test("repository excludes private artifact and secret file types", async () => {
  const files = (await filesUnder(root)).map((file) => path.relative(root, file).replace(/\\/g, "/"));
  for (const file of files) {
    assert.doesNotMatch(file, /(^|\/)\.dev\.vars$/);
    assert.doesNotMatch(file, /(^|\/)\.env(?:\.|$)/);
    assert.doesNotMatch(file, /\.docx$/i);
    assert.doesNotMatch(file, /\.(?:sqlite3?|db)$/i);
    assert.notEqual(file, "wrangler.jsonc");
  }
});

test("tracked content contains no obvious production identifiers or private names", async () => {
  const files = await filesUnder(root);
  const content = (await Promise.all(files.map((file) => readFile(file, "utf8").catch(() => "")))).join("\n");
  const knownProductionName = ["myclaude", "memory"].join("-");
  assert.equal(content.toLowerCase().includes(knownProductionName), false);
  assert.doesNotMatch(content, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  assert.doesNotMatch(content, /Bearer\s+[A-Za-z0-9._~+/-]{24,}/);
});
