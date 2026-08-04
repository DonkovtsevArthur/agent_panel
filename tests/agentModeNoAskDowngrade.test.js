const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Agent mode is not silently downgraded to Ask", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../src/agentPanelProvider.ts"),
    "utf8"
  );
  assert.doesNotMatch(
    src,
    /looksLikeQuestionRequest\(trimmed\)\s*\?\s*getModeById\("ask"\)/
  );
  assert.match(src, /const modeForRun = selectedMode/);
});

test("Agent question turns soft-readonly tools without switching UI mode", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../src/agentLoopMainLike.ts"),
    "utf8"
  );
  assert.match(src, /agentQuestionTurn/);
  assert.match(src, /AGENT_QUESTION_HINT/);
  assert.match(src, /looksLikeQuestionRequest\(options\.userText\)/);
  assert.match(src, /const readonly = modeReadonly \|\| agentQuestionTurn/);
  assert.doesNotMatch(src, /getModeById\("ask"\)/);
});
