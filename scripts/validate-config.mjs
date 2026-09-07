import { readFile } from "node:fs/promises";
import process from "node:process";

export function stripJsonComments(input) {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        output += char;
      }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      } else if (char === "\n") {
        output += char;
      }
      continue;
    }
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
    } else if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
    } else {
      output += char;
    }
  }
  return output;
}

export function validateConfig(config) {
  const bindings = [
    ...(config.kv_namespaces || []).map((item) => item.binding),
    ...(config.d1_databases || []).map((item) => item.binding),
    ...(config.vectorize || []).map((item) => item.binding),
    config.ai?.binding,
  ];
  const requiredBindings = ["MEMORY"];
  if ((config.vectorize || []).length) requiredBindings.push("VECTORIZE_INDEX", "AI");
  if ((config.d1_databases || []).length) requiredBindings.push("DB", "VECTORIZE_INDEX", "AI");
  for (const binding of requiredBindings) {
    if (!bindings.includes(binding)) throw new Error(`Missing binding: ${binding}`);
  }
  if (typeof config.main !== "string" || !config.main.endsWith("worker.js")) {
    throw new Error("main must point to a worker.js file");
  }
  return true;
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) {
  const paths = process.argv.slice(2);
  if (!paths.length) paths.push("wrangler.example.jsonc");
  for (const path of paths) {
    const raw = await readFile(path, "utf8");
    validateConfig(JSON.parse(stripJsonComments(raw)));
    console.log(`${path}: valid JSONC with required bindings`);
  }
}
