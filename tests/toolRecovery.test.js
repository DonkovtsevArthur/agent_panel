const test = require("node:test");
const assert = require("node:assert/strict");

const {
  shrinkToolMessageContents,
  shrinkOlderToolResults,
  formatToolEvidenceFallbackAnswer,
  modelNeedsAggressiveToolBudget,
} = require("../out/toolRecovery.js");

test("shrinkToolMessageContents truncates long tool payloads", () => {
  const messages = [
    { role: "user", content: "hi" },
    {
      role: "tool",
      name: "read_file",
      content: "x".repeat(5_000),
    },
  ];
  assert.equal(shrinkToolMessageContents(messages, 1000), true);
  assert.ok(String(messages[1].content).length < 1200);
  assert.ok(String(messages[1].content).includes("truncated for recovery"));
  assert.equal(shrinkToolMessageContents(messages, 1000), false);
});

test("shrinkOlderToolResults keeps recent tools intact", () => {
  const messages = [
    { role: "tool", name: "read_file", content: "a".repeat(5_000) },
    { role: "tool", name: "read_file", content: "b".repeat(5_000) },
    { role: "tool", name: "read_file", content: "c".repeat(5_000) },
    { role: "tool", name: "read_file", content: "d".repeat(100) },
  ];
  assert.equal(
    shrinkOlderToolResults(messages, { keepRecent: 1, maxOldChars: 800 }),
    true
  );
  assert.ok(String(messages[0].content).includes("older tool result compacted"));
  assert.ok(String(messages[2].content).includes("older tool result compacted"));
  assert.equal(messages[3].content, "d".repeat(100));
});

test("modelNeedsAggressiveToolBudget covers DeepSeek and gpt-4.1", () => {
  const { resolveToolSoftTargetTokens, AGGRESSIVE_SOFT_TARGET_CAP_TOKENS } =
    require("../out/toolRecovery.js");
  const {
    modelNeedsGatewayWorkarounds,
    modelUsesMainLikeApi,
  } = require("../out/modelCapabilities.js");
  assert.equal(modelNeedsAggressiveToolBudget("DeepSeek-V4-Flash"), true);
  assert.equal(modelNeedsAggressiveToolBudget("Qwen3-Coder-Next"), false);
  assert.equal(modelNeedsAggressiveToolBudget("gpt-4.1"), false);
  assert.equal(modelNeedsAggressiveToolBudget("gpt-4o"), false);
  assert.equal(modelNeedsAggressiveToolBudget("claude-sonnet-4-5"), false);
  assert.equal(modelNeedsGatewayWorkarounds("gpt-4.1"), false);
  assert.equal(modelNeedsGatewayWorkarounds("Qwen3-Coder-Next"), false);
  assert.equal(modelUsesMainLikeApi("Qwen3-Coder-Next"), true);
  assert.equal(modelUsesMainLikeApi("gpt-4.1"), true);
  assert.equal(modelUsesMainLikeApi("DeepSeek-V4-Flash"), true);
  assert.equal(modelNeedsGatewayWorkarounds("DeepSeek-V4-Flash"), false);
  // Qwen — main-like, без aggressive soft-cap; gpt-4.1 — обычный budget.
  const softQwen = resolveToolSoftTargetTokens({
    hardBudget: 200_000,
    modelId: "Qwen3-Coder-Next",
  });
  assert.ok(softQwen > AGGRESSIVE_SOFT_TARGET_CAP_TOKENS);
  const softGpt = resolveToolSoftTargetTokens({
    hardBudget: 1_000_000,
    modelId: "gpt-4.1",
  });
  assert.ok(softGpt > AGGRESSIVE_SOFT_TARGET_CAP_TOKENS);
});

test("prepareKimiGatewayMessages shrinks older tool payloads", () => {
  const {
    prepareKimiGatewayMessages,
    prepareKimiEmptyFinaleMessages,
  } = require("../out/toolRecovery.js");
  const messages = [
    { role: "tool", name: "read_file", content: "a".repeat(6_000) },
    { role: "tool", name: "read_file", content: "b".repeat(6_000) },
    { role: "tool", name: "read_file", content: "c".repeat(6_000) },
    { role: "tool", name: "read_file", content: "d".repeat(6_000) },
  ];
  assert.equal(prepareKimiGatewayMessages(messages), true);
  assert.ok(String(messages[0].content).length < 3_000);
  assert.ok(String(messages[3].content).length === 6_000);

  const forFinale = [
    { role: "tool", name: "read_file", content: "x".repeat(5_000) },
    { role: "tool", name: "read_file", content: "y".repeat(5_000) },
    { role: "tool", name: "read_file", content: "z".repeat(5_000) },
  ];
  assert.equal(prepareKimiEmptyFinaleMessages(forFinale), true);
  assert.ok(String(forFinale[0].content).length < 2_000);
});

