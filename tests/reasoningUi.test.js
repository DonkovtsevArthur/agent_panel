const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeReasoningContent,
  mergeReasoningChunks,
  appendReasoningDelta,
  finalizeRoundReasoning,
} = require("../out/reasoningUi.js");

test("normalizeReasoningContent drops placeholders", () => {
  assert.equal(normalizeReasoningContent(""), "");
  assert.equal(normalizeReasoningContent(" "), "");
  assert.equal(normalizeReasoningContent("  think  "), "think");
});

test("mergeReasoningChunks avoids duplicates", () => {
  assert.equal(mergeReasoningChunks("", "a"), "a");
  assert.equal(mergeReasoningChunks("a", ""), "a");
  assert.equal(mergeReasoningChunks("hello", "hello world"), "hello world");
  assert.equal(mergeReasoningChunks("hello world", "world"), "hello world");
  assert.equal(mergeReasoningChunks("a", "b"), "a\n\nb");
});

test("appendReasoningDelta concatenates stream tokens without spaces", () => {
  let text = "";
  for (const part of ["П", "ользователь", " хочет", " версию"]) {
    text = appendReasoningDelta(text, part);
  }
  assert.equal(text, "Пользователь хочет версию");
});

test("appendReasoningDelta accepts cumulative snapshots via startsWith only", () => {
  assert.equal(appendReasoningDelta("По", "Польз"), "Польз");
  // Short token that appears inside previous must NOT replace previous.
  assert.equal(
    appendReasoningDelta("Пользователь хочет версию", "а"),
    "Пользователь хочет версиюа"
  );
});

test("append across rounds uses separate buffers then merge", () => {
  let round1 = "";
  for (const part of ["Сейчас ", "package.json"]) {
    round1 = appendReasoningDelta(round1, part);
  }
  let round2 = "";
  for (const part of ["Нужно ", "обновить"]) {
    round2 = appendReasoningDelta(round2, part);
  }
  assert.equal(round1, "Сейчас package.json");
  assert.equal(round2, "Нужно обновить");
  assert.equal(
    mergeReasoningChunks(round1, round2),
    "Сейчас package.json\n\nНужно обновить"
  );
});

test("finalizeRoundReasoning prefers message field", () => {
  assert.equal(
    finalizeRoundReasoning("partial stream", "full authoritative text"),
    "full authoritative text"
  );
  assert.equal(finalizeRoundReasoning("only stream", ""), "only stream");
});
