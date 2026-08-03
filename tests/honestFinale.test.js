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

test("readonly mode: hollow-sounding plan reply passes as ok (no false nudge)", () => {
  // Plan/Ask mode — объяснение это deliverable, не пустышка.
  const planReply = "Я объяснил подход к созданию страницы в плане выше. Скажи — перепишу если нужно.";
  const decision = decideHonestFinale({
    text: planReply,
    canEdit: false,
    messages: [{ role: "assistant", content: planReply }],
    userText: "сделай план",
    allowNudgeHollow: true,
  });
  assert.equal(decision.kind, "ok");
  assert.equal(decision.text, planReply);
});

test("readonly mode: hedge still nudges (unfinished action is bad even in plan)", () => {
  const decision = decideHonestFinale({
    text: "Возможно TS ругается, попробую пересобрать и скажу результат.",
    canEdit: false,
    messages: [],
    userText: "проверь типы",
    allowNudgeHedge: true,
  });
  assert.equal(decision.kind, "nudge_hedge");
});

test("readonly mode: prose clarifying questions nudge request_user_input", () => {
  const prose =
    "Есть несколько уточняющих вопросов, которые помогут дать точный план:\n\n" +
    "1. Роут и расположение страницы — отдельный `/new/certificate` или вложенный?\n" +
    "2. Источник данных — есть ли уже backend endpoint?\n" +
    "3. Входные параметры — `pageId` или `journalId`?";
  const decision = decideHonestFinale({
    text: prose,
    canEdit: false,
    messages: [{ role: "assistant", content: prose }],
    userText: "сделай план страницы удостоверения",
    allowNudgeAskUser: true,
  });
  assert.equal(decision.kind, "nudge_ask_user");
});

test("readonly mode: prose questions ok after successful request_user_input", () => {
  const prose =
    "Есть несколько уточняющих вопросов:\n1. Где кнопка?\n2. Какой API?";
  const decision = decideHonestFinale({
    text: prose,
    canEdit: false,
    messages: [
      {
        role: "tool",
        name: "request_user_input",
        tool_call_id: "1",
        content: JSON.stringify({ ok: true, answer: "в tabs" }),
      },
      { role: "assistant", content: prose },
    ],
    userText: "сделай план",
    allowNudgeAskUser: true,
  });
  assert.equal(decision.kind, "ok");
});

test("readonly mode: proposed_plan with risks is not prose clarifying", () => {
  const plan =
    "<proposed_plan>\n**Цель**: страница.\n**Шаги**:\n1. Роут — reuse `src/app/routes.ts` — observed: `createBrowserRouter`.\n**Затрагиваемые файлы**: `src/app/routes.ts`\n**Риски**: API может отсутствовать.\n</proposed_plan>";
  const decision = decideHonestFinale({
    text: plan,
    canEdit: false,
    messages: [],
    userText: "план",
    allowNudgeAskUser: true,
  });
  assert.equal(decision.kind, "ok");
});

test("readonly mode: proposed_plan with future-tense steps is not hedge (forced-finale path)", () => {
  // Risks/шаги легитимно содержат «возможно стоит» / «начну с…», что ложнит
  // hedge-детектор. forced-finale зовёт decideHonestFinale с allowNudgeHedge:false
  // — без защиты тегом это заменило бы план на HEDGE_USER_VISIBLE.
  const plan =
    "<proposed_plan>\n**Цель**: миграция.\n**Шаги**:\n1. Начну с обновления путей в `src/migrate.ts`.\n2. Возможно стоит добавить fallback в `src/fallback.ts`.\n**Затрагиваемые файлы**: `src/migrate.ts`, `src/fallback.ts`\n**Риски**: возможно, стоит проверить совместимость.\n</proposed_plan>";
  const decisionAllow = decideHonestFinale({
    text: plan,
    canEdit: false,
    messages: [],
    userText: "план миграции",
    allowNudgeHedge: true,
  });
  assert.equal(decisionAllow.kind, "ok");
  assert.equal(decisionAllow.text, plan);

  const decisionForced = decideHonestFinale({
    text: plan,
    canEdit: false,
    messages: [],
    userText: "план миграции",
    allowNudgeHedge: false,
  });
  assert.equal(decisionForced.kind, "ok");
  assert.equal(decisionForced.text, plan);
});

