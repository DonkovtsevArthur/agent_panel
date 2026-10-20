const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  capWorkspaceRuleText,
  clineRuleSearchPathsWithoutWorkspaceAgentsMd,
  combineWorkspaceRules,
  findLinkedCommitRulePaths,
  formatOversizedWorkspaceAgentsMdRule,
  loadOversizedWorkspaceAgentsMd,
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

test("loadOversizedWorkspaceAgentsMd leaves a small AGENTS.md to Cline", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agents-md-cap-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.equal(await loadOversizedWorkspaceAgentsMd(root, 100), undefined);
  await fs.writeFile(path.join(root, "AGENTS.md"), "short rules");
  assert.equal(await loadOversizedWorkspaceAgentsMd(root, 100), undefined);
});

test("loadOversizedWorkspaceAgentsMd truncates a large AGENTS.md on a line boundary", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agents-md-cap-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i} ${"x".repeat(20)}`);
  const text = lines.join("\n");
  await fs.writeFile(path.join(root, "AGENTS.md"), text);

  const result = await loadOversizedWorkspaceAgentsMd(root, 300);
  assert.ok(result);
  assert.equal(result.originalChars, text.length);
  assert.match(result.rule, /^## Workspace AGENTS\.md\n/);
  assert.match(result.rule, /line 0 /);
  assert.doesNotMatch(result.rule, /line 49 /);
  assert.match(result.rule, new RegExp(`AGENTS\\.md is ${text.length} chars`));
  const body = result.rule.split("\n").slice(1, -2).join("\n");
  assert.ok(body.length <= 300);
  assert.ok(lines.includes(body.split("\n").pop()), "cut on a whole line");
});

test("formatOversizedWorkspaceAgentsMdRule keeps a single long line under the cap", () => {
  const rule = formatOversizedWorkspaceAgentsMdRule("y".repeat(1000), 100);
  assert.match(rule, /\ny{100}\n/);
});

test("clineRuleSearchPathsWithoutWorkspaceAgentsMd drops only the workspace AGENTS.md", () => {
  const ws = path.join(path.sep, "ws");
  const home = path.join(path.sep, "home", "u");
  const saved = process.env.CLINE_DIR;
  delete process.env.CLINE_DIR;
  try {
    const paths = clineRuleSearchPathsWithoutWorkspaceAgentsMd(ws, home);
    assert.ok(!paths.includes(path.join(ws, "AGENTS.md")));
    assert.ok(paths.includes(path.join(ws, ".clinerules")));
    assert.ok(paths.includes(path.join(ws, ".cline", "rules")));
    assert.ok(paths.includes(path.join(home, ".agents", "AGENTS.md")));
    assert.ok(paths.includes(path.join(home, ".cline", "rules")));
    assert.ok(paths.includes(path.join(home, "Documents", "Cline", "Rules")));
  } finally {
    if (saved !== undefined) process.env.CLINE_DIR = saved;
  }
});

test("findLinkedCommitRulePaths finds commit rule docs linked from AGENTS.md", () => {
  const text = [
    "| [commits.md](./docs/agents/commits.md) | Commit messages |",
    "- Подробнее: [docs/agents/commits.md](./docs/agents/commits.md#git)",
    "- [api](./docs/agents/api.md), [site](https://example.com/commit.md)",
    "- [правила коммитов](<docs/коммиты.md>)",
  ].join("\n");
  assert.deepEqual(findLinkedCommitRulePaths(text), [
    "./docs/agents/commits.md",
    "docs/коммиты.md",
  ]);
});
