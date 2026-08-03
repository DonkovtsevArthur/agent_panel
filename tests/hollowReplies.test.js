const test = require("node:test");
const assert = require("node:assert/strict");

const { looksLikeHollowStatusOrDeferral } = require("../out/hollowReplies.js");
const {
  decideHonestFinale,
  HOLLOW_USER_VISIBLE,
  IMPACT_USER_VISIBLE,
  IMPACT_USER_SOFT_VISIBLE,
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

test("detects stale test expectation deferred to the user", () => {
  assert.equal(
    looksLikeHollowStatusOrDeferral(
      "Примечание: тест get-work-status.test.ts ожидает '' и теперь будет падать. Нужно обновить ожидание на null?"
    ),
    true
  );
});

test("honest finale requires updating a stale related test", () => {
  const decision = decideHonestFinale({
    text: "Тест get-work-status.test.ts ожидает ''. Теперь будет падать. Нужно обновить ожидание на null?",
    canEdit: true,
    messages: [],
    userText: "давай вернем null",
    hadSuccessfulWrite: true,
    allowNudgeHollow: true,
  });
  assert.equal(decision.kind, "nudge_hollow");
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

test("decideHonestFinale accepts search_text as shared-UI usage search", () => {
  const decision = decideHonestFinale({
    text: "Кнопку закрытия перенес в конец контейнера справа по макету Figma. Consumers проверил — ломающих call sites нет.",
    canEdit: true,
    messages: [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "s1",
            type: "function",
            function: {
              name: "search_text",
              arguments: '{"query":"from \\\"@/shared/ui/toast\\\"","path":"src"}',
            },
          },
        ],
      },
      {
        role: "tool",
        name: "search_text",
        tool_call_id: "s1",
        content: "src/pages/foo.tsx:1: import { Toast } from \"@/shared/ui/toast\"",
      },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "1",
            type: "function",
            function: {
              name: "search_replace",
              arguments:
                '{"path":"src/shared/ui/toast.tsx","old_string":"a","new_string":"b"}',
            },
          },
        ],
      },
      {
        role: "tool",
        name: "search_replace",
        tool_call_id: "1",
        content: JSON.stringify({
          ok: true,
          path: "src/shared/ui/toast.tsx",
          created: false,
          added: 1,
          removed: 1,
        }),
      },
      {
        role: "assistant",
        content:
          "Кнопку закрытия перенес в конец контейнера справа по макету Figma. Consumers проверил — ломающих call sites нет.",
      },
    ],
    userText: "поправь layout под figma",
    allowNudgeImpact: true,
  });
  assert.equal(decision.kind, "ok");
});

test("looksLikeSharedUiEditPath: UI yes, shared/api no", () => {
  const { looksLikeSharedUiEditPath } = require("../out/honestFinale.js");
  assert.equal(
    looksLikeSharedUiEditPath("src/shared/ui/toast.tsx"),
    true
  );
  assert.equal(
    looksLikeSharedUiEditPath("src/components/header/header.tsx"),
    true
  );
  assert.equal(
    looksLikeSharedUiEditPath(
      "src/shared/api/initial-briefing/get-certificate-detail/types.ts"
    ),
    false
  );
  assert.equal(
    looksLikeSharedUiEditPath("src/shared/lib/http/client.ts"),
    false
  );
  // Feature/API paths with «notification» in the name are NOT shared UI.
  assert.equal(
    looksLikeSharedUiEditPath(
      "src/pages/notification-certificate/ui/notification-certificate-page.tsx"
    ),
    false
  );
  assert.equal(
    looksLikeSharedUiEditPath(
      "src/shared/api/notification-certificate/get-certificates/types.ts"
    ),
    false
  );
  assert.equal(
    looksLikeSharedUiEditPath("src/shared/ui/notification/toast.tsx"),
    true
  );
});

test("decideHonestFinale does not impact-nudge shared/api creates", () => {
  const decision = decideHonestFinale({
    text: "Добавил get-certificate-detail API и экспортировал типы.",
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
              arguments:
                '{"relativePath":"src/shared/api/initial-briefing/get-certificate-detail/types.ts"}',
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
          path: "src/shared/api/initial-briefing/get-certificate-detail/types.ts",
          created: true,
          added: 20,
          removed: 0,
        }),
      },
      {
        role: "assistant",
        content: "Добавил get-certificate-detail API и экспортировал типы.",
      },
    ],
    userText: "реализуй план",
    allowNudgeImpact: true,
  });
  assert.equal(decision.kind, "ok");
});