test("readonly mode: incomplete proposed_plan without paths nudges plan quality", () => {
  const { PLAN_QUALITY_USER_VISIBLE } = require("../out/honestFinale.js");
  const plan =
    "<proposed_plan>\n**Цель**: страница.\n**Шаги**:\n1. Сделать таблицу.\n**Затрагиваемые файлы**: несколько файлов\n**Риски**: нет.\n</proposed_plan>";
  const nudged = decideHonestFinale({
    text: plan,
    canEdit: false,
    messages: [],
    userText: "план по пунктам",
    allowNudgePlanQuality: true,
  });
  assert.equal(nudged.kind, "nudge_plan_quality");

  // z.ai-style: nudges exhausted but a <proposed_plan> card exists → show it
  // (with the Build button), do NOT replace with the blocking error.
  const shown = decideHonestFinale({
    text: plan,
    canEdit: false,
    messages: [],
    userText: "план по пунктам",
    allowNudgePlanQuality: false,
  });
  assert.equal(shown.kind, "ok");
  assert.equal(shown.text, plan);
});

test("readonly mode: page→tab drift after nudges still shows the Build card", () => {
  const user =
    "составь план реализации страницы https://www.figma.com/design/abc/x?node-id=1-2";
  const plan =
    "<proposed_plan>\n**Цель**: Реализовать вкладку «Удостоверение» на существующей странице InitialBriefingKnowledgeCheckPage\n**Шаги**:\n" +
    "1. Добавить таб — src/features/ibkc/tabs.tsx\n" +
    "**Затрагиваемые файлы**:\n- src/features/ibkc/tabs.tsx\n**Риски**: нет\n</proposed_plan>";
  const nudged = decideHonestFinale({
    text: plan,
    canEdit: false,
    messages: [],
    userText: user,
    allowNudgePlanQuality: true,
    kimi: true,
  });
  assert.equal(nudged.kind, "nudge_plan_quality");

  // After nudges: show the imperfect card (Kimi included) — never a dead-end
  // error when a <proposed_plan> exists.
  for (const kimi of [true, false]) {
    const shown = decideHonestFinale({
      text: plan,
      canEdit: false,
      messages: [],
      userText: user,
      allowNudgePlanQuality: false,
      kimi,
    });
    assert.equal(shown.kind, "ok");
    assert.equal(shown.text, plan);
  }
});

test("readonly mode: recovers last proposed_plan when finale dropped the card", () => {
  const { PLAN_QUALITY_USER_VISIBLE } = require("../out/honestFinale.js");
  const user =
    "составь план реализации страницы https://www.figma.com/design/abc/x?node-id=1-2";
  const plan =
    "<proposed_plan>\n**Цель**: страница.\n**Шаги**:\n" +
    "1. Таблица — reuse src/pages/foo/page.tsx — observed: `DataTable`\n" +
    "**Затрагиваемые файлы**: src/pages/foo/page.tsx\n</proposed_plan>";
  const prose =
    "Страница уже есть в проекте — initial-briefing полностью совпадает с макетом.";
  const recovered = decideHonestFinale({
    text: prose,
    canEdit: false,
    messages: [{ role: "assistant", content: plan }],
    userText: user,
    allowNudgePlanQuality: false,
  });
  assert.equal(recovered.kind, "ok");
  assert.equal(recovered.text, plan);

  const deadEnd = decideHonestFinale({
    text: prose,
    canEdit: false,
    messages: [],
    userText: user,
    allowNudgePlanQuality: false,
  });
  assert.equal(deadEnd.kind, "replace");
  assert.equal(deadEnd.text, PLAN_QUALITY_USER_VISIBLE);
});

