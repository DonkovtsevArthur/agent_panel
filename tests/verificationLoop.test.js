const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_DIAGNOSTIC_FIX_ATTEMPTS,
  MAX_DIAGNOSTICS_CHECKS,
  MAX_PROJECT_COMMANDS_PER_TURN,
  decideVerificationStep,
  isProjectVerificationCommand,
  isTargetedTestCommand,
  selectProjectVerificationCommand,
} = require("../out/verificationLoop.js");

function state(overrides = {}) {
  return {
    agentMode: true,
    editedPaths: ["src/a.ts"],
    diagnosticsCheckedAfterLastEdit: false,
    diagnosticsChecks: 0,
    diagnosticErrors: [],
    diagnosticFixAttempts: 0,
    importWarnings: [],
    importFixAttempts: 0,
    noOpWrites: [],
    noOpWriteAttempts: 0,
    projectCommand: "npm run typecheck",
    projectCommandAttempts: 0,
    ...overrides,
  };
}

test("requires diagnostics after a successful edit", () => {
  assert.deepEqual(decideVerificationStep(state()), {
    kind: "request_diagnostics",
    paths: ["src/a.ts"],
  });
});

test("keeps diagnostic, import, and no-op gates bounded and ordered", () => {
  assert.equal(
    decideVerificationStep(
      state({
        diagnosticsCheckedAfterLastEdit: true,
        diagnosticErrors: ["src/a.ts:1 broken"],
        importWarnings: ["src/a.ts: missing import"],
        noOpWrites: ["src/a.ts"],
      })
    ).kind,
    "fix_diagnostics"
  );

  assert.equal(
    decideVerificationStep(
      state({
        diagnosticsCheckedAfterLastEdit: true,
        diagnosticErrors: ["src/a.ts:1 broken"],
        diagnosticFixAttempts: MAX_DIAGNOSTIC_FIX_ATTEMPTS,
        importWarnings: ["src/a.ts: missing import"],
      })
    ).kind,
    "fix_imports"
  );

  assert.equal(
    decideVerificationStep(
      state({
        diagnosticsChecks: MAX_DIAGNOSTICS_CHECKS,
        projectCommand: undefined,
      })
    ).kind,
    "none"
  );
});

test("runs at most one project command after clean diagnostics", () => {
  assert.deepEqual(
    decideVerificationStep(
      state({ diagnosticsCheckedAfterLastEdit: true })
    ),
    { kind: "run_project_command", command: "npm run typecheck" }
  );
  assert.equal(
    decideVerificationStep(
      state({
        diagnosticsCheckedAfterLastEdit: true,
        projectCommandAttempts: MAX_PROJECT_COMMANDS_PER_TURN,
      })
    ).kind,
    "none"
  );
});

test("verification is disabled outside Agent mode and without edits", () => {
  assert.equal(
    decideVerificationStep(state({ agentMode: false })).kind,
    "none"
  );
  assert.equal(
    decideVerificationStep(state({ editedPaths: [] })).kind,
    "none"
  );
});

test("preserves no-op write handling even without successful edits", () => {
  assert.deepEqual(
    decideVerificationStep(
      state({
        editedPaths: [],
        noOpWrites: ["src/already-correct.ts"],
      })
    ),
    {
      kind: "handle_no_op_writes",
      paths: ["src/already-correct.ts"],
    }
  );
});

test("selects deterministic safe scripts and never auto-runs tests", () => {
  assert.deepEqual(
    selectProjectVerificationCommand({
      build: "tsc -p .",
      lint: "eslint .",
      typecheck: "tsc --noEmit",
      test: "node --test",
    }),
    { scriptName: "typecheck", command: "npm run typecheck" }
  );
  assert.deepEqual(
    selectProjectVerificationCommand({
      lint: "eslint .",
      build: "tsc -p .",
    }),
    { scriptName: "lint", command: "npm run lint" }
  );
  assert.equal(
    selectProjectVerificationCommand({ test: "node --test" }),
    undefined
  );
});

test("skips watch scripts and commands with hidden pipeline exits", () => {
  assert.deepEqual(
    selectProjectVerificationCommand({
      typecheck: "tsc --watch",
      lint: "eslint . | head -20",
      build: "tsc -p .",
    }),
    { scriptName: "build", command: "npm run build" }
  );
});

test("recognizes only reliable project verification commands", () => {
  assert.equal(isProjectVerificationCommand("npm run typecheck"), true);
  assert.equal(
    isProjectVerificationCommand("npx tsc --project tsconfig.json --noEmit"),
    true
  );
  assert.equal(isProjectVerificationCommand("npm test"), true);
  assert.equal(
    isProjectVerificationCommand("npm run lint 2>&1 | head -20"),
    false
  );
});

test("recognizes a single test file separately from project-wide gates", () => {
  assert.equal(
    isTargetedTestCommand(
      "npx vitest run src/shared/libs/__tests__/get-work-status.test.ts"
    ),
    true
  );
  assert.equal(
    isTargetedTestCommand("npx jest src/shared/libs/get-work-status.spec.ts"),
    true
  );
  assert.equal(isTargetedTestCommand("npm test"), false);
  assert.equal(isTargetedTestCommand("npx vitest run"), false);
  assert.equal(
    isTargetedTestCommand(
      "npx vitest run src/shared/libs/get-work-status.test.ts | tail -20"
    ),
    false
  );
});
