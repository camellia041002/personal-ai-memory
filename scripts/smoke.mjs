import process from "node:process";

const endpoint = process.argv[2];
const bearerToken = process.env.SMOKE_AUTH_TOKEN;

if (!endpoint) {
  throw new Error("Usage: npm run smoke -- https://your-worker.example/mcp");
}

const parsedEndpoint = new URL(endpoint);
if (parsedEndpoint.protocol !== "https:") throw new Error("Smoke test endpoint must use HTTPS");
if (parsedEndpoint.search || parsedEndpoint.hash) throw new Error("Smoke test endpoint must not contain a query or fragment");
if (parsedEndpoint.pathname === "/mcp" && (!bearerToken || bearerToken.length < 24)) {
  throw new Error("Set SMOKE_AUTH_TOKEN when testing the /mcp Bearer endpoint");
}

const headers = { "Content-Type": "application/json" };
if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

const suffix = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const key = `project_smoke-${suffix}`;
const value = "这是一条完全虚构的冒烟测试记忆，主题是蓝色纸飞机。";
let saved = false;
let deleted = false;

async function rpc(method, params = {}) {
  const response = await fetch(parsedEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`MCP ${payload.error.code}: ${payload.error.message}`);
  return payload.result;
}

async function callTool(name, args) {
  const result = await rpc("tools/call", { name, arguments: args });
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error(`${name} returned no text result`);
  try { return JSON.parse(text); } catch { return text; }
}

async function cleanup() {
  if (!saved || deleted) return;
  try {
    await callTool("delete_memory", { key, confirmKey: key });
    deleted = true;
    console.log(`cleanup: deleted ${key}`);
  } catch {
    console.error(`cleanup required: delete the fictional key ${key}`);
  }
}

try {
  const initialized = await rpc("initialize");
  console.log(`initialize: ${initialized.serverInfo.name} ${initialized.serverInfo.version}`);

  const listed = await rpc("tools/list");
  const toolNames = listed.tools.map((tool) => tool.name);
  for (const required of ["save_memory", "get_memory", "search_memories", "delete_memory"]) {
    if (!toolNames.includes(required)) throw new Error(`Missing required tool: ${required}`);
  }
  console.log(`tools/list: ${toolNames.length} tools`);

  const saveResult = await callTool("save_memory", { key, value });
  saved = saveResult?.kv === "ok";
  if (!saved) throw new Error("save_memory did not report kv=ok");
  if (saveResult.index !== "ok") throw new Error(`save_memory reported index=${saveResult.index || "unknown"}`);
  console.log(`save_memory: kv=${saveResult.kv}, index=${saveResult.index}, key=${key}`);

  const readResult = await callTool("get_memory", { key });
  if (readResult !== value) throw new Error("get_memory content did not match the saved value");
  console.log("get_memory: exact content matched");

  let searchResult;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    searchResult = await callTool("search_memories", { query: "蓝色纸飞机" });
    if (searchResult?.results?.some((item) => item.key === key)) break;
    if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  if (!searchResult?.results?.some((item) => item.key === key)) {
    throw new Error("search_memories did not return the smoke-test key after retries");
  }
  console.log("search_memories: saved key found");

  const deleteResult = await callTool("delete_memory", { key, confirmKey: key });
  deleted = deleteResult?.deleted === true;
  if (!deleted) throw new Error("delete_memory did not confirm deletion");
  console.log("delete_memory: deleted=true");

  const deletedRead = await callTool("get_memory", { key });
  if (deletedRead !== `Not found: ${key}`) throw new Error("deleted key is still readable");
  console.log("verification: deleted key is not found");
} finally {
  await cleanup();
}
