const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  capWorkspaceRuleText,
  combineWorkspaceRules,
  loadWorkspaceRules,
  matchesWorkspaceRuleGlob,
  parseWorkspaceRule,
} = require("../out/workspaceRules.js");

test("parseWorkspaceRule reads alwaysApply and inline or list globs", () => {
  assert.deepEqual(
    parseWorkspaceRule(`---
alwaysApply: true
globs: ["src/**/*.ts", 'tests/*.{js,ts}']
---
Keep changes focused.
`),
    {
      body: "Keep changes focused.",
      alwaysApply: true,
      globs: ["src/**/*.ts", "tests/*.{js,ts}"],
    }
  );

  assert.deepEqual(
    parseWorkspaceRule(`---
globs:
  - src/**/*
  - "*.md"
---
Document behavior.
`).globs,
    ["src/**/*", "*.md"]
  );
});

test("matchesWorkspaceRuleGlob supports stars, globstars, braces, and separators", () => {
  assert.equal(matchesWorkspaceRuleGlob("src/a/file.ts", "src/**/*.ts"), true);
  assert.equal(matchesWorkspaceRuleGlob("src/file.ts", "src/**/*.ts"), true);
  assert.equal(matchesWorkspaceRuleGlob("tests/unit.js", "tests/*.{js,ts}"), true);
  assert.equal(matchesWorkspaceRuleGlob("tests/a/unit.js", "tests/*.{js,ts}"), false);
  assert.equal(matchesWorkspaceRuleGlob("src\\a\\file.ts", "src/**/*.ts"), true);
});

test("combineWorkspaceRules is deterministic, applicable, and globally capped", () => {
  const rules = [
    {
      relativePath: ".cursor/rules/z.mdc",
      body: "Z rule",
      alwaysApply: true,
      globs: [],
    },
    {
      relativePath: ".cursor/rules/typescript.mdc",
      body: "TS rule",
      globs: ["src/**/*.ts"],
    },
    {
      relativePath: "AGENTS.md",
      body: "Agent rule",
      globs: [],
    },
    {
      relativePath: ".cursor/rules/disabled.mdc",
      body: "Disabled",
      alwaysApply: false,
      globs: [],
    },
  ];

  const combined = combineWorkspaceRules(rules, ["src/index.ts"], 10_000);
  assert.ok(combined);
  assert.ok(combined.indexOf("AGENTS.md") < combined.indexOf("typescript.mdc"));
  assert.ok(combined.indexOf("typescript.mdc") < combined.indexOf("z.mdc"));
  assert.match(combined, /TS rule/);
  assert.doesNotMatch(combined, /Disabled/);
  assert.equal(combineWorkspaceRules(rules, ["README.md"], 24).length, 24);
  assert.equal(capWorkspaceRuleText("abcdef", 3), "abc");
});

test("loadWorkspaceRules loads AGENTS.md and sorted direct mdc rules", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "workspace-rules-test-")
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".cursor", "rules"), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(root, "AGENTS.md"), "Agent instructions"),
    fs.writeFile(
      path.join(root, ".cursor", "rules", "b.mdc"),
      "---\nalwaysApply: true\n---\nB instructions"
    ),
    fs.writeFile(
      path.join(root, ".cursor", "rules", "a.mdc"),
      "---\nglobs: src/**/*.ts\n---\nA instructions"
    ),
    fs.writeFile(
      path.join(root, ".cursor", "rules", "ignored.md"),
      "Not an mdc rule"
    ),
  ]);

  const loaded = await loadWorkspaceRules(root, {
    targetPaths: ["src/main.ts"],
    charCap: 10_000,
  });
  assert.ok(loaded);
  assert.ok(loaded.indexOf("AGENTS.md") < loaded.indexOf("a.mdc"));
  assert.ok(loaded.indexOf("a.mdc") < loaded.indexOf("b.mdc"));
  assert.doesNotMatch(loaded, /ignored\.md/);

  const withoutAgents = await loadWorkspaceRules(root, {
    targetPaths: ["src/main.ts"],
    omitAgentsMd: true,
  });
  assert.ok(withoutAgents);
  assert.doesNotMatch(withoutAgents, /Agent instructions/);
  assert.match(withoutAgents, /A instructions/);
});
