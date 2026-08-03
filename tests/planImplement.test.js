const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PLAN_IMPLEMENT_MARKER,
  stripPlanImplementWrapper,
  looksLikePlanImplementRequest,
  looksLikeEditCorrectionRequest,
  buildPlanImplementSystemHint,
  buildEditCorrectionSystemHint,
  extractPlanTargetPaths,
  remainingPlanTargetPaths,
  buildPlanChecklistNudge,
} = require("../out/planImplement.js");

const {
  exploreRoundLimits,
  buildExploreSoftNudge,
  EXPLORE_SOFT_NUDGE_ROUNDS,
  KIMI_EXPLORE_SOFT_NUDGE_ROUNDS,
} = require("../out/toolRoundPolicy.js");

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
  assert.match(hint, /correcting/i);
  assert.match(hint, /search_replace/i);
  assert.match(hint, /Figma|vision-helper/i);
  assert.match(hint, /read_file/i);
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
