const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EMPTY_ASSISTANT_PLACEHOLDER,
  looksLikeEmptyAssistantReply,
  summarizeEditsFallback,
  summarizeToolActivity,
  finalizeAssistantText,
} = require("../out/emptyFinale.js");

test("looksLikeEmptyAssistantReply detects blank and placeholder", () => {
  assert.equal(looksLikeEmptyAssistantReply(""), true);
  assert.equal(looksLikeEmptyAssistantReply("   "), true);
  assert.equal(looksLikeEmptyAssistantReply(EMPTY_ASSISTANT_PLACEHOLDER), true);
  assert.equal(looksLikeEmptyAssistantReply("Готово"), false);
});

test("summarizeToolActivity lists tool counts", () => {
  const text = summarizeToolActivity([
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "1", type: "function", function: { name: "list_files", arguments: "{}" } },
        { id: "2", type: "function", function: { name: "read_file", arguments: "{}" } },
      ],
    },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "3", type: "function", function: { name: "read_file", arguments: "{}" } },
      ],
    },
  ]);
  assert.match(text, /list_files/);
  assert.match(text, /read_file ×2/);
  assert.match(text, /не вернула итоговый текст/);
});

test("finalizeAssistantText prefers real text, then edits, then tools", () => {
  const edits = new Map([
    ["src/a.ts", { path: "src/a.ts", created: false, added: 1, removed: 0 }],
  ]);
  assert.equal(
    finalizeAssistantText("Ок", edits, 1000),
    "Ок"
  );
  assert.match(
    finalizeAssistantText("", edits, 1000),
    /Изменения применены/
  );
  assert.match(
    finalizeAssistantText(EMPTY_ASSISTANT_PLACEHOLDER, new Map(), 1000, [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "1",
            type: "function",
            function: { name: "read_file", arguments: "{}" },
          },
        ],
      },
    ]),
    /read_file/
  );
  assert.match(
    finalizeAssistantText("", new Map(), 1000),
    /Не удалось получить текстовый ответ/
  );
  assert.equal(summarizeEditsFallback(edits).includes("src/a.ts"), true);
});
