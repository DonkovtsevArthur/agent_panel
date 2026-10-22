const test = require("node:test");
const assert = require("node:assert/strict");

const {
  computeContextBreakdown,
  estimateTokens,
  estimateToolTokens,
  messageMemoryFiles,
  systemPromptMemoryFiles,
  IMAGE_TOKENS_ESTIMATE,
  RULES_FALLBACK_NAME,
} = require("../out/contextBreakdown.js");
const {
  createHarborContextBreakdownExtension,
  withContextBreakdownSink,
  withHarborContextBreakdownExtension,
  HARBOR_CONTEXT_BREAKDOWN_EXTENSION_NAME,
} = require("../out/contextBreakdownExtension.js");

function category(breakdown, id) {
  return breakdown.categories.find((c) => c.id === id).tokens;
}

test("estimateTokens: ~4 chars per ASCII token, ~2 per non-ASCII char", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd".repeat(10)), 10);
  assert.equal(estimateTokens("абвг".repeat(10)), 20);
});

test("systemPromptMemoryFiles: splits # Rules only at known rule names", () => {
  const prompt = [
    "You are Cline.",
    "",
    "# Rules",
    "## Workspace AGENTS.md",
    "# Project",
    "## Orientation",
    "a".repeat(400),
    "## Commands",
    "a".repeat(400),
    "",
    "## style",
    "b".repeat(200),
  ].join("\n");
  const files = systemPromptMemoryFiles(prompt, [
    { name: "Workspace AGENTS.md", label: "AGENTS.md" },
    { name: "style", label: ".clinerules/style.md" },
    { name: "not-loaded", label: "x.md" },
  ]);
  assert.deepEqual([...files.keys()], ["AGENTS.md", ".clinerules/style.md"]);
  assert.ok(files.get("AGENTS.md") > 200, "inner ## headings stay in AGENTS.md");
  assert.ok(files.get(".clinerules/style.md") >= 50);
});

test("systemPromptMemoryFiles: unknown rule names → one entry, not per heading", () => {
  const prompt = ["base", "", "# Rules", "## A", "x", "## B", "y", "## C", "z"].join("\n");
  const files = systemPromptMemoryFiles(prompt);
  assert.deepEqual([...files.keys()], [RULES_FALLBACK_NAME]);
});

test("systemPromptMemoryFiles: Harbor capped AGENTS.md copy counts as AGENTS.md", () => {
  const prompt = [
    "base",
    "## Workspace AGENTS.md",
    "x".repeat(800),
    "",
    "[Harbor: AGENTS.md is 20000 chars; only the first 800 chars are in the prompt. Read the rest.]",
    "# Mode: Agent",
  ].join("\n");
  const files = systemPromptMemoryFiles(prompt);
  assert.ok(files.get("AGENTS.md") >= 200);
});

test("messageMemoryFiles: project memory and matching workspace rules", () => {
  const text = [
    "[Harbor turn context]",
    "",
    "Project memory (.harbor/memory.md — facts learned in earlier chats):",
    "- build with npm run compile",
    "",
    "Matching workspace rules for the current file(s) (glob / alwaysApply; AGENTS.md is already in session rules):",
    "# Workspace rule: .cursor/rules/a.mdc",
    "",
    "rule a body",
    "",
    "# Workspace rule: .cursor/rules/b.mdc",
    "",
    "rule b body",
    "",
    "Recently viewed / open files:",
    "- src/x.ts",
  ].join("\n");
  const files = messageMemoryFiles(text);
  assert.deepEqual(
    [...files.keys()].sort(),
    [".cursor/rules/a.mdc", ".cursor/rules/b.mdc", ".harbor/memory.md"]
  );
});

