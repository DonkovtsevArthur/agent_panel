const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractProposedPlanBody,
  extractAnaloguePathsFromStep,
  extractGroundedPathsFromStep,
  extractObservedQuotesFromStep,
  extractImplementationSection,
  extractUserChecklistItems,
  extractVisionHelperFrameTitle,
  extractVisionHelperUiLabels,
  diagnosePlanQualityFailure,
  diagnosisFromReasons,
  looksLikeMissingAnalogueQuote,
  looksLikeIncompleteProposedPlan,
  looksLikePageToTabDrift,
  looksLikePageToSimilarPageDrift,
  looksLikeUserAskedForPageSurface,
  looksLikeAlreadyExistsWithoutInventory,
  looksLikeProseAlreadyExistsSkip,
  looksLikePlanFileWriteClaim,
  looksLikePlanQualityFailure,
  looksLikeMissingImplementationSection,
  looksLikeMissingComponentApiRead,
  looksLikeChecklistCoverageGap,
  looksLikeGoalMissingFrameTitle,
  looksLikeMissingFigmaBlockInventory,
  significantChecklistTokens,
  shouldForceFigmaBeforeExplore,
  turnHadFigmaPlanTools,
  historyHasProposedPlan,
  proposedPlanHasWorkspacePath,
  proposedPlanHasGroundedPath,
  looksLikeMissingAnaloguePathRead,
  looksLikeImplementationApiMismatch,
  extractImplementationEvidenceTokens,
  diagnosisHasCriticalPlanGap,
  PLAN_QUALITY_NUDGE,
  PLAN_REVISION_HINT,
  PLAN_MECHANICAL_HINT,
  FIGMA_FIRST_FORCE_HINT,
  FIGMA_FIRST_EXPLORE_BLOCKED_JSON,
  SCREENSHOT_FIRST_HINT,
  shouldRunScreenshotPlanPreflight,
  messageHasImageAttachment,
  proposedPlanHasMechanicalPath,
} = require("../out/planQuality.js");

const FIGMA_TOOL_MESSAGES = [
  {
    role: "tool",
    name: "mcp__figma__get_design_context",
    content: JSON.stringify({ ok: true }),
  },
  {
    role: "tool",
    name: "mcp__figma__get_screenshot",
    content:
      "[Harbor vision helper · vision-model]\n\n## Visible UI (from screenshot)\nTitle: Удостоверение\nColumns: Вид работ\n",
  },
];

const UI_IMPLEMENTATION = [
  "**Implementation**:",
  "- page `src/pages/cert/page.tsx`: import `CertificatePage`, type `CertificateDto`",
].join("\n");

/** Implementation that matches notification-* plans (avoids page→similar false fail). */
const UI_IMPLEMENTATION_NOTIFICATION = [
  "**Implementation**:",
  "- page `src/pages/notification-certificate/ui/page.tsx`: import `CertificatePage`, type `CertificateDto`",
].join("\n");

test("extractProposedPlanBody takes the last plan block", () => {
  const text =
    "<proposed_plan>draft</proposed_plan>\n" +
    "<proposed_plan>\n**Цель**: x\n**Шаги**:\n1. reuse `src/a.ts`\n</proposed_plan>";
  const body = extractProposedPlanBody(text);
  assert.match(body, /src\/a\.ts/);
  assert.doesNotMatch(body, /draft/);
});

test("proposedPlanHasWorkspacePath detects common path shapes", () => {
  assert.equal(proposedPlanHasWorkspacePath("reuse `src/pages/Foo.tsx`"), true);
  assert.equal(proposedPlanHasWorkspacePath("touch package.json"), true);
  assert.equal(proposedPlanHasWorkspacePath("сделать таблицу"), false);
});

test("looksLikeIncompleteProposedPlan requires paths and numbered steps", () => {
  assert.equal(
    looksLikeIncompleteProposedPlan(
      "<proposed_plan>\n**Цель**: x\n**Шаги**:\n1. Таблица.\n</proposed_plan>"
    ),
    true
  );
  assert.equal(
    looksLikeIncompleteProposedPlan(
      "<proposed_plan>\n**Цель**: x\n**Шаги**:\n1. Таблица — reuse `src/ui/Table.tsx` — observed: `ColumnDef`.\n**Затрагиваемые файлы**: `src/ui/Table.tsx`\n</proposed_plan>"
    ),
    false
  );
  assert.equal(
    looksLikeIncompleteProposedPlan(
      "<proposed_plan>\n**Цель**: x\n**Шаги**:\n1. reuse `src/a.ts`\n**Риски**: ColumnDef не зафиксированы\n</proposed_plan>"
    ),
    true
  );
  assert.equal(looksLikeIncompleteProposedPlan("просто ответ без плана"), false);
});

test("looksLikeUserAskedForPageSurface detects page / bare Figma plan asks", () => {
  assert.equal(
    looksLikeUserAskedForPageSurface(
      "составь план по реализации данной страницы https://www.figma.com/design/abc/x?node-id=1-2"
    ),
    true
  );
  assert.equal(
    looksLikeUserAskedForPageSurface(
      "https://www.figma.com/design/abc/Foo?node-id=3150-156164"
    ),
    true
  );
  assert.equal(looksLikeUserAskedForPageSurface("добавь таб в настройки"), false);
});

test("looksLikePageToTabDrift catches Goal redefined as tab", () => {
  const user =
    "составь план реализации страницы https://www.figma.com/design/abc/x?node-id=1-2";
  const drifted =
    "**Цель**: добавить таб «Удостоверения» в существующий раздел\n" +
    "**Шаги**:\n1. Добавить таб — reuse `src/pages/Tabs.tsx`\n" +
    "**Затрагиваемые файлы**: `src/pages/Tabs.tsx`\n";
  assert.equal(looksLikePageToTabDrift(user, drifted), true);

  const ok =
    "**Цель**: страница «Удостоверения» по макету Figma (новый роут)\n" +
    "**Шаги**:\n1. Роут — новый по паттерну `src/pages/Foo.tsx`\n" +
    "2. Таблица — reuse `src/ui/Table.tsx`\n" +
    "**Затрагиваемые файлы**: `src/pages/Foo.tsx`, `src/ui/Table.tsx`\n";
  assert.equal(looksLikePageToTabDrift(user, ok), false);
});

