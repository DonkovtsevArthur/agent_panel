const test = require("node:test");
const assert = require("node:assert/strict");

const { previewText, toolStepId } = require("../out/agentSteps.js");

test("previewText truncates", () => {
  assert.equal(previewText("short"), "short");
  assert.ok(previewText("x".repeat(200), 20).endsWith("…"));
});

test("toolStepId is stable", () => {
  assert.equal(toolStepId("abc"), "tool:abc");
});
