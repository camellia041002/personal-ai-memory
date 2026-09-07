export const LIMITS = Object.freeze({
  key: 200,
  value: 100_000,
  query: 500,
  owner: 32,
  note: 40,
  findKeys: 20,
  recentDays: 30,
  adminPage: 1_000,
});

export const INDEX_VERSION = "v8-public-qwen3-embedding-0.6b";

function baseMeta(category, index) {
  return { category, owner: "none", date: null, note: null, index };
}

export function normalizeOwner(owner) {
  if (typeof owner !== "string") throw new Error("owner must be a string");
  const normalized = owner.trim().toLowerCase();
  if (!normalized || normalized.length > LIMITS.owner) {
    throw new Error(`owner must be 1-${LIMITS.owner} characters`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw new Error("owner may contain lowercase letters, numbers, and hyphens");
  }
  return normalized;
}

export function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function classifyKey(key) {
  const value = String(key || "");
  if (value.startsWith("obsolete_")) return baseMeta("obsolete", false);
  if (value.startsWith("archive_") || value.includes("_history_")) {
    return baseMeta("history", false);
  }

  const daily = value.match(/^([a-z0-9][a-z0-9-]{0,31})_daily_(\d{4}-\d{2}-\d{2})(?:_(.+))?$/u);
  if (daily && isIsoDate(daily[2])) {
    return {
      category: "daily",
      owner: daily[1],
      date: daily[2],
      note: daily[3] || null,
      index: true,
    };
  }

  const event = value.match(/^([a-z0-9][a-z0-9-]{0,31})_event_/u);
  if (event) return { ...baseMeta("event", true), owner: event[1] };
  if (value.startsWith("person_")) return baseMeta("person_profile", true);
  if (value.startsWith("tool_")) return baseMeta("tool", true);
  if (value.startsWith("proj_") || value.startsWith("project_")) return baseMeta("project", true);
  if (value === "job_search" || value.startsWith("job_")) return baseMeta("job", true);
  if (value === "todo" || value.startsWith("todo_") || value === "待办" || value.startsWith("待办_")) {
    return baseMeta("todo", true);
  }
  return baseMeta("general", true);
}

export function validateKeyValue(key, value) {
  if (typeof key !== "string" || !key.trim()) throw new Error("key is required");
  if (key.length > LIMITS.key) throw new Error(`key must not exceed ${LIMITS.key} characters`);
  if (/[\u0000-\u001f\u007f]/u.test(key)) throw new Error("key must not contain control characters");
  if (typeof value !== "string") throw new Error("value must be a string");
  if (value.length > LIMITS.value) throw new Error(`value must not exceed ${LIMITS.value} characters`);
}

export function normalizeQuery(query) {
  const value = typeof query === "string" ? query.trim() : "";
  if (!value) throw new Error("query is required");
  if (value.length > LIMITS.query) throw new Error(`query must not exceed ${LIMITS.query} characters`);
  return value;
}

export function normalizeDailyNote(note) {
  if (note === undefined || note === null || note === "") return "";
  const cleaned = String(note)
    .trim()
    .replace(/[\r\n/\\]/g, "-")
    .replace(/^_+|_+$/g, "");
  if (!cleaned) return "";
  if (cleaned.length > LIMITS.note) throw new Error(`note must not exceed ${LIMITS.note} characters`);
  return cleaned;
}

export function clampInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

export function splitText(text, options = {}) {
  const target = options.target || 650;
  const max = options.max || 850;
  const overlap = options.overlap || 100;
  const normalized = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized || !/[\p{L}\p{N}]/u.test(normalized)) return [];

  const paragraphs = normalized.split(/\n{2,}/u).map((part) => part.trim()).filter(Boolean);
  const units = paragraphs.flatMap((paragraph) => (
    paragraph.length <= max ? [paragraph] : splitLongParagraph(paragraph, max)
  ));

  const chunks = [];
  let current = "";
  for (const unit of units) {
    const candidate = current ? `${current}\n\n${unit}` : unit;
    if (candidate.length <= max && (current.length < target || unit.length < target / 2)) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    const prefix = current ? current.slice(-overlap) : "";
    current = prefix ? `${prefix}\n\n${unit}`.slice(-max) : unit;
  }
  if (current) chunks.push(current);
  return [...new Set(chunks.map((chunk) => chunk.trim()).filter((chunk) => /[\p{L}\p{N}]/u.test(chunk)))];
}

function splitLongParagraph(text, max) {
  const sentences = text.split(/(?<=[。！？!?；;])\s*/u).filter(Boolean);
  if (sentences.length <= 1) {
    const parts = [];
    for (let index = 0; index < text.length; index += max) parts.push(text.slice(index, index + max));
    return parts;
  }

  const parts = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > max) {
      parts.push(current);
      current = "";
    }
    if (sentence.length > max) {
      if (current) parts.push(current);
      current = "";
      for (let index = 0; index < sentence.length; index += max) {
        parts.push(sentence.slice(index, index + max));
      }
    } else {
      current += sentence;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export async function vectorIdFor(key, chunkIndex) {
  const bytes = new TextEncoder().encode(`${INDEX_VERSION}\0${key}\0${chunkIndex}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}

export function normalizeSearchFilters(args = {}) {
  const filters = {};
  for (const key of ["category", "owner"]) {
    if (typeof args[key] === "string" && args[key].trim()) filters[key] = args[key].trim();
  }
  for (const key of ["dateFrom", "dateTo"]) {
    if (args[key] !== undefined && args[key] !== "") {
      if (!isIsoDate(args[key])) throw new Error(`${key} must be YYYY-MM-DD`);
      filters[key] = args[key];
    }
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    throw new Error("dateFrom must not be after dateTo");
  }
  return filters;
}

export function scoreCandidate(row, query, semanticScore, exactSource) {
  const text = row.chunk_text || "";
  const key = row.memory_key || "";
  const lowerQuery = query.toLocaleLowerCase("zh-CN");
  const exactText = text.toLocaleLowerCase("zh-CN").includes(lowerQuery);
  const exactKey = key.toLocaleLowerCase("zh-CN").includes(lowerQuery);
  const score = semanticScore + (exactText ? 2 : 0) + (exactKey ? 0.6 : 0) + (exactSource && exactText ? 0.1 : 0);
  return {
    key,
    chunkIndex: Number(row.chunk_index),
    category: row.category,
    owner: row.owner,
    date: row.memory_date,
    score: Number(score.toFixed(6)),
    semanticScore: Number(semanticScore.toFixed(6)),
    exactMatch: exactText,
    chunk: text,
  };
}
