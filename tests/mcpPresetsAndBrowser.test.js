const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MCP_PRESETS,
  getMcpPreset,
  mcpPresetToModalPrefill,
} = require("../out/mcp/presets.js");

test("MCP_PRESETS includes Playwright stdio and GitHub http", () => {
  assert.equal(MCP_PRESETS.length, 2);
  const pw = getMcpPreset("playwright");
  assert.ok(pw);
  assert.equal(pw.transport, "stdio");
  assert.equal(pw.command, "npx");
  assert.ok(pw.args.includes("@playwright/mcp@latest"));
  assert.ok(pw.args.includes("--headless"));

  const gh = getMcpPreset("github");
  assert.ok(gh);
  assert.equal(gh.transport, "http");
  assert.match(gh.url, /api\.githubcopilot\.com/);
  assert.equal(gh.needsBearerToken, true);
});

test("mcpPresetToModalPrefill maps fields for the edit modal", () => {
  const pw = getMcpPreset("playwright");
  const prefill = mcpPresetToModalPrefill(pw);
  assert.equal(prefill.transport, "stdio");
  assert.equal(prefill.command, "npx");
  assert.match(prefill.argsText, /@playwright\/mcp@latest/);
  assert.equal(prefill.needsBearerToken, false);

  const gh = getMcpPreset("github");
  const ghPrefill = mcpPresetToModalPrefill(gh);
  assert.equal(ghPrefill.transport, "http");
  assert.ok(ghPrefill.url.startsWith("https://"));
  assert.equal(ghPrefill.needsBearerToken, true);
});
