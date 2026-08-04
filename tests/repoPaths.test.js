const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  toRepoRelativePath,
  toRepoRelativePaths,
  matchSeedsToDirtyPaths,
} = require("../out/repoPaths.js");

test("keeps already-relative paths", () => {
  assert.equal(toRepoRelativePath("src/a.ts"), "src/a.ts");
  assert.equal(toRepoRelativePath("./media/panel.js"), "media/panel.js");
});

test("strips workspace absolute prefix via root", () => {
  const root = "/Users/me/proj";
  assert.equal(
    toRepoRelativePath("/Users/me/proj/package.json", root),
    "package.json"
  );
  assert.equal(
    toRepoRelativePath("/Users/me/proj/src/app/suspense.tsx", root),
    "src/app/suspense.tsx"
  );
});

test("identical basename seed and dirty always match", () => {
  assert.deepEqual(
    matchSeedsToDirtyPaths(
      ["suspense.tsx", "suspense.tsx"],
      ["suspense.tsx"],
      "/Users/me/proj"
    ),
    ["suspense.tsx"]
  );
});

test("unique basename maps seed to full dirty path", () => {
  assert.deepEqual(
    matchSeedsToDirtyPaths(["suspense.tsx"], ["src/app/suspense.tsx"], "/Users/me/proj"),
    ["src/app/suspense.tsx"]
  );
});

test("ambiguous basename does not guess", () => {
  assert.deepEqual(
    matchSeedsToDirtyPaths(
      ["suspense.tsx"],
      ["src/app/suspense.tsx", "lib/suspense.tsx"],
      "/Users/me/proj"
    ),
    []
  );
});

test("suffix match with directory component", () => {
  assert.deepEqual(
    matchSeedsToDirtyPaths(["app/suspense.tsx"], ["src/app/suspense.tsx"]),
    ["src/app/suspense.tsx"]
  );
});

test("dedupes mixed absolute and relative", () => {
  const root = "/Users/me/proj";
  assert.deepEqual(
    toRepoRelativePaths(
      ["/Users/me/proj/package.json", "package.json", "./package.json"],
      root
    ),
    ["package.json"]
  );
});
