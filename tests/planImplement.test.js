const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PLAN_IMPLEMENT_MARKER,
  PLAN_IMPLEMENT_PREFIX_RU,
  stripPlanImplementWrapper,
  buildPlanImplementUserText,
  planMarkdownFileName,
  looksLikePlanImplementRequest,
  looksLikeEditCorrectionRequest,
  buildPlanImplementSystemHint,
  buildEditCorrectionSystemHint,
  extractPlanTargetPaths,
  remainingPlanTargetPaths,
  buildPlanChecklistNudge,
  buildPlanChecklistPartialFinale,
} = require("../out/planImplement.js");

const {
  exploreRoundLimits,
  buildExploreSoftNudge,
  EXPLORE_SOFT_NUDGE_ROUNDS,
  KIMI_EXPLORE_SOFT_NUDGE_ROUNDS,
} = require("../out/toolRoundPolicy.js");

test("planMarkdownFileName and buildPlanImplementUserText", () => {
  assert.equal(planMarkdownFileName("ru"), "План.md");
  assert.equal(planMarkdownFileName("en"), "Plan.md");
  const payload = buildPlanImplementUserText(
    "**Цель**: x\n**Шаги**:\n1. a",
    PLAN_IMPLEMENT_PREFIX_RU
  );
  assert.match(payload, /\[\[harbor:implement_plan\]\]/);
  assert.match(payload, /Реализуй следующий план/);
  assert.match(payload, /\*\*Цель\*\*: x/);
  assert.equal(buildPlanImplementUserText("   "), "");
});

test("stripPlanImplementWrapper removes marker and RU/EN implement prefixes", () => {
  assert.equal(
    stripPlanImplementWrapper(
      `${PLAN_IMPLEMENT_MARKER}\nРеализуй следующий план точно (компоненты, пути и шаги — как написано, без подмены своими):\n\n**Цель**: страница`
    ),
    "**Цель**: страница"
  );
  assert.equal(
    stripPlanImplementWrapper(
      `${PLAN_IMPLEMENT_MARKER}\nImplement the following plan exactly (components, paths, and steps as written — do not substitute your own):\n\n**Goal**: page`
    ),
    "**Goal**: page"
  );
  assert.equal(
    stripPlanImplementWrapper("**Цель**: уже чистый план"),
    "**Цель**: уже чистый план"
  );
});

test("looksLikePlanImplementRequest detects marker and localized prefixes", () => {
  assert.equal(
    looksLikePlanImplementRequest(
      `${PLAN_IMPLEMENT_MARKER}\nРеализуй следующий план точно …\n\n**Цель**`
    ),
    true
  );
  assert.equal(
    looksLikePlanImplementRequest("Implement the following plan:\n\n**Goal**"),
    true
  );
  assert.equal(
    looksLikePlanImplementRequest("Реализуй следующий план:\n\n**Цель**"),
    true
  );
  assert.equal(
    looksLikePlanImplementRequest("просто сделай страницу по фигме"),
    false
  );
});

test("looksLikeEditCorrectionRequest detects wrong-table / mixed-up follow-ups", () => {
  assert.equal(
    looksLikeEditCorrectionRequest("таблица не та, я перепутал"),
    true
  );
  assert.equal(
    looksLikeEditCorrectionRequest("не тот компонент, переделай"),
    true
  );
  assert.equal(
    looksLikeEditCorrectionRequest("wrong table, I mixed up the screen"),
    true
  );
  // Layout unwrap without open-file context is NOT the legacy regex path —
  // use looksLikeDirectiveFixRequest (structural) instead.
  assert.equal(
    looksLikeEditCorrectionRequest(
      "не нужно оборачивать layout content он уже есть внутри таблицы"
    ),
    false
  );
  assert.equal(
    looksLikeEditCorrectionRequest("добавь кнопку сохранить в шапку"),
    false
  );
  assert.equal(
    looksLikeEditCorrectionRequest(
      `${PLAN_IMPLEMENT_MARKER}\nРеализуй следующий план:\n\nтаблица`
    ),
    false
  );
});

test("looksLikeDirectiveFixRequest is structural: short + target file", () => {
  const { looksLikeDirectiveFixRequest } = require("../out/planImplement.js");
  assert.equal(
    looksLikeDirectiveFixRequest(
      "не нужно оборачивать layout content он уже есть внутри таблицы",
      { openPaths: ["src/features/cert/certificate-table.tsx"] }
    ),
    true
  );
  assert.equal(
    looksLikeDirectiveFixRequest("убери лишнюю обёртку", {
      lastEditedPaths: ["src/a.tsx"],
    }),
    true
  );
  assert.equal(
    looksLikeDirectiveFixRequest("поправь title в src/config.ts"),
    true
  );
  // No target → not a directive-fix lane.
  assert.equal(
    looksLikeDirectiveFixRequest("убери лишнюю обёртку", {
      openPaths: [],
      lastEditedPaths: [],
    }),
    false
  );
  // Complex / page → no.
  assert.equal(
    looksLikeDirectiveFixRequest("создай новую страницу Отделы", {
      openPaths: ["src/pages/x.tsx"],
    }),
    false
  );
  // Bare question → no.
  assert.equal(
    looksLikeDirectiveFixRequest("что делает эта функция?", {
      openPaths: ["src/a.ts"],
    }),
    false
  );
});

