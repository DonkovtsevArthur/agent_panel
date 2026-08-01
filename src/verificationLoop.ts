import { evaluateVerificationCommand } from "./verificationCommandPolicy";

export const MAX_DIAGNOSTICS_CHECKS = 2;
export const MAX_DIAGNOSTIC_FIX_ATTEMPTS = 2;
export const MAX_IMPORT_FIX_ATTEMPTS = 2;
export const MAX_NO_OP_WRITE_ATTEMPTS = 2;
export const MAX_PROJECT_COMMANDS_PER_TURN = 1;
export const MAX_TARGETED_TEST_COMMANDS_PER_TURN = 1;

export type VerificationStep =
  | { kind: "request_diagnostics"; paths: string[] }
  | { kind: "fix_diagnostics"; errors: string[] }
  | { kind: "fix_imports"; warnings: string[] }
  | { kind: "handle_no_op_writes"; paths: string[] }
  | { kind: "run_project_command"; command: string }
  | { kind: "none" };

export interface VerificationLoopState {
  agentMode: boolean;
  editedPaths: string[];
  diagnosticsCheckedAfterLastEdit: boolean;
  diagnosticsChecks: number;
  diagnosticErrors: string[];
  diagnosticFixAttempts: number;
  importWarnings: string[];
  importFixAttempts: number;
  noOpWrites: string[];
  noOpWriteAttempts: number;
  projectCommand?: string;
  projectCommandAttempts: number;
}

export type VerificationDiagnosticLike = {
  path?: string;
  severity?: string;
  message?: string;
  startLine?: number;
};

