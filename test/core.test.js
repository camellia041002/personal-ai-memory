import assert from "node:assert/strict";
import test from "node:test";

import {
  LIMITS,
  classifyKey,
  isIsoDate,
  normalizeDailyNote,
  normalizeOwner,
  normalizeQuery,
  normalizeSearchFilters,
  scoreCandidate,
  splitText,
  validateKeyValue,
  vectorIdFor,
} from "../src/core.js";

test("project_ and proj_ share the project category", () => {
  assert.equal(classifyKey("project_demo").category, "project");
  assert.equal(classifyKey("proj_demo").category, "project");
});

test("daily keys use generic owners and valid dates", () => {
  assert.deepEqual(classifyKey("user-a_daily_2026-08-18_evening"), {
    category: "daily",
    owner: "user-a",
    date: "2026-08-18",
    note: "evening",
    index: true,
  });
  assert.equal(classifyKey("user-a_daily_2026-02-30").category, "general");
  assert.equal(normalizeOwner(" User-A "), "user-a");
  assert.throws(() => normalizeOwner("name_with_underscore"));
});

test("ISO date validation rejects calendar overflow", () => {
  assert.equal(isIsoDate("2026-09-04"), true);
  assert.equal(isIsoDate("2026-02-30"), false);
  assert.equal(isIsoDate("20260904"), false);
});

test("key, value, query, and note limits are enforced", () => {
  assert.doesNotThrow(() => validateKeyValue("key", "value"));
  assert.throws(() => validateKeyValue("x".repeat(LIMITS.key + 1), "value"));
  assert.throws(() => validateKeyValue("key", "x".repeat(LIMITS.value + 1)));
  assert.throws(() => validateKeyValue("bad\nkey", "value"));
  assert.equal(normalizeQuery(" 中文短语 "), "中文短语");
  assert.throws(() => normalizeQuery("x".repeat(LIMITS.query + 1)));
  assert.equal(normalizeDailyNote("_evening/note_"), "evening-note");
});

test("splitText returns bounded, overlapping chunks", () => {
  const text = `${"甲".repeat(500)}。${"乙".repeat(500)}。${"丙".repeat(500)}。`;
  const chunks = splitText(text, { target: 400, max: 600, overlap: 80 });
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((chunk) => chunk.length <= 600));
  assert.equal(new Set(chunks).size, chunks.length);
});

test("stable vector IDs differ by key and chunk", async () => {
  const first = await vectorIdFor("project_demo", 0);
  assert.equal(first.length, 40);
  assert.equal(first, await vectorIdFor("project_demo", 0));
  assert.notEqual(first, await vectorIdFor("project_demo", 1));
  assert.notEqual(first, await vectorIdFor("project_other", 0));
});

test("search filters validate date ranges", () => {
  assert.deepEqual(normalizeSearchFilters({ category: "project", dateFrom: "2026-01-01" }), {
    category: "project",
    dateFrom: "2026-01-01",
  });
  assert.throws(() => normalizeSearchFilters({ dateFrom: "2026-12-01", dateTo: "2026-01-01" }));
});

test("exact phrase and key matches receive documented bonuses", () => {
  const scored = scoreCandidate({
    memory_key: "project_garden",
    chunk_index: 0,
    chunk_text: "阳台种植计划",
    category: "project",
    owner: "none",
    memory_date: null,
  }, "种植", 0.75, true);
  assert.equal(scored.score, 2.85);
  assert.equal(scored.exactMatch, true);
});
