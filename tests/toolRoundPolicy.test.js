const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EXPLORE_SOFT_NUDGE_ROUNDS,
  EXPLORE_HARD_CUT_ROUNDS,
  IMPLEMENT_EXPLORE_SOFT_NUDGE_ROUNDS,
  FOCUSED_EXPLORE_SOFT_NUDGE_ROUNDS,
  FOCUSED_EXPLORE_HARD_CUT_ROUNDS,
  COLD_PAGE_EXPLORE_SOFT_NUDGE_ROUNDS,
  COLD_PAGE_EXPLORE_HARD_CUT_ROUNDS,
  KIMI_EXPLORE_SOFT_NUDGE_ROUNDS,
  KIMI_EXPLORE_HARD_CUT_ROUNDS,
  ROUND_EXTENSION_SIZE,
  MAX_ROUND_EXTENSIONS,
  isExploreOnlyTool,
  roundWasExploreOnly,
  shouldExtendToolRounds,
  exploreRoundLimits,
  classifyExploreBudgetSignal,
  hardCutAllowsSearchText,
  userMessageHasFocusedPath,
  looksLikeColdPageExploreRequest,
  buildExploreSoftNudge,
  buildExploreHardNudge,
  buildKimiWorkspaceFollowHint,
} = require("../out/toolRoundPolicy.js");

test("explore-only detection", () => {
  assert.equal(isExploreOnlyTool("list_files"), true);
  assert.equal(isExploreOnlyTool("read_file"), true);
  assert.equal(isExploreOnlyTool("search_text"), true);
  assert.equal(isExploreOnlyTool("write_file"), false);
  assert.equal(roundWasExploreOnly(["list_files", "read_file"]), true);
  assert.equal(roundWasExploreOnly(["search_text", "read_file"]), true);
  assert.equal(roundWasExploreOnly(["read_file", "write_file"]), false);
  assert.equal(roundWasExploreOnly([]), false);
});

test("round extension policy", () => {
  assert.equal(
    shouldExtendToolRounds({
      extensionsUsed: 0,
      hadProductiveTool: true,
      answered: false,
    }),
    true
  );
  assert.equal(
    shouldExtendToolRounds({
      extensionsUsed: 0,
      hadProductiveTool: false,
      answered: false,
    }),
    false
  );
  assert.equal(
    shouldExtendToolRounds({
      extensionsUsed: MAX_ROUND_EXTENSIONS,
      hadProductiveTool: true,
      answered: false,
    }),
    false
  );
  assert.equal(ROUND_EXTENSION_SIZE, 8);
  assert.equal(EXPLORE_SOFT_NUDGE_ROUNDS, 4);
  assert.equal(EXPLORE_HARD_CUT_ROUNDS, 6);
});

test("Agent explore limits match for all models and strip explore on soft", () => {
  assert.equal(KIMI_EXPLORE_SOFT_NUDGE_ROUNDS, EXPLORE_SOFT_NUDGE_ROUNDS);
  assert.equal(KIMI_EXPLORE_HARD_CUT_ROUNDS, EXPLORE_HARD_CUT_ROUNDS);
  const defaultLimits = exploreRoundLimits({ kimi: false });
  assert.deepEqual(defaultLimits, {
    softNudgeRounds: 4,
    hardCutRounds: 6,
    stripExploreOnSoftNudge: true,
    hardCutExplore: true,
  });
  const kimiLimits = exploreRoundLimits({ kimi: true });
  assert.deepEqual(kimiLimits, defaultLimits);
});

