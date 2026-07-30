const test = require("node:test");
const assert = require("node:assert/strict");

const {
  evaluateVerificationCommand,
} = require("../out/verificationCommandPolicy.js");

test("blocks tsc project mode mixed with source files", () => {
  const decision = evaluateVerificationCommand(
    "npx tsc --noEmit --project tsconfig.json src/a.ts src/b.ts"
  );
  assert.equal(decision.blocked, true);
  assert.equal(decision.reason, "tsc_project_with_files");
  assert.equal(decision.suggestion, "npx tsc --project tsconfig.json --noEmit");
});

test("blocks isolated tsc files that bypass project configuration", () => {
  const decision = evaluateVerificationCommand(
    "npx tsc --noEmit src/a.ts src/b.ts"
  );
  assert.equal(decision.blocked, true);
  assert.equal(decision.reason, "tsc_files_without_project");
});

test("blocks output pipes that hide verification exit codes", () => {
  for (const command of [
    "npx tsc --project tsconfig.json --noEmit 2>&1 | head -30",
    "npx vitest run src/a.test.ts 2>&1 | tail -20",
  ]) {
    const decision = evaluateVerificationCommand(command);
    assert.equal(decision.blocked, true, command);
    assert.equal(decision.reason, "hidden_pipeline_exit", command);
    assert.doesNotMatch(decision.suggestion, /\|\s*(?:head|tail)/);
  }
});

test("allows reliable project and targeted test commands", () => {
  assert.deepEqual(
    evaluateVerificationCommand("npx tsc --project tsconfig.json --noEmit"),
    { blocked: false }
  );
  assert.deepEqual(
    evaluateVerificationCommand(
      "npx vitest run src/shared/libs/get-work-status.test.ts"
    ),
    { blocked: false }
  );
  assert.deepEqual(evaluateVerificationCommand('rg -n "getWorkStatus" src/'), {
    blocked: false,
  });
});
