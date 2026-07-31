const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parsePorcelainPaths,
  pathsNewlyDirty,
  relatedDirtyCompanions,
} = require("../out/turnFileChanges.js");

test("parsePorcelainPaths reads modified, untracked, and rename targets", () => {
  const stdout = [
    " M src/a.ts",
    "M  src/b.ts",
    "MM src/c.ts",
    "?? src/d.test.ts",
    "?? src/__snapshots__/d.test.ts.snap",
    "R  old.ts -> new.ts",
    "",
  ].join("\n");

  assert.deepEqual(parsePorcelainPaths(stdout), [
    "src/a.ts",
    "src/b.ts",
    "src/c.ts",
    "src/d.test.ts",
    "src/__snapshots__/d.test.ts.snap",
    "new.ts",
  ]);
});

test("pathsNewlyDirty returns only files that were clean at baseline", () => {
  const baseline = ["src/a.ts", "src/preexisting.ts"];
  const current = [
    "src/a.ts",
    "src/preexisting.ts",
    "src/b.tsx",
    "src/b.module.css",
    "src/b.test.ts",
  ];

  assert.deepEqual(pathsNewlyDirty(baseline, current), [
    "src/b.tsx",
    "src/b.module.css",
    "src/b.test.ts",
  ]);
});

test("pathsNewlyDirty normalizes ./ and duplicate slashes", () => {
  assert.deepEqual(
    pathsNewlyDirty(["./src/a.ts"], ["src/a.ts", "/src/b.ts", "src/b.ts"]),
    ["src/b.ts"]
  );
});

test("relatedDirtyCompanions picks same-folder and test/snapshot files", () => {
  const edited = [
    "src/shared/ui/work-status/work-status.tsx",
    "src/shared/ui/work-status/work-status.module.css",
  ];
  const dirty = [
    ...edited,
    "src/shared/ui/work-status/work-status.test.ts",
    "src/shared/ui/work-status/__snapshots__/work-status.test.ts.snap",
    "src/unrelated/foo.ts",
    "README.md",
  ];

  assert.deepEqual(relatedDirtyCompanions(edited, dirty).sort(), [
    "src/shared/ui/work-status/__snapshots__/work-status.test.ts.snap",
    "src/shared/ui/work-status/work-status.test.ts",
  ]);
});

test("relatedDirtyCompanions still finds test after source files were committed", () => {
  // Seeds = original review paths (already clean); dirty = leftover test only.
  const seeds = [
    "src/shared/ui/work-status/work-status.tsx",
    "src/shared/ui/work-status/work-status.module.css",
  ];
  const dirty = ["src/shared/ui/work-status/work-status.test.ts"];
  assert.deepEqual(relatedDirtyCompanions(seeds, dirty), [
    "src/shared/ui/work-status/work-status.test.ts",
  ]);
});

test("mergeNewlyDirtyEdits adds shell-touched files that were clean at baseline", async () => {
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  const { execFile } = require("node:child_process");
  const { promisify } = require("node:util");
  const execFileAsync = promisify(execFile);
  const { mergeNewlyDirtyEdits } = require("../out/turnFileChanges.js");

  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "harbor-dirty-"));
  const run = (args) =>
    execFileAsync("git", args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });

  try {
    await run(["init", "--template="]);
    await run(["config", "user.email", "t@t"]);
    await run(["config", "user.name", "t"]);
    await fs.writeFile(path.join(cwd, "tracked.ts"), "a\n");
    await run(["add", "tracked.ts"]);
    await run(["commit", "-m", "init"]);

    const baselineDirty = [];
    // write_file path already in map
    const editsByPath = new Map([
      [
        "tracked.ts",
        { path: "tracked.ts", created: false, added: 1, removed: 0 },
      ],
    ]);
    await fs.writeFile(path.join(cwd, "tracked.ts"), "a\nb\n");
    // shell-created / shell-edited companion (not via write_file)
    await fs.writeFile(path.join(cwd, "shell-only.ts"), "new\n");
    await fs.mkdir(path.join(cwd, "src"), { recursive: true });
    await fs.writeFile(path.join(cwd, "src", "also.ts"), "x\n");

    const merged = await mergeNewlyDirtyEdits(editsByPath, baselineDirty, cwd);
    const paths = merged.map((e) => e.path).sort();
    assert.deepEqual(paths, ["shell-only.ts", "src/also.ts", "tracked.ts"]);
    const shell = merged.find((e) => e.path === "shell-only.ts");
    assert.equal(shell.created, true);
    assert.ok(shell.added >= 1);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("mergeNewlyDirtyEdits ignores files that were already dirty before the turn", async () => {
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  const { execFile } = require("node:child_process");
  const { promisify } = require("node:util");
  const execFileAsync = promisify(execFile);
  const { mergeNewlyDirtyEdits, listDirtyPaths } = require("../out/turnFileChanges.js");

  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "harbor-dirty-base-"));
  const run = (args) =>
    execFileAsync("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });

  try {
    await run(["init", "--template="]);
    await run(["config", "user.email", "t@t"]);
    await run(["config", "user.name", "t"]);
    await fs.writeFile(path.join(cwd, "a.ts"), "1\n");
    await fs.writeFile(path.join(cwd, "pre.ts"), "p\n");
    await run(["add", "."]);
    await run(["commit", "-m", "init"]);

    await fs.writeFile(path.join(cwd, "pre.ts"), "p\nchanged\n");
    const baselineDirty = await listDirtyPaths(cwd);
    assert.ok(baselineDirty.includes("pre.ts"));

    const editsByPath = new Map([
      ["a.ts", { path: "a.ts", created: false, added: 1, removed: 0 }],
    ]);
    await fs.writeFile(path.join(cwd, "a.ts"), "1\n2\n");
    await fs.writeFile(path.join(cwd, "fresh.ts"), "n\n");

    const merged = await mergeNewlyDirtyEdits(editsByPath, baselineDirty, cwd);
    const paths = merged.map((e) => e.path).sort();
    assert.deepEqual(paths, ["a.ts", "fresh.ts"]);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