test("already-exists without block inventory is a quality failure", () => {
  const user =
    "составь план по реализации данной страницы https://www.figma.com/design/abc/x?node-id=1-2";
  const prose =
    "Страница уже есть в проекте — initial-briefing-knowledge-check полностью совпадает с макетом.";
  assert.equal(looksLikeProseAlreadyExistsSkip(prose, user), true);
  assert.equal(looksLikePlanQualityFailure(prose, { userText: user }), true);

  const planSkip =
    "<proposed_plan>\n**Цель**: страница уже реализована\n**Шаги**:\n" +
    "1. Ничего делать не нужно — reuse `src/pages/initial-briefing-knowledge-check/page.tsx`\n" +
    "**Затрагиваемые файлы**: `src/pages/initial-briefing-knowledge-check/page.tsx`\n" +
    "</proposed_plan>";
  assert.equal(looksLikeAlreadyExistsWithoutInventory(planSkip, user), true);
  assert.equal(
    looksLikeIncompleteProposedPlan(planSkip, { userText: user }),
    true
  );

  const planWithInventory =
    "<proposed_plan>\n**Цель**: страница Удостоверение (Figma)\n**Шаги**:\n" +
    "1. Page header блок макета — reuse `src/pages/foo/header.tsx`\n" +
    "2. Таблица блок — gap: нет колонок Вид работ\n" +
    "**Затрагиваемые файлы**: `src/pages/foo/header.tsx`\n" +
    "**Риски**: частично уже есть\n</proposed_plan>";
  assert.equal(
    looksLikeAlreadyExistsWithoutInventory(planWithInventory, user),
    false
  );
});

test("already-matches with block inventory skips Implementation gate", () => {
  const {
    looksLikeAlreadyMatchesWithInventory,
    looksLikeMissingImplementationSection,
  } = require("../out/planQuality.js");
  const user =
    "посмотри скрин и составь план реализации страницы Удостоверение";
  const plan =
    "<proposed_plan>\n**Цель**: Удостоверение — уже совпадает с макетом, новых работ нет\n**Шаги**:\n" +
    "1. Page header блок макета — reuse `src/pages/initial-briefing-knowledge-check-certificate/ui/page.tsx`\n" +
    "2. Таблица блок — reuse `src/features/initial-briefing-knowledge-check-certificate/certificate-table.tsx`\n" +
    "3. Actions Скачать/Распечатать блок — reuse `src/pages/initial-briefing-knowledge-check-certificate/ui/page.tsx`\n" +
    "**Затрагиваемые файлы**: `src/pages/initial-briefing-knowledge-check-certificate/ui/page.tsx`\n" +
    "</proposed_plan>";
  assert.equal(looksLikeAlreadyMatchesWithInventory(plan), true);
  assert.equal(
    looksLikeMissingImplementationSection(plan, {
      userText: user,
      hasImageAttachment: true,
    }),
    false
  );
});

test("plan file write claim is a quality failure", () => {
  assert.equal(
    looksLikePlanFileWriteClaim(
      "Создал файл PLAN-initial-briefing-knowledge-check.md через write_file"
    ),
    true
  );
  assert.equal(
    looksLikePlanQualityFailure(
      "План записан в PLAN-foo.md",
      { userText: "план страницы" }
    ),
    true
  );
});

test("PLAN_QUALITY_NUDGE mentions design_context, no PLAN.md, already-exists", () => {
  assert.match(PLAN_QUALITY_NUDGE, /get_design_context/);
  assert.match(PLAN_QUALITY_NUDGE, /get_screenshot|get_figma_data/);
  assert.match(PLAN_QUALITY_NUDGE, /PLAN\.md|proposed_plan/);
  assert.match(PLAN_QUALITY_NUDGE, /already implemented|уже/i);
});

test("PLAN_QUALITY_NUDGE asks for an Implementation section with exact props/imports", () => {
  assert.match(PLAN_QUALITY_NUDGE, /Implementation/i);
  assert.match(PLAN_QUALITY_NUDGE, /props\/imports/i);
  assert.match(PLAN_QUALITY_NUDGE, /from read_file of the component source/i);
});

test("proposedPlanHasGroundedPath requires a directory in the path", () => {
  assert.equal(proposedPlanHasGroundedPath("reuse `src/ui/Table.tsx`"), true);
  assert.equal(proposedPlanHasGroundedPath("new by pattern src/pages/Foo.tsx"), true);
  assert.equal(proposedPlanHasGroundedPath("touch package.json"), false);
  assert.equal(proposedPlanHasGroundedPath("— types.ts —"), false);
  assert.equal(proposedPlanHasGroundedPath("сделать таблицу"), false);
});

test("bare-filename plan is incomplete (no grounded path)", () => {
  const user =
    "составь план по реализации данной страницы https://www.figma.com/design/abc/x?node-id=1-2";
  const barePlan =
    "<proposed_plan>\n**Цель**: страница «Удостоверение» (Figma)\n**Шаги**:\n" +
    "1. Расширить типы — types.ts — новый по паттерну\n" +
    "2. Реализовать таблицу — certificate-table.tsx — новый по паттерну table.tsx\n" +
    "3. Добавить вкладку — initial-briefing-knowledge-check-tabs.tsx\n" +
    "**Затрагиваемые файлы**: types.ts, model.ts, paths.ts\n</proposed_plan>";
  assert.equal(proposedPlanHasGroundedPath(barePlan), false);
  assert.equal(looksLikeIncompleteProposedPlan(barePlan, { userText: user }), true);
  assert.equal(looksLikePlanQualityFailure(barePlan, { userText: user }), true);
});

test("page→tab drift hidden past step 1 is caught", () => {
  const user =
    "составь план по реализации данной страницы https://www.figma.com/design/abc/x?node-id=1-2";
  const drifted =
    "<proposed_plan>\n**Цель**: Реализовать экран «Удостоверение» — страница с заголовком\n**Шаги**:\n" +
    "1. Расширить типы сущности — src/entities/ibkc/types.ts — новый по паттерну\n" +
    "2. Реализовать таблицу — src/features/ibkc/certificate-table.tsx — новый по паттерну src/ui/table.tsx\n" +
    "3. Собрать контент — src/features/ibkc/certificate-view.tsx\n" +
    "4. Добавить вкладку — src/features/ibkc/initial-briefing-knowledge-check-tabs.tsx — расширить существующий компонент вкладок: добавить таб «Удостоверение»\n" +
    "5. Отобразить на странице — src/pages/ibkc/initial-briefing-knowledge-check-page.tsx — рендер при активной вкладке\n" +
    "**Затрагиваемые файлы**: src/entities/ibkc/types.ts, src/features/ibkc/initial-briefing-knowledge-check-tabs.tsx\n</proposed_plan>";
  assert.equal(looksLikePageToTabDrift(user, drifted), true);
  assert.equal(looksLikePlanQualityFailure(drifted, { userText: user }), true);
});

