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

  if (
    state.editedPaths.length > 0 &&
    state.diagnosticsCheckedAfterLastEdit &&
    state.diagnosticErrors.length === 0 &&
    state.projectCommand &&
    state.projectCommandAttempts < MAX_PROJECT_COMMANDS_PER_TURN
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
