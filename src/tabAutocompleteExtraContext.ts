/**
 * Extra Tab autocomplete context: relative imports, one sibling open tab,
 * and a short workspace-rules digest (AGENTS.md / .cursor/rules).
 * Kept tiny — hole-fill latency and gateway token budgets matter.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { loadWorkspaceRules } from "./workspaceRules";

export type TabRelatedSnippet = {
  /** Workspace- or file-relative label for the prompt. */
  label: string;
  snippet: string;
};

export type TabExtraContext = {
  related: TabRelatedSnippet[];
  projectRules?: string;
};

const MAX_RELATED_FILES = 2;
const MAX_SNIPPET_CHARS = 420;
const MAX_RULES_CHARS = 900;
const MAX_TOTAL_EXTRA_CHARS = 1_400;
const RULES_CACHE_TTL_MS = 60_000;

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
];

type RulesCacheEntry = {
  key: string;
  at: number;
  text: string | undefined;
};

let rulesCache: RulesCacheEntry | undefined;

/** Relative `from '…'` / `require('…')` specifiers only (`./` / `../`). */
export function extractRelativeImportSpecifiers(source: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (spec: string | undefined) => {
    const s = String(spec || "").trim();
    if (!s.startsWith(".") || seen.has(s)) {
      return;
    }
    seen.add(s);
    out.push(s);
  };

  const fromRe =
    /(?:import|export)\s+(?:type\s+)?[\s\S]*?\s+from\s*['"](\.[^'"]+)['"]/g;
  const requireRe = /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(source))) {
    push(m[1]);
  }
  while ((m = requireRe.exec(source))) {
    push(m[1]);
  }
  return out;
}

/**
 * Prefer exported / Effector unit lines; fall back to a short file head.
 */