test("buildPlanImplementSystemHint requires reading project files for HOW", () => {
  const hint = buildPlanImplementSystemHint();
  assert.match(hint, /binding contract/i);
  assert.match(hint, /read_file/i);
  assert.match(hint, /HOW to write/i);
  assert.match(hint, /never empty or truncated/i);
  assert.match(hint, /Acceptance/i);
  assert.match(hint, /completed vs remaining/i);
});

test("buildPlanImplementSystemHint treats the plan Implementation section as the HOW contract", () => {
  const hint = buildPlanImplementSystemHint();
  assert.match(hint, /\*\*Implementation\*\*/i);
  assert.match(hint, /exact props and types/i);
  assert.match(hint, /Do not re-decide them/i);
});

test("buildEditCorrectionSystemHint prefers search_replace and Figma labels", () => {
  const hint = buildEditCorrectionSystemHint();
  assert.match(hint, /correcting|short directive|known target/i);
  assert.match(hint, /search_replace/i);
  assert.match(hint, /Figma|vision-helper/i);
  assert.match(hint, /read_file/i);
  assert.match(hint, /paired sites|search_text/i);
  assert.match(hint, /do not only describe the fix/i);
});

test("implementPlan uses tighter explore limits than Agent default", () => {
  const {
    IMPLEMENT_EXPLORE_SOFT_NUDGE_ROUNDS,
  } = require("../out/toolRoundPolicy.js");
  const agent = exploreRoundLimits({ kimi: false });
  const implement = exploreRoundLimits({ kimi: true, implementPlan: true });
  assert.equal(agent.softNudgeRounds, KIMI_EXPLORE_SOFT_NUDGE_ROUNDS);
  assert.equal(agent.softNudgeRounds, EXPLORE_SOFT_NUDGE_ROUNDS);
  assert.equal(implement.softNudgeRounds, IMPLEMENT_EXPLORE_SOFT_NUDGE_ROUNDS);
  assert.ok(implement.softNudgeRounds < agent.softNudgeRounds);
});

test("implementPlan explore soft nudge asks to edit with complete contents", () => {
  const nudge = buildExploreSoftNudge({
    agentsMd: false,
    readonly: false,
    implementPlan: true,
  });
  assert.match(nudge, /search_replace/i);
  assert.match(nudge, /COMPLETE|project patterns/i);
});

test("extractPlanTargetPaths reads Affected files and reuse/create targets", () => {
  const plan = `${PLAN_IMPLEMENT_MARKER}
Реализуй следующий план:

**Цель**: страница
**Шаги**:
1. reuse src/entities/foo/index.ts — observed: \`export\`
2. новый по паттерну src/pages/old/page.tsx — создать экран
3. Кнопки — src/features/cert/certificate-actions.tsx
**Затрагиваемые файлы**: src/pages/certificate/page.tsx, src/shared/api/initial-briefing/get-certificate-detail/types.ts
**Acceptance**: ок
`;
  const paths = extractPlanTargetPaths(plan);
  assert.ok(paths.includes("src/pages/certificate/page.tsx"));
  assert.ok(
    paths.includes("src/shared/api/initial-briefing/get-certificate-detail/types.ts")
  );
  assert.ok(paths.includes("src/entities/foo/index.ts"));
  assert.ok(paths.includes("src/features/cert/certificate-actions.tsx"));
  // analogue-only «по паттерну» without create/reuse keyword should not force the analogue path
  assert.equal(paths.includes("src/pages/old/page.tsx"), false);
});

test("remainingPlanTargetPaths and checklist nudge", () => {
  const plan = `
**Затрагиваемые файлы**: src/a.ts, src/b.ts
`;
  assert.deepEqual(remainingPlanTargetPaths(plan, ["src/a.ts"]), ["src/b.ts"]);
  const nudge = buildPlanChecklistNudge(["src/b.ts"]);
  assert.match(nudge, /Plan checklist incomplete/);
  assert.match(nudge, /src\/b\.ts/);
  assert.match(nudge, /search_replace/);
});

test("buildPlanChecklistPartialFinale prepends honest remaining paths", () => {
  const partial = buildPlanChecklistPartialFinale("Готово, всё сделал.", [
    "src/b.ts",
    "src/c.ts",
  ]);
  assert.match(partial, /частично/i);
  assert.match(partial, /src\/b\.ts/);
  assert.match(partial, /src\/c\.ts/);
  assert.match(partial, /Готово, всё сделал/);

  const alreadyHonest = buildPlanChecklistPartialFinale(
    "Сделано частично. Осталось: src/b.ts — blocked by missing API.",
    ["src/b.ts"]
  );
  assert.equal(
    alreadyHonest,
    "Сделано частично. Осталось: src/b.ts — blocked by missing API."
  );

  assert.equal(buildPlanChecklistPartialFinale("ok", []), "ok");
});
