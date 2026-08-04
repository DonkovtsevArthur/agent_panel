const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  toRepoRelativePath,
  toRepoRelativePaths,
} = require("../out/repoPaths.js");

test("keeps already-relative paths", () => {
  assert.equal(toRepoRelativePath("src/a.ts"), "src/a.ts");
  assert.equal(toRepoRelativePath("./media/panel.js"), "media/panel.js");
});

test("strips workspace absolute prefix via cwd", () => {
  const cwd = "/Users/me/proj";
  assert.equal(
    toRepoRelativePath("/Users/me/proj/package.json", cwd),
    "package.json"
  );
  assert.equal(
    toRepoRelativePath("/Users/me/proj/src/a.ts", cwd),
    "src/a.ts"
  );
});

test("does not mangle absolute paths into Users/... without cwd", () => {
  assert.equal(
    toRepoRelativePath("/Users/me/proj/package.json"),
    ""
  );
});

test("dedupes mixed absolute and relative", () => {
  const cwd = "/Users/me/proj";
  assert.deepEqual(
    toRepoRelativePaths(
      ["/Users/me/proj/package.json", "package.json", "./package.json"],
      cwd
    ),
    ["package.json"]
  );
});
