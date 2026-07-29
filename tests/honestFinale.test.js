const test = require("node:test");
const assert = require("node:assert/strict");

const {
  decideHonestFinale,
  precedingToolRoundHadSuccessfulWrite,
  MISSING_WRITE_USER_VISIBLE,
} = require("../out/honestFinale.js");
const { looksLikeUserEditRequest } = require("../out/claimedEdits.js");

test("precedingToolRoundHadSuccessfulWrite requires ok:true", () => {
  const messages = [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "1",
          type: "function",
          function: { name: "write_file", arguments: "{}" },
        },
      ],
    },
    {
      role: "tool",
      name: "write_file",
      tool_call_id: "1",
      content: JSON.stringify({ ok: false, error: "fail" }),
    },
    { role: "assistant", content: "Вернул пропсы" },
  ];
  assert.equal(precedingToolRoundHadSuccessfulWrite(messages), false);

  messages[1].content = JSON.stringify({
    ok: true,
    path: "a.tsx",
    added: 1,
    removed: 0,
  });
  assert.equal(precedingToolRoundHadSuccessfulWrite(messages), true);
});

test("no-op write_file (0 lines) is not a successful write", () => {
  const messages = [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "1",
          type: "function",
          function: { name: "write_file", arguments: "{}" },
        },
      ],
    },
    {
      role: "tool",
      name: "write_file",
      tool_call_id: "1",
      content: JSON.stringify({
        ok: true,
        path: "a.tsx",
        created: false,
        added: 0,
        removed: 0,
      }),
    },
    { role: "assistant", content: "Вернул кнопку" },
  ];
  assert.equal(precedingToolRoundHadSuccessfulWrite(messages), false);
});

test("decideHonestFinale blocks claimed edits without write", () => {
  const decision = decideHonestFinale({
    text: "Вернул пропсы cancelButtonText на место, ничего не сломается.",
    canEdit: true,
    messages: [{ role: "assistant", content: "Вернул пропсы" }],
    userText: "а зачем ты их убрал",
    allowNudgeWrite: true,
  });
  assert.equal(decision.kind, "nudge_write");
});

test("decideHonestFinale replaces after nudges exhausted", () => {
  const decision = decideHonestFinale({
    text: "Вернул пропсы на место.",
    canEdit: true,
    messages: [{ role: "assistant", content: "Вернул" }],
    userText: "верни пропсы",
    allowNudgeWrite: false,
  });
  assert.equal(decision.kind, "replace");
  assert.equal(decision.text, MISSING_WRITE_USER_VISIBLE);
});

test("looksLikeUserEditRequest catches follow-ups", () => {
  assert.equal(
    looksLikeUserEditRequest(
      "а зачем ты их убрал если они могут использоваться где то в другом месте"
    ),
    true
  );
});

test("ordinary Q&A is ok without write", () => {
  const decision = decideHonestFinale({
    text: "В этом файле экспортируется store.",
    canEdit: true,
    messages: [{ role: "assistant", content: "В этом файле экспортируется store." }],
    userText: "что экспортирует model.ts?",
    allowNudgeWrite: true,
  });
  assert.equal(decision.kind, "ok");
});
