const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ensureToolResultsIntentHint,
  hasToolResultsIntentHint,
  TOOL_RESULTS_INTENT_MARKER,
  previewText,
  toolStepId,
} = require("../out/agentSteps.js");

const { prepareRoundMessages } = require("../out/prepareRoundMessages.js");

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
  // Must mention that the rest of the file is left untouched.
  assert.match(FOCUSED_EDIT_HINT, /untouched|not rewritten|leaves the rest/i);
});

test("previewText truncates", () => {
  assert.equal(previewText("short"), "short");
  assert.ok(previewText("x".repeat(200), 20).endsWith("…"));
});

test("toolStepId is stable", () => {
  assert.equal(toolStepId("abc"), "tool:abc");
});

test("prepareRoundMessages shrinks oversized tool history", () => {
  const big = "z".repeat(20_000);
  const messages = [
    { role: "system", content: "sys" },
    { role: "user", content: "start" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "c1",
          type: "function",
          function: { name: "read_file", arguments: "{}" },
        },
      ],
    },
    { role: "tool", tool_call_id: "c1", name: "read_file", content: big },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "c2",
          type: "function",
          function: { name: "read_file", arguments: "{}" },
        },
      ],
    },
    { role: "tool", tool_call_id: "c2", name: "read_file", content: "newest" },
  ];
  const before = messages[3].content.length;
  const result = prepareRoundMessages({
    messages,
    modelId: "DeepSeek-V4-Flash",
    contextWindow: 8_000,
    reservedOutputTokens: 1_000,
    kimi: false,
  });
  // Fragile gateway shrink runs before budget; content must shrink either way.
  assert.ok(messages[3].content.length < before);
  assert.ok(result.estimatedTokens > 0);
});

test("DeepSeek prepareRoundMessages caps a single large read under big context", () => {
  const payload = JSON.stringify({
    path: "package.json",
    content: "{\n" + "  \"x\": 1,\n".repeat(2_000) + "}\n",
  });
  const messages = [
    { role: "system", content: "sys" },
    { role: "user", content: "20" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "c1",
          type: "function",
          function: { name: "read_file", arguments: "{}" },
        },
      ],
    },
    { role: "tool", tool_call_id: "c1", name: "read_file", content: payload },
  ];
  const before = messages[3].content.length;
  assert.ok(before > 5_000);
  prepareRoundMessages({
    messages,
    modelId: "DeepSeek-V4-Flash",
    contextWindow: 128_000,
    reservedOutputTokens: 4_000,
    kimi: false,
  });
  assert.ok(messages[3].content.length < before);
  assert.ok(messages[3].content.length < 3_500);
});

test("Haiku prepareRoundMessages uses fragile gateway shrink", () => {
  const payload = JSON.stringify({
    path: "package.json",
    content: "y".repeat(10_000),
  });
  const messages = [
    { role: "user", content: "bump" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "h1",
          type: "function",
          function: { name: "read_file", arguments: "{}" },
        },
      ],
    },
    { role: "tool", tool_call_id: "h1", name: "read_file", content: payload },
  ];
  prepareRoundMessages({
    messages,
    modelId: "claude-haiku-4-5",
    contextWindow: 200_000,
    reservedOutputTokens: 4_000,
    kimi: false,
  });
  assert.ok(String(messages[2].content).length < 3_500);
});