test("adaptive explore: focused path / cold page / implement", () => {
  assert.equal(userMessageHasFocusedPath("fix @src/pages/foo.tsx please"), true);
  assert.equal(userMessageHasFocusedPath("поправь src/shared/ui/toast.tsx"), true);
  assert.equal(userMessageHasFocusedPath("сделай красиво"), false);
  assert.equal(
    looksLikeColdPageExploreRequest("создай новую страницу по фигме"),
    true
  );
  assert.equal(
    looksLikeColdPageExploreRequest("создай новую страницу в src/pages/x.tsx"),
    false
  );
  assert.equal(
    classifyExploreBudgetSignal({ userText: "edit src/a.ts" }),
    "focused"
  );
  assert.equal(
    classifyExploreBudgetSignal({ userText: "new page from figma" }),
    "cold_page"
  );
  assert.equal(
    classifyExploreBudgetSignal({ implementPlan: true, userText: "new page" }),
    "implement"
  );
  const focused = exploreRoundLimits({
    kimi: false,
    userText: "поправь src/pages/foo.tsx",
  });
  assert.equal(focused.softNudgeRounds, FOCUSED_EXPLORE_SOFT_NUDGE_ROUNDS);
  assert.equal(focused.hardCutRounds, FOCUSED_EXPLORE_HARD_CUT_ROUNDS);
  const cold = exploreRoundLimits({
    kimi: false,
    userText: "создай новую страницу Удостоверение",
  });
  assert.equal(cold.softNudgeRounds, COLD_PAGE_EXPLORE_SOFT_NUDGE_ROUNDS);
  assert.equal(cold.hardCutRounds, COLD_PAGE_EXPLORE_HARD_CUT_ROUNDS);
});

test("hardCutAllowsSearchText only after productive Agent edits", () => {
  assert.equal(
    hardCutAllowsSearchText({
      readonly: false,
      hadProductiveTool: false,
    }),
    false
  );
  assert.equal(
    hardCutAllowsSearchText({
      readonly: false,
      hadProductiveTool: true,
    }),
    true
  );
  assert.equal(
    hardCutAllowsSearchText({
      readonly: false,
      hadProductiveTool: false,
      impactNudgeAttempts: 1,
    }),
    true
  );
  assert.equal(
    hardCutAllowsSearchText({
      readonly: true,
      hadProductiveTool: true,
    }),
    false
  );
});

test("explore nudges mention AGENTS.md when needed", () => {
  const soft = buildExploreSoftNudge({ agentsMd: true, readonly: false });
  assert.match(soft, /AGENTS\.md/);
  assert.match(soft, /write_file/);
  const hard = buildExploreHardNudge({ agentsMd: true, readonly: false });
  assert.match(hard, /Exploration limit/);
  assert.match(hard, /AGENTS\.md/);
  const ask = buildExploreSoftNudge({ agentsMd: false, readonly: true });
  assert.match(ask, /Reply to the user/);
  assert.doesNotMatch(ask, /write_file/);
});

test("Agent soft nudge stops explore and asks to write by analogy", () => {
  for (const kimi of [true, false]) {
    const soft = buildExploreSoftNudge({
      agentsMd: false,
      readonly: false,
      kimi,
    });
    assert.match(soft, /analogous|already read/i);
    assert.match(soft, /write_file|search_replace/);
    assert.match(soft, /no longer available|Stop exploring/i);
  }
});

test("Agent hard nudge keeps search_text for consumers after edits", () => {
  const hard = buildExploreHardNudge({
    agentsMd: false,
    readonly: false,
  });
  assert.match(hard, /search_text/);
  assert.match(hard, /consumers/i);
  assert.match(hard, /list_files and read_file are no longer allowed/i);
});

test("workspace follow hint requires reading analogous UI first", () => {
  const hint = buildKimiWorkspaceFollowHint();
  assert.match(hint, /AGENTS\.md/);
  assert.match(hint, /read_file/);
  assert.match(hint, /analog|similar|pattern/i);
  assert.match(hint, /write_file/);
  assert.match(hint, /same tool round|parallel/i);
});

