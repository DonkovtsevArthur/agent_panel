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
