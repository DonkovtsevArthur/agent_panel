/**
 * Harbor extraTool: `verify_edits` — after file writes the model collects IDE
 * diagnostics for the changed paths before claiming the task is done.
 * Read-only (languages.getDiagnostics); safe in Agent / Plan / Ask.
 */
import { buildDiagnosticsMessage } from "./turnContext";

type CreateTool = (config: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown, context: unknown) => Promise<unknown>;
  timeoutMs?: number;
}) => unknown;

export const VERIFY_EDITS_TOOL = "verify_edits";

/** Paths edited in the current turn (cleared at turn start). */
const turnEditedPaths = new Set<string>();

export function clearTurnEditedPaths(): void {
  turnEditedPaths.clear();
}

export function noteTurnEditedPath(path: string): void {
  const p = String(path || "").trim();
  if (p) {
    turnEditedPaths.add(p);
  }
}

export function getTurnEditedPaths(): string[] {
  return [...turnEditedPaths];
}

function normalizePaths(raw: unknown): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    const s = String(v || "").trim();
    if (s) {
      out.push(s);
    }
  };
  if (Array.isArray(raw)) {
    raw.forEach(push);
  } else if (raw !== undefined && raw !== null) {
    push(raw);
  }
  return [...new Set(out)].slice(0, 24);
}

/** Let language servers catch up with the on-disk edit. */
function settleDiagnostics(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createVerifyEditsTool(createTool: CreateTool): unknown {
  return createTool({
    name: VERIFY_EDITS_TOOL,
    description: [
      "Collect IDE diagnostics (errors/warnings) for files changed in this turn, or for explicit paths.",
      "Call ONCE before the final message if you edited files — not after every write. If there are [error] items, fix them and call again.",
      "Do not claim tests passed unless a real run_commands said so.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          description:
            "Optional file paths (workspace-relative) to check. Omit to check every file edited in this turn.",
          items: { type: "string" },
        },
      },
    },
    execute: async (input: unknown) => {
      const explicit = normalizePaths(
        (input as { paths?: unknown } | null)?.paths
      );
      const targets = explicit.length ? explicit : getTurnEditedPaths();
      // Language servers need a beat after the write lands on disk.
      await settleDiagnostics(200);
      const message = buildDiagnosticsMessage(targets);
      const listed = targets.length
        ? targets.join(", ")
        : "open editors / recently edited files";
      if (!message.trim()) {
        return [
          `verify_edits: no IDE errors/warnings for: ${listed}.`,
          "Safe to finish IF you also have a real tool result for every claim (write/edit success, or run_commands exit code).",
          "Do not invent test/build results — only report what tools actually returned.",
        ].join(" ");
      }
      return [
        message,
        "",
        "If any line is [error] — fix it now, then call verify_edits again.",
        "Do not claim the task is done while [error] items remain on edited files.",
      ].join("\n");
    },
    timeoutMs: 15_000,
  });
}
