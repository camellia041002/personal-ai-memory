import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const indexName = config.vectorize?.find((item) => item.binding === "VECTORIZE_INDEX")?.index_name;
if (!indexName) throw new Error("VECTORIZE_INDEX is missing from wrangler.jsonc");

const wrangler = process.platform === "win32" ? "wrangler.cmd" : "wrangler";

function run(args, options = {}) {
  const result = spawnSync(wrangler, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    const message = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    if (options.acceptExisting && /already (?:exists|indexed)|duplicate/iu.test(message)) return result.stdout;
    throw new Error(`wrangler ${args.join(" ")} failed: ${message}`);
  }
  return result.stdout;
}

function propertyNames(payload) {
  const names = new Set();
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const name = value.propertyName || value.property_name;
    if (name) names.add(name);
    Object.values(value).forEach(visit);
  }
  visit(payload);
  return names;
}

const existing = propertyNames(JSON.parse(run([
  "vectorize", "list-metadata-index", indexName, "--json",
])));

for (const property of ["cat", "owner", "date"]) {
  if (existing.has(property)) continue;
  run([
    "vectorize", "create-metadata-index", indexName,
    `--property-name=${property}`,
    "--type=string",
  ], { acceptExisting: true });
  console.log(`Vectorize metadata index requested: ${property}`);
}
