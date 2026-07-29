const test = require("node:test");
const assert = require("node:assert/strict");

const { looksLikeHollowStatusOrDeferral } = require("../out/hollowReplies.js");
const {
  decideHonestFinale,
  HOLLOW_USER_VISIBLE,
  IMPACT_USER_VISIBLE,
} = require("../out/honestFinale.js");

test("detects hollow «я объяснил / скажи перепишу»", () => {
  assert.equal(
    looksLikeHollowStatusOrDeferral(
      "Файл уже содержит нужные изменения — я просто объяснил почему closeButton справа (по макету Figma).\nЕсли тебе нужно вернуть её на старое место — скажи, перепишу."
    ),
    true
  );
});

test("detects «скажи, переделаю» deferral after layout change", () => {
  assert.equal(
    looksLikeHollowStatusOrDeferral(
      "Кнопку закрытия перенес в конец контейнера.\nЕсли нужно вернуть обратно внутрь .content — скажи, переделаю."
    ),
    true
  );
});

test("detects shared layout change claim", () => {
  const {
    looksLikeSharedLayoutChangeClaim,
  } = require("../out/hollowReplies.js");
  assert.equal(
    looksLikeSharedLayoutChangeClaim(
      "Кнопку закрытия перенес в конец основного контейнера (справа) — чтобы структура совпадала с макетом Figma:\n[indicator] [content] [closeButton]\nРаньше кнопка была внутри .content."
    ),
    true
  );
});

test("decideHonestFinale nudges shared layout without usage search", () => {
  const decision = decideHonestFinale({
    text: "Кнопку закрытия перенес в конец контейнера справа по макету Figma.",
    canEdit: true,
    messages: [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "1",
            type: "function",
            function: {
              name: "write_file",
              arguments: '{"relativePath":"src/shared/ui/toast.tsx"}',
            },
          },
        ],
      },
      {
        role: "tool",
        name: "write_file",
        tool_call_id: "1",
        content: JSON.stringify({
          ok: true,
          path: "src/shared/ui/toast.tsx",
          created: false,
          added: 5,
          removed: 3,
        }),
      },
      {
        role: "assistant",
        content: "Кнопку закрытия перенес в конец контейнера справа по макету Figma.",
      },
    ],
    userText: "поправь layout под figma",
    allowNudgeImpact: true,
  });
  assert.equal(decision.kind, "nudge_impact");
});

test("decideHonestFinale treats «файл уже содержит» as missing write", () => {
  const decision = decideHonestFinale({
    text: "Файл уже содержит нужные изменения — я просто объяснил. Скажи — перепишу.",
    canEdit: true,
    messages: [{ role: "assistant", content: "…" }],
    userText: "почему кнопка справа?",
    allowNudgeWrite: true,
    allowNudgeHollow: true,
  });
  assert.equal(decision.kind, "nudge_write");
});

test("decideHonestFinale nudges pure hollow explanation claims", () => {
  const decision = decideHonestFinale({
    text: "Я просто объяснил почему closeButton справа. Если нужно — скажи, перепишу.",
    canEdit: true,
    messages: [{ role: "assistant", content: "…" }],
    userText: "почему кнопка справа?",
    allowNudgeWrite: true,
    allowNudgeHollow: true,
  });
  assert.equal(decision.kind, "nudge_hollow");
});

test("decideHonestFinale replaces hollow after nudge exhausted", () => {
  const decision = decideHonestFinale({
    text: "Я уже объяснил. Если нужно — скажи, перепишу.",
    canEdit: true,
    messages: [{ role: "assistant", content: "…" }],
    userText: "почему справа?",
    allowNudgeHollow: false,
  });
  assert.equal(decision.kind, "replace");
  assert.equal(decision.text, HOLLOW_USER_VISIBLE);
});
