const test = require("node:test");
const assert = require("node:assert/strict");

const {
  filterDiagnostics,
  formatDiagnostics,
  normalizeDiagnostic,
} = require("../out/diagnosticsContext.js");

function rawDiagnostic(severity, message, line, character, source) {
  return {
    severity,
    message,
    source,
    range: { start: { line, character } },
  };
}

test("normalizeDiagnostic keeps structured errors and warnings only", () => {
  assert.deepEqual(
    normalizeDiagnostic(
      "src\\main.ts",
      rawDiagnostic(0, "  Broken\r\nvalue  ", 2, 4, "ts")
    ),
    {
      path: "src/main.ts",
      severity: "error",
      message: "Broken\nvalue",
      source: "ts",
      startLine: 3,
      startColumn: 5,
    }
  );
  assert.deepEqual(
    normalizeDiagnostic("src/main.ts", rawDiagnostic("warning", "Risk", 0, 0)),
    {
      path: "src/main.ts",
      severity: "warning",
      message: "Risk",
      startLine: 1,
      startColumn: 1,
    }
  );
  assert.equal(
    normalizeDiagnostic("src/main.ts", rawDiagnostic(2, "Information", 0, 0)),
    undefined
  );
  assert.equal(
    normalizeDiagnostic("src/main.ts", rawDiagnostic(3, "Hint", 0, 0)),
    undefined
  );
});

test("filterDiagnostics sorts deterministically and caps per file and total", () => {
  const diagnostics = [
    normalizeDiagnostic("b.ts", rawDiagnostic(1, "late warning", 5, 0)),
    normalizeDiagnostic("a.ts", rawDiagnostic(1, "warning", 0, 0)),
    normalizeDiagnostic("a.ts", rawDiagnostic(0, "second error", 2, 0)),
    normalizeDiagnostic("a.ts", rawDiagnostic(0, "first error", 1, 0)),
    normalizeDiagnostic("b.ts", rawDiagnostic(0, "error", 0, 0)),
  ];

  assert.deepEqual(
    filterDiagnostics(diagnostics, { perFile: 2, total: 3 }).map(
      ({ path, severity, message }) => ({ path, severity, message })
    ),
    [
      { path: "a.ts", severity: "error", message: "first error" },
      { path: "a.ts", severity: "error", message: "second error" },
      { path: "b.ts", severity: "error", message: "error" },
    ]
  );
  assert.deepEqual(diagnostics.map((item) => item.message), [
    "late warning",
    "warning",
    "second error",
    "first error",
    "error",
  ]);
});

test("formatDiagnostics produces compact stable context without runtime vscode", () => {
  const diagnostics = filterDiagnostics([
    normalizeDiagnostic(
      "src/main.ts",
      rawDiagnostic(0, "First line\nsecond line", 3, 6, "typescript")
    ),
  ]);

  assert.equal(
    formatDiagnostics(diagnostics),
    [
      "Workspace diagnostics (errors and warnings):",
      "- src/main.ts:4:7 [error] (typescript) First line second line",
    ].join("\n")
  );
  assert.equal(formatDiagnostics([]), "");
});
