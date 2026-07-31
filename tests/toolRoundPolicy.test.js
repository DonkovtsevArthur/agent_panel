const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EXPLORE_SOFT_NUDGE_ROUNDS,
  EXPLORE_HARD_CUT_ROUNDS,
  KIMI_EXPLORE_SOFT_NUDGE_ROUNDS,
  KIMI_EXPLORE_HARD_CUT_ROUNDS,
  ROUND_EXTENSION_SIZE,
  MAX_ROUND_EXTENSIONS,
  isExploreOnlyTool,
  roundWasExploreOnly,
  shouldExtendToolRounds,
  exploreRoundLimits,
  buildExploreSoftNudge,
  buildExploreHardNudge,
  buildKimiWorkspaceFollowHint,
} = require("../out/toolRoundPolicy.js");

test("explore-only detection", () => {
  assert.equal(isExploreOnlyTool("list_files"), true);
  assert.equal(isExploreOnlyTool("read_file"), true);
  assert.equal(isExploreOnlyTool("write_file"), false);
  assert.equal(roundWasExploreOnly(["list_files", "read_file"]), true);
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
  assert.equal(EXPLORE_SOFT_NUDGE_ROUNDS, 2);
  assert.equal(EXPLORE_HARD_CUT_ROUNDS, 4);
});

test("Kimi explore limits allow more reads then strip explore on soft", () => {
  assert.equal(KIMI_EXPLORE_SOFT_NUDGE_ROUNDS, 4);
  assert.equal(KIMI_EXPLORE_HARD_CUT_ROUNDS, 6);
  const defaultLimits = exploreRoundLimits({ kimi: false });
  assert.deepEqual(defaultLimits, {
    softNudgeRounds: 2,
    hardCutRounds: 4,
    stripExploreOnSoftNudge: true,
  });
  const kimiLimits = exploreRoundLimits({ kimi: true });
  assert.deepEqual(kimiLimits, {
    softNudgeRounds: 4,
    hardCutRounds: 6,
    stripExploreOnSoftNudge: true,
  });
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

test("Kimi soft nudge stops explore and asks to write by analogy", () => {
  const soft = buildExploreSoftNudge({
    agentsMd: false,
    readonly: false,
    kimi: true,
  });
  assert.match(soft, /analogous|already read/i);
  assert.match(soft, /write_file/);
  assert.match(soft, /no longer available|Stop exploring/i);
});

test("Kimi workspace follow hint requires reading analogous UI first", () => {
  const hint = buildKimiWorkspaceFollowHint();
  assert.match(hint, /AGENTS\.md/);
  assert.match(hint, /read_file/);
  assert.match(hint, /analog|similar|pattern/i);
  assert.match(hint, /write_file/);
  assert.match(hint, /same tool round|parallel/i);
});
