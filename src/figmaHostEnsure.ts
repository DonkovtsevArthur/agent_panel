/**
 * Ensure the Figma Cline sidecar host is running (background, non-blocking).
 * Spawns `scripts/figma-host-ensure.js` as a detached child so the extension
 * activation is not delayed. The script itself is idempotent — it checks
 * health first and only starts/restarts when needed.
 *
 * Opt-in via `agentPanel.figma.hostAutoStart`: the host only serves the
 * Harbor Figma plugin, so it should not run for every VS Code user.
 */
import * as vscode from "vscode";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

const SETTING = "figma.hostAutoStart";

function isAutoStartEnabled(): boolean {
  return (
    vscode.workspace.getConfiguration("agentPanel").get<boolean>(SETTING) ===
    true
  );
}

export function ensureFigmaHostInBackground(extensionPath: string): void {
  const script = join(extensionPath, "scripts", "figma-host-ensure.js");
  if (!existsSync(script)) {
    return;
  }
  try {
    const child = spawn(process.execPath, [script], {
      cwd: extensionPath,
      detached: true,
      stdio: "ignore",
      // Inside the extension host process.execPath is the Electron binary;
      // without this flag it would try to launch a second VS Code window
      // instead of running the script under Node. Inherited by the sidecar.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    child.on("error", () => {
      /* best-effort; user can still run `npm run figma:host` manually */
    });
    child.unref();
  } catch {
    // best-effort; user can still run manually
  }
}

/** Start the host now (if enabled) and again whenever the setting is turned on. */
export function registerFigmaHostAutoStart(
  context: vscode.ExtensionContext
): void {
  if (isAutoStartEnabled()) {
    ensureFigmaHostInBackground(context.extensionPath);
  }
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration(`agentPanel.${SETTING}`) &&
        isAutoStartEnabled()
      ) {
        ensureFigmaHostInBackground(context.extensionPath);
      }
    })
  );
}
