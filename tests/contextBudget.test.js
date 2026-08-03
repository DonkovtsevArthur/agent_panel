const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyContextBudget,
  calculateContextBudget,
  collectSuccessfulEditPaths,
  createAgentImplementPreserve,
  estimateTokens,
  looksLikeAgentImplementToolResult,
  looksLikePlanGroundingToolResult,
  pullPreservedToolRounds,
  shouldPreserveToolResultFromCompaction,
} = require("../out/contextBudget.js");

function toolRound(id, result, reasoning = `reasoning-${id}`, args = "{}") {
  return [
    {
      role: "assistant",
      content: null,
      reasoning_content: reasoning,
      tool_calls: [
        {
          id,
          type: "function",
          function: { name: "read_file", arguments: args },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: id,
      name: "read_file",
      content: result,
    },
  ];
}

test("budget subtracts reserved output and safety margin", () => {
  assert.equal(
    calculateContextBudget({
      contextWindow: 16_000,
      reservedOutputTokens: 4_000,
      safetyMarginTokens: 1_000,
    }),
    11_000
  );
});

test("oversized history compacts old rounds and preserves invariants", () => {
  const messages = [
    { role: "system", content: "policy that must stay intact" },
    { role: "user", content: "old request" },
    ...toolRound("old-1", "A".repeat(12_000), "keep old reasoning exactly"),
    ...toolRound(
      "old-2",
      "B".repeat(12_000),
      "keep second reasoning exactly",
      JSON.stringify({ path: "x".repeat(4_000) })
    ),
    ...toolRound("latest", "C".repeat(6_000), "latest reasoning"),
    { role: "user", content: "latest user instruction" },
  ];
  const original = structuredClone(messages);
  const latestRound = structuredClone(messages.slice(6, 8));
  const latestUser = structuredClone(messages.at(-1));

  const result = applyContextBudget(messages, {
    contextWindow: 6_000,
    reservedOutputTokens: 1_000,
    safetyMarginTokens: 500,
  });

  assert.equal(result.budgetTokens, 4_500);
  assert.equal(result.compacted, true);
  assert.equal(result.fits, true);
  assert.ok(result.estimatedTokens <= result.budgetTokens);
  assert.ok(result.estimatedTokens < estimateTokens(messages));

  assert.deepEqual(messages, original, "input history must not be mutated");
  assert.deepEqual(result.messages[0], messages[0], "system is immutable");
  assert.deepEqual(result.messages.slice(6, 8), latestRound);
  assert.deepEqual(result.messages.at(-1), latestUser);

  assert.equal(
    result.messages[2].reasoning_content,
    "keep old reasoning exactly"
  );
  assert.equal(
    result.messages[4].reasoning_content,
    "keep second reasoning exactly"
  );

  for (const assistantIndex of [2, 4, 6]) {
    const assistant = result.messages[assistantIndex];
    const tool = result.messages[assistantIndex + 1];
    assert.equal(assistant.tool_calls[0].id, tool.tool_call_id);
  }
});

test("does not alter protected messages when no old completed round can shrink", () => {
  const messages = [
    { role: "system", content: "S".repeat(8_000) },
    { role: "user", content: "current request" },
    ...toolRound("latest", "T".repeat(8_000), "reasoning must remain"),
  ];

  const result = applyContextBudget(messages, {
    contextWindow: 2_000,
    reservedOutputTokens: 500,
    safetyMarginTokens: 250,
  });

  assert.equal(result.fits, false);
  assert.equal(result.compacted, false);
  assert.deepEqual(result.messages, messages);
  assert.notEqual(result.messages, messages);
});

test("compacts old plain conversation while preserving latest user", () => {
  const messages = [
    { role: "system", content: "policy" },
    { role: "user", content: "old question " + "Q".repeat(12_000) },
    { role: "assistant", content: "old answer " + "A".repeat(12_000) },
    { role: "user", content: "current request must remain exact" },
  ];

  const result = applyContextBudget(messages, {
    contextWindow: 3_000,
    reservedOutputTokens: 500,
    safetyMarginTokens: 250,
  });

  assert.equal(result.fits, true);
  assert.equal(result.compacted, true);
  assert.equal(result.messages[0].content, "policy");
  assert.equal(result.messages.at(-1).content, "current request must remain exact");
  assert.match(result.messages[1].content, /older conversation compacted/);
  assert.match(result.messages[2].content, /older conversation compacted/);
});

function figmaRound(id, result) {
  return [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id,
          type: "function",
          function: {
            name: "mcp__figma__get_screenshot",
            arguments: '{"fileKey":"abc","nodeId":"1:2"}',
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: id,
      name: "mcp__figma__get_screenshot",
      content: result,
    },
  ];
}

test("looksLikePlanGroundingToolResult detects paths/routes/shared UI reads", () => {
  assert.equal(
    looksLikePlanGroundingToolResult({
      role: "tool",
      name: "read_file",
      content: JSON.stringify({
        path: "src/shared/paths.ts",
        content: "export const PATHS = {}",
      }),
    }),
    true
  );
  assert.equal(
    looksLikePlanGroundingToolResult({
      role: "tool",
      name: "read_file",
      content: JSON.stringify({
        path: "src/features/foo/bar.tsx",
        content: "export const X = 1",
      }),
    }),
    false
  );
});

test("shouldPreserveToolResultFromCompaction detects Figma and vision helper", () => {
  assert.equal(
    shouldPreserveToolResultFromCompaction({
      role: "tool",
      name: "mcp__figma__get_design_context",
      content: "x".repeat(1000),
    }),
    true
  );
  assert.equal(
    shouldPreserveToolResultFromCompaction({
      role: "tool",
      name: "read_file",
      content: "[Harbor vision helper · Gemini] Columns: A",
    }),
    true
  );
  assert.equal(
    shouldPreserveToolResultFromCompaction({
      role: "tool",
      name: "read_file",
      content: "A".repeat(1000),
    }),
    false
  );
});

test("applyContextBudget does not shrink old Figma tool results", () => {
  const figmaBody =
    "[Harbor vision helper · Gemini 2.5 Flash] Columns: ФИО, Профессия " +
    "L".repeat(8_000);
  const messages = [
    { role: "system", content: "policy" },
    { role: "user", content: "plan from figma" },
    ...figmaRound("fig-1", figmaBody),
    ...toolRound("read-1", "R".repeat(12_000)),
    ...toolRound("latest", "C".repeat(2_000)),
    { role: "user", content: "continue" },
  ];

  const result = applyContextBudget(messages, {
    contextWindow: 6_000,
    reservedOutputTokens: 1_000,
    safetyMarginTokens: 500,
  });

  assert.equal(result.compacted, true);
  assert.equal(result.messages[3].content, figmaBody);
  assert.match(String(result.messages[5].content), /older tool result compacted/);
});

test("pullPreservedToolRounds pins Figma rounds and leaves the rest", () => {
  const figmaBody = "[Harbor vision helper · X] Title: Удостоверение";
  const messages = [
    { role: "user", content: "start" },
    ...figmaRound("fig-1", figmaBody),
    ...toolRound("read-1", "file body"),
    { role: "user", content: "later" },
  ];
  const { pinned, remainder } = pullPreservedToolRounds(messages);
  assert.equal(pinned.length, 2);
  assert.equal(pinned[1].content, figmaBody);
  assert.equal(remainder.length, 4);
  assert.ok(remainder.every((m) => m.name !== "mcp__figma__get_screenshot"));
});

test("looksLikeAgentImplementToolResult pins grounding and edited-path reads", () => {
  const uiRead = {
    role: "tool",
    name: "read_file",
    content: JSON.stringify({
      path: "src/shared/ui/toast.tsx",
      content: "export const Toast = () => null;\n".repeat(20),
    }),
  };
  const pageRead = {
    role: "tool",
    name: "read_file",
    content: JSON.stringify({
      path: "src/pages/certificate/page.tsx",
      content: "export const Page = () => null;\n".repeat(20),
    }),
  };
  const noise = {
    role: "tool",
    name: "read_file",
    content: JSON.stringify({
      path: "src/features/foo/bar.tsx",
      content: "export const X = 1;\n".repeat(20),
    }),
  };
  assert.equal(looksLikeAgentImplementToolResult(uiRead, []), true);
  assert.equal(looksLikeAgentImplementToolResult(pageRead, []), false);
  assert.equal(
    looksLikeAgentImplementToolResult(pageRead, [
      "src/pages/certificate/page.tsx",
    ]),
    true
  );
  assert.equal(
    looksLikeAgentImplementToolResult(noise, [
      "src/pages/certificate/page.tsx",
    ]),
    false
  );
});

test("createAgentImplementPreserve uses successful edit paths", () => {
  const messages = [
    {
      role: "tool",
      name: "read_file",
      content: JSON.stringify({
        path: "src/pages/certificate/page.tsx",
        content: "PAGE".repeat(2_000),
      }),
    },
    {
      role: "tool",
      name: "write_file",
      content: JSON.stringify({
        ok: true,
        path: "src/pages/certificate/page.tsx",
        created: true,
        added: 10,
        removed: 0,
      }),
    },
  ];
  assert.deepEqual(collectSuccessfulEditPaths(messages), [
    "src/pages/certificate/page.tsx",
  ]);
  const preserve = createAgentImplementPreserve(messages);
  assert.equal(preserve(messages[0]), true);
});

test("applyContextBudget does not shrink Agent implement reads of edited paths", () => {
  const pageBody = JSON.stringify({
    path: "src/pages/certificate/page.tsx",
    content: "P".repeat(10_000),
  });
  const noiseBody = "N".repeat(12_000);
  const messages = [
    { role: "system", content: "policy" },
    { role: "user", content: "implement" },
    ...toolRound("read-page", pageBody),
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "w1",
          type: "function",
          function: {
            name: "write_file",
            arguments: '{"relativePath":"src/pages/certificate/page.tsx"}',
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "w1",
      name: "write_file",
      content: JSON.stringify({
        ok: true,
        path: "src/pages/certificate/page.tsx",
        created: true,
        added: 40,
        removed: 0,
      }),
    },
    ...toolRound("noise", noiseBody),
    ...toolRound("latest", "C".repeat(2_000)),
    { role: "user", content: "continue" },
  ];
  const preserve = createAgentImplementPreserve(messages);
  const result = applyContextBudget(messages, {
    contextWindow: 6_000,
    reservedOutputTokens: 1_000,
    safetyMarginTokens: 500,
    preserveToolResult: preserve,
  });
  assert.equal(result.compacted, true);
  assert.equal(result.messages[3].content, pageBody);
  assert.match(String(result.messages[7].content), /older tool result compacted/);
});

test("pullPreservedToolRounds pins Agent implement reads via extra predicate", () => {
  const pageBody = JSON.stringify({
    path: "src/pages/certificate/page.tsx",
    content: "PAGE",
  });
  const messages = [
    { role: "user", content: "start" },
    ...toolRound("read-page", pageBody),
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "w1",
          type: "function",
          function: {
            name: "write_file",
            arguments: "{}",
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "w1",
      name: "write_file",
      content: JSON.stringify({
        ok: true,
        path: "src/pages/certificate/page.tsx",
        created: true,
        added: 1,
        removed: 0,
      }),
    },
    ...toolRound("noise", "noise body"),
  ];
  const preserve = createAgentImplementPreserve(messages);
  const { pinned, remainder } = pullPreservedToolRounds(messages, {
    preserveToolResult: preserve,
  });
  assert.ok(pinned.some((m) => m.content === pageBody));
  assert.ok(remainder.some((m) => m.content === "noise body"));
});

test("applyContextBudget skips deep clone when already under budget", () => {
  const big = "V".repeat(50_000);
  const toolMsg = {
    role: "tool",
    tool_call_id: "t1",
    name: "mcp__figma__get_screenshot",
    content: big,
  };
  const messages = [
    { role: "system", content: "policy" },
    { role: "user", content: "plan" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "t1",
          type: "function",
          function: {
            name: "mcp__figma__get_screenshot",
            arguments: "{}",
          },
        },
      ],
    },
    toolMsg,
  ];
  const result = applyContextBudget(messages, {
    contextWindow: 200_000,
    reservedOutputTokens: 4_000,
    safetyMarginTokens: 1_000,
  });
  assert.equal(result.compacted, false);
  assert.equal(result.fits, true);
  // Shallow array copy, shared message/content refs — no peak ×2 on Figma.
  assert.notStrictEqual(result.messages, messages);
  assert.strictEqual(result.messages[3], toolMsg);
  assert.strictEqual(result.messages[3].content, big);
});
