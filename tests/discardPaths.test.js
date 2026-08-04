const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyDiscardPathsFromStatus,
} = require("../out/discardPaths.js");

test("classifies modified tracked files for restore", () => {
  const plan = classifyDiscardPathsFromStatus(
    " M src/a.ts\nM  src/b.ts\nMM media/panel.js\n",
    ["src/a.ts", "src/b.ts", "media/panel.js"]
  );
  assert.deepEqual(plan.restore.sort(), [
    "media/panel.js",
    "src/a.ts",
    "src/b.ts",
  ]);
  assert.deepEqual(plan.remove, []);
});

test("classifies untracked files for remove", () => {
  const plan = classifyDiscardPathsFromStatus(
    "?? src/new.ts\n?? docs/note.md\n",
    ["src/new.ts", "docs/note.md"]
  );
  assert.deepEqual(plan.restore, []);
  assert.deepEqual(plan.remove.sort(), ["docs/note.md", "src/new.ts"]);
});

test("splits mixed status into restore and remove", () => {
  const plan = classifyDiscardPathsFromStatus(
    " M src/a.ts\n?? src/b.ts\nA  src/c.ts\n",
    ["src/a.ts", "src/b.ts", "src/c.ts"]
  );
  assert.deepEqual(plan.restore.sort(), ["src/a.ts", "src/c.ts"]);
  assert.deepEqual(plan.remove, ["src/b.ts"]);
});

test("ignores paths outside the scoped list", () => {
  const plan = classifyDiscardPathsFromStatus(
    " M src/a.ts\n M src/other.ts\n?? src/b.ts\n",
    ["src/a.ts"]
  );
  assert.deepEqual(plan.restore, ["src/a.ts"]);
  assert.deepEqual(plan.remove, []);
});

test("classifies absolute scoped paths when cwd is provided", () => {
  const plan = classifyDiscardPathsFromStatus(
    " M package.json\n",
    ["/Users/me/proj/package.json"],
    "/Users/me/proj"
  );
  assert.deepEqual(plan.restore, ["package.json"]);
  assert.deepEqual(plan.remove, []);
});
