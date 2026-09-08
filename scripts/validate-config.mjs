import { readFile } from "node:fs/promises";
import process from "node:process";

const KV_ID_PATTERN = /^[0-9a-f]{32}$/i;
const D1_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESOURCE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;
const PLACEHOLDER_PATTERN = /<[^<>]+>/;

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

export function validateConfig(config, options = {}) {
  const mode = options.mode || "deploy";
  if (!(["deploy", "template", "provision"].includes(mode))) throw new Error(`Unknown validation mode: ${mode}`);
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Configuration must be a JSON object");
  }
  if (mode === "deploy") rejectPlaceholders(config);

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
  if (typeof config.name !== "string" || !RESOURCE_NAME_PATTERN.test(config.name)) {
    throw new Error("name must be a non-empty Worker resource name");
  }
  if (!isIsoDate(config.compatibility_date)) {
    throw new Error("compatibility_date must be YYYY-MM-DD");
  }

  for (const item of config.kv_namespaces || []) {
    validateRequiredString(item?.binding, "KV binding", mode, RESOURCE_NAME_PATTERN);
    if (!(mode === "provision" && item?.id === undefined)) {
      validateRequiredString(item?.id, `KV namespace ID for ${item?.binding || "unknown binding"}`, mode, KV_ID_PATTERN);
    }
  }
  for (const item of config.d1_databases || []) {
    validateRequiredString(item?.binding, "D1 binding", mode, RESOURCE_NAME_PATTERN);
    validateRequiredString(item?.database_name, `D1 database name for ${item?.binding || "unknown binding"}`, mode, RESOURCE_NAME_PATTERN);
    validateRequiredString(item?.database_id, `D1 database ID for ${item?.binding || "unknown binding"}`, mode, D1_ID_PATTERN);
  }
  for (const item of config.vectorize || []) {
    validateRequiredString(item?.binding, "Vectorize binding", mode, RESOURCE_NAME_PATTERN);
    validateRequiredString(item?.index_name, `Vectorize index name for ${item?.binding || "unknown binding"}`, mode, RESOURCE_NAME_PATTERN);
  }
  if (config.ai) validateRequiredString(config.ai.binding, "Workers AI binding", mode, RESOURCE_NAME_PATTERN);
  return true;
}

function validateRequiredString(value, label, mode, pattern) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must not be empty`);
  if (mode === "template" && isPlaceholder(value)) return;
  if (!pattern.test(value)) throw new Error(`${label} has an invalid format`);
}

function isPlaceholder(value) {
  return typeof value === "string" && /^<[A-Z0-9_]+>$/.test(value);
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function rejectPlaceholders(value, path = "config") {
  if (typeof value === "string" && PLACEHOLDER_PATTERN.test(value)) {
    throw new Error(`Unreplaced placeholder at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectPlaceholders(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) rejectPlaceholders(item, `${path}.${key}`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) {
  const args = process.argv.slice(2);
  let mode = "deploy";
  if (["--template", "--deploy", "--provision"].includes(args[0])) mode = args.shift().slice(2);
  const paths = args;
  if (!paths.length) paths.push(mode === "template" ? "wrangler.example.jsonc" : "wrangler.jsonc");
  for (const path of paths) {
    try {
      const raw = await readFile(path, "utf8");
      validateConfig(JSON.parse(stripJsonComments(raw)), { mode });
      const result = mode === "template"
        ? "valid template structure"
        : mode === "provision"
          ? "valid automatic-provisioning configuration"
          : "deployable configuration valid";
      console.log(`${path}: ${result}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${path}: invalid ${mode} configuration: ${message}`);
      process.exitCode = 1;
    }
  }
}
