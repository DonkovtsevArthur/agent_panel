export interface VerificationCommandDecision {
  blocked: boolean;
  reason?: "tsc_project_with_files" | "tsc_files_without_project" | "hidden_pipeline_exit";
  suggestion?: string;
}

const TSC_COMMAND = /(?:^|[;&|]\s*)(?:npx\s+)?(?:[^\s;&|]+\/)?tsc(?:\s|$)/i;
const PROJECT_OPTION = /(?:^|\s)(?:--project|-p)(?:=|\s+)/i;
const TYPESCRIPT_FILE =
  /(?:^|\s)(?:"[^"]+\.(?:[cm]?ts|tsx)"|'[^']+\.(?:[cm]?ts|tsx)'|[^\s;&|]+\.(?:[cm]?ts|tsx))(?=\s|$|[;&|])/i;
const VERIFICATION_COMMAND =
  /(?:^|[;&|]\s*)(?:(?:npx\s+)?(?:[^\s;&|]+\/)?tsc|(?:npx\s+)?vitest|(?:npx\s+)?jest|npm\s+(?:run\s+)?(?:test|lint|build|typecheck)|pnpm\s+(?:test|lint|build|typecheck)|yarn\s+(?:test|lint|build|typecheck))(?:\s|$)/i;
const OUTPUT_TRUNCATION_PIPE = /\s+(?:2>&1\s*)?\|\s*(?:head|tail)\b[^;&|]*/i;

function commandBeforeOutputPipe(command: string): string {
  return command.replace(OUTPUT_TRUNCATION_PIPE, "").trim();
}

/**
 * Reject verification commands whose exit status or project configuration
 * would be misleading. Tool output is already truncated safely by run_command.
 */
export function evaluateVerificationCommand(
  command: string
): VerificationCommandDecision {
  const value = String(command || "").trim();
  if (!value) {
    return { blocked: false };
  }

  if (VERIFICATION_COMMAND.test(value) && OUTPUT_TRUNCATION_PIPE.test(value)) {
    return {
      blocked: true,
      reason: "hidden_pipeline_exit",
      suggestion: commandBeforeOutputPipe(value),
    };
  }

  if (!TSC_COMMAND.test(value) || !TYPESCRIPT_FILE.test(value)) {
    return { blocked: false };
  }

  if (PROJECT_OPTION.test(value)) {
    return {
      blocked: true,
      reason: "tsc_project_with_files",
      suggestion: "npx tsc --project tsconfig.json --noEmit",
    };
  }

  return {
    blocked: true,
    reason: "tsc_files_without_project",
    suggestion: "npx tsc --project tsconfig.json --noEmit",
  };
}
