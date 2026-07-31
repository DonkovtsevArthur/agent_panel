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

test("finalizeAssistantText strips a stray leading </welcome> close tag (no open tag)", () => {
  const THINK_CLOSE = "<" + "/think" + ">";
  const out = finalizeAssistantText(
    THINK_CLOSE + "Вот актуальная информация: 0.0.21",
    new Map(),
    1000
  );
  assert.equal(out, "Вот актуальная информация: 0.0.21");
});

test("finalizeAssistantText strips a full leading </welcome>…</welcome> block", () => {
  const THINK_OPEN = "<" + "think" + ">";
  const THINK_CLOSE = "<" + "/think" + ">";
  const out = finalizeAssistantText(
    THINK_OPEN + "рассуждаю" + THINK_CLOSE + "ответ",
    new Map(),
    1000
  );
  assert.equal(out, "ответ");
});

test("finalizeAssistantText does NOT strip a </welcome> tag that is not leading", () => {
  const THINK_CLOSE = "<" + "/think" + ">";
  const input = "код: `" + THINK_CLOSE + "` — не трогать";
  const out = finalizeAssistantText(input, new Map(), 1000);
  assert.equal(out, input);
});
