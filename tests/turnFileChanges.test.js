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
