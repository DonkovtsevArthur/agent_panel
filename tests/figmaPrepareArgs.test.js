const test = require("node:test");
const assert = require("node:assert/strict");

const {
  prepareFigmaToolArgs,
  isLegacyFigmaDataTool,
  hasModernFigmaReadTools,
  shouldHideLegacyFigmaDataTool,
} = require("../out/mcp/figma.js");

test("prepareFigmaToolArgs forces enableBase64Response on get_screenshot", () => {
  const patched = prepareFigmaToolArgs("get_screenshot", {
    fileKey: "abcdefghijklmnopqrstuv",
    nodeId: "1:2",
  });
  assert.equal(patched.enableBase64Response, true);
  assert.equal(patched.fileKey, "abcdefghijklmnopqrstuv");
  assert.equal(patched.nodeId, "1:2");
});

test("prepareFigmaToolArgs overrides explicit false on get_screenshot", () => {
  const patched = prepareFigmaToolArgs("get_screenshot", {
    enableBase64Response: false,
    nodeId: "3:4",
  });
  assert.equal(patched.enableBase64Response, true);
});

test("prepareFigmaToolArgs leaves other Figma tools unchanged", () => {
  const args = { fileKey: "abcdefghijklmnopqrstuv", nodeId: "1:2" };
  const patched = prepareFigmaToolArgs("get_design_context", args);
  assert.equal(patched, args);
  assert.equal(patched.enableBase64Response, undefined);
});

test("isLegacyFigmaDataTool matches bare and qualified get_figma_data", () => {
  assert.equal(isLegacyFigmaDataTool("get_figma_data"), true);
  assert.equal(isLegacyFigmaDataTool("mcp__figma__get_figma_data"), true);
  assert.equal(isLegacyFigmaDataTool("get_design_context"), false);
  assert.equal(isLegacyFigmaDataTool("get_screenshot"), false);
});

test("PAT catalog keeps get_figma_data; modern catalog hides it", () => {
  const pat = ["mcp__figma__get_figma_data", "mcp__figma__download_figma_images"];
  assert.equal(hasModernFigmaReadTools(pat), false);
  assert.equal(
    shouldHideLegacyFigmaDataTool("mcp__figma__get_figma_data", pat),
    false
  );

  const remote = [
    "mcp__figma__get_design_context",
    "mcp__figma__get_screenshot",
    "mcp__figma__get_figma_data",
  ];
  assert.equal(hasModernFigmaReadTools(remote), true);
  assert.equal(
    shouldHideLegacyFigmaDataTool("mcp__figma__get_figma_data", remote),
    true
  );
  assert.equal(
    shouldHideLegacyFigmaDataTool("mcp__figma__get_design_context", remote),
    false
  );
});
