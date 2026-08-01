const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PLAN_IMPLEMENT_MARKER,
  looksLikePlanImplementRequest,
  buildPlanImplementSystemHint,
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

test("buildPlanImplementSystemHint forbids substituting planned components", () => {
  const hint = buildPlanImplementSystemHint();
  assert.match(hint, /binding contract/i);
  assert.match(hint, /Do NOT invent a parallel component/i);
  assert.match(hint, /Affected files/i);
});

test("implementPlan uses tighter explore limits even for Kimi", () => {
  const kimi = exploreRoundLimits({ kimi: true });
  const implement = exploreRoundLimits({ kimi: true, implementPlan: true });
  assert.equal(kimi.softNudgeRounds, KIMI_EXPLORE_SOFT_NUDGE_ROUNDS);
  assert.equal(implement.softNudgeRounds, EXPLORE_SOFT_NUDGE_ROUNDS);
  assert.ok(implement.softNudgeRounds < kimi.softNudgeRounds);
});

test("implementPlan explore soft nudge asks to edit plan paths", () => {
  const nudge = buildExploreSoftNudge({
    agentsMd: false,
    readonly: false,
    implementPlan: true,
  });
  assert.match(nudge, /approved plan/i);
  assert.match(nudge, /Do not invent a substitute component/i);
});
