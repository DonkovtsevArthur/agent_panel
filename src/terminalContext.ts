/**
 * Last IDE terminal / Run console output for the agent turn.
 * VS Code: shellIntegration stream. JetBrains: snapshot on HarborHeadless extras.
 */
import * as vscode from "vscode";

const MAX_OUTPUT_CHARS = 4_000;

export type TerminalSnapshot = {
  name: string;
  command?: string;
  cwd?: string;
  output: string;
  exitCode?: number;
};

let lastSnapshot: TerminalSnapshot | undefined;

function trimOutput(text: string): string {
  const raw = String(text || "").replace(/\s+$/g, "");
  if (raw.length <= MAX_OUTPUT_CHARS) {
    return raw;
  }
  return raw.slice(-MAX_OUTPUT_CHARS);
}

/**
 * Drop the cached snapshot. Called on chat switch/new chat: the module-level
 * snapshot belongs to the previous chat's activity and must not leak into
 * the first turn of the next chat.
 */
export function resetTerminalSnapshot(): void {
  lastSnapshot = undefined;
}

export function recordTerminalSnapshot(snapshot: TerminalSnapshot | undefined): void {
  if (!snapshot || !String(snapshot.output || "").trim()) {
    return;
  }
  lastSnapshot = {
    name: String(snapshot.name || "terminal").trim() || "terminal",
    command: snapshot.command ? String(snapshot.command).trim() : undefined,
    cwd: snapshot.cwd ? String(snapshot.cwd).trim() : undefined,
    output: trimOutput(snapshot.output),
    exitCode:
      typeof snapshot.exitCode === "number" && Number.isFinite(snapshot.exitCode)
        ? snapshot.exitCode
        : undefined,
  };
}

export function startTerminalOutputTracking(
  subscriptions: { push(...items: { dispose(): unknown }[]): void }
): void {
  const win = vscode.window as unknown as {
    onDidStartTerminalShellExecution?: (
      listener: (e: {
        terminal: { name?: string };
        execution: {
          commandLine?: { value?: string };
          cwd?: { fsPath?: string };
          read: () => AsyncIterable<string>;
        };
      }) => void
    ) => { dispose(): void };
    onDidEndTerminalShellExecution?: (
      listener: (e: {
        terminal: { name?: string };
        execution: { commandLine?: { value?: string } };
        exitCode?: number;
      }) => void
    ) => { dispose(): void };
  };
  if (typeof win.onDidStartTerminalShellExecution !== "function") {
    return;
  }
  subscriptions.push(
    win.onDidStartTerminalShellExecution((event) => {
      void (async () => {
        let buf = "";
        try {
          for await (const chunk of event.execution.read()) {
            buf += String(chunk || "");
            if (buf.length > MAX_OUTPUT_CHARS * 3) {
              buf = buf.slice(-MAX_OUTPUT_CHARS * 2);
            }
          }
        } catch {
          /* closed / no shellIntegration */
        }
        recordTerminalSnapshot({
          name: event.terminal.name || "terminal",
          command: event.execution.commandLine?.value,
          cwd: event.execution.cwd?.fsPath,
          output: buf,
        });
      })();
    })
  );
  if (typeof win.onDidEndTerminalShellExecution === "function") {
    subscriptions.push(
      win.onDidEndTerminalShellExecution((event) => {
        if (!lastSnapshot) {
          return;
        }
        const same =
          (event.terminal.name || "terminal") === lastSnapshot.name;
        if (!same) {
          return;
        }
        lastSnapshot = {
          ...lastSnapshot,
          command:
            event.execution.commandLine?.value || lastSnapshot.command,
          exitCode: event.exitCode,
        };
      })
    );
  }
}

export function buildTerminalSnapshotMessage(
  extra?: TerminalSnapshot
): string {
  const snap = extra?.output?.trim() ? extra : lastSnapshot;
  if (!snap || !String(snap.output || "").trim()) {
    return "";
  }
  const lines = [
    "Last IDE terminal / Run output (may be stale — re-run for current):",
    `- Terminal: ${snap.name}`,
  ];
  if (snap.command) {
    lines.push(`- Command: ${snap.command}`);
  }
  if (snap.cwd) {
    lines.push(`- Cwd: ${snap.cwd}`);
  }
  if (typeof snap.exitCode === "number") {
    lines.push(`- Exit code: ${snap.exitCode}`);
  }
  lines.push("```");
  lines.push(trimOutput(snap.output));
  lines.push("```");
  return lines.join("\n");
}
