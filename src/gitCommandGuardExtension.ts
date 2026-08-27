/**
 * Harbor Act-mode git policy as a Cline `beforeTool` extension.
 * Blocks git commit / push / broad add / broad discard via `run_commands`
 * before approval or execution (same hook slot as Cline's plan command-guard).
 */
import {
  shouldBlockBroadGitDiscard,
  shouldBlockBroadGitStage,
  shouldBlockGitCommitOrPush,
  isGitCommitCommand,
} from "./gitCommandPolicy";

export const HARBOR_GIT_COMMAND_GUARD_EXTENSION_NAME =
  "harbor.git-command-policy";

/** Latest user turn text — updated each Harbor turn so push/"all changes" exceptions work. */
export const harborGitGuardUserTextRef: { current: string } = { current: "" };

export function setHarborGitGuardUserText(text: string): void {
  harborGitGuardUserTextRef.current = String(text || "");
}

function commandLineFromEntry(entry: unknown): string {
  if (typeof entry === "string") {
    return entry.trim();
  }
  if (!entry || typeof entry !== "object") {
    return "";
  }
  const row = entry as {
    command?: unknown;
    cmd?: unknown;
    args?: unknown;
  };
  const base = String(row.command || row.cmd || "").trim();
  const args = Array.isArray(row.args)
    ? row.args.map((a) => String(a ?? "")).join(" ")
    : "";
  return `${base} ${args}`.trim();
}

/** Best-effort parse of Cline `run_commands` input without importing vendor helpers. */
export function extractRunCommandLines(input: unknown): string[] {
  if (typeof input === "string") {
    const line = input.trim();
    return line ? [line] : [];
  }
  if (!input || typeof input !== "object") {
    return [];
  }
  const row = input as Record<string, unknown>;
  if (Array.isArray(row.commands)) {
    return row.commands.map(commandLineFromEntry).filter(Boolean);
  }
  const single = commandLineFromEntry(row);
  if (single) {
    return [single];
  }
  if (typeof row.command === "string" || typeof row.cmd === "string") {
    return [commandLineFromEntry(row)].filter(Boolean);
  }
  return [];
}

export function harborBlockedGitCommandReason(
  command: string,
  userText: string
): string | undefined {
  const cmd = String(command || "").trim();
  if (!cmd) {
    return undefined;
  }
  if (shouldBlockGitCommitOrPush(cmd, userText)) {
    if (isGitCommitCommand(cmd)) {
      return [
        "Command not executed: Harbor blocks `git commit` via shell.",
        "Use the panel «Commit and push» control instead.",
      ].join(" ");
    }
    return [
      "Command not executed: Harbor blocks `git push` via shell",
      "unless the user explicitly asked only to push.",
      "Prefer the panel «Commit and push» control.",
    ].join(" ");
  }
  if (shouldBlockBroadGitStage(cmd, userText)) {
    return [
      "Command not executed: Harbor blocks broad staging",
      "(`git add .` / `-A` / `--all`, or `git commit -a`)",
      "unless the user asked to include all changes.",
      "Stage specific paths instead.",
    ].join(" ");
  }
  if (shouldBlockBroadGitDiscard(cmd, userText)) {
    return [
      "Command not executed: Harbor blocks broad discard",
      "(`git restore .`, `git clean -f`, `git reset --hard`)",
      "unless the user asked to discard all local changes.",
    ].join(" ");
  }
  return undefined;
}

/**
 * Plain AgentExtension-shaped object for ClineCore `config.extensions`.
 * Uses `skip` (not `stop`) so the model gets the reason and can continue.
 */
export function createHarborGitCommandGuardExtension(): {
  name: string;
  manifest: { capabilities: string[] };
  hooks: {
    beforeTool: (context: {
      tool?: { name?: string };
      input?: unknown;
    }) => { skip: true; reason: string } | undefined;
  };
} {
  return {
    name: HARBOR_GIT_COMMAND_GUARD_EXTENSION_NAME,
    manifest: {
      capabilities: ["hooks"],
    },
    hooks: {
      beforeTool(context) {
        if (String(context.tool?.name || "") !== "run_commands") {
          return undefined;
        }
        let commands: string[];
        try {
          commands = extractRunCommandLines(context.input);
        } catch {
          return undefined;
        }
        const userText = harborGitGuardUserTextRef.current;
        for (const command of commands) {
          const reason = harborBlockedGitCommandReason(command, userText);
          if (reason) {
            return { skip: true, reason };
          }
        }
        return undefined;
      },
    },
  };
}

/** Merge Harbor git guard into a Cline session `extensions` array (idempotent). */
export function withHarborGitCommandGuardExtension(
  prior: unknown
): unknown[] {
  const list = Array.isArray(prior) ? [...prior] : [];
  const filtered = list.filter((entry) => {
    if (!entry || typeof entry !== "object") {
      return true;
    }
    return (
      String((entry as { name?: unknown }).name || "") !==
      HARBOR_GIT_COMMAND_GUARD_EXTENSION_NAME
    );
  });
  filtered.push(createHarborGitCommandGuardExtension());
  return filtered;
}
