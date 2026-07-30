const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildEarlierConversationSummary,
  compactHistoryWithSummary,
  extractMentionedPaths,
} = require("../out/historySummary.js");
const { estimateTokens } = require("../out/contextBudget.js");
const { applyContextBudget } = require("../out/contextBudget.js");

test("extractMentionedPaths finds file-like tokens", () => {
  assert.deepEqual(
    extractMentionedPaths("See `src/agentLoop.ts` and media/panel.js please"),
    ["src/agentLoop.ts", "media/panel.js"]
  );
});

test("buildEarlierConversationSummary lists goals answers and files", () => {
  const summary = buildEarlierConversationSummary([
    { role: "user", content: "Fix the bug in src/tools.ts" },
    {
      role: "assistant",
      content: "I updated the command policy in src/tools.ts",
    },
    { role: "user", content: "Also check tests/gitCommandPolicy.test.js" },
  ]);
  assert.match(summary, /Earlier conversation summary/);
  assert.match(summary, /Fix the bug/);
  assert.match(summary, /updated the command policy/);
  assert.match(summary, /src\/tools\.ts/);
});

test("compactHistoryWithSummary folds older turns into one summary", () => {
  const history = [];
  for (let i = 0; i < 10; i += 1) {
    history.push({
      role: "user",
      content: `Please inspect file_${i}.ts and explain the flow in detail. `.repeat(
        20
      ),
    });
    history.push({
      role: "assistant",
      content: `I reviewed file_${i}.ts and described the module. `.repeat(20),
    });
  }

  const compacted = compactHistoryWithSummary(history, {
    keepRecentMessages: 4,
    summarizeMessageThreshold: 6,
    maxHistoryTokens: 3_000,
    maxCharsPerMessage: 2_000,
  });

  assert.ok(compacted.length < history.length);
  assert.ok(compacted.length <= 5);
  assert.match(String(compacted[0].content), /Earlier conversation summary/);
  assert.equal(compacted.at(-1)?.role, "assistant");
  assert.ok(estimateTokens(compacted) < estimateTokens(history));
});

test("short history is left intact", () => {
  const history = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ];
  assert.deepEqual(compactHistoryWithSummary(history), history);
});

test("softTargetTokens compacts before hard budget is hit", () => {
  const messages = [
    { role: "system", content: "policy" },
    { role: "user", content: "old" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "t1",
          type: "function",
          function: { name: "read_file", arguments: "{}" },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "t1",
      name: "read_file",
      content: "X".repeat(8_000),
    },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "t2",
          type: "function",
          function: { name: "read_file", arguments: "{}" },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "t2",
      name: "read_file",
      content: "Y".repeat(2_000),
    },
    { role: "user", content: "latest" },
  ];

  const hardOnly = applyContextBudget(messages, {
    contextWindow: 20_000,
    reservedOutputTokens: 1_000,
    safetyMarginTokens: 500,
  });
  assert.equal(hardOnly.compacted, false);

  const soft = applyContextBudget(messages, {
    contextWindow: 20_000,
    reservedOutputTokens: 1_000,
    safetyMarginTokens: 500,
    softTargetTokens: 1_500,
  });
  assert.equal(soft.compacted, true);
  assert.ok(soft.estimatedTokens < hardOnly.estimatedTokens);
  assert.match(String(soft.messages[3].content), /older tool result compacted/);
});