test("inner-UI tab of a genuinely new page is not drift", () => {
  const user =
    "составь план по реализации данной страницы https://www.figma.com/design/abc/x?node-id=1-2";
  const ok =
    "<proposed_plan>\n**Цель**: страница «Удостоверение» по макету Figma (новый роут)\n**Шаги**:\n" +
    "1. Роут — новый по паттерну `src/pages/Foo.tsx`\n" +
    "2. Вкладка переключения видов внутри страницы — новый компонент `src/pages/Foo/tabs.tsx`\n" +
    "3. Таблица — reuse `src/ui/Table.tsx`\n" +
    "**Затрагиваемые файлы**: `src/pages/Foo.tsx`, `src/ui/Table.tsx`\n</proposed_plan>";
  assert.equal(looksLikePageToTabDrift(user, ok), false);
});

test("Goal 'вкладку на существующей странице' is drift even with 'страница' present", () => {
  const user =
    "составь план по реализации данной страницы https://www.figma.com/design/abc/x?node-id=1-2";
  const drifted =
    "<proposed_plan>\n**Цель**: Реализовать вкладку «Удостоверение» на существующей странице InitialBriefingKnowledgeCheckPage\n**Шаги**:\n" +
    "1. Расширить типы — src/entities/ibkc/types.ts\n" +
    "2. Создать таблицу — src/features/ibkc/cert-table.tsx\n" +
    "**Затрагиваемые файлы**: src/entities/ibkc/types.ts, src/features/ibkc/cert-table.tsx\n</proposed_plan>";
  assert.equal(looksLikePageToTabDrift(user, drifted), true);
  assert.equal(looksLikePlanQualityFailure(drifted, { userText: user }), true);
});

test("step 'Зарегистрировать вкладку' with existing path is drift", () => {
  const user =
    "составь план по реализации данной страницы https://www.figma.com/design/abc/x?node-id=1-2";
  const drifted =
    "<proposed_plan>\n**Цель**: страница «Удостоверение» (Figma)\n**Шаги**:\n" +
    "1. Типы — src/entities/ibkc/types.ts\n" +
    "2. Таблица — src/features/ibkc/cert-table.tsx\n" +
    "3. Зарегистрировать вкладку в UI табов — src/features/ibkc/tabs.tsx — расширить существующий компонент\n" +
    "4. Обновить страницу — src/pages/ibkc/page.tsx\n" +
    "**Затрагиваемые файлы**: src/features/ibkc/tabs.tsx, src/pages/ibkc/page.tsx\n</proposed_plan>";
  assert.equal(looksLikePageToTabDrift(user, drifted), true);
  assert.equal(looksLikePlanQualityFailure(drifted, { userText: user }), true);
});

test("step 'Расширить модель вкладками' with existing path is drift", () => {
  const user =
    "составь план по реализации данной страницы https://www.figma.com/design/abc/x?node-id=1-2";
  const drifted =
    "<proposed_plan>\n**Цель**: страница «Удостоверение» (Figma)\n**Шаги**:\n" +
    "1. Типы — src/entities/ibkc/types.ts\n" +
    "2. Расширить effector-модель вкладками и сертификатом — src/entities/ibkc/model.ts — добавить таб 'certificate'\n" +
    "3. Таблица — src/features/ibkc/cert-table.tsx\n" +
    "**Затрагиваемые файлы**: src/entities/ibkc/model.ts, src/features/ibkc/cert-table.tsx\n</proposed_plan>";
  assert.equal(looksLikePageToTabDrift(user, drifted), true);
  assert.equal(looksLikePlanQualityFailure(drifted, { userText: user }), true);
});

test("page with inner tabs (no 'существующ') is not drift", () => {
  const user =
    "составь план по реализации данной страницы https://www.figma.com/design/abc/x?node-id=1-2";
  const ok =
    "<proposed_plan>\n**Цель**: страница «Удостоверение» с вкладками разделов\n**Шаги**:\n" +
    "1. Роут — новый src/pages/cert/page.tsx\n" +
    "2. Вкладки разделов внутри страницы — новый src/pages/cert/tabs.tsx\n" +
    "3. Таблица — reuse src/ui/table.tsx\n" +
    "**Затрагиваемые файлы**: src/pages/cert/page.tsx, src/pages/cert/tabs.tsx\n</proposed_plan>";
  assert.equal(looksLikePageToTabDrift(user, ok), false);
});

test("page→similar-page drift: plan grounds in notification-* but user asked for initial-briefing Figma", () => {
  const user =
    "https://www.figma.com/design/BorsqD1HZYfh2kqJhqazNG/%D0%9F%D0%B5%D1%80%D0%B2%D0%B8%D1%87%D0%BD%D1%8B%D0%B9-%D0%B8%D0%BD%D1%81%D1%82%D1%80%D1%83%D0%BA%D1%82%D0%B0%D0%B6?node-id=3150-156164 составь план по реализации данной страницы";
  const drifted =
    "<proposed_plan>\n**Цель**: Реализовать страницу «Удостоверение» по макету Figma\n**Шаги**:\n" +
    "1. Таблица — reuse src/pages/notification-certificate/ui/notification-certificate-page.tsx\n" +
    "2. Модель — reuse src/entities/notification/notifications-certification/model.ts\n" +
    "3. Фичи — reuse src/features/notification-certificate/search.tsx\n" +
    "**Затрагиваемые файлы**: src/pages/notification-certificate/ui/notification-certificate-page.tsx, src/entities/notification/notifications-certification/model.ts\n</proposed_plan>";
  assert.equal(looksLikePageToSimilarPageDrift(user, drifted), true);
  assert.equal(looksLikePlanQualityFailure(drifted, { userText: user }), true);
});

test("page→similar-page: not drift when domain word matches user text", () => {
  const user =
    "составь план реализации страницы notification certificate https://www.figma.com/design/abc/x?node-id=1-2";
  const ok =
    "<proposed_plan>\n**Цель**: страница notification certificate Удостоверение\n**Шаги**:\n" +
    "1. Таблица — reuse src/pages/notification-certificate/ui/page.tsx — observed: `CertificateTable`\n" +
    "2. Модель — reuse src/entities/notification/notifications-certification/model.ts — observed: `certificationModel`\n" +
    "**Затрагиваемые файлы**: src/pages/notification-certificate/ui/page.tsx\n" +
    UI_IMPLEMENTATION_NOTIFICATION +
    "\n</proposed_plan>";
  assert.equal(looksLikePageToSimilarPageDrift(user, ok), false);
  assert.equal(
    looksLikePlanQualityFailure(ok, {
      userText: user,
      messages: FIGMA_TOOL_MESSAGES,
    }),
    false
  );
});

