const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const modesSrc = fs.readFileSync(
  path.join(__dirname, "../src/modes.ts"),
  "utf8"
);

test("planModeSystemPrompt requires Component-API grounding (read the target UI component source)", () => {
  assert.match(modesSrc, /Component-API grounding/i);
  assert.match(
    modesSrc,
    /read that component's source|прочитай исходник этого компонента/i
  );
  assert.match(
    modesSrc,
    /exact props\/imports|точные пропсы\/импорты/i
  );
});

test("planModeSystemPrompt allows an optional Implementation section in <proposed_plan>", () => {
  assert.match(modesSrc, /\*\*Implementation\*\*/i);
  assert.match(
    modesSrc,
    /optional but recommended|опционально, но рекомендуется/i
  );
  assert.match(
    modesSrc,
    /props\/imports of the target shared components|пропсы\/импорты целевых shared-компонентов/i
  );
});