test("readonly mode: prose «already exists» without a plan card is replaced with the error when nudges are off", () => {
  const { PLAN_QUALITY_USER_VISIBLE } = require("../out/honestFinale.js");
  const prose =
    "Страница уже есть в проекте — initial-briefing-knowledge-check полностью совпадает с макетом Figma.";
  const replaced = decideHonestFinale({
    text: prose,
    canEdit: false,
    messages: [],
    userText:
      "составь план по реализации данной страницы https://www.figma.com/design/abc/x?node-id=1-2",
    allowNudgePlanQuality: false,
  });
  assert.equal(replaced.kind, "replace");
  assert.equal(replaced.text, PLAN_QUALITY_USER_VISIBLE);
});

test("readonly mode: prose «already exists» without proposed_plan nudges plan quality", () => {
  const prose =
    "Страница уже есть в проекте — initial-briefing-knowledge-check полностью совпадает с макетом Figma.";
  const decision = decideHonestFinale({
    text: prose,
    canEdit: false,
    messages: [],
    userText:
      "составь план по реализации данной страницы https://www.figma.com/design/abc/x?node-id=1-2",
    allowNudgePlanQuality: true,
  });
  assert.equal(decision.kind, "nudge_plan_quality");
});

test("readonly mode: Figma abstract-payload prose clarification nudges (no question marks)", () => {
  // Реальный кейс: модель получила из Figma абстрактный пейлоад и пишет
  // уточнение условной прозой без знаков «?» и без нумерованного списка.
  const prose =
    "Что блокирует детальный план: данные из Figma пришли в сжатом виде — " +
    "я не вижу конкретные поля таблицы, фильтры, кнопки и состав макета. " +
    "Если страница типовая (список документов/удостоверений с фильтрами), " +
    "могу сразу реализовать по шаблону. Если макет содержит уникальные " +
    "элементы — уточните структуру один раз (или переключитесь в режим " +
    "Agent, и я соберу страницу итеративно, проверяя результат по ссылке).";
  const decision = decideHonestFinale({
    text: prose,
    canEdit: false,
    messages: [{ role: "assistant", content: prose }],
    userText: "сделай план страницы по фигме",
    allowNudgeAskUser: true,
  });
  assert.equal(decision.kind, "nudge_ask_user");
});

test("readonly mode: imperative «опишите структуру» nudges without question marks", () => {
  const prose =
    "Из Figma виден только каркас. Опишите структуру макета: какие поля " +
    "таблицы, фильтры и кнопки должны быть на странице — тогда дам " +
    "детальный план.";
  const decision = decideHonestFinale({
    text: prose,
    canEdit: false,
    messages: [{ role: "assistant", content: prose }],
    userText: "сделай план",
    allowNudgeAskUser: true,
  });
  assert.equal(decision.kind, "nudge_ask_user");
});

test("readonly mode: mode-switch handoff with corroboration nudges", () => {
  const prose =
    "Переключитесь в режим Agent — соберу страницу итеративно, проверяя " +
    "результат по ссылке, так как из Figma не видны конкретные кнопки.";
  const decision = decideHonestFinale({
    text: prose,
    canEdit: false,
    messages: [{ role: "assistant", content: prose }],
    userText: "сделай план",
    allowNudgeAskUser: true,
  });
  assert.equal(decision.kind, "nudge_ask_user");
});

test("readonly mode: bare mode-switch without corroboration is ok (not a clarification)", () => {
  // «Чтобы запустить, переключитесь в режим Agent» в ответ на «как запустить»
  // — это инструкция, а не уточнение; не должно триггерить nudge_ask_user.
  const answer =
    "Чтобы запустить сборку, переключитесь в режим Agent и нажмите Build.";
  const decision = decideHonestFinale({
    text: answer,
    canEdit: false,
    messages: [{ role: "assistant", content: answer }],
    userText: "как запустить сборку?",
    allowNudgeAskUser: true,
  });
  assert.equal(decision.kind, "ok");
});

test("readonly mode: ordinary explanation with «опишите» is not a clarification", () => {
  // Модель описывает существующую структуру пользователю — не императив-уточнение.
  const answer =
    "В этом файле вы опишите структуру store через createSlice: поле a, поле b.";
  const decision = decideHonestFinale({
    text: answer,
    canEdit: false,
    messages: [{ role: "assistant", content: answer }],
    userText: "что в этом файле?",
    allowNudgeAskUser: true,
  });
  assert.equal(decision.kind, "ok");
});