test("page→similar-page: not drift when plan creates new files (no existing feature-area paths)", () => {
  const user =
    "https://www.figma.com/design/abc/Первичный-инструктаж?node-id=1-2 составь план";
  const ok =
    "<proposed_plan>\n**Цель**: страница «Удостоверение»\n**Шаги**:\n" +
    "1. Роут — новый src/pages/cert/page.tsx\n" +
    "2. Таблица — новый src/pages/cert/table.tsx\n" +
    "**Затрагиваемые файлы**: src/pages/cert/page.tsx, src/pages/cert/table.tsx\n</proposed_plan>";
  assert.equal(looksLikePageToSimilarPageDrift(user, ok), false);
});

test("looksLikeMissingAnalogueQuote flags step without observed quote from read_file", () => {
  const plan =
    "<proposed_plan>\n**Цель**: x\n**Шаги**:\n" +
    "1. Editor — новый по паттерну `src/features/foo/editor.tsx`\n" +
    "**Затрагиваемые файлы**: src/features/bar/editor.tsx\n</proposed_plan>";
  const messages = [
    {
      role: "tool",
      name: "read_file",
      content: JSON.stringify({
        path: "src/features/foo/editor.tsx",
        content: "export const Editor = () => <div className={styles.grid} />;\n",
      }),
    },
  ];
  assert.deepEqual(extractAnaloguePathsFromStep("1. Editor — новый по паттерну `src/features/foo/editor.tsx`"), [
    "src/features/foo/editor.tsx",
  ]);
  assert.deepEqual(
    extractObservedQuotesFromStep(
      "1. Editor — новый по паттерну `src/features/foo/editor.tsx`",
      ["src/features/foo/editor.tsx"]
    ),
    []
  );
  assert.equal(looksLikeMissingAnalogueQuote(extractProposedPlanBody(plan), messages), true);
  assert.equal(looksLikePlanQualityFailure(plan, { messages }), true);
});

test("looksLikeMissingAnalogueQuote ok with quote present in file content", () => {
  const plan =
    "<proposed_plan>\n**Цель**: x\n**Шаги**:\n" +
    "1. list/grid editor — новый по паттерну `src/features/foo/editor.tsx` — observed: `styles.grid`\n" +
    "**Затрагиваемые файлы**: src/features/bar/editor.tsx\n</proposed_plan>";
  const messages = [
    {
      role: "tool",
      name: "read_file",
      content: JSON.stringify({
        path: "src/features/foo/editor.tsx",
        content: "export const Editor = () => <div className={styles.grid} />;\n",
      }),
    },
  ];
  assert.equal(looksLikeMissingAnalogueQuote(extractProposedPlanBody(plan), messages), false);
  assert.equal(looksLikePlanQualityFailure(plan, { messages }), false);
});

test("looksLikeMissingAnalogueQuote flags quote not found in file", () => {
  const plan =
    "<proposed_plan>\n**Цель**: x\n**Шаги**:\n" +
    "1. table — новый по паттерну `src/features/foo/editor.tsx` — observed: `ColumnDef`\n" +
    "**Затрагиваемые файлы**: src/features/bar/editor.tsx\n</proposed_plan>";
  const messages = [
    {
      role: "tool",
      name: "read_file",
      content: JSON.stringify({
        path: "src/features/foo/editor.tsx",
        content: "export const Editor = () => <div className={styles.grid} />;\n",
      }),
    },
  ];
  assert.equal(looksLikeMissingAnalogueQuote(extractProposedPlanBody(plan), messages), true);
});

test("PLAN_QUALITY_NUDGE mentions analogue evidence quote", () => {
  assert.match(PLAN_QUALITY_NUDGE, /observed|Analogue evidence|backtick/i);
});

test("analogue quote required structurally even without tool messages", () => {
  const plan =
    "<proposed_plan>\n**Цель**: x\n**Шаги**:\n" +
    "1. Editor — новый по паттерну `src/features/foo/editor.tsx`\n" +
    "**Затрагиваемые файлы**: src/features/bar/editor.tsx\n</proposed_plan>";
  assert.equal(looksLikeMissingAnalogueQuote(extractProposedPlanBody(plan)), true);
  assert.equal(looksLikePlanQualityFailure(plan), true);
});

test("как в <path> counts as analogue marker", () => {
  assert.deepEqual(
    extractAnaloguePathsFromStep("1. Таблица — как в `src/pages/cert/page.tsx` — observed: `DataTable`"),
    ["src/pages/cert/page.tsx"]
  );
});

test("bare cited path that was read_file'd requires observed quote from that file", () => {
  const plan =
    "<proposed_plan>\n**Цель**: x\n**Шаги**:\n" +
    "1. Таблица — src/features/notification-certificate/notifications-certificate/search.tsx\n" +
    "**Затрагиваемые файлы**: src/features/x/table.tsx\n</proposed_plan>";
  const messages = [
    {
      role: "tool",
      name: "read_file",
      content: JSON.stringify({
        path: "src/features/notification-certificate/notifications-certificate/search.tsx",
        content: "export const Search = () => <input className={styles.search} />;\n",
      }),
    },
  ];
  assert.deepEqual(
    extractGroundedPathsFromStep(
      "1. Таблица — src/features/notification-certificate/notifications-certificate/search.tsx"
    ),
    ["src/features/notification-certificate/notifications-certificate/search.tsx"]
  );
  assert.equal(looksLikeMissingAnalogueQuote(extractProposedPlanBody(plan), messages), true);

  const fixed =
    "<proposed_plan>\n**Цель**: x\n**Шаги**:\n" +
    "1. Таблица — src/pages/notification-certificate/ui/notification-certificate-page.tsx — observed: `styles.search`\n" +
    "**Затрагиваемые файлы**: src/features/x/table.tsx\n</proposed_plan>";
  // Wrong quote source: quote from search file but path is page → still fail when page was read.
  const pageMessages = [
    {
      role: "tool",
      name: "read_file",
      content: JSON.stringify({
        path: "src/pages/notification-certificate/ui/notification-certificate-page.tsx",
        content: "export const Page = () => <Table columns={cols} />;\n",
      }),
    },
  ];
  assert.equal(looksLikeMissingAnalogueQuote(extractProposedPlanBody(fixed), pageMessages), true);

  const grounded =
    "<proposed_plan>\n**Цель**: x\n**Шаги**:\n" +
    "1. Таблица — src/pages/notification-certificate/ui/notification-certificate-page.tsx — observed: `<Table columns`\n" +
    "**Затрагиваемые файлы**: src/features/x/table.tsx\n</proposed_plan>";
  assert.equal(looksLikeMissingAnalogueQuote(extractProposedPlanBody(grounded), pageMessages), false);
});