test("plan-mode explore nudges ask for <proposed_plan>, not a concise answer", () => {
  const soft = buildExploreSoftNudge({
    agentsMd: false,
    readonly: true,
    plan: true,
  });
  assert.match(soft, /proposed_plan/);
  assert.match(soft, /not a hard stop|remain available/i);
  assert.match(soft, /Do not drop remaining items/i);
  assert.doesNotMatch(soft, /Reply to the user/);
  const hard = buildExploreHardNudge({
    agentsMd: false,
    readonly: true,
    plan: true,
  });
  assert.match(hard, /proposed_plan/);
  assert.doesNotMatch(hard, /Answer the user/);
  // Ask mode (readonly, no plan) keeps the concise-answer wording.
  const ask = buildExploreSoftNudge({ agentsMd: false, readonly: true });
  assert.match(ask, /Reply to the user/);
});

test("planQuality explore: soft reminders only, no hard-cut", () => {
  const {
    PLAN_QUALITY_SOFT_NUDGE_ROUNDS,
    PLAN_QUALITY_KIMI_SOFT_NUDGE_ROUNDS,
    PLAN_REVISION_SOFT_NUDGE_ROUNDS,
  } = require("../out/toolRoundPolicy.js");
  const plan = exploreRoundLimits({ kimi: false, planQuality: true });
  assert.equal(plan.softNudgeRounds, PLAN_QUALITY_SOFT_NUDGE_ROUNDS);
  assert.equal(plan.softNudgeRounds, 8);
  assert.equal(plan.stripExploreOnSoftNudge, false);
  assert.equal(plan.hardCutExplore, false);
  assert.ok(plan.hardCutRounds > 1000);
  // Same soft threshold for Kimi and Claude/other — Plan grounding needs room.
  const kimiPlan = exploreRoundLimits({ kimi: true, planQuality: true });
  assert.equal(kimiPlan.softNudgeRounds, PLAN_QUALITY_SOFT_NUDGE_ROUNDS);
  assert.equal(
    kimiPlan.softNudgeRounds,
    PLAN_QUALITY_KIMI_SOFT_NUDGE_ROUNDS
  );
  assert.equal(kimiPlan.hardCutExplore, false);
  assert.equal(kimiPlan.stripExploreOnSoftNudge, false);
  // Revision: soft-strip explore soon; still no hard-cut.
  const revision = exploreRoundLimits({
    kimi: false,
    planQuality: true,
    planRevision: true,
  });
  assert.equal(revision.softNudgeRounds, PLAN_REVISION_SOFT_NUDGE_ROUNDS);
  assert.equal(revision.softNudgeRounds, 2);
  assert.equal(revision.stripExploreOnSoftNudge, true);
  assert.equal(revision.hardCutExplore, false);
  const revNudge = buildExploreSoftNudge({
    agentsMd: false,
    readonly: true,
    plan: true,
    planRevision: true,
  });
  assert.match(revNudge, /FULL replacement/i);
  assert.match(revNudge, /no longer available/i);
  // implementPlan still wins over planQuality if both were set
  const implement = exploreRoundLimits({
    kimi: true,
    implementPlan: true,
    planQuality: true,
  });
  assert.equal(implement.softNudgeRounds, IMPLEMENT_EXPLORE_SOFT_NUDGE_ROUNDS);
  assert.equal(implement.stripExploreOnSoftNudge, true);
  assert.equal(implement.hardCutExplore, true);
});

test("roundAdvancesExploreStreak counts delegate_task only in readonly", () => {
  const { roundAdvancesExploreStreak } = require("../out/toolRoundPolicy.js");
  assert.equal(roundAdvancesExploreStreak(["list_files", "read_file"], false), true);
  assert.equal(roundAdvancesExploreStreak(["delegate_task"], false), false);
  assert.equal(roundAdvancesExploreStreak(["delegate_task"], true), true);
  assert.equal(
    roundAdvancesExploreStreak(["read_file", "delegate_task"], true),
    true
  );
  assert.equal(
    roundAdvancesExploreStreak(["read_file", "delegate_task"], false),
    false
  );
  assert.equal(roundAdvancesExploreStreak(["write_file"], true), false);
  assert.equal(roundAdvancesExploreStreak([], true), false);
});
