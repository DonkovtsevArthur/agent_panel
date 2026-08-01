const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildVisionDescribeMessages,
  formatVisionHelperToolResult,
} = require("../out/figmaVisionFormat.js");

test("buildVisionDescribeMessages attaches image_url parts for the vision model", () => {
  const messages = buildVisionDescribeMessages(
    ["data:image/png;base64,abc"],
    "abstract tree"
  );
  assert.equal(messages[0].role, "system");
  assert.equal(messages[1].role, "user");
  const parts = messages[1].content;
  assert.ok(Array.isArray(parts));
  assert.ok(parts.some((p) => p.type === "text" && /Accompanying/.test(p.text)));
  assert.ok(
    parts.some(
      (p) =>
        p.type === "image_url" &&
        p.image_url.url === "data:image/png;base64,abc"
    )
  );
});

test("formatVisionHelperToolResult tells planner to trust screenshot labels", () => {
  const text = formatVisionHelperToolResult({
    visionModelId: "Gemini 2.5 Flash",
    description: "Columns: Name, Status, Owner",
    accompanyingText: "dev-mode stub",
  });
  assert.match(text, /Gemini 2\.5 Flash/);
  assert.match(text, /Name, Status, Owner/);
  assert.match(text, /dev-mode stub/);
  assert.match(text, /not fixed/i);
});
