const test = require("node:test");
const assert = require("node:assert/strict");

const {
  toApiMessages,
  isKimiFamilyModel,
  resolveRequestMaxTokens,
  KIMI_MIN_MAX_TOKENS,
} = require("../out/openaiClient.js");

test("isKimiFamilyModel detects kimi / moonshot ids", () => {
  assert.equal(isKimiFamilyModel("kimi-k2.6"), true);
  assert.equal(isKimiFamilyModel("moonshot/kimi-k2.5"), true);
  assert.equal(isKimiFamilyModel("kimi2.6"), true);
  assert.equal(isKimiFamilyModel("gpt-4o"), false);
});

test("resolveRequestMaxTokens floors Kimi but keeps other models", () => {
  assert.equal(resolveRequestMaxTokens("kimi-k2.6", 4096), KIMI_MIN_MAX_TOKENS);
  assert.equal(resolveRequestMaxTokens("kimi-k2.6", 20000), 20000);
  assert.equal(resolveRequestMaxTokens("kimi-k2.6"), KIMI_MIN_MAX_TOKENS);
  assert.equal(resolveRequestMaxTokens("kimi-k2.6", 4096, 4096), 4096);
  assert.equal(resolveRequestMaxTokens("kimi-k2.6", 2048, 2048), 2048);
  assert.equal(resolveRequestMaxTokens("gpt-4o", 4096), 4096);
  assert.equal(resolveRequestMaxTokens("gpt-4o"), undefined);
});

test("toApiMessages omits empty content when tool_calls present", () => {
  const serialized = toApiMessages([
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "read_file", arguments: "{}" },
        },
      ],
      reasoning_content: "need to read the file",
    },
  ]);

  assert.equal(serialized.length, 1);
  assert.equal("content" in serialized[0], false);
  assert.equal(serialized[0].reasoning_content, "need to read the file");
  assert.equal(serialized[0].tool_calls.length, 1);
});

test("toApiMessages omits null content with tool_calls", () => {
  const serialized = toApiMessages([
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "write_file", arguments: "{}" },
        },
      ],
    },
  ]);
  assert.equal("content" in serialized[0], false);
});

test("toApiMessages injects reasoning placeholder for Kimi tool calls", () => {
  const serialized = toApiMessages(
    [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "read_file", arguments: "{}" },
          },
        ],
      },
    ],
    { ensureReasoningForTools: true }
  );
  assert.equal(serialized[0].reasoning_content, " ");
});

test("toApiMessages keeps normal assistant content", () => {
  const serialized = toApiMessages([
    { role: "assistant", content: "Готово." },
  ]);
  assert.equal(serialized[0].content, "Готово.");
  assert.equal("tool_calls" in serialized[0], false);
});

test("toApiMessages strips attachments", () => {
  const serialized = toApiMessages([
    {
      role: "user",
      content: "hi",
      attachments: [{ kind: "file", name: "a.txt", path: "/tmp/a.txt" }],
    },
  ]);
  assert.equal(serialized[0].content, "hi");
  assert.equal("attachments" in serialized[0], false);
});
