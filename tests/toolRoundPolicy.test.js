const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EXPLORE_SOFT_NUDGE_ROUNDS,
  EXPLORE_HARD_CUT_ROUNDS,
  ROUND_EXTENSION_SIZE,
  MAX_ROUND_EXTENSIONS,
  isExploreOnlyTool,
  roundWasExploreOnly,
  shouldExtendToolRounds,
  buildExploreSoftNudge,
  buildExploreHardNudge,
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