export function pickExportSnippets(text: string, maxChars: number): string {
  const cap = Math.max(80, Math.floor(maxChars) || MAX_SNIPPET_CHARS);
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const interesting: string[] = [];
  let size = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || "";
    const isInteresting =
      /^\s*export\s+/.test(line) ||
      /\bcreate(?:Store|Event|Effect|Domain)\b/.test(line) ||
      /^\s*(?:export\s+)?(?:type|interface|enum)\s+/.test(line);
    if (!isInteresting) {
      continue;
    }
    const chunk = [line];
    const next = lines[i + 1] || "";
    if (/^\s*[.({`]/.test(next) || /=>$/.test(line.trim())) {
      chunk.push(next);
    }
    const add = chunk.join("\n");
    if (size + add.length + 1 > cap && interesting.length > 0) {
      break;
    }
    interesting.push(add);
    size += add.length + 1;
    if (size >= cap) {
      break;
    }
  }

  if (interesting.length > 0) {
    return interesting.join("\n").slice(0, cap).trimEnd();
  }

  return lines.slice(0, 35).join("\n").slice(0, cap).trimEnd();
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Resolve `./foo` → concrete file on disk (tries extensions + index). */
export async function resolveRelativeImportFile(
  fromFile: string,
  specifier: string
): Promise<string | undefined> {
  const baseDir = path.dirname(fromFile);
  const joined = path.resolve(baseDir, specifier);
  if (await pathExists(joined)) {
    const st = await fs.stat(joined);
    if (st.isFile()) {
      return joined;
    }
    if (st.isDirectory()) {
      for (const ext of SOURCE_EXTENSIONS) {
        const indexPath = path.join(joined, `index${ext}`);
        if (await pathExists(indexPath)) {
          return indexPath;
        }
      }
    }
  }
  if (path.extname(joined)) {
    return undefined;
  }
  for (const ext of SOURCE_EXTENSIONS) {
    const withExt = joined + ext;
    if (await pathExists(withExt)) {
      return withExt;
    }
  }
  for (const ext of SOURCE_EXTENSIONS) {
    const indexPath = path.join(joined, `index${ext}`);
    if (await pathExists(indexPath)) {
      return indexPath;
    }
  }
  return undefined;
}

function workspaceRelativeLabel(filePath: string): string {
  const folders = vscode.workspace.workspaceFolders || [];
  for (const folder of folders) {
    const root = folder.uri.fsPath;
    if (filePath === root || filePath.startsWith(root + path.sep)) {
      return path.relative(root, filePath).split(path.sep).join("/");
    }
  }
  return path.basename(filePath);
}

function currentWorkspaceRoot(
  document: vscode.TextDocument
): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (folder) {
    return folder.uri.fsPath;
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function loadSnippetFromDisk(
  filePath: string,
  maxChars: number
): Promise<TabRelatedSnippet | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (!raw.trim()) {
      return undefined;
    }
    const snippet = pickExportSnippets(raw, maxChars);
    if (!snippet.trim()) {
      return undefined;
    }
    return { label: workspaceRelativeLabel(filePath), snippet };
  } catch {
    return undefined;
  }
}

function pickSiblingOpenDocument(
  current: vscode.TextDocument
): vscode.TextDocument | undefined {
  const currentUri = current.uri.toString();
  const docs = vscode.window.visibleTextEditors
    .map((e) => e.document)
    .filter(
      (d) =>
        d.uri.scheme === "file" &&
        d.uri.toString() !== currentUri &&
        !d.isUntitled
    );

  const sameLang = docs.find((d) => d.languageId === current.languageId);
  if (sameLang) {
    return sameLang;
  }
  return docs[0];
}

async function loadProjectRulesDigest(
  root: string,
  targetRelativePath: string
): Promise<string | undefined> {
  const key = `${root}::${targetRelativePath}`;
  const now = Date.now();
  if (
    rulesCache &&
    rulesCache.key === key &&
    now - rulesCache.at < RULES_CACHE_TTL_MS
  ) {
    return rulesCache.text;
  }

  const text = await loadWorkspaceRules(root, {
    targetPaths: [targetRelativePath],
    charCap: MAX_RULES_CHARS,
  });
  // Drop huge Harbor-product noise if it somehow dominates — keep head only.
  const capped = text ? text.slice(0, MAX_RULES_CHARS).trim() : undefined;
  rulesCache = { key, at: now, text: capped };
  return capped;
}

/**
 * Gather import + sibling-tab snippets and a short rules digest for Tab prompts.
 */
export async function buildTabExtraContext(
  document: vscode.TextDocument
): Promise<TabExtraContext> {
  if (document.uri.scheme !== "file") {
    return { related: [] };
  }

  const related: TabRelatedSnippet[] = [];
  const usedPaths = new Set<string>([document.uri.fsPath]);
  let budget = MAX_TOTAL_EXTRA_CHARS;

  const source = document.getText();
  // Prefer imports near the top / first N relative modules.
  const specs = extractRelativeImportSpecifiers(source).slice(0, 6);
  for (const spec of specs) {
    if (related.length >= MAX_RELATED_FILES || budget < 120) {
      break;
    }
    const resolved = await resolveRelativeImportFile(document.uri.fsPath, spec);
    if (!resolved || usedPaths.has(resolved)) {
      continue;
    }
    usedPaths.add(resolved);
    const snippetBudget = Math.min(MAX_SNIPPET_CHARS, budget);
    const item = await loadSnippetFromDisk(resolved, snippetBudget);
    if (!item) {
      continue;
    }
    related.push(item);
    budget -= item.snippet.length + item.label.length + 24;
  }

  // One other visible editor (often the store/events sibling while editing).
  if (related.length < MAX_RELATED_FILES && budget >= 120) {
    const sibling = pickSiblingOpenDocument(document);
    if (sibling && !usedPaths.has(sibling.uri.fsPath)) {
      usedPaths.add(sibling.uri.fsPath);
      const snippet = pickExportSnippets(
        sibling.getText(),
        Math.min(MAX_SNIPPET_CHARS, budget)
      );
      if (snippet.trim()) {
        related.push({
          label: workspaceRelativeLabel(sibling.uri.fsPath),
          snippet,
        });
        budget -= snippet.length + 24;
      }
    }
  }

  const root = currentWorkspaceRoot(document);
  let projectRules: string | undefined;
  if (root && budget >= 160) {
    const rel = workspaceRelativeLabel(document.uri.fsPath);
    const rules = await loadProjectRulesDigest(root, rel);
    if (rules) {
      projectRules = rules.slice(0, Math.min(MAX_RULES_CHARS, budget));
    }
  }

  return { related, projectRules };
}
