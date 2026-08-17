/**
 * Per-turn context injected into the Cline user prompt (not the system
 * prompt): editor, git, diagnostics, recently edited files, terminal, rules.
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
import { buildTerminalSnapshotMessage } from "./terminalContext";
import {
  buildEnclosingSymbolMessage,
  formatEnclosingSymbolMessage,
} from "./editorSymbols";
import { loadWorkspaceRules } from "./workspaceRules";

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

function harborIdeExtras(): {
  enclosingSymbol?: { name?: string; kind?: string; line?: number; detail?: string };
  terminal?: {
    name?: string;
    command?: string;
    cwd?: string;
    output?: string;
    exitCode?: number;
  };
  recentFiles?: string[];
} {
  try {
    const extras = (
      vscode as unknown as {
        HarborHeadless?: { getIdeExtras?: () => unknown };
      }
    ).HarborHeadless?.getIdeExtras?.();
    if (extras && typeof extras === "object") {
      return extras as ReturnType<typeof harborIdeExtras>;
    }
  } catch {
    /* real vscode module */
  }
  return {};
}

function relativeFromFsPath(fsPath: string): string {
  try {
    return vscode.workspace.asRelativePath(fsPath, false) || fsPath;
  } catch {
    return fsPath;
  }
}

function buildRecentlyViewedMessage(extraPaths: string[] = []): string {
  const seen = new Set<string>();
  const paths: string[] = [];
  const push = (rel: string) => {
    const key = rel.replace(/\\/g, "/").trim();
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    paths.push(key);
  };
  for (const extra of extraPaths) {
    push(String(extra || ""));
  }
  try {
    const groups = (
      vscode.window as unknown as {
        tabGroups?: { all?: Array<{ tabs?: Array<{ input?: { uri?: vscode.Uri } }> }> };
      }
    ).tabGroups;
    if (Array.isArray(groups?.all)) {
      for (const group of groups.all) {
        for (const tab of group.tabs || []) {
          const uri = tab.input?.uri;
          if (uri && uri.scheme === "file") {
            push(relativeFromFsPath(uri.fsPath));
          }
        }
      }
    }
  } catch {
    /* stub without tabGroups */
  }
  for (const editor of vscode.window.visibleTextEditors || []) {
    const uri = editor?.document?.uri;
    if (uri && uri.scheme === "file") {
      push(relativeFromFsPath(uri.fsPath));
    }
  }
  const shown = paths.slice(0, 12);
  if (!shown.length) {
    return "";
  }
  return ["Recently viewed / open files:", ...shown.map((p) => `- ${p}`)].join(
    "\n"
  );
}

function openFileTargetPaths(): string[] {
  const paths: string[] = [];
  const active = getActiveFileRelativePath();
  if (active) {
    paths.push(active);
  }
  for (const editor of [
    vscode.window.activeTextEditor,
    ...(vscode.window.visibleTextEditors || []),
  ]) {
    const uri = editor?.document?.uri;
    if (!uri || uri.scheme !== "file") {
      continue;
    }
    paths.push(relativeFromFsPath(uri.fsPath));
  }
  return [...new Set(paths.map((p) => p.replace(/\\/g, "/")).filter(Boolean))];
}

export async function buildTurnContextBlock(options: {
  skipActiveFilePrefetch?: boolean;
  lastAgentEditedPaths?: string[];
  /**
   * Follow-up turn of a live session: keep the cheap live-state parts
   * (editor state, git, diagnostics, enclosing symbol, agent-edited paths)
   * and drop the heavy ones (active-file prefetch, workspace rules,
   * terminal snapshot, recently viewed) — they were already sent on the
   * session's first turn and stay in its history.
   */
  slim?: boolean;
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

  if (!options.slim && !options.skipActiveFilePrefetch) {
    try {
      const prefetch = buildActiveFilePrefetchMessage();
      if (prefetch.trim()) {
        parts.push(prefetch.trim());
      }
    } catch {
      /* headless / stub */
    }
  }

  // Git snapshot, enclosing symbol and workspace rules are independent —
  // started together here, awaited in their original positions below so the
  // part order (and thus the prompt layout) stays stable.
  const gitPromise = buildGitSnapshotMessage().catch(() => "");
  const symbolPromise = buildEnclosingSymbolMessage().catch(() => "");
  let rulesPromise: Promise<string | undefined> | undefined;
  if (!options.slim) {
    try {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (folder) {
        rulesPromise = loadWorkspaceRules(folder.uri.fsPath, {
          omitAgentsMd: true,
          targetPaths: openFileTargetPaths(),
          charCap: 6_000,
        }).catch(() => undefined);
      }
    } catch {
      /* no rules dir */
    }
  }

  const git = await gitPromise;
  if (git.trim()) {
    parts.push(git.trim());
  }

  const diagnostics = buildDiagnosticsMessage(options.lastAgentEditedPaths);
  if (diagnostics.trim()) {
    parts.push(diagnostics.trim());
  }

  const extras = harborIdeExtras();

  try {
    const symbol =
      (await symbolPromise) ||
      formatEnclosingSymbolMessage(
        extras.enclosingSymbol?.name
          ? {
              name: String(extras.enclosingSymbol.name),
              kind: extras.enclosingSymbol.kind,
              line: extras.enclosingSymbol.line,
              detail: extras.enclosingSymbol.detail,
            }
          : undefined
      );
    if (symbol.trim()) {
      parts.push(symbol.trim());
    }
  } catch {
    /* headless / no LSP */
  }

  if (!options.slim) {
    try {
      const terminal = buildTerminalSnapshotMessage(
        extras.terminal?.output
          ? {
              name: String(extras.terminal.name || "Run"),
              command: extras.terminal.command,
              cwd: extras.terminal.cwd,
              output: String(extras.terminal.output),
              exitCode: extras.terminal.exitCode,
            }
          : undefined
      );
      if (terminal.trim()) {
        parts.push(terminal.trim());
      }
    } catch {
      /* no terminal API */
    }
  }

  const recentViewed = options.slim
    ? ""
    : buildRecentlyViewedMessage(extras.recentFiles || []);
  if (recentViewed) {
    parts.push(recentViewed);
  }

  const recent = buildRecentlyEditedMessage(options.lastAgentEditedPaths);
  if (recent) {
    parts.push(recent);
  }

  const rules = await rulesPromise;
  if (rules?.trim()) {
    parts.push(
      [
        "Matching workspace rules for the current file(s) (glob / alwaysApply; AGENTS.md is already in session rules):",
        rules.trim(),
      ].join("\n")
    );
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
