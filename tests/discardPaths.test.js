const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyDiscardPathsFromStatus,
  parsePorcelainEntries,
} = require("../out/discardPaths.js");

test("parsePorcelainEntries keeps full relative paths", () => {
  const entries = parsePorcelainEntries(
    " M src/app/suspense.tsx\n?? src/new.ts\n"
  );
  assert.deepEqual(
    entries.map((e) => e.path),
    ["src/app/suspense.tsx", "src/new.ts"]
  );
  assert.equal(entries[0].xy, " M");
  assert.equal(entries[1].xy, "??");
});

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

test("classifies untracked and added as remove — never restore", () => {
  const plan = classifyDiscardPathsFromStatus(
    "?? suspense.tsx\nA  src/c.ts\n M src/a.ts\n",
    ["suspense.tsx", "src/c.ts", "src/a.ts"]
  );
  assert.deepEqual(plan.restore, ["src/a.ts"]);
  assert.deepEqual(plan.remove.sort(), ["src/c.ts", "suspense.tsx"]);
});

test("basename seed matches dirty basename path", () => {
  const plan = classifyDiscardPathsFromStatus(
    "?? suspense.tsx\n",
    ["suspense.tsx", "suspense.tsx"]
  );
  assert.deepEqual(plan.restore, []);
  assert.deepEqual(plan.remove, ["suspense.tsx"]);
});

test("unique basename seed maps to full dirty path", () => {
  const plan = classifyDiscardPathsFromStatus(
    " M src/app/suspense.tsx\n",
    ["suspense.tsx"]
  );
  assert.deepEqual(plan.restore, ["src/app/suspense.tsx"]);
});

test("pickDiscardTargets prefers longer dirty path over basename", () => {
  const {
    pickDiscardTargets,
  } = require("../out/discardPaths.js");
  const targets = pickDiscardTargets(
    ["suspense.tsx"],
    ["src/app/suspense.tsx", "other.ts"],
    "/repo",
    "/repo"
  );
  assert.deepEqual(targets, ["src/app/suspense.tsx"]);
});

test("expandSeedsToGitRelPaths joins workspace seed under git root", () => {
  const {
    expandSeedsToGitRelPaths,
  } = require("../out/discardPaths.js");
  const expanded = expandSeedsToGitRelPaths(
    ["src/app/suspense.tsx"],
    "/repo",
    "/repo"
  );
  assert.ok(expanded.includes("src/app/suspense.tsx"));
});
