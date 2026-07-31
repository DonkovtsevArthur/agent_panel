const test = require("node:test");
const assert = require("node:assert/strict");

const { effectiveReasoningEffort } = require("../out/reasoningEffort.js");

test("effectiveReasoningEffort keeps base when no tool history", () => {
  const messages = [
    { role: "system", content: "sys" },
    { role: "user", content: "какая версия?" },
  ];
  assert.equal(effectiveReasoningEffort(messages, "high"), "high");
});

test("effectiveReasoningEffort drops base when tool result present", () => {
  const messages = [
    { role: "system", content: "sys" },
    { role: "user", content: "какая версия?" },
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
    {
      role: "tool",
      tool_call_id: "call_1",
      name: "read_file",
      content: '{"content":"1.0.31"}',
    },
  ];
  assert.equal(effectiveReasoningEffort(messages, "high"), undefined);
});

test("effectiveReasoningEffort drops base when assistant tool_calls present", () => {
  const messages = [
    { role: "system", content: "sys" },
    { role: "user", content: "какая версия?" },
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
  ];
  assert.equal(effectiveReasoningEffort(messages, "high"), undefined);
});

test("effectiveReasoningEffort returns undefined when base is undefined", () => {
  const messages = [{ role: "user", content: "hi" }];
  assert.equal(effectiveReasoningEffort(messages, undefined), undefined);
});

test("effectiveReasoningEffort keeps base for text-only assistant history", () => {
  const messages = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello there" },
    { role: "user", content: "again" },
  ];
  assert.equal(effectiveReasoningEffort(messages, "high"), "high");
});