test("prepareFragileGatewayMessages caps even the latest read_file", () => {
  const { prepareFragileGatewayMessages } = require("../out/toolRecovery.js");
  const payload = JSON.stringify({
    path: "package.json",
    content: "z".repeat(12_000),
  });
  const messages = [
    {
      role: "tool",
      name: "read_file",
      tool_call_id: "1",
      content: payload,
    },
  ];
  assert.equal(prepareFragileGatewayMessages(messages), true);
  assert.ok(String(messages[0].content).length < 3_200);
  assert.ok(String(messages[0].content).includes("package.json"));
});

test("formatToolEvidenceFallbackAnswer summarizes read/search tools", () => {
  const answer = formatToolEvidenceFallbackAnswer(
    [
      {
        role: "tool",
        name: "read_file",
        content: JSON.stringify({
          path: "AGENTS.md",
          content: "# Harbor Agents\nMap of the project.\n",
        }),
      },
      {
        role: "tool",
        name: "write_file",
        content: JSON.stringify({
          ok: true,
          path: "AGENTS.md",
          created: false,
          added: 10,
          removed: 2,
        }),
      },
      {
        role: "tool",
        name: "search_text",
        content: JSON.stringify({
          query: "resolveSpeedRouting",
          matches: [{ path: "src/modelRouting.ts", line: 154, text: "export function" }],
        }),
      },
    ],
    "теперь по этому файлу будет легче ориентироваться?"
  );
  assert.ok(answer);
  assert.ok(answer.includes("AGENTS.md"));
  assert.ok(answer.includes("write_file") || answer.includes("Изменённые"));
  assert.ok(answer.includes("resolveSpeedRouting"));
  assert.ok(answer.includes("ошибка сервера"));
  // При уже сделанных правках не дампим содержимое прочитанных файлов.
  assert.equal(answer.includes("Map of the project"), false);
  assert.ok(answer.includes("Также читали"));
});

test("shrinkToolPayloadJson keeps valid JSON with truncated content", () => {
  const { shrinkToolPayloadJson, extractReadFileFromToolPayload } = require("../out/toolRecovery.js");
  const raw = JSON.stringify({
    path: "package.json",
    content: "{\n  \"name\": \"briefings\"\n" + "x".repeat(4000),
  });
  const shrunk = shrinkToolPayloadJson(raw, 800);
  assert.ok(shrunk);
  const parsed = JSON.parse(shrunk);
  assert.equal(parsed.path, "package.json");
  assert.equal(typeof parsed.content, "string");
  assert.ok(parsed.content.length < 4000);

  const broken = raw.slice(0, 200);
  const extracted = extractReadFileFromToolPayload(broken);
  assert.equal(extracted.path, "package.json");
  assert.ok(extracted.content);
});

test("formatToolEvidenceFallbackAnswer shows file text not raw JSON wrapper", () => {
  const answer = formatToolEvidenceFallbackAnswer(
    [
      {
        role: "tool",
        name: "read_file",
        content: JSON.stringify({
          path: "README.md",
          content: "Web-приложение для управления инструктажами.",
        }),
      },
    ],
    "создай AGENTS.md"
  );
  assert.ok(answer);
  assert.ok(answer.includes("Web-приложение"));
  assert.equal(answer.includes('{"path":"README.md"'), false);
});

test("compactCompletedEditToolArguments strips write_file content", () => {
  const {
    compactCompletedEditToolArguments,
    listSuccessfulEditPathsFromMessages,
  } = require("../out/toolRecovery.js");
  const messages = [
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "c1",
          type: "function",
          function: {
            name: "write_file",
            arguments: JSON.stringify({
              relativePath: "AGENTS.md",
              content: "# big\n" + "x".repeat(2000),
            }),
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "c1",
      name: "write_file",
      content: JSON.stringify({
        ok: true,
        path: "AGENTS.md",
        created: true,
        added: 10,
        removed: 0,
      }),
    },
  ];
  assert.equal(compactCompletedEditToolArguments(messages), true);
  const args = JSON.parse(messages[0].tool_calls[0].function.arguments);
  assert.equal(args.compacted, true);
  assert.equal(args.relativePath, "AGENTS.md");
  assert.equal(typeof args.content, "undefined");
  assert.deepEqual(listSuccessfulEditPathsFromMessages(messages), ["AGENTS.md"]);
});