test("create-only path never read does not require observed quote", () => {
  const plan =
    "<proposed_plan>\n**Цель**: x\n**Шаги**:\n" +
    "1. Роут — новый src/pages/cert/page.tsx\n" +
    "2. Таблица — новый src/pages/cert/table.tsx\n" +
    "**Затрагиваемые файлы**: src/pages/cert/page.tsx, src/pages/cert/table.tsx\n</proposed_plan>";
  const messages = [
    {
      role: "tool",
      name: "read_file",
      content: JSON.stringify({
        path: "src/shared/ui/button.tsx",
        content: "export const Button = () => null;\n",
      }),
    },
  ];
  assert.equal(looksLikeMissingAnalogueQuote(extractProposedPlanBody(plan), messages), false);
});

test("diagnosePlanQualityFailure returns targeted nudge for missing grounded path", () => {
  const plan =
    "<proposed_plan>\n**Цель**: x\n**Шаги**:\n1. Сделать таблицу.\n**Затрагиваемые файлы**: несколько файлов\n</proposed_plan>";
  const d = diagnosePlanQualityFailure(plan);
  assert.equal(d?.reason, "missing_grounded_path");
  assert.match(d?.nudge || "", /concrete workspace path/i);
});

test("missing_figma_tools when user pasted Figma URL but no MCP calls", () => {
  const user =
    "составь план страницы https://www.figma.com/design/abc/x?node-id=1-2";
  const plan =
    "<proposed_plan>\n**Цель**: страница Удостоверение\n**Шаги**:\n" +
    "1. Роут — новый src/pages/cert/page.tsx — observed: `createRoute`\n" +
    "**Затрагиваемые файлы**: src/pages/cert/page.tsx\n" +
    UI_IMPLEMENTATION +
    "\n</proposed_plan>";
  assert.equal(turnHadFigmaPlanTools([]), false);
  const d = diagnosePlanQualityFailure(plan, { userText: user, messages: [] });
  assert.equal(d?.reason, "missing_figma_tools");
  assert.match(d?.nudge || "", /get_design_context/i);
  assert.equal(
    diagnosePlanQualityFailure(plan, {
      userText: user,
      messages: FIGMA_TOOL_MESSAGES,
    }),
    null
  );
});

test("turnHadFigmaPlanTools accepts design_context+screenshot or get_figma_data", () => {
  assert.equal(turnHadFigmaPlanTools(FIGMA_TOOL_MESSAGES), true);
  assert.equal(
    turnHadFigmaPlanTools([
      { role: "tool", name: "mcp__figma__get_figma_data", content: "{}" },
    ]),
    true
  );
  assert.equal(
    turnHadFigmaPlanTools([
      {
        role: "assistant",
        tool_calls: [
          { function: { name: "mcp__figma__get_design_context" } },
          { function: { name: "mcp__figma__get_screenshot" } },
        ],
      },
    ]),
    true
  );
});

test("missing_implementation for UI/Figma page plans", () => {
  const user =
    "составь план страницы https://www.figma.com/design/abc/x?node-id=1-2";
  const body =
    "**Цель**: страница Удостоверение\n**Шаги**:\n" +
    "1. Роут — новый src/pages/cert/page.tsx — observed: `createRoute`\n" +
    "**Затрагиваемые файлы**: src/pages/cert/page.tsx";
  assert.equal(looksLikeMissingImplementationSection(body, user), true);
  const plan = `<proposed_plan>\n${body}\n</proposed_plan>`;
  const d = diagnosePlanQualityFailure(plan, {
    userText: user,
    messages: FIGMA_TOOL_MESSAGES,
  });
  assert.equal(d?.reason, "missing_implementation");
  assert.match(
    extractImplementationSection(body + "\n" + UI_IMPLEMENTATION) || "",
    /CertificatePage/
  );
});

test("missing_component_api_read when Table mentioned but source not read", () => {
  const planBody =
    "**Цель**: x\n**Шаги**:\n" +
    "1. Таблица — reuse `src/pages/foo/page.tsx` — observed: `<Table`\n" +
    "**Implementation**:\n- Table from call site — import `Table`, columns=\n" +
    "**Затрагиваемые файлы**: src/pages/foo/page.tsx";
  const messages = [
    {
      role: "tool",
      name: "read_file",
      content: JSON.stringify({
        path: "src/pages/foo/page.tsx",
        content: "import { Table } from 'shared/ui';\n<Table columns={c} />\n",
      }),
    },
  ];
  assert.equal(looksLikeMissingComponentApiRead(planBody, messages), true);
  const fixedMessages = [
    ...messages,
    {
      role: "tool",
      name: "read_file",
      content: JSON.stringify({
        path: "src/shared/ui/table/Table.tsx",
        content: "export type TableProps = { columns: unknown[] };\n",
      }),
    },
  ];
  assert.equal(looksLikeMissingComponentApiRead(planBody, fixedMessages), false);
});

test("checklist_coverage requires at least as many Steps as user bullets", () => {
  const user =
    "план:\n1. Роут\n2. Таблица\n3. Фильтры\nhttps://www.figma.com/design/abc/x?node-id=1-2";
  assert.equal(extractUserChecklistItems(user).length, 3);
  const thin =
    "**Цель**: страница Удостоверение\n**Шаги**:\n" +
    "1. Роут — новый src/pages/cert/page.tsx — observed: `createRoute`\n" +
    "2. Таблица — новый src/pages/cert/table.tsx\n" +
    "**Затрагиваемые файлы**: src/pages/cert/page.tsx\n" +
    UI_IMPLEMENTATION;
  assert.equal(looksLikeChecklistCoverageGap(thin, user), true);
  const full =
    "**Цель**: страница Удостоверение\n**Шаги**:\n" +
    "1. Роут — новый src/pages/cert/page.tsx — observed: `createRoute`\n" +
    "2. Таблица — новый src/pages/cert/table.tsx\n" +
    "3. Фильтры — новый src/pages/cert/filters.tsx\n" +
    "**Затрагиваемые файлы**: src/pages/cert/page.tsx\n" +
    UI_IMPLEMENTATION;
  assert.equal(looksLikeChecklistCoverageGap(full, user), false);
  const d = diagnosePlanQualityFailure(`<proposed_plan>\n${thin}\n</proposed_plan>`, {
    userText: user,
    messages: FIGMA_TOOL_MESSAGES,
  });
  assert.equal(d?.reason, "checklist_coverage");
});

