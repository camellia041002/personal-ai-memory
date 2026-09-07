import { readFile } from "node:fs/promises";
import process from "node:process";

const baseUrl = process.argv[2];
const token = process.env.SAMPLE_AUTH_TOKEN;
if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
  throw new Error("Usage: npm run seed:sample -- https://your-worker.example/mcp");
}
if (!token || token.length < 24) {
  throw new Error("Set SAMPLE_AUTH_TOKEN to the same value stored as the Worker AUTH_TOKEN secret");
}

const rows = JSON.parse(await readFile(new URL("../examples/sample-data.json", import.meta.url), "utf8"));
for (let index = 0; index < rows.length; index += 1) {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: index + 1,
      method: "tools/call",
      params: { name: "save_memory", arguments: rows[index] },
    }),
  });
  if (!response.ok) throw new Error(`Seed request ${index + 1} failed with HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`Seed request ${index + 1} failed: ${payload.error.message}`);
  console.log(`Seeded ${rows[index].key}`);
}
