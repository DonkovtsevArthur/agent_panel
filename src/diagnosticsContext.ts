import * as path from "path";
import type * as Vscode from "vscode";

export const DEFAULT_DIAGNOSTICS_PER_FILE = 20;
export const DEFAULT_DIAGNOSTICS_TOTAL = 100;

export type DiagnosticSeverity = "error" | "warning";

export type StructuredDiagnostic = {
  path: string;
  severity: DiagnosticSeverity;
  message: string;
  source?: string;
  startLine: number;
  startColumn: number;
};

export type DiagnosticLike = {
  severity: number | string;
  message: unknown;
  source?: unknown;
  range?: {
    start?: {
      line?: unknown;
      character?: unknown;
    };
  };
};

export type DiagnosticsLimitOptions = {
  perFile?: number;
  total?: number;
};

export type CollectDiagnosticsOptions = DiagnosticsLimitOptions & {
  paths?: string[];
};

function normalizeSeverity(value: number | string): DiagnosticSeverity | undefined {
  if (value === 0 || String(value).toLowerCase() === "error") {
    return "error";
  }
  if (value === 1 || String(value).toLowerCase() === "warning") {
    return "warning";
  }
  return undefined;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function normalizeDisplayPath(value: string): string {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

/** Convert a VS Code-like diagnostic into the stable context representation. */
export function normalizeDiagnostic(
  relativePath: string,
  diagnostic: DiagnosticLike
): StructuredDiagnostic | undefined {
  const normalizedPath = normalizeDisplayPath(relativePath);
  const severity = normalizeSeverity(diagnostic.severity);
  const message = String(diagnostic.message ?? "").replace(/\r\n?/g, "\n").trim();
  if (!normalizedPath || !severity || !message) {
    return undefined;
  }

  const source = String(diagnostic.source ?? "").trim();
  return {
    path: normalizedPath,
    severity,
    message,
    ...(source ? { source } : {}),
    startLine: nonNegativeInteger(diagnostic.range?.start?.line) + 1,
    startColumn: nonNegativeInteger(diagnostic.range?.start?.character) + 1,
  };
}

function compareDiagnostics(
  left: StructuredDiagnostic,
  right: StructuredDiagnostic
): number {
  return (
    left.path.localeCompare(right.path, "en") ||
    (left.severity === right.severity
      ? 0
      : left.severity === "error"
        ? -1
        : 1) ||
    left.startLine - right.startLine ||
    left.startColumn - right.startColumn ||
    left.message.localeCompare(right.message, "en") ||
    (left.source || "").localeCompare(right.source || "", "en")
  );
}

function safeLimit(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.max(0, Math.floor(value));
}

/** Keep only errors/warnings, sort deterministically, and apply both caps. */
export function filterDiagnostics(
  diagnostics: readonly (StructuredDiagnostic | undefined)[],
  options: DiagnosticsLimitOptions = {}
): StructuredDiagnostic[] {
  const perFile = safeLimit(options.perFile, DEFAULT_DIAGNOSTICS_PER_FILE);
  const total = safeLimit(options.total, DEFAULT_DIAGNOSTICS_TOTAL);
  const sorted = diagnostics
    .filter((item): item is StructuredDiagnostic => Boolean(item))
    .filter((item) => item.severity === "error" || item.severity === "warning")
    .slice()
    .sort(compareDiagnostics);
  const counts = new Map<string, number>();
  const result: StructuredDiagnostic[] = [];

  for (const diagnostic of sorted) {
    if (result.length >= total) {
      break;
    }
    const count = counts.get(diagnostic.path) || 0;
    if (count >= perFile) {
      continue;
    }
    counts.set(diagnostic.path, count + 1);
    result.push(diagnostic);
  }
  return result;
}

/** Format structured diagnostics as compact, deterministic context text. */
export function formatDiagnostics(
  diagnostics: readonly StructuredDiagnostic[]
): string {
  if (diagnostics.length === 0) {
    return "";
  }
  return [
    "Workspace diagnostics (errors and warnings):",
    ...diagnostics.map((diagnostic) => {
      const source = diagnostic.source ? ` (${diagnostic.source})` : "";
      const message = diagnostic.message.replace(/\s*\n\s*/g, " ");
      return `- ${diagnostic.path}:${diagnostic.startLine}:${diagnostic.startColumn} [${diagnostic.severity}]${source} ${message}`;
    }),
  ].join("\n");
}

function isInsideRoot(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function resolveRequestedUris(
  vscode: typeof Vscode,
  rootPath: string,
  requestedPaths: readonly string[]
): Vscode.Uri[] {
  const seen = new Set<string>();
  const uris: Vscode.Uri[] = [];
  for (const requestedPath of requestedPaths) {
    if (!requestedPath || path.isAbsolute(requestedPath)) {
      continue;
    }
    const absolutePath = path.resolve(rootPath, requestedPath);
    if (!isInsideRoot(rootPath, absolutePath)) {
      continue;
    }
    const uri = vscode.Uri.file(absolutePath);
    if (!seen.has(uri.fsPath)) {
      seen.add(uri.fsPath);
      uris.push(uri);
    }
  }
  return uris;
}

function collectOpenUris(
  vscode: typeof Vscode,
  rootPath: string
): Vscode.Uri[] {
  const documents = [
    vscode.window.activeTextEditor?.document,
    ...vscode.window.visibleTextEditors.map((editor) => editor.document),
    ...vscode.workspace.textDocuments,
  ];
  const seen = new Set<string>();
  const uris: Vscode.Uri[] = [];
  for (const document of documents) {
    const uri = document?.uri;
    if (
      !document ||
      document.isClosed ||
      !uri ||
      uri.scheme !== "file" ||
      !isInsideRoot(rootPath, uri.fsPath) ||
      seen.has(uri.fsPath)
    ) {
      continue;
    }
    seen.add(uri.fsPath);
    uris.push(uri);
  }
  return uris;
}

/**
 * Collect diagnostics for explicit workspace-relative paths, or for active/open
 * files when no paths are supplied.
 */
export function collectWorkspaceDiagnostics(
  options: CollectDiagnosticsOptions = {}
): StructuredDiagnostic[] {
  // A local require keeps pure helpers importable in Node tests without the
  // extension-host-only `vscode` runtime module.
  const vscode = require("vscode") as typeof Vscode;
  const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!rootPath) {
    return [];
  }

  const requestedPaths = (options.paths || []).filter((item) =>
    Boolean(String(item || "").trim())
  );
  const uris =
    requestedPaths.length > 0
      ? resolveRequestedUris(vscode, rootPath, requestedPaths)
      : collectOpenUris(vscode, rootPath);
  const normalized: Array<StructuredDiagnostic | undefined> = [];

  for (const uri of uris) {
    if (!isInsideRoot(rootPath, uri.fsPath)) {
      continue;
    }
    const relativePath = normalizeDisplayPath(path.relative(rootPath, uri.fsPath));
    for (const diagnostic of vscode.languages.getDiagnostics(uri)) {
      normalized.push(normalizeDiagnostic(relativePath, diagnostic));
    }
  }
  return filterDiagnostics(normalized, options);
}

export function buildDiagnosticsContextMessage(
  options: CollectDiagnosticsOptions = {}
): string {
  return formatDiagnostics(collectWorkspaceDiagnostics(options));
}