test("goal_frame_title requires Goal to include vision-helper Title token", () => {
  assert.equal(
    extractVisionHelperFrameTitle(FIGMA_TOOL_MESSAGES),
    "Удостоверение"
  );
  const driftedGoal =
    "**Цель**: страница notification certificate\n**Шаги**:\n" +
    "1. Роут — новый src/pages/cert/page.tsx — observed: `createRoute`\n" +
    "**Затрагиваемые файлы**: src/pages/cert/page.tsx\n" +
    UI_IMPLEMENTATION;
  assert.equal(
    looksLikeGoalMissingFrameTitle(driftedGoal, FIGMA_TOOL_MESSAGES),
    true
  );
  const okGoal =
    "**Цель**: страница Удостоверение по макету\n**Шаги**:\n" +
    "1. Роут — новый src/pages/cert/page.tsx — observed: `createRoute`\n" +
    "**Затрагиваемые файлы**: src/pages/cert/page.tsx\n" +
    UI_IMPLEMENTATION;
  assert.equal(
    looksLikeGoalMissingFrameTitle(okGoal, FIGMA_TOOL_MESSAGES),
    false
  );
  const user =
    "составь план страницы https://www.figma.com/design/abc/x?node-id=1-2";
  const d = diagnosePlanQualityFailure(
    `<proposed_plan>\n${driftedGoal}\n</proposed_plan>`,
    { userText: user, messages: FIGMA_TOOL_MESSAGES }
  );
  assert.equal(d?.reason, "goal_frame_title");
});

test("historyHasProposedPlan and PLAN_REVISION_HINT", () => {
  assert.equal(historyHasProposedPlan([]), false);
  assert.equal(
    historyHasProposedPlan([
      { role: "user", content: "plan it" },
      {
        role: "assistant",
        content:
          "<proposed_plan>\n**Цель**: x\n**Шаги**:\n1. reuse `src/a/b.ts` — observed: `Foo`\n</proposed_plan>",
      },
    ]),
    true
  );
  assert.match(PLAN_REVISION_HINT, /Plan revision/i);
  assert.match(PLAN_REVISION_HINT, /FULL replacement/i);
  assert.match(PLAN_REVISION_HINT, /Do NOT restart Phase 1/i);
});

test("mechanical plan: package.json path + Steps pass; UI gates skipped", () => {
  assert.match(PLAN_MECHANICAL_HINT, /Mechanical plan/i);
  assert.match(PLAN_MECHANICAL_HINT, /Skip Phase 1/i);
  assert.match(PLAN_MECHANICAL_HINT, /request_user_input/i);
  assert.equal(proposedPlanHasMechanicalPath("Affected: package.json"), true);
  assert.equal(proposedPlanHasGroundedPath("Affected: package.json"), false);

  const user = "Версия 0.0.21 — составь план изменения до 0.0.22";
  const plan = [
    "<proposed_plan>",
    "**Цель**: Поднять версию до 0.0.22",
    "**Шаги**:",
    "1. Обновить `version` в `package.json` с 0.0.21 на 0.0.22",
    "2. Синхронизировать `package-lock.json` при необходимости",
    "**Затрагиваемые файлы**: `package.json`, `package-lock.json`",
    "**Acceptance**: version = 0.0.22",
    "</proposed_plan>",
  ].join("\n");
  assert.equal(
    diagnosePlanQualityFailure(plan, { userText: user, planMechanical: true }),
    null
  );
  assert.equal(
    diagnosePlanQualityFailure(plan, { userText: user }),
    null
  );
  // Without Steps — still fails.
  const noSteps = [
    "<proposed_plan>",
    "**Цель**: bump",
    "**Затрагиваемые файлы**: `package.json`",
    "</proposed_plan>",
  ].join("\n");
  const bad = diagnosePlanQualityFailure(noSteps, {
    userText: user,
    planMechanical: true,
  });
  assert.equal(bad?.reason, "missing_steps");
});

test("planRevision diagnose skips re-fetch gates", () => {
  const user =
    "бекенд не предусмотрен https://www.figma.com/design/abc/x?node-id=1-2";
  const plan = [
    "<proposed_plan>",
    "**Цель**: Удостоверение",
    "**Шаги**:",
    "1. Таблица — новый по паттерну `src/pages/notification-certificate/ui/page.tsx` — observed: `CertificatePage`",
    "**Затрагиваемые файлы**: `src/pages/notification-certificate/ui/page.tsx`",
    "**Acceptance**: UI без API",
    UI_IMPLEMENTATION_NOTIFICATION,
    "</proposed_plan>",
  ].join("\n");
  // Fresh turn without tool reads would fail component API / Figma tools.
  const fresh = diagnosePlanQualityFailure(plan, {
    userText: user,
    messages: [],
  });
  assert.ok(fresh);
  assert.ok(
    (fresh?.reasons || []).includes("missing_figma_tools") ||
      (fresh?.reasons || []).includes("missing_component_api_read")
  );
  // Revision: same card + scope note — do not force re-Figma / re-read.
  const rev = diagnosePlanQualityFailure(plan, {
    userText: "бекенд не предусмотрен",
    messages: [],
    planRevision: true,
  });
  assert.equal(rev, null);
});

test("shouldForceFigmaBeforeExplore until Figma MCP ran in Plan", () => {
  const user =
    "составь план https://www.figma.com/design/abc/x?node-id=1-2";
  assert.equal(
    shouldForceFigmaBeforeExplore({
      planMode: true,
      figmaConnected: true,
      userText: user,
      messages: [],
    }),
    true
  );
  assert.equal(
    shouldForceFigmaBeforeExplore({
      planMode: true,
      figmaConnected: true,
      userText: user,
      messages: FIGMA_TOOL_MESSAGES,
    }),
    false
  );
  assert.equal(
    shouldForceFigmaBeforeExplore({
      planMode: true,
      figmaConnected: false,
      userText: user,
      messages: [],
    }),
    false
  );
  assert.equal(
    shouldForceFigmaBeforeExplore({
      planMode: false,
      figmaConnected: true,
      userText: user,
      messages: [],
    }),
    false
  );
  assert.equal(
    shouldForceFigmaBeforeExplore({
      planMode: true,
      figmaConnected: true,
      userText: "план без ссылки",
      messages: [],
    }),
    false
  );
  assert.match(FIGMA_FIRST_FORCE_HINT, /FIRST tool call/i);
  assert.match(FIGMA_FIRST_EXPLORE_BLOCKED_JSON, /get_design_context|get_figma_data/);
});

test("diagnosisFromReasons packs multiple reasons into one nudge", () => {
  const single = diagnosisFromReasons(["missing_grounded_path"]);
  assert.equal(single?.reason, "missing_grounded_path");
  assert.deepEqual(single?.reasons, ["missing_grounded_path"]);
  assert.match(single?.nudge || "", /^False: every Step/i);

  const multi = diagnosisFromReasons([
    "missing_figma_tools",
    "page_to_tab",
    "missing_implementation",
  ]);
  assert.equal(multi?.reason, "missing_figma_tools");
  assert.deepEqual(multi?.reasons, [
    "missing_figma_tools",
    "page_to_tab",
    "missing_implementation",
  ]);
  assert.match(multi?.nudge || "", /fix ALL of the following/i);
  assert.match(multi?.nudge || "", /1\)/);
  assert.match(multi?.nudge || "", /2\)/);
  assert.match(multi?.nudge || "", /get_design_context/i);
  assert.match(multi?.nudge || "", /tab|вкладк/i);
  assert.match(multi?.nudge || "", /Implementation/i);

  const capped = diagnosisFromReasons([
    "missing_steps",
    "missing_figma_tools",
    "page_to_tab",
    "missing_implementation",
    "checklist_coverage",
    "goal_frame_title",
  ]);
  assert.equal(capped?.reasons.length, 4);
});

