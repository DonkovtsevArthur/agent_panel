const test = require("node:test");
const assert = require("node:assert/strict");

const {
  filterToolsForContext,
  messageContainsUrl,
} = require("../out/toolFilter.js");

function tool(name) {
  return { type: "function", function: { name, parameters: {} } };
}

test("filterToolsForContext drops URL tools without a link", () => {
  const tools = [
    tool("read_file"),
    tool("fetch_url"),
    tool("open_external"),
    tool("search_text"),
  ];
  const filtered = filterToolsForContext(tools, { hasUrl: false });
  assert.deepEqual(
    filtered.map((t) => t.function.name),
    ["read_file", "search_text"]
  );
});

test("filterToolsForContext keeps everything when URL present", () => {
  const tools = [tool("read_file"), tool("fetch_url"), tool("open_external")];
  const filtered = filterToolsForContext(tools, { hasUrl: true });
  assert.equal(filtered.length, 3);
});

test("filterToolsForContext keeps MCP tools regardless", () => {
  const tools = [tool("mcp__figma__get_screenshot"), tool("fetch_url")];
  const filtered = filterToolsForContext(tools, { hasUrl: false });
  assert.deepEqual(
    filtered.map((t) => t.function.name),
    ["mcp__figma__get_screenshot"]
  );
});

test("messageContainsUrl detects http(s) links", () => {
  assert.equal(messageContainsUrl("смотри https://example.com/x"), true);
  assert.equal(messageContainsUrl("http://localhost:3000"), true);
  assert.equal(messageContainsUrl("без ссылки"), false);
  assert.equal(messageContainsUrl(""), false);
});