test("computeContextBreakdown: categories, MCP split, autocompact buffer", () => {
  const skillsText = "# Skills\n" + "s".repeat(400);
  const mcpInstructions = "MCP servers: figma. " + "m".repeat(200);
  const systemPrompt = [
    "c".repeat(4000),
    skillsText,
    mcpInstructions,
    "",
    "# Rules",
    "## AGENTS.md",
    "r".repeat(800),
  ].join("\n");
  const tools = [
    { name: "read_files", description: "Read files", inputSchema: { type: "object" } },
    { name: "mcp__figma__get_screenshot", description: "Shot", inputSchema: { type: "object" } },
  ];
  const messages = [
    { role: "user", content: [{ type: "text", text: "u".repeat(2000) }] },
    { role: "user", content: [{ type: "image", image: "data:image/png;base64,AAAA" }] },
  ];
  const deferredMcpTools = [
    { name: "mcp__figma__get_code_connect_map", description: "x".repeat(100), inputSchema: {} },
  ];
  const b = computeContextBreakdown({
    systemPrompt,
    tools,
    messages,
    skillsText,
    mcpInstructions,
    deferredMcpTools,
    contextWindow: 100_000,
    compactTriggerTokens: 90_000,
    rules: [{ name: "AGENTS.md" }],
  });
  assert.equal(b.calibrated, false);
  assert.equal(b.compactTriggerTokens, 90_000);
  assert.equal(category(b, "skills"), estimateTokens(skillsText));
  assert.equal(category(b, "mcpInstructions"), estimateTokens(mcpInstructions));
  assert.equal(category(b, "mcpTools"), estimateToolTokens(tools[1]));
  assert.equal(category(b, "systemTools"), estimateToolTokens(tools[0]));
  assert.ok(category(b, "memoryFiles") >= 200);
  assert.ok(category(b, "systemPrompt") >= 990);
  assert.ok(category(b, "messages") >= 500 + IMAGE_TOKENS_ESTIMATE);
  assert.equal(category(b, "autocompactBuffer"), 10_000);
  const total = b.categories.reduce((sum, c) => sum + c.tokens, 0);
  assert.equal(total, 100_000, "categories fill the window exactly");
  assert.equal(b.used, total - 10_000 - category(b, "freeSpace"));
  assert.equal(b.deferred.mcpTools, estimateToolTokens(deferredMcpTools[0]));
  assert.deepEqual(
    b.mcpTools.map((t) => [t.name, Boolean(t.deferred)]),
    [
      ["mcp__figma__get_screenshot", false],
      ["mcp__figma__get_code_connect_map", true],
    ]
  );
  assert.deepEqual(b.memoryFiles.map((f) => f.name), ["AGENTS.md"]);
});

test("computeContextBreakdown: scales to API usage so used matches the ring", () => {
  const b = computeContextBreakdown({
    systemPrompt: "p".repeat(4000),
    tools: [{ name: "bash", description: "d".repeat(400), inputSchema: {} }],
    messages: [{ role: "user", content: "m".repeat(4000) }],
    contextWindow: 200_000,
    usage: { promptTokens: 6000, completionTokens: 500 },
  });
  assert.equal(b.calibrated, true);
  // Rounding per category may drift by a few tokens.
  assert.ok(Math.abs(b.used - 6500) <= 3, `used ${b.used}`);
  assert.equal(category(b, "autocompactBuffer"), 0, "auto compact off");
  assert.equal(b.compactTriggerTokens, 0);
  assert.equal(category(b, "freeSpace"), 200_000 - b.used);
});

test("computeContextBreakdown: buffer never overlaps used tokens", () => {
  const b = computeContextBreakdown({
    systemPrompt: "",
    tools: [],
    messages: [],
    contextWindow: 10_000,
    compactTriggerTokens: 9_000,
    usage: { promptTokens: 0, completionTokens: 9_500 },
  });
  assert.equal(b.used, 9_500);
  assert.equal(category(b, "autocompactBuffer"), 500);
  assert.equal(category(b, "freeSpace"), 0);
});

test("context breakdown extension: captures root requests only, read-only", async () => {
  const ext = createHarborContextBreakdownExtension();
  assert.equal(ext.name, HARBOR_CONTEXT_BREAKDOWN_EXTENSION_NAME);
  const seen = [];
  const request = {
    systemPrompt: "sys",
    tools: [{ name: "t", description: "d", inputSchema: {}, execute: () => 1 }],
    messages: [{ role: "user", content: "hi" }],
  };
  await withContextBreakdownSink(
    (r) => seen.push(r),
    async () => {
      assert.equal(ext.hooks.beforeModel({ snapshot: {}, request }), undefined);
      ext.hooks.beforeModel({ snapshot: { parentAgentId: "root" }, request });
    }
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].systemPrompt, "sys");
  assert.deepEqual(Object.keys(seen[0].tools[0]).sort(), ["description", "inputSchema", "name"]);
  // Outside a turn nothing is captured.
  ext.hooks.beforeModel({ snapshot: {}, request });
  assert.equal(seen.length, 1);
});

test("withHarborContextBreakdownExtension is idempotent", () => {
  const once = withHarborContextBreakdownExtension([{ name: "other" }]);
  const twice = withHarborContextBreakdownExtension(once);
  assert.equal(
    twice.filter((e) => e.name === HARBOR_CONTEXT_BREAKDOWN_EXTENSION_NAME).length,
    1
  );
  assert.equal(twice.length, 2);
});