export function normalizeVerificationPath(filePath: string): string {
  return String(filePath || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

/**
 * Metadata / packaging files: diagnostics-only gate, no project-wide lint/typecheck.
 * Avoids “npm run lint failed → fix the whole repo” after a version bump.
 */
export function isMetadataVerificationPath(filePath: string): boolean {
  const rel = normalizeVerificationPath(filePath);
  if (!rel) {
    return false;
  }
  const base = rel.includes("/")
    ? rel.slice(rel.lastIndexOf("/") + 1)
    : rel;
  const lower = base.toLowerCase();
  if (lower === "package.json") {
    return true;
  }
  if (/^package\.nls(\.[a-z0-9-]+)?\.json$/i.test(lower)) {
    return true;
  }
  if (/^changelog(\.md)?$/i.test(lower)) {
    return true;
  }
  if (/^readme(\.md)?$/i.test(lower)) {
    return true;
  }
  if (/^license(\.txt|\.md)?$/i.test(lower)) {
    return true;
  }
  return false;
}

export function isMetadataOnlyVerificationScope(paths: string[]): boolean {
  const list = (paths || [])
    .map(normalizeVerificationPath)
    .filter(Boolean);
  return list.length > 0 && list.every(isMetadataVerificationPath);
}

/** Paths that look like source files in command / diagnostic output. */
export function pathsMentionedInCommandOutput(output: string): string[] {
  const text = String(output || "");
  if (!text.trim()) {
    return [];
  }
  const found = new Set<string>();
  const re =
    /(?:^|[\s"'`(])((?:[\w.@+-]+\/)*[\w.@+-]+\.(?:[cm]?[jt]sx?|json|mdc?|css|scss|vue|mjs|cjs))(?::\d+)?/gim;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const rel = normalizeVerificationPath(match[1]);
    if (rel) {
      found.add(rel);
    }
  }
  return [...found];
}

function pathTouchesScope(candidate: string, scope: string[]): boolean {
  const c = normalizeVerificationPath(candidate);
  if (!c) {
    return false;
  }
  for (const raw of scope) {
    const s = normalizeVerificationPath(raw);
    if (!s) {
      continue;
    }
    if (c === s || c.endsWith(`/${s}`) || s.endsWith(`/${c}`)) {
      return true;
    }
  }
  return false;
}

/**
 * True when project-command failure mentions at least one path from this turn's edits.
 * No parsable paths → treat as out-of-scope (do not demand a whole-repo cleanup).
 */
export function projectCommandFailureTouchesScope(
  output: string,
  editedPaths: string[]
): boolean {
  const scope = (editedPaths || [])
    .map(normalizeVerificationPath)
    .filter(Boolean);
  if (!scope.length) {
    return false;
  }
  const mentioned = pathsMentionedInCommandOutput(output);
  if (!mentioned.length) {
    return false;
  }
  return mentioned.some((path) => pathTouchesScope(path, scope));
}

/**
 * Извлекает спецификаторы «missing module / file» из вывода проектной команды
 * (typecheck / lint / build). TS: "Cannot find module '...'"; Vite/rollup:
 * "Could not resolve './...'"; ESLint: "Unable to resolve path to module '...'";
 * TS2304 "Cannot find name '...'" для bare-импортов.
 *
 * Когда typecheck падает на отредактированном файле только из-за того, что он
 * импортирует ещё не созданный файл — правильное действие создать недостающий
 * файл, а не переписывать уже корректный. См. agentLoopMainLike.ts.
 */
export function missingModuleSpecifiersFromOutput(output: string): string[] {
  const text = String(output || "");
  if (!text.trim()) {
    return [];
  }
  const found = new Set<string>();
  const re =
    /(?:Cannot find module|Could not resolve|Unable to resolve path to module|is not a module|Cannot find name)\s+['"`]([^'"`]+)['"`]/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const spec = String(match[1] || "").trim();
    if (spec) {
      found.add(spec);
    }
  }
  return [...found];
}

export function createVerificationState(options: {
  agentMode: boolean;
  projectCommand?: string;
}): VerificationLoopState {
  return {
    agentMode: options.agentMode,
    editedPaths: [],
    diagnosticsCheckedAfterLastEdit: false,
    diagnosticsChecks: 0,
    diagnosticErrors: [],
    diagnosticFixAttempts: 0,
    importWarnings: [],
    importFixAttempts: 0,
    noOpWrites: [],
    noOpWriteAttempts: 0,
    projectCommand: options.projectCommand,
    projectCommandAttempts: 0,
  };
}

export function diagnosticErrorsFromPayload(
  diagnostics: VerificationDiagnosticLike[] | undefined
): string[] {
  return (diagnostics || [])
    .filter((item) => String(item.severity || "").toLowerCase() === "error")
    .map((item) => {
      const path = String(item.path || "?").trim() || "?";
      const line = Number(item.startLine) > 0 ? Number(item.startLine) : "?";
      const message = String(item.message || "")
        .replace(/\s+/g, " ")
        .trim();
      return message ? `${path}:${line}: ${message}` : "";
    })
    .filter(Boolean)
    .slice(0, 12);
}

/** Keep only diagnostic lines that refer to this turn's edited files. */
export function filterDiagnosticErrorsToScope(
  errors: string[],
  editedPaths: string[]
): string[] {
  const scope = (editedPaths || [])
    .map(normalizeVerificationPath)
    .filter(Boolean);
  if (!scope.length) {
    return [];
  }
  return (errors || []).filter((line) => {
    const pathPart = String(line || "").split(":")[0] || "";
    return pathTouchesScope(pathPart, scope);
  });
}

/** Apply a successful/failed write_file (or unchanged) tool result to the gate. */
export function applyWriteFileToVerification(
  state: VerificationLoopState,
  parsed: {
    ok?: boolean;
    unchanged?: boolean;
    path?: string;
    diagnostics?: VerificationDiagnosticLike[];
    importWarnings?: string[];
  }
): void {
  if (!state.agentMode) {
    return;
  }
  const filePath = String(parsed.path || "").trim();
  if (!filePath) {
    return;
  }

  if (parsed.unchanged) {
    if (!state.noOpWrites.includes(filePath)) {
      state.noOpWrites.push(filePath);
    }
    return;
  }

  if (!parsed.ok) {
    return;
  }

  if (!state.editedPaths.includes(filePath)) {
    state.editedPaths.push(filePath);
  }
  state.noOpWrites = state.noOpWrites.filter((item) => item !== filePath);
  state.diagnosticsCheckedAfterLastEdit = false;
  state.diagnosticErrors = [];

  if (Array.isArray(parsed.diagnostics)) {
    state.diagnosticsCheckedAfterLastEdit = true;
    state.diagnosticsChecks += 1;
    state.diagnosticErrors = filterDiagnosticErrorsToScope(
      diagnosticErrorsFromPayload(parsed.diagnostics),
      state.editedPaths
    );
  }

  if (Array.isArray(parsed.importWarnings)) {
    const next = parsed.importWarnings
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    state.importWarnings = next.slice(0, 10);
  } else {
    state.importWarnings = [];
  }
}

export function applyGetDiagnosticsToVerification(
  state: VerificationLoopState,
  parsed: { diagnostics?: VerificationDiagnosticLike[] }
): void {
  if (!state.agentMode) {
    return;
  }
  state.diagnosticsCheckedAfterLastEdit = true;
  state.diagnosticsChecks += 1;
  state.diagnosticErrors = filterDiagnosticErrorsToScope(
    diagnosticErrorsFromPayload(parsed.diagnostics),
    state.editedPaths
  );
}

export function applyProjectCommandToVerification(
  state: VerificationLoopState,
  parsed: { ok?: boolean; stdout?: string; stderr?: string }
): { failed: boolean; output: string } {
  state.projectCommandAttempts += 1;
  const output = [parsed.stdout, parsed.stderr]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 4_000);
  return { failed: parsed.ok === false, output };
}

export function bumpVerificationFixAttempt(
  state: VerificationLoopState,
  step: VerificationStep
): void {
  if (step.kind === "fix_diagnostics") {
    state.diagnosticFixAttempts += 1;
  } else if (step.kind === "fix_imports") {
    state.importFixAttempts += 1;
  } else if (step.kind === "handle_no_op_writes") {
    state.noOpWriteAttempts += 1;
  }
}

/** User-visible nudge that keeps the model in the tool loop until the gate clears. */
export function buildVerificationNudge(
  step: VerificationStep
): string | undefined {
  switch (step.kind) {
    case "request_diagnostics":
      return [
        "Post-edit verification: call get_diagnostics now with",
        `paths ${JSON.stringify(step.paths)}.`,
        "Fix any errors with write_file before finishing.",
      ].join(" ");
    case "fix_diagnostics":
      return [
        "Post-edit verification: diagnostics still have errors:",
        ...step.errors.map((error) => `- ${error}`),
        "Call write_file to fix them now, then finish briefly.",
        "Do not claim done while errors remain.",
      ].join("\n");
    case "fix_imports":
      return [
        "Post-edit verification: unresolved imports:",
        ...step.warnings.map((warning) => `- ${warning}`),
        "Fix with write_file using real paths from tsconfig / sibling files.",
      ].join("\n");
    case "handle_no_op_writes":
      return [
        "Post-edit verification: write_file reported unchanged for:",
        step.paths.join(", ") + ".",
        "Either write different content that actually changes the file,",
        "or explain honestly that it was already correct — do not claim you fixed it.",
      ].join(" ");
    case "run_project_command":
      return [
        "Post-edit verification: diagnostics are clean.",
        `Run exactly this command via run_command now: ${step.command}`,
        "If it fails only on files you edited this turn, fix those with write_file.",
        "If failures are elsewhere (pre-existing), finish briefly — do not clean the whole repo.",
      ].join("\n");
    case "none":
      return undefined;
  }
}

/**
 * Pure post-edit quality-gate orchestrator. Counters are owned by the caller,
 * so every retry remains explicit and bounded.
 */
export function decideVerificationStep(
  state: VerificationLoopState
): VerificationStep {
  if (!state.agentMode) {
    return { kind: "none" };
  }

  if (
    state.editedPaths.length > 0 &&
    !state.diagnosticsCheckedAfterLastEdit &&
    state.diagnosticsChecks < MAX_DIAGNOSTICS_CHECKS
  ) {
    return { kind: "request_diagnostics", paths: [...state.editedPaths] };
  }

  if (
    state.diagnosticErrors.length > 0 &&
    state.diagnosticFixAttempts < MAX_DIAGNOSTIC_FIX_ATTEMPTS
  ) {
    return {
      kind: "fix_diagnostics",
      errors: state.diagnosticErrors.slice(0, 12),
    };
  }

  if (
    state.importWarnings.length > 0 &&
    state.importFixAttempts < MAX_IMPORT_FIX_ATTEMPTS
  ) {
    return {
      kind: "fix_imports",
      warnings: state.importWarnings.slice(0, 10),
    };
  }

  if (
    state.noOpWrites.length > 0 &&
    state.noOpWriteAttempts < MAX_NO_OP_WRITE_ATTEMPTS
  ) {
    return {
      kind: "handle_no_op_writes",
      paths: state.noOpWrites.slice(0, 8),
    };
  }

  // Metadata-only edits (e.g. package.json version): diagnostics only — no
  // project-wide lint/typecheck that would drag in unrelated debt.
  if (
    state.editedPaths.length > 0 &&
    state.diagnosticsCheckedAfterLastEdit &&
    state.diagnosticErrors.length === 0 &&
    state.projectCommand &&
    state.projectCommandAttempts < MAX_PROJECT_COMMANDS_PER_TURN &&
    !isMetadataOnlyVerificationScope(state.editedPaths)
  ) {
    return { kind: "run_project_command", command: state.projectCommand };
  }

  return { kind: "none" };
}

export interface ProjectVerificationCommand {
  scriptName: "typecheck" | "lint" | "build";
  command: string;
}

export function isProjectVerificationCommand(command: string): boolean {
  const value = String(command || "").trim();
  if (evaluateVerificationCommand(value).blocked) {
    return false;
  }
  return /(?:^|[;&|]\s*)(?:(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:typecheck|lint|build|test)|(?:npx\s+)?(?:tsc|vitest|jest))(?:\s|$)/i.test(
    value
  );
}

/** A single-file test run is separate from the project-wide quality gate. */
export function isTargetedTestCommand(command: string): boolean {
  const value = String(command || "").trim();
  if (!value || evaluateVerificationCommand(value).blocked) {
    return false;
  }
  return /^(?:npx\s+)?(?:vitest\s+run|jest)\s+(?:"[^"]+\.(?:test|spec)\.[cm]?[jt]sx?"|'[^']+\.(?:test|spec)\.[cm]?[jt]sx?'|\S+\.(?:test|spec)\.[cm]?[jt]sx?)(?:\s|$)/i.test(
    value
  );
}

/**
 * Selects one deterministic, project-scoped command. General test suites are
 * deliberately excluded because their duration is unknown.
 */
export function selectProjectVerificationCommand(
  scripts: Record<string, unknown> | undefined
): ProjectVerificationCommand | undefined {
  if (!scripts) {
    return undefined;
  }

  for (const scriptName of ["typecheck", "lint", "build"] as const) {
    const body = scripts[scriptName];
    if (typeof body !== "string" || !body.trim()) {
      continue;
    }
    if (
      /(?:^|\s)(?:--watch|-w)(?:\s|$)|\b(?:watch|serve|start|dev)\b/i.test(
        body
      ) ||
      /\|\s*(?:head|tail)\b/i.test(body)
    ) {
      continue;
    }
    const command = `npm run ${scriptName}`;
    if (
      evaluateVerificationCommand(body).blocked ||
      evaluateVerificationCommand(command).blocked
    ) {
      continue;
    }
    return { scriptName, command };
  }

  return undefined;
}
