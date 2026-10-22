const test = require("node:test");
const assert = require("node:assert/strict");

const {
  compactMcpServerTools,
  resolveMcpDispatch,
} = require("../out/mcp/toolsOnDemand.js");
const {
  compactAtlassianToolDefs,
  resolveAtlassianDispatch,
} = require("../out/mcp/atlassianCompact.js");
const { JIRA_NATIVE_TOOLS, JIRA_NATIVE_WRITE_TOOLS } = require("../out/mcp/jiraNative.js");
const { estimateToolTokens } = require("../out/contextBreakdown.js");

function figmaTool(name, readonly = true) {
  return {
    type: "function",
    function: {
      name: `mcp__figma__${name}`,
      description: `Figma ${name}. Long description of what it returns.`,
      parameters: {
        type: "object",
        properties: { fileKey: { type: "string" }, nodeId: { type: "string" } },
        required: ["fileKey"],
      },
    },
    readonly,
  };
}

const FIGMA = [
  "get_design_context",
  "get_screenshot",
  "get_metadata",
  "get_variable_defs",
  "get_code_connect_map",
].map((n) => figmaTool(n));

const toolTokens = (tools) =>
  tools.reduce(
    (sum, t) =>
      sum +
      estimateToolTokens({
        name: t.function ? t.function.name : t.name,
        description: t.function ? t.function.description : t.description,
        inputSchema: t.function ? t.function.parameters : t.inputSchema,
      }),
    0
  );

test("lazy MCP: core tools move behind a names-only dispatcher", () => {
  const compact = compactMcpServerTools("figma", FIGMA);
  // Default on-demand mode: under 9 tools the server is sent as-is.
  assert.equal(compact.length, FIGMA.length);
  const lazy = compactMcpServerTools("figma", FIGMA, { lazy: true });
  assert.deepEqual(
    lazy.map((t) => t.function.name),
    ["mcp__figma__figma_read"]
  );
  const desc = lazy[0].function.description;
  assert.match(desc, /describe: true/);
  assert.match(desc, /Tools: get_design_context, get_screenshot/);
  assert.doesNotMatch(desc, /fileKey/, "no parameter catalog in lazy mode");
  assert.ok(toolTokens(lazy) < toolTokens(FIGMA));
});

test("lazy MCP: dispatcher routes core tools and describes schemas", () => {
  const call = resolveMcpDispatch(
    "figma",
    "figma_read",
    { tool: "get_design_context", arguments: { fileKey: "k" } },
    FIGMA,
    { lazy: true }
  );
  assert.deepEqual(call, {
    kind: "call",
    tool: "get_design_context",
    args: { fileKey: "k" },
  });
  const described = resolveMcpDispatch(
    "figma",
    "figma_read",
    { tool: "get_screenshot", describe: true },
    FIGMA,
    { lazy: true }
  );
  assert.equal(described.kind, "result");
  assert.equal(JSON.parse(described.text).inputSchema.required[0], "fileKey");
});

test("lazy MCP: a single-tool server stays as-is", () => {
  const one = [figmaTool("get_screenshot")];
  assert.deepEqual(compactMcpServerTools("figma", one, { lazy: true }), one);
});

test("lazy Atlassian: no direct jira tools, core reachable via jira_read", () => {
  const lazy = compactAtlassianToolDefs("jira", JIRA_NATIVE_TOOLS, JIRA_NATIVE_WRITE_TOOLS, {
    lazy: true,
  });
  assert.deepEqual(
    lazy.map((t) => t.name),
    ["jira_read", "jira_write"]
  );
  assert.match(lazy[0].description, /jira_search/);
  const compact = compactAtlassianToolDefs("jira", JIRA_NATIVE_TOOLS, JIRA_NATIVE_WRITE_TOOLS);
  assert.ok(toolTokens(lazy) < toolTokens(compact) / 2, "at least half of the compact cost saved");

  const call = resolveAtlassianDispatch(
    "jira",
    "jira_read",
    { tool: "jira_search", arguments: { jql: "project = X" } },
    JIRA_NATIVE_TOOLS,
    JIRA_NATIVE_WRITE_TOOLS,
    { lazy: true }
  );
  assert.equal(call.kind, "call");
  assert.equal(call.tool, "jira_search");
  // Without lazy the core tool stays direct and the dispatcher refuses it.
  const refused = resolveAtlassianDispatch(
    "jira",
    "jira_read",
    { tool: "jira_search" },
    JIRA_NATIVE_TOOLS,
    JIRA_NATIVE_WRITE_TOOLS
  );
  assert.equal(refused.kind, "result");
  // A read dispatcher never runs a write tool, lazy or not.
  const write = [...JIRA_NATIVE_WRITE_TOOLS][0];
  const blocked = resolveAtlassianDispatch(
    "jira",
    "jira_read",
    { tool: write },
    JIRA_NATIVE_TOOLS,
    JIRA_NATIVE_WRITE_TOOLS,
    { lazy: true }
  );
  assert.equal(blocked.kind, "result");
  assert.match(JSON.parse(blocked.text).error, /use jira_write/);
});
