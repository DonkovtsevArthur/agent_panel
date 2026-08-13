/**
 * Per-turn context injected into the Cline user prompt (not the system
 * prompt): editor, git, diagnostics, recently edited files.
 * Changes every message, so it must not be baked into a persistent session
 * system prompt.
 */
import * as vscode from "vscode";
import {
  buildActiveFilePrefetchMessage,
  buildEditorContextMessage,
  getActiveFileRelativePath,
} from "./editorContext";
import { buildGitSnapshotMessage } from "./gitStatus";

const DIAGNOSTIC_MAX_ITEMS = 20;
const DIAGNOSTIC_MESSAGE_CHARS = 180;

function diagnosticSeverityLabel(severity: number): string {
  if (severity === 0) {
    return "error";
  }
  if (severity === 1) {
    return "warning";
  }
  return "";
}

function relativeFromUri(uri: vscode.Uri): string {
  try {
    const rel = vscode.workspace.asRelativePath(uri, false);
    return rel || uri.fsPath;
  } catch {
    return uri.fsPath;
  }
}

function collectOpenFileKeys(): Set<string> {
  const keys = new Set<string>();
  const editors = [
    vscode.window.activeTextEditor,
    ...(vscode.window.visibleTextEditors || []),
  ];
  for (const editor of editors) {
    const uri = editor?.document?.uri;
    if (!uri || (uri.scheme !== "file" && uri.scheme !== "untitled")) {
      continue;
    }
    keys.add(uri.toString());
  }
  return keys;
}

/** Problems for open editors — errors and warnings only. */
export function buildDiagnosticsMessage(
  extraRelativePaths: string[] = []
): string {
  const languages = (
    vscode as unknown as {
      languages?: {
        getDiagnostics?: () => Array<
          [
            vscode.Uri,
            Array<{
              severity?: number;
              message?: string;
              range?: { start?: { line?: number } };
            }>,
          ]
        >;
      };
    }
  ).languages;
  if (typeof languages?.getDiagnostics !== "function") {
    return "";
  }

  let entries: Array<
    [
      vscode.Uri,
      Array<{
        severity?: number;
        message?: string;
        range?: { start?: { line?: number } };
      }>,
    ]
  > = [];
  try {
    entries = languages.getDiagnostics() || [];
  } catch {
    return "";
  }

  const openKeys = collectOpenFileKeys();
  const extra = new Set(
    extraRelativePaths.map((p) => String(p || "").replace(/\\/g, "/").trim()).filter(Boolean)
  );
  const rows: string[] = [];
  for (const [uri, diags] of entries) {
    if (!uri || !Array.isArray(diags) || !diags.length) {
      continue;
    }
    const rel = relativeFromUri(uri);
    const wanted =
      openKeys.has(uri.toString()) || extra.has(rel.replace(/\\/g, "/"));
    if (!wanted) {
      continue;
    }
    for (const diag of diags) {
      const sev = diagnosticSeverityLabel(Number(diag.severity));
      if (!sev) {
        continue;
      }
      const line =
        typeof diag.range?.start?.line === "number"
          ? diag.range.start.line + 1
          : undefined;
      const message = String(diag.message || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, DIAGNOSTIC_MESSAGE_CHARS);
      if (!message) {
        continue;
      }
      rows.push(
        line
          ? `- ${rel}:${line} [${sev}] ${message}`
          : `- ${rel} [${sev}] ${message}`
      );
      if (rows.length >= DIAGNOSTIC_MAX_ITEMS) {
        break;
      }
    }
    if (rows.length >= DIAGNOSTIC_MAX_ITEMS) {
      break;
    }
  }
  if (!rows.length) {
    return "";
  }
  return ["IDE diagnostics (open / recently edited files):", ...rows].join("\n");
}

function buildRecentlyEditedMessage(paths: string[] | undefined): string {
  const unique = [
    ...new Set(
      (paths || []).map((p) => String(p || "").trim()).filter(Boolean)
    ),
  ].slice(0, 12);
  if (!unique.length) {
    return "";
  }
  return [
    "Files the agent edited in a previous turn of this chat:",
    ...unique.map((p) => `- ${p}`),
  ].join("\n");
}

export async function buildTurnContextBlock(options: {
  skipActiveFilePrefetch?: boolean;
  lastAgentEditedPaths?: string[];
}): Promise<string> {
  const parts: string[] = [];
  try {
    const editor = buildEditorContextMessage();
    if (editor.trim()) {
      parts.push(editor.trim());
    }
  } catch {
    /* headless / stub */
  }

  if (!options.skipActiveFilePrefetch) {
    try {
      const prefetch = buildActiveFilePrefetchMessage();
      if (prefetch.trim()) {
        parts.push(prefetch.trim());
      }
    } catch {
      /* headless / stub */
    }
  }

  const git = await buildGitSnapshotMessage();
  if (git.trim()) {
    parts.push(git.trim());
  }

  const diagnostics = buildDiagnosticsMessage(options.lastAgentEditedPaths);
  if (diagnostics.trim()) {
    parts.push(diagnostics.trim());
  }

  const recent = buildRecentlyEditedMessage(options.lastAgentEditedPaths);
  if (recent) {
    parts.push(recent);
  }

  if (!parts.length) {
    return "";
  }
  return ["[Harbor turn context]", ...parts].join("\n\n");
}

export function activeFileAlreadyInlined(inlinedPaths: string[]): boolean {
  const active = getActiveFileRelativePath();
  if (!active) {
    return false;
  }
  const needle = active.replace(/\\/g, "/");
  return inlinedPaths.some(
    (p) => String(p || "").replace(/\\/g, "/") === needle
  );
}
