/**
 * Ensure the Figma Cline sidecar host is running (background, non-blocking).
 * Spawns `scripts/figma-host-ensure.js` as a detached child so the extension
 * activation is not delayed. The script itself is idempotent — it checks
 * health first and only starts/restarts when needed.
 */
import { spawn } from "child_process";
import { join } from "path";

export function ensureFigmaHostInBackground(extensionPath: string): void {
  const script = join(extensionPath, "scripts", "figma-host-ensure.js");
  try {
    const child = spawn(process.execPath, [script], {
      cwd: extensionPath,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // best-effort; user can still run manually
  }
}
