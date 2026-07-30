const test = require("node:test");
const assert = require("node:assert/strict");

const {
  WORKSPACE_IGNORE_DIRS,
  isIgnoredDirName,
  isIgnoredWorkspacePath,
  ignoredPathError,
} = require("../out/workspaceIgnore.js");

test("WORKSPACE_IGNORE_DIRS includes node_modules and build artifacts", () => {
  assert.ok(WORKSPACE_IGNORE_DIRS.includes("node_modules"));
  assert.ok(WORKSPACE_IGNORE_DIRS.includes(".git"));
  assert.ok(WORKSPACE_IGNORE_DIRS.includes("dist"));
  assert.ok(WORKSPACE_IGNORE_DIRS.includes("out"));
});

test("isIgnoredDirName matches known dirs only", () => {
  assert.equal(isIgnoredDirName("node_modules"), true);
  assert.equal(isIgnoredDirName(".git"), true);
  assert.equal(isIgnoredDirName("src"), false);
  assert.equal(isIgnoredDirName(""), false);
  assert.equal(isIgnoredDirName("."), false);
});

test("isIgnoredWorkspacePath covers nested and root ignore dirs", () => {
  assert.equal(isIgnoredWorkspacePath(""), false);
  assert.equal(isIgnoredWorkspacePath("."), false);
  assert.equal(isIgnoredWorkspacePath("src/app.ts"), false);
  assert.equal(isIgnoredWorkspacePath("node_modules"), true);
  assert.equal(isIgnoredWorkspacePath("node_modules/lodash/index.js"), true);
  assert.equal(isIgnoredWorkspacePath("/node_modules/foo"), true);
  assert.equal(isIgnoredWorkspacePath("packages/app/node_modules/x"), true);
  assert.equal(isIgnoredWorkspacePath("dist/main.js"), true);
  assert.equal(isIgnoredWorkspacePath("out/extension.js"), true);
  assert.equal(isIgnoredWorkspacePath(".git/config"), true);
  assert.equal(isIgnoredWorkspacePath("src/out/file.ts"), true);
  assert.equal(isIgnoredWorkspacePath("src\\out\\file.ts"), true);
  assert.equal(isIgnoredWorkspacePath("src/output/file.ts"), false);
  assert.equal(isIgnoredWorkspacePath("vendor/lib.rs"), true);
});

test("ignoredPathError mentions the path and policy", () => {
  const msg = ignoredPathError("node_modules/foo");
  assert.match(msg, /node_modules\/foo/);
  assert.match(msg, /игнорируется/i);
});