test("multi-reason diagnose when Figma URL + page→tab + no Implementation", () => {
  const user =
    "составь план страницы https://www.figma.com/design/abc/x?node-id=1-2";
  const plan =
    "<proposed_plan>\n**Цель**: вкладка на существующей странице\n**Шаги**:\n" +
    "1. Добавить таб — src/features/ibkc/tabs.tsx\n" +
    "**Затрагиваемые файлы**: src/features/ibkc/tabs.tsx\n</proposed_plan>";
  const d = diagnosePlanQualityFailure(plan, { userText: user, messages: [] });
  assert.ok(d);
  assert.ok(d.reasons.includes("missing_figma_tools"));
  assert.ok(d.reasons.includes("page_to_tab"));
  assert.ok(d.reasons.includes("missing_implementation"));
  assert.match(d.nudge, /fix ALL of the following/i);
});

test("missing_path_read when analogue path was never read_file'd", () => {
  const body =
    "**Цель**: x\n**Шаги**:\n" +
    "1. Таблица — новый по паттерну `src/pages/foo/page.tsx` — observed: `DataTable`\n" +
    "**Затрагиваемые файлы**: src/pages/bar/page.tsx\n";
  const otherRead = [
    {
      role: "tool",
      name: "read_file",
      content: JSON.stringify({
        path: "src/pages/other/page.tsx",
        content: "export const Other = () => null;",
      }),
    },
  ];
  assert.equal(looksLikeMissingAnaloguePathRead(body, otherRead), true);
  const matchedRead = [
    {
      role: "tool",
      name: "read_file",
      content: JSON.stringify({
        path: "src/pages/foo/page.tsx",
        content: "export const DataTable = () => null;",
      }),
    },
  ];
  assert.equal(looksLikeMissingAnaloguePathRead(body, matchedRead), false);
  assert.equal(looksLikeMissingAnaloguePathRead(body, []), false);
});

test("implementation_api_mismatch when props not in component source", () => {
  const body =
    "**Цель**: x\n**Шаги**:\n1. reuse `src/pages/a.tsx` — observed: `Table`\n" +
    "**Implementation**:\n- import { Table } from `shared/ui/Table`\n- columns={inventedVirtualScroll}\n";
  const reads = [
    {
      role: "tool",
      name: "read_file",
      content: JSON.stringify({
        path: "src/shared/ui/Table.tsx",
        content: "export function Table(props: { columns: Column[] }) { return null; }",
      }),
    },
  ];
  assert.ok(extractImplementationEvidenceTokens(body).length >= 1);
  // inventedVirtualScroll / backticks that aren't in file → mismatch
  const invented =
    "**Implementation**:\n- `inventedVirtualScroll` on Table\n- props fooBarBazQuux=\n";
  assert.equal(
    looksLikeImplementationApiMismatch(
      "**Цель**: x\n**Шаги**:\n1. x\n" + invented,
      reads
    ),
    true
  );
  const matched =
    "**Implementation**:\n- import type — `columns` from Table\n- path `src/shared/ui/Table.tsx`\n";
  assert.equal(
    looksLikeImplementationApiMismatch(
      "**Цель**: x\n**Шаги**:\n1. x\n" + matched,
      reads
    ),
    false
  );
  assert.equal(
    diagnosisHasCriticalPlanGap({
      reason: "missing_path_read",
      reasons: ["missing_path_read"],
      nudge: "x",
    }),
    true
  );
  assert.equal(
    diagnosisHasCriticalPlanGap({
      reason: "page_to_tab",
      reasons: ["page_to_tab"],
      nudge: "x",
    }),
    false
  );
});

test("figma_block_inventory requires vision-helper labels in the plan", () => {
  const richVision = [
    {
      role: "tool",
      name: "mcp__figma__get_design_context",
      content: JSON.stringify({ ok: true }),
    },
    {
      role: "tool",
      name: "mcp__figma__get_screenshot",
      content:
        "[Harbor vision helper · vision-model]\n\n## Visible UI (from screenshot)\n" +
        "Title: Удостоверение\n" +
        "Columns: Вид работ, Статус, Организация\n" +
        "Actions: Создать, Экспорт\n",
    },
  ];
  assert.deepEqual(extractVisionHelperUiLabels(richVision).sort(), [
    "Вид работ",
    "Организация",
    "Создать",
    "Статус",
    "Экспорт",
  ].sort());

  const thinBody =
    "**Цель**: страница Удостоверение\n**Шаги**:\n" +
    "1. Роут — новый src/pages/cert/page.tsx — observed: `createRoute`\n" +
    "**Затрагиваемые файлы**: src/pages/cert/page.tsx\n" +
    UI_IMPLEMENTATION;
  assert.equal(looksLikeMissingFigmaBlockInventory(thinBody, richVision), true);

  const coveredBody =
    "**Цель**: страница Удостоверение\n**Шаги**:\n" +
    "1. Таблица — колонки Вид работ, Статус, Организация — src/pages/cert/table.tsx\n" +
    "2. Actions — Создать / Экспорт — src/pages/cert/actions.tsx\n" +
    "**Затрагиваемые файлы**: src/pages/cert/table.tsx\n" +
    UI_IMPLEMENTATION;
  assert.equal(looksLikeMissingFigmaBlockInventory(coveredBody, richVision), false);

  // Near 1:1: covering only 2 of 5 labels fails (half used to pass).
  const halfBody =
    "**Цель**: страница Удостоверение\n**Шаги**:\n" +
    "1. Колонки Вид работ, Статус — src/pages/cert/table.tsx\n" +
    "**Затрагиваемые файлы**: src/pages/cert/table.tsx\n" +
    UI_IMPLEMENTATION;
  assert.equal(looksLikeMissingFigmaBlockInventory(halfBody, richVision), true);

  // Allow dropping at most one label (4 of 5).
  const almostBody =
    "**Цель**: страница Удостоверение\n**Шаги**:\n" +
    "1. Колонки Вид работ, Статус, Организация — src/pages/cert/table.tsx\n" +
    "2. Actions — Создать — src/pages/cert/actions.tsx\n" +
    "**Затрагиваемые файлы**: src/pages/cert/table.tsx\n" +
    UI_IMPLEMENTATION;
  assert.equal(looksLikeMissingFigmaBlockInventory(almostBody, richVision), false);

  // Single Column label is below the inventory threshold (need ≥2 labels).
  assert.equal(
    looksLikeMissingFigmaBlockInventory(thinBody, FIGMA_TOOL_MESSAGES),
    false
  );

  const user =
    "составь план страницы https://www.figma.com/design/abc/x?node-id=1-2";
  const d = diagnosePlanQualityFailure(
    `<proposed_plan>\n${thinBody}\n</proposed_plan>`,
    { userText: user, messages: richVision }
  );
  assert.ok(d?.reasons.includes("figma_block_inventory"));
  assert.match(d?.nudge || "", /Columns|Filters|Actions|Tabs|labels/i);
});

