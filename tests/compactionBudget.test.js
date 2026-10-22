const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CLINE_COMPACTION_TRIGGER_RATIO,
  harborCompactionInputBudget,
} = require("../out/compactionBudget.js");

/** Request size at which Cline compacts for a given budget. */
function trigger(budget) {
  return Math.floor(budget * CLINE_COMPACTION_TRIGGER_RATIO);
}

test("compaction budget: defaults to 75% of the model window", () => {
  const budget = harborCompactionInputBudget(256_000, { enabled: true, thresholdTokens: 0 });
  assert.equal(trigger(budget), 192_000);
  assert.ok(budget <= 256_000);
});

test("compaction budget: thresholdTokens caps the trigger below 75%", () => {
  const budget = harborCompactionInputBudget(1_000_000, {
    enabled: true,
    thresholdTokens: 120_000,
  });
  assert.equal(trigger(budget), 120_000);
});

test("compaction budget: thresholdTokens above 75% does not raise the trigger", () => {
  const budget = harborCompactionInputBudget(200_000, {
    enabled: true,
    thresholdTokens: 190_000,
  });
  assert.equal(trigger(budget), 150_000);
});

test("compaction budget: auto compact off keeps the model window", () => {
  assert.equal(
    harborCompactionInputBudget(256_000, { enabled: false, thresholdTokens: 120_000 }),
    256_000
  );
});