test("decideHonestFinale still impact-nudges shared/ui edits without usage search", () => {
  const decision = decideHonestFinale({
    text: "Обновил Toast: closeButton теперь справа.",
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
              name: "search_replace",
              arguments:
                '{"path":"src/shared/ui/toast.tsx","old_string":"a","new_string":"b"}',
            },
          },
        ],
      },
      {
        role: "tool",
        name: "search_replace",
        tool_call_id: "1",
        content: JSON.stringify({
          ok: true,
          path: "src/shared/ui/toast.tsx",
          created: false,
          added: 1,
          removed: 1,
        }),
      },
      {
        role: "assistant",
        content: "Обновил Toast: closeButton теперь справа.",
      },
    ],
    userText: "поправь toast",
    allowNudgeImpact: true,
  });
  assert.equal(decision.kind, "nudge_impact");
});

test("decideHonestFinale soft-keeps draft after impact nudges exhausted", () => {
  const draft = "Обновил Toast: closeButton теперь справа.";
  const decision = decideHonestFinale({
    text: draft,
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
              name: "search_replace",
              arguments:
                '{"path":"src/shared/ui/toast.tsx","old_string":"a","new_string":"b"}',
            },
          },
        ],
      },
      {
        role: "tool",
        name: "search_replace",
        tool_call_id: "1",
        content: JSON.stringify({
          ok: true,
          path: "src/shared/ui/toast.tsx",
          created: false,
          added: 1,
          removed: 1,
        }),
      },
      {
        role: "assistant",
        content: draft,
      },
    ],
    userText: "поправь toast",
    allowNudgeImpact: false,
  });
  assert.equal(decision.kind, "ok");
  assert.ok(decision.text.startsWith(IMPACT_USER_SOFT_VISIBLE));
  assert.ok(decision.text.includes("closeButton теперь справа"));
  assert.equal(decision.text.includes(IMPACT_USER_VISIBLE), false);
});

test("decideHonestFinale hard-replaces empty impact finale", () => {
  const decision = decideHonestFinale({
    text: "(пустой ответ)",
    canEdit: true,
    messages: [
      {
        role: "tool",
        name: "write_file",
        tool_call_id: "1",
        content: JSON.stringify({
          ok: true,
          path: "src/shared/ui/toast.tsx",
          created: false,
          added: 2,
          removed: 1,
        }),
      },
    ],
    userText: "поправь toast",
    hadSuccessfulWrite: true,
    allowNudgeImpact: false,
  });
  assert.equal(decision.kind, "replace");
  assert.equal(decision.text, IMPACT_USER_VISIBLE);
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

test("detects denied successful edit («уже была / правок не потребовалось»)", () => {
  const { looksLikeDeniedSuccessfulEdit } = require("../out/hollowReplies.js");
  assert.equal(
    looksLikeDeniedSuccessfulEdit(
      "Версия в package.json уже была 0.0.19. Я синхронизировал package-lock.json. Изменений через редактор в этом шаге не потребовалось — package.json был обновлён ранее."
    ),
    true
  );
  assert.equal(
    looksLikeDeniedSuccessfulEdit("Поднял версию с 0.0.18 до 0.0.19."),
    false
  );
});

test("honest finale nudges when successful write is denied in the reply", () => {
  const { DENIED_WRITE_USER_VISIBLE } = require("../out/honestFinale.js");
  const decision = decideHonestFinale({
    text: "Версия в package.json уже была 0.0.19. Изменений через редактор в этом шаге не потребовалось.",
    canEdit: true,
    messages: [],
    userText: "19",
    hadSuccessfulWrite: true,
    allowNudgeHollow: true,
  });
  assert.equal(decision.kind, "nudge_denied_write");

  const replaced = decideHonestFinale({
    text: "Версия уже была 0.0.19. Правок не потребовалось.",
    canEdit: true,
    messages: [],
    userText: "19",
    hadSuccessfulWrite: true,
    allowNudgeHollow: false,
  });
  assert.equal(replaced.kind, "replace");
  assert.equal(replaced.text, DENIED_WRITE_USER_VISIBLE);
});

test("honest finale does not treat «уже была» as denial without a write", () => {
  const decision = decideHonestFinale({
    text: "Версия уже была 0.0.19 — менять нечего.",
    canEdit: true,
    messages: [],
    userText: "какая сейчас версия в package.json?",
    hadSuccessfulWrite: false,
    allowNudgeHollow: true,
    allowNudgeWrite: false,
  });
  assert.equal(decision.kind, "ok");
});
