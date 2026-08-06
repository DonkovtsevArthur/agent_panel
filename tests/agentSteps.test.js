const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ensureToolResultsIntentHint,
  hasToolResultsIntentHint,
  TOOL_RESULTS_INTENT_MARKER,
  previewText,
  toolStepId,
} = require("../out/agentSteps.js");

test("ensureToolResultsIntentHint inserts once", () => {
  const messages = [
    { role: "system", content: "base" },
    { role: "user", content: "do it" },
    { role: "assistant", content: null, tool_calls: [{ id: "1" }] },
    { role: "tool", tool_call_id: "1", content: "ok" },
  ];
  assert.equal(ensureToolResultsIntentHint(messages), true);
  assert.equal(hasToolResultsIntentHint(messages), true);
  assert.ok(
    messages.some(
      (m) =>
        typeof m.content === "string" &&
        m.content.includes(TOOL_RESULTS_INTENT_MARKER)
    )
  );
  assert.equal(ensureToolResultsIntentHint(messages), false);
  assert.equal(
    messages.filter(
      (m) =>
        typeof m.content === "string" &&
        m.content.includes(TOOL_RESULTS_INTENT_MARKER)
    ).length,
    1
  );
});

test("VERIFY_REPO_FACTS_HINT stays universal (no task hardcoding)", () => {
  const {
    VERIFY_REPO_FACTS_HINT,
    PARALLEL_READS_HINT_MARKER,
  } = require("../out/agentSteps.js");
  assert.match(VERIFY_REPO_FACTS_HINT, /verify with list_files \/ read_file/i);
  assert.doesNotMatch(VERIFY_REPO_FACTS_HINT, /package\.json/i);
  assert.doesNotMatch(VERIFY_REPO_FACTS_HINT, /верси/i);
  assert.ok(VERIFY_REPO_FACTS_HINT.includes(PARALLEL_READS_HINT_MARKER));
  assert.match(VERIFY_REPO_FACTS_HINT, /parallel/i);
});

test("FOCUSED_EDIT_HINT nudges toward search_replace over write_file", () => {
  const { FOCUSED_EDIT_HINT } = require("../out/agentSteps.js");
  assert.match(FOCUSED_EDIT_HINT, /search_replace/i);
  assert.match(FOCUSED_EDIT_HINT, /write_file/i);
  assert.match(FOCUSED_EDIT_HINT, /only to create a new file or to rewrite/i);
  assert.match(FOCUSED_EDIT_HINT, /untouched|not rewritten|leaves the rest/i);
});

test("previewText truncates", () => {
  assert.equal(previewText("short"), "short");
  assert.ok(previewText("x".repeat(200), 20).endsWith("…"));
});

test("toolStepId is stable", () => {
  assert.equal(toolStepId("abc"), "tool:abc");
});
