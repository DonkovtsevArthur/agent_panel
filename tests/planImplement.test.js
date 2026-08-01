const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PLAN_IMPLEMENT_MARKER,
  looksLikePlanImplementRequest,
  looksLikeEditCorrectionRequest,
  buildPlanImplementSystemHint,
  buildEditCorrectionSystemHint,
} = require("../out/planImplement.js");

const {
  exploreRoundLimits,
  buildExploreSoftNudge,
  EXPLORE_SOFT_NUDGE_ROUNDS,
  KIMI_EXPLORE_SOFT_NUDGE_ROUNDS,
} = require("../out/toolRoundPolicy.js");

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
});

test("buildEditCorrectionSystemHint prefers search_replace and Figma labels", () => {
  const hint = buildEditCorrectionSystemHint();
  assert.match(hint, /correcting/i);
  assert.match(hint, /search_replace/i);
  assert.match(hint, /Figma|vision-helper/i);
  assert.match(hint, /read_file/i);
});

test("implementPlan uses tighter explore limits even for Kimi", () => {
  const kimi = exploreRoundLimits({ kimi: true });
  const implement = exploreRoundLimits({ kimi: true, implementPlan: true });
  assert.equal(kimi.softNudgeRounds, KIMI_EXPLORE_SOFT_NUDGE_ROUNDS);
  assert.equal(implement.softNudgeRounds, EXPLORE_SOFT_NUDGE_ROUNDS);
  assert.ok(implement.softNudgeRounds < kimi.softNudgeRounds);
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
