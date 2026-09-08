import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import worker from "../src/worker.js";
import kvOnlyWorker from "../examples/kv-only/worker.js";
import liteWorker from "../lite/worker.js";
import vectorSearchWorker from "../examples/vector-search/worker.js";

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

test("public workers never accept query-parameter tokens or emit application logs", async () => {
  const paths = [
    path.join(root, "src", "worker.js"),
    path.join(root, "examples", "kv-only", "worker.js"),
    path.join(root, "lite", "worker.js"),
    path.join(root, "examples", "vector-search", "worker.js"),
  ];
  for (const sourcePath of paths) {
    const source = await readFile(sourcePath, "utf8");
    assert.doesNotMatch(source, /searchParams\.get\(["']token["']\)/i);
    assert.match(source, /request\.headers\.get\(["']Authorization["']\)/);
    assert.doesNotMatch(source, /console\.(?:debug|error|info|log|warn)\s*\(/);
  }
});

async function initialize(profile, path, env, headers = {}) {
  return profile.fetch(new Request(`https://example.invalid${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  }), env);
}

test("all profiles preserve Bearer authentication on the exact /mcp route", async () => {
  const token = "x".repeat(32);
  for (const profile of [worker, kvOnlyWorker, vectorSearchWorker]) {
    const env = { AUTH_TOKEN: token, ALLOWED_ORIGIN: "https://example.invalid" };
    const missingResponse = await initialize(profile, "/mcp", env);
    assert.equal(missingResponse.status, 401);

    const wrongResponse = await initialize(profile, "/mcp", env, { Authorization: `Bearer ${"y".repeat(32)}` });
    assert.equal(wrongResponse.status, 401);

    const acceptedResponse = await initialize(profile, "/mcp", env, { Authorization: `Bearer ${token}` });
    assert.equal(acceptedResponse.status, 200);
    assert.doesNotMatch(await acceptedResponse.text(), new RegExp(token));
  }

  const liteToken = "l".repeat(43);
  const liteMissing = await initialize(liteWorker, "/mcp", { MEMORY_TOKEN: liteToken });
  assert.equal(liteMissing.status, 401);
  const liteAccepted = await initialize(liteWorker, "/mcp", { MEMORY_TOKEN: liteToken }, {
    Authorization: `Bearer ${liteToken}`,
  });
  assert.equal(liteAccepted.status, 200);
  assert.doesNotMatch(await liteAccepted.text(), new RegExp(liteToken));

  const shortTokenResponse = await worker.fetch(new Request("https://example.invalid/mcp", {
    headers: { Authorization: "Bearer short" },
  }), { AUTH_TOKEN: "short" });
  assert.equal(shortTokenResponse.status, 401);
});

test("all profiles accept only the exact configured secret URL", async () => {
  const urlToken = "u".repeat(43);
  const invalidConfiguredToken = `${"u".repeat(42)}/`;
  const rejectedPaths = [
    "/mcp/",
    `/mcp/${"w".repeat(43)}`,
    `/mcp/${urlToken}/extra`,
    `/mcp/${urlToken}%2Fextra`,
  ];

  for (const profile of [worker, kvOnlyWorker, vectorSearchWorker]) {
    const env = { MCP_URL_TOKEN: urlToken, ALLOWED_ORIGIN: "https://example.invalid" };
    const acceptedResponse = await initialize(profile, `/mcp/${urlToken}`, env);
    assert.equal(acceptedResponse.status, 200);
    assert.doesNotMatch(await acceptedResponse.text(), new RegExp(urlToken));

    for (const pathName of rejectedPaths) {
      const response = await initialize(profile, pathName, env);
      assert.equal(response.status, 404);
      assert.doesNotMatch(await response.text(), new RegExp(urlToken));
    }

    const unconfiguredResponse = await initialize(profile, `/mcp/${urlToken}`, {
      ALLOWED_ORIGIN: "https://example.invalid",
    });
    assert.equal(unconfiguredResponse.status, 404);

    const invalidSecretResponse = await initialize(profile, `/mcp/${invalidConfiguredToken}`, {
      MCP_URL_TOKEN: invalidConfiguredToken,
      ALLOWED_ORIGIN: "https://example.invalid",
    });
    assert.equal(invalidSecretResponse.status, 404);

    const shortSecretResponse = await initialize(profile, `/mcp/${"s".repeat(42)}`, {
      MCP_URL_TOKEN: "s".repeat(42),
      ALLOWED_ORIGIN: "https://example.invalid",
    });
    assert.equal(shortSecretResponse.status, 404);

    const queryOnlyResponse = await initialize(profile, `/mcp?token=${urlToken}`, env);
    assert.equal(queryOnlyResponse.status, 401);
  }
});

test("ordinary Bearer and secret URL tokens cannot authenticate administrator routes", async () => {
  const urlToken = "u".repeat(43);
  const bearerToken = "b".repeat(32);
  const env = {
    AUTH_TOKEN: bearerToken,
    MCP_URL_TOKEN: urlToken,
    ADMIN_TOKEN: "a".repeat(32),
  };
  for (const ordinaryToken of [urlToken, bearerToken]) {
    const response = await worker.fetch(new Request("https://example.invalid/admin/keys", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ordinaryToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    }), env);
    assert.equal(response.status, 401);
    assert.doesNotMatch(await response.text(), new RegExp(ordinaryToken));
  }

  const pathResponse = await worker.fetch(new Request(`https://example.invalid/admin/keys/${urlToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }), env);
  assert.equal(pathResponse.status, 401);
  assert.doesNotMatch(await pathResponse.text(), new RegExp(urlToken));
});

test("CORS preflight exposes no data and does not require a bearer token", async () => {
  const response = await worker.fetch(new Request("https://example.invalid/mcp", {
    method: "OPTIONS",
    headers: { Origin: "https://example.invalid" },
  }), { ALLOWED_ORIGIN: "https://example.invalid" });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://example.invalid");
});

test("public workers have no unconditional all-memory tools", async () => {
  const paths = [
    path.join(root, "src", "worker.js"),
    path.join(root, "examples", "kv-only", "worker.js"),
    path.join(root, "lite", "worker.js"),
    path.join(root, "examples", "vector-search", "worker.js"),
  ];
  for (const sourcePath of paths) {
    const source = await readFile(sourcePath, "utf8");
    assert.doesNotMatch(source, /name:\s*["']get_all_memories["']/);
    assert.doesNotMatch(source, /name:\s*["']list_memories["']/);
    assert.match(source, /confirmKey must exactly match key/);
  }
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
