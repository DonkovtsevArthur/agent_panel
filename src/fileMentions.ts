import * as path from "path";
import * as vscode from "vscode";

export interface FileMentionCandidate {
  path: string;
  name: string;
}

const SEARCH_EXCLUDE =
  "{**/node_modules/**,**/.git/**,**/out/**,**/dist/**,**/*.vsix,**/package-lock.json}";

function workspaceRelativePath(uri: vscode.Uri): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return undefined;
  }
  for (const folder of folders) {
    const rel = path.relative(folder.uri.fsPath, uri.fsPath);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      return rel.split(path.sep).join("/");
    }
  }
  return undefined;
}

function scorePath(relPath: string, query: string): number {
  const q = query.toLowerCase();
  const base = path.basename(relPath).toLowerCase();
  const full = relPath.toLowerCase();
  if (!q) {
    return 0;
  }
  if (base === q) {
    return 1000;
  }
  if (base.startsWith(q)) {
    return 900;
  }
  if (base.includes(q)) {
    return 700;
  }
  if (full.startsWith(q) || full.includes(`/${q}`)) {
    return 500;
  }
  if (full.includes(q)) {
    return 300;
  }
  let qi = 0;
  for (let i = 0; i < full.length && qi < q.length; i++) {
    if (full[i] === q[qi]) {
      qi++;
    }
  }
  return qi === q.length ? 100 : -1;
}

function collectOpenPaths(): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (uri: vscode.Uri | undefined) => {
    if (!uri || uri.scheme !== "file") {
      return;
    }
    const rel = workspaceRelativePath(uri);
    if (!rel || seen.has(rel)) {
      return;
    }
    seen.add(rel);
    ordered.push(rel);
  };

  push(vscode.window.activeTextEditor?.document.uri);

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input as { uri?: vscode.Uri } | undefined;
      push(input?.uri);
    }
  }

  for (const doc of vscode.workspace.textDocuments) {
    push(doc.uri);
  }

  return ordered;
}

/**
 * Быстрый поиск файлов workspace для @-меню.
 */
export async function searchWorkspaceFiles(
  query: string,
  limit = 12
): Promise<FileMentionCandidate[]> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return [];
  }

  const q = String(query || "")
    .trim()
    .replace(/^@/, "");
  const openPaths = collectOpenPaths();
  const byPath = new Map<string, FileMentionCandidate>();

  for (const rel of openPaths) {
    byPath.set(rel, { path: rel, name: path.basename(rel) });
  }

  try {
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, "**/*"),
      SEARCH_EXCLUDE,
      2500
    );
    for (const uri of uris) {
      const rel = workspaceRelativePath(uri);
      if (!rel || byPath.has(rel)) {
        continue;
      }
      byPath.set(rel, { path: rel, name: path.basename(rel) });
    }
  } catch {
    // ignore findFiles errors
  }

  const all = [...byPath.values()];
  if (!q) {
    const openSet = new Set(openPaths);
    const open = all.filter((c) => openSet.has(c.path));
    const rest = all.filter((c) => !openSet.has(c.path));
    return [...open, ...rest].slice(0, limit);
  }

  return all
    .map((c) => ({ c, score: scorePath(c.path, q) }))
    .filter((x) => x.score >= 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.c.path.length - b.c.path.length ||
        a.c.path.localeCompare(b.c.path)
    )
    .slice(0, limit)
    .map((x) => x.c);
}
