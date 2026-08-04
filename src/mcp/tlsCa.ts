import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

function expandHome(p: string): string {
  const trimmed = p.trim();
  if (trimmed === "~") {
    return os.homedir();
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

/**
 * MCP SDK fetch respects NODE_EXTRA_CA_CERTS. Mirror Harbor's caBundlePath
 * so corporate MITM / custom roots work for Figma remote MCP too.
 */
export function applyFigmaTlsCaFromSettings(): void {
  const raw = vscode.workspace
    .getConfiguration("agentPanel")
    .get<string>("caBundlePath");
  const caPath = expandHome(String(raw || "").trim());
  if (!caPath || !fs.existsSync(caPath)) {
    return;
  }
  if (!process.env.NODE_EXTRA_CA_CERTS) {
    process.env.NODE_EXTRA_CA_CERTS = caPath;
  }
}
