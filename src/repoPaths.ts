/**
 * Workspace/repo-relative path helpers (vscode-free — unit-tested).
 * Absolute paths must be stripped via cwd, not by deleting a leading `/`
 * (that turns `/Users/me/proj/a.ts` into `Users/me/proj/a.ts`, which git ignores).
 */

export function toRepoRelativePath(
  filePath: string,
  cwd?: string | null
): string {
  let p = String(filePath || "")
    .trim()
    .replace(/\\/g, "/");
  if (!p) {
    return "";
  }

  if (/^file:\/\//i.test(p)) {
    try {
      p = decodeURIComponent(p.replace(/^file:\/\//i, ""));
      // file:///Users/... on Unix → /Users/...; file:///C:/... → /C:/...
      if (/^\/[A-Za-z]:\//.test(p)) {
        p = p.slice(1);
      }
      p = p.replace(/\\/g, "/");
    } catch {
      return "";
    }
  }

  const root = String(cwd || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  if (root) {
    const fold =
      process.platform === "darwin" || process.platform === "win32"
        ? (s: string) => s.toLowerCase()
        : (s: string) => s;
    const pFold = fold(p);
    const rootFold = fold(root);
    if (pFold === rootFold) {
      return "";
    }
    if (pFold.startsWith(`${rootFold}/`)) {
      p = p.slice(root.length + 1);
    }
  }

  p = p.replace(/^\.\//, "");

  // Still absolute (cwd missing or mismatched) — cannot safely feed to git --path.
  if (p.startsWith("/") || /^[A-Za-z]:\//.test(p)) {
    return "";
  }

  return p.replace(/^\/+/, "");
}

export function toRepoRelativePaths(
  paths: Iterable<string>,
  cwd?: string | null
): string[] {
  return [
    ...new Set(
      [...paths].map((p) => toRepoRelativePath(p, cwd)).filter(Boolean)
    ),
  ];
}
