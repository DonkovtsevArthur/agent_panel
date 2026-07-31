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

test("successful search_replace counts as a write, but no-op does not", () => {
  const messages = [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "replace",
          type: "function",
          function: { name: "search_replace", arguments: "{}" },
        },
      ],
    },
    {
      role: "tool",
      name: "search_replace",
      tool_call_id: "replace",
      content: JSON.stringify({
        ok: true,
        path: "a.tsx",
        replacements: 1,
        added: 0,
        removed: 0,
      }),
    },
    { role: "assistant", content: "Заменил вызов функции." },
  ];

  assert.equal(precedingToolRoundHadSuccessfulWrite(messages), true);

  messages[1].content = JSON.stringify({
    ok: false,
    path: "a.tsx",
    unchanged: true,
    error: {
      code: "NO_CHANGE",
      message: "Replacement would not change the file.",
      matchCount: 1,
    },
  });
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

test("decideHonestFinale accepts a write followed by verification tools", () => {
  const decision = decideHonestFinale({
    text: "Исправил модель и проверил TypeScript.",
    canEdit: true,
    messages: [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "verify",
            type: "function",
            function: { name: "run_command", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        name: "run_command",
        tool_call_id: "verify",
        content: JSON.stringify({ ok: true }),
      },
      { role: "assistant", content: "Исправил модель и проверил TypeScript." },
    ],
    userText: "исправь ошибку",
    hadSuccessfulWrite: true,
    allowNudgeWrite: false,
  });
  assert.equal(decision.kind, "ok");
});

test("decideHonestFinale does not re-check UI after completed git push", () => {
  const decision = decideHonestFinale({
    text: "Запушил коммит: добавлена кнопка проверки.",
    canEdit: true,
    messages: [],
    userText: "давай запушим",
    gitOperationCompleted: true,
  });
  assert.equal(decision.kind, "ok");
});

test("decideHonestFinale accepts changes applied through git restore", () => {
  const decision = decideHonestFinale({
    text: "Вернул последние изменения в двух файлах.",
    canEdit: true,
    messages: [],
    userText: "отмени последние изменения",
    gitOperationCompleted: true,
    allowNudgeWrite: false,
  });
  assert.equal(decision.kind, "ok");
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

test("implement-plan ask + future announcement without write nudges write", () => {
  const decision = decideHonestFinale({
    text: "Создаю файлы. Начну с обновления путей, затем feature и страницу.",
    canEdit: true,
    messages: [],
    userText: "давай приступик к реализации по этому плану",
    hadSuccessfulWrite: false,
    allowNudgeWrite: true,
    allowNudgeHedge: true,
  });
  assert.equal(decision.kind, "nudge_write");
});

test("Kimi: version clarifying question is ok without write", () => {
  assert.equal(looksLikeUserEditRequest("давай поменяем?"), true);

  const decision = decideHonestFinale({
    text: "Какую версию установить? Например:\n- **0.0.20** — patch\n- **0.1.0** — minor\n- **1.0.0** — major",
    canEdit: true,
    messages: [],
    userText: "давай поменяем?",
    hadSuccessfulWrite: false,
    kimi: true,
    allowNudgeWrite: true,
  });
  assert.equal(decision.kind, "ok");
});

test("non-Kimi: clarifying question still nudges write", () => {
  const decision = decideHonestFinale({
    text: "Какую версию установить? Например 0.0.20 или 1.0.0?",
    canEdit: true,
    messages: [],
    userText: "давай поменяем?",
    hadSuccessfulWrite: false,
    kimi: false,
    allowNudgeWrite: true,
  });
  assert.equal(decision.kind, "nudge_write");
});

test("Kimi: укажи версию — clarifying, not missing write", () => {
  const decision = decideHonestFinale({
    text: "Укажи, на какую версию меняем (например, `0.0.19`, `0.1.0` или другую) — сразу применю в `package.json`.",
    canEdit: true,
    messages: [],
    userText: "давай поменяем?",
    hadSuccessfulWrite: false,
    kimi: true,
    allowNudgeWrite: true,
  });
  assert.equal(decision.kind, "ok");
});

test("fake claimed version bump still nudges write", () => {
  const decision = decideHonestFinale({
    text: "Я обновил версию в package.json до 0.0.20.",
    canEdit: true,
    messages: [],
    userText: "давай поменяем?",
    hadSuccessfulWrite: false,
    kimi: true,
    allowNudgeWrite: true,
  });
  assert.equal(decision.kind, "nudge_write");
});

test("Kimi: git checkout revert is ok without write_file", () => {
  const decision = decideHonestFinale({
    text: "Откатил изменения через git checkout -- AGENTS.md package.json. Файлы возвращены к версии 0.0.18.",
    canEdit: true,
    messages: [],
    userText: "верни как было",
    hadSuccessfulWrite: false,
    kimi: true,
    gitOperationCompleted: true,
    allowNudgeWrite: true,
  });
  assert.equal(decision.kind, "ok");
});

test("Kimi: git revert claim without gitOperationCompleted still nudges", () => {
  const decision = decideHonestFinale({
    text: "Я откатил файлы через git checkout. Готово.",
    canEdit: true,
    messages: [],
    userText: "верни как было",
    hadSuccessfulWrite: false,
    kimi: true,
    gitOperationCompleted: false,
    allowNudgeWrite: true,
  });
  assert.equal(decision.kind, "nudge_write");
});