test("checklist_coverage is semantic: count alone is not enough", () => {
  const user =
    "план:\n1. Роут\n2. Таблица\n3. Фильтры\nhttps://www.figma.com/design/abc/x?node-id=1-2";
  assert.ok(significantChecklistTokens("3. Фильтры").includes("фильтры"));
  const collapsed =
    "**Цель**: страница Удостоверение\n**Шаги**:\n" +
    "1. Роут — новый src/pages/cert/page.tsx — observed: `createRoute`\n" +
    "2. Роут дубль — src/pages/cert/route2.tsx\n" +
    "3. Ещё роут — src/pages/cert/route3.tsx\n" +
    "**Затрагиваемые файлы**: src/pages/cert/page.tsx\n" +
    UI_IMPLEMENTATION;
  // 3 steps ≥ 3 items, but «Таблица» / «Фильтры» never appear → semantic gap.
  assert.equal(looksLikeChecklistCoverageGap(collapsed, user), true);
  const covered =
    "**Цель**: страница Удостоверение\n**Шаги**:\n" +
    "1. Роут — новый src/pages/cert/page.tsx — observed: `createRoute`\n" +
    "2. Таблица — новый src/pages/cert/table.tsx\n" +
    "3. Фильтры — новый src/pages/cert/filters.tsx\n" +
    "**Затрагиваемые файлы**: src/pages/cert/page.tsx\n" +
    UI_IMPLEMENTATION;
  assert.equal(looksLikeChecklistCoverageGap(covered, user), false);
});

test("shouldRunScreenshotPlanPreflight: Plan + image, skip only Figma URL", () => {
  assert.equal(
    shouldRunScreenshotPlanPreflight({
      planMode: true,
      hasImageAttachment: true,
      userText: "реализуем данную страницу",
    }),
    true
  );
  assert.equal(
    shouldRunScreenshotPlanPreflight({
      planMode: true,
      hasImageAttachment: true,
      userText: "посмотри и составь план для реализации, бекенда пока нет",
    }),
    true
  );
  assert.equal(
    shouldRunScreenshotPlanPreflight({
      planMode: true,
      hasImageAttachment: true,
      userText: "ok",
    }),
    true
  );
  assert.equal(
    shouldRunScreenshotPlanPreflight({
      planMode: false,
      hasImageAttachment: true,
      userText: "реализуем данную страницу",
    }),
    false
  );
  assert.equal(
    shouldRunScreenshotPlanPreflight({
      planMode: true,
      hasImageAttachment: false,
      userText: "реализуем данную страницу",
    }),
    false
  );
  assert.equal(
    shouldRunScreenshotPlanPreflight({
      planMode: true,
      hasImageAttachment: true,
      userText:
        "план https://www.figma.com/design/abc/x?node-id=1-2 страницы",
    }),
    false
  );
  // Revision + image still runs (new/same mockup must be OCR'd).
  assert.equal(
    shouldRunScreenshotPlanPreflight({
      planMode: true,
      hasImageAttachment: true,
      userText: "посмотри и составь план для реализации",
      planRevision: true,
      planMechanical: true,
    }),
    true
  );
  assert.equal(messageHasImageAttachment([{ kind: "image" }]), true);
  assert.equal(messageHasImageAttachment([{ kind: "file" }]), false);
  assert.match(SCREENSHOT_FIRST_HINT, /Visible UI|screenshot/i);
  assert.match(SCREENSHOT_FIRST_HINT, /request_user_input/i);
});

test("shouldWholeTurnRouteForImageAttachment: Plan never swaps planner", () => {
  const {
    shouldWholeTurnRouteForImageAttachment,
  } = require("../out/planQuality.js");
  assert.equal(
    shouldWholeTurnRouteForImageAttachment({
      planMode: true,
      hasImageAttachment: true,
      userText: "составь план по скрину",
    }),
    false
  );
  assert.equal(
    shouldWholeTurnRouteForImageAttachment({
      planMode: false,
      hasImageAttachment: true,
      userText: "что на картинке?",
    }),
    true
  );
  assert.equal(
    shouldWholeTurnRouteForImageAttachment({
      planMode: true,
      hasImageAttachment: true,
      userText: "план https://www.figma.com/design/abc/x?node-id=1-2",
    }),
    false
  );
  assert.equal(
    shouldWholeTurnRouteForImageAttachment({
      planMode: true,
      hasImageAttachment: false,
      userText: "составь план",
    }),
    false
  );
});

test("vision inventory gates work on system-injected OCR without Figma URL", () => {
  const systemOcr = {
    role: "system",
    content:
      "[Harbor vision helper · vision-model]\n\n## Visible UI (from screenshot)\n" +
      "Title: Удостоверение\n" +
      "Columns: ФИО, Профессия, Вид работ, Тип ПС\n" +
      "Actions: Скачать, Распечатать\n",
  };
  assert.equal(
    extractVisionHelperFrameTitle([systemOcr]),
    "Удостоверение"
  );
  assert.ok(
    extractVisionHelperUiLabels([systemOcr]).some((l) => /Вид работ/i.test(l))
  );

  const thin =
    "**Цель**: новая страница\n**Шаги**:\n" +
    "1. Таблица — src/pages/cert/page.tsx — observed: `Table`\n" +
    "**Затрагиваемые файлы**: src/pages/cert/page.tsx\n" +
    "**Implementation**: Table props=`data` import from `src/shared/ui/table`\n";
  assert.equal(looksLikeGoalMissingFrameTitle(thin, [systemOcr]), true);
  assert.equal(looksLikeMissingFigmaBlockInventory(thin, [systemOcr]), true);

  const d = diagnosePlanQualityFailure(
    `<proposed_plan>\n${thin}\n</proposed_plan>`,
    {
      userText: "реализуем данную страницу",
      messages: [systemOcr],
      hasImageAttachment: true,
    }
  );
  assert.ok(
    d?.reasons.includes("goal_frame_title") ||
      d?.reasons.includes("figma_block_inventory")
  );
});
