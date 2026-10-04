import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { stripJsonComments, validateConfig } from "../scripts/validate-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function validHybridConfig() {
  const d1Id = ["11111111", "2222", "3333", "4444", "555555555555"].join("-");
  return {
    name: "personal-ai-memory-test",
    main: "src/worker.js",
    compatibility_date: "2026-09-04",
    kv_namespaces: [{ binding: "MEMORY", id: "a".repeat(32) }],
    d1_databases: [{ binding: "DB", database_name: "personal-ai-memory-test-db", database_id: d1Id }],
    vectorize: [{ binding: "VECTORIZE_INDEX", index_name: "personal-ai-memory-test-index" }],
    ai: { binding: "AI" },
  };
}

test("all example configs have valid template structure", async () => {
  const files = [
    "wrangler.example.jsonc",
    "examples/kv-only/wrangler.example.jsonc",
    "examples/vector-search/wrangler.example.jsonc",
  ];
  for (const file of files) {
    const raw = await readFile(path.join(root, file), "utf8");
    assert.doesNotThrow(() => validateConfig(JSON.parse(stripJsonComments(raw)), { mode: "template" }));
  }
});

test("Lite one-click config requests automatic KV provisioning", async () => {
  const raw = await readFile(path.join(root, "lite", "wrangler.jsonc"), "utf8");
  const config = JSON.parse(stripJsonComments(raw));
  assert.deepEqual(config.kv_namespaces, [{ binding: "MEMORY" }]);
  assert.doesNotThrow(() => validateConfig(config, { mode: "provision" }));
});

test("V8 deploy-button config requests isolated automatic resources", async () => {
  const raw = await readFile(path.join(root, "v8", "wrangler.jsonc"), "utf8");
  const config = JSON.parse(stripJsonComments(raw));
  assert.deepEqual(config.kv_namespaces, [{ binding: "MEMORY" }]);
  assert.deepEqual(config.d1_databases, [{ binding: "DB", database_name: "personal-ai-memory-v8-db" }]);
  assert.deepEqual(config.vectorize, [{ binding: "VECTORIZE_INDEX", index_name: "personal-ai-memory-v8-index" }]);
  assert.deepEqual(config.ai, { binding: "AI" });
  assert.doesNotThrow(() => validateConfig(config, { mode: "provision" }));
});

test("V8 deploy package applies schema and all required metadata indexes", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "v8", "package.json"), "utf8"));
  assert.match(packageJson.scripts.deploy, /db:migrate/);
  assert.match(packageJson.scripts.deploy, /vectorize:metadata/);
  assert.match(packageJson.scripts.deploy, /wrangler deploy/);

  const setup = await readFile(path.join(root, "v8", "scripts", "setup-vectorize.mjs"), "utf8");
  for (const property of ["cat", "owner", "date", "space"]) assert.match(setup, new RegExp(`"${property}"`));

  for (const migration of ["0001_schema.sql", "0002_v9_access_spaces.sql"]) {
    const rootMigration = await readFile(path.join(root, "migrations", migration), "utf8");
    const deployMigration = await readFile(path.join(root, "v8", "migrations", migration), "utf8");
    assert.equal(deployMigration, rootMigration);
  }
});

test("a fully replaced Hybrid V8 config is deployable", () => {
  assert.doesNotThrow(() => validateConfig(validHybridConfig(), { mode: "deploy" }));
});

test("deploy validation rejects placeholders anywhere in the config", () => {
  const config = validHybridConfig();
  config.kv_namespaces[0].id = "<KV_NAMESPACE_ID>";
  assert.throws(() => validateConfig(config, { mode: "deploy" }), /Unreplaced placeholder/);

  const nested = validHybridConfig();
  nested.vars = { OPTIONAL_VALUE: "prefix-<STILL_A_PLACEHOLDER>" };
  assert.throws(() => validateConfig(nested, { mode: "deploy" }), /Unreplaced placeholder/);
});

test("deploy validation rejects empty and obviously invalid resource identifiers", () => {
  for (const [mutate, message] of [
    [(config) => { config.kv_namespaces[0].id = ""; }, /must not be empty/],
    [(config) => { config.kv_namespaces[0].id = "not-a-kv-id"; }, /invalid format/],
    [(config) => { config.d1_databases[0].database_id = ""; }, /must not be empty/],
    [(config) => { config.d1_databases[0].database_id = "not-a-d1-id"; }, /invalid format/],
    [(config) => { config.vectorize[0].index_name = ""; }, /must not be empty/],
    [(config) => { config.vectorize[0].index_name = "invalid index name"; }, /invalid format/],
  ]) {
    const config = validHybridConfig();
    mutate(config);
    assert.throws(() => validateConfig(config, { mode: "deploy" }), message);
  }
});

test("deploy validation rejects an impossible compatibility date", () => {
  const config = validHybridConfig();
  config.compatibility_date = "2026-02-30";
  assert.throws(() => validateConfig(config, { mode: "deploy" }), /compatibility_date/);
});

test("template validation still rejects missing required bindings", () => {
  const config = validHybridConfig();
  config.kv_namespaces[0].binding = "OTHER";
  assert.throws(() => validateConfig(config, { mode: "template" }), /Missing binding: MEMORY/);
});
