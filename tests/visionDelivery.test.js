const test = require("node:test");
const assert = require("node:assert/strict");

const {
  shouldDeliverRawScreenshotToPlanner,
} = require("../out/visionDelivery.js");

test("manual preferred: Kimi planner never gets raw screenshots", () => {
  assert.equal(
    shouldDeliverRawScreenshotToPlanner("kimi-k2.5", false, [
      "claude-sonnet-4-5",
    ]),
    false
  );
  // even if someone flagged Kimi as vision
  assert.equal(
    shouldDeliverRawScreenshotToPlanner("kimi-k2.5", true, [
      "claude-sonnet-4-5",
    ]),
    false
  );
});

test("manual preferred: Claude planner in the list gets raw screenshots", () => {
  assert.equal(
    shouldDeliverRawScreenshotToPlanner("claude-sonnet-4-5", true, [
      "claude-sonnet-4-5",
    ]),
    true
  );
});

test("manual preferred: other vision planner not in list uses helper", () => {
  assert.equal(
    shouldDeliverRawScreenshotToPlanner("gpt-4.1", true, [
      "claude-sonnet-4-5",
    ]),
    false
  );
});

test("empty preferred (auto): vision planner gets raw; non-vision does not", () => {
  assert.equal(
    shouldDeliverRawScreenshotToPlanner("Gemini 2.5 Flash", true, []),
    true
  );
  assert.equal(
    shouldDeliverRawScreenshotToPlanner("DeepSeek-V4-Flash", false, []),
    false
  );
  assert.equal(
    shouldDeliverRawScreenshotToPlanner("kimi-k2.5", false, undefined),
    false
  );
});
