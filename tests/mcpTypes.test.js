const test = require("node:test");
const assert = require("node:assert/strict");

const {
  sanitizeMcpServerId,
  qualifyMcpToolName,
  parseQualifiedToolName,
  isMcpReadonlyTool,
  formatTransportDetail,
} = require("../out/mcp/types.js");

test("MCP server ids are normalized for qualified tool names", () => {
  const id = sanitizeMcpServerId(" My_Server 01 ");
  assert.equal(id, "my-server-01");

  const qualified = qualifyMcpToolName(id, "list_items");
  assert.equal(qualified, "mcp__my-server-01__list_items");
  assert.deepEqual(parseQualifiedToolName(qualified), {
    serverId: "my-server-01",
    toolName: "list_items",
  });
});

test("readonly classifier keeps list/get style tools readonly", () => {
  assert.equal(isMcpReadonlyTool("mcp__demo__list_items"), true);
  assert.equal(isMcpReadonlyTool("mcp__demo__get_metadata"), true);
});

test("readonly classifier blocks write-ish verbs", () => {
  assert.equal(isMcpReadonlyTool("mcp__demo__create_ticket"), false);
  assert.equal(isMcpReadonlyTool("mcp__demo__update_page"), false);
  assert.equal(isMcpReadonlyTool("mcp__demo__delete_row"), false);
});

test("transport detail is formatted for http and stdio configs", () => {
  assert.equal(
    formatTransportDetail({
      id: "demo",
      name: "Demo",
      enabled: true,
      transport: "http",
      url: "https://example.com/mcp",
    }),
    "http · https://example.com/mcp"
  );
  assert.equal(
    formatTransportDetail({
      id: "demo",
      name: "Demo",
      enabled: true,
      transport: "stdio",
      command: "npx",
      args: ["-y", "demo-mcp"],
    }),
    "stdio · npx -y demo-mcp"
  );
});
