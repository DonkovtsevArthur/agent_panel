const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_DIAGNOSTIC_FIX_ATTEMPTS,
  MAX_DIAGNOSTICS_CHECKS,
  MAX_PROJECT_COMMANDS_PER_TURN,
  applyGetDiagnosticsToVerification,
  applyWriteFileToVerification,
  buildVerificationNudge,
  createVerificationState,
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

test("metadata-only edits skip project-wide lint/typecheck", () => {
  const {
    isMetadataOnlyVerificationScope,
    isMetadataVerificationPath,
  } = require("../out/verificationLoop.js");
  assert.equal(isMetadataVerificationPath("package.json"), true);
  assert.equal(isMetadataOnlyVerificationScope(["package.json"]), true);
  assert.equal(
    decideVerificationStep(
      state({
        editedPaths: ["package.json"],
        diagnosticsCheckedAfterLastEdit: true,
        projectCommand: "npm run lint",
      })
    ).kind,
    "none"
  );
  assert.equal(
    decideVerificationStep(
      state({
        editedPaths: ["src/a.ts", "package.json"],
        diagnosticsCheckedAfterLastEdit: true,
        projectCommand: "npm run lint",
      })
    ).kind,
    "run_project_command"
  );
});

test("project command failure scope detects edited vs unrelated paths", () => {
  const {
    projectCommandFailureTouchesScope,
    pathsMentionedInCommandOutput,
  } = require("../out/verificationLoop.js");
  const lintOut = [
    "src/features/foo/__tests__/a.test.tsx",
    "  81:5  error  Unexpected require",
    "src/entities/bar/model.ts",
    "  12:1  warning  @ts-ignore",
  ].join("\n");
  assert.ok(
    pathsMentionedInCommandOutput(lintOut).includes(
      "src/features/foo/__tests__/a.test.tsx"
    )
  );
  assert.equal(
    projectCommandFailureTouchesScope(lintOut, ["package.json"]),
    false
  );
  assert.equal(
    projectCommandFailureTouchesScope(lintOut, [
      "src/features/foo/__tests__/a.test.tsx",
    ]),
    true
  );
  assert.equal(
    projectCommandFailureTouchesScope("Command failed with exit code 1", [
      "src/a.ts",
    ]),
    false
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

test("buildVerificationNudge covers each gate step", () => {
  assert.match(
    buildVerificationNudge({
      kind: "request_diagnostics",
      paths: ["src/a.ts"],
    }),
    /get_diagnostics/
  );
  assert.match(
    buildVerificationNudge({
      kind: "fix_diagnostics",
      errors: ["src/a.ts:1: broken"],
    }),
    /broken/
  );
  assert.match(
    buildVerificationNudge({
      kind: "run_project_command",
      command: "npm run lint",
    }),
    /npm run lint/
  );
  assert.equal(buildVerificationNudge({ kind: "none" }), undefined);
});

test("applyWriteFileToVerification tracks edits and attached diagnostics", () => {
  const s = createVerificationState({
    agentMode: true,
    projectCommand: "npm run lint",
  });
  applyWriteFileToVerification(s, {
    ok: true,
    path: "src/a.ts",
    diagnostics: [
      {
        path: "src/a.ts",
        severity: "error",
        message: "Cannot find name 'x'",
        startLine: 3,
      },
    ],
  });
  assert.deepEqual(s.editedPaths, ["src/a.ts"]);
  assert.equal(s.diagnosticsCheckedAfterLastEdit, true);
  assert.equal(s.diagnosticErrors.length, 1);
  assert.equal(decideVerificationStep(s).kind, "fix_diagnostics");
});

test("applyGetDiagnosticsToVerification clears the request gate", () => {
  const s = createVerificationState({ agentMode: true });
  applyWriteFileToVerification(s, { ok: true, path: "src/a.ts" });
  assert.equal(decideVerificationStep(s).kind, "request_diagnostics");
  applyGetDiagnosticsToVerification(s, { diagnostics: [] });
  assert.equal(decideVerificationStep(s).kind, "none");
});
