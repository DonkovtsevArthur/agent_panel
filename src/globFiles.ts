/**
 * Shared workspace glob helpers for context collectors (@db, @logs, …).
 * Pure fs/path — no vscode import; callers use workspace findFiles lazily
 * themselves when available.
 */
import * as fs from "fs";
import * as path from "path";

/** Directories never worth scanning for context files. */
export const SKIP_WALK_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "out",
  "build",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  ".next",
  ".turbo",
]);

export interface WorkspaceFileRef {
  abs: string;
  /** Path relative to the matched root (forward slashes). */
  rel: string;
}

/** Minimal glob → RegExp: `**` spans separators, `*`/`?` do not. */
export function globToRegExp(glob: string): RegExp {
  const prefix = glob.startsWith("/") ? "" : "/";
  let source = "";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        // `**/` and `**` — any path (greedy across separators).
        source += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
        i += glob[i + 2] === "/" ? 3 : 2;
      } else {
        source += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      source += "[^/]";
      i += 1;
    } else if ("\\^$.|+()[]{}".includes(ch)) {
      source += `\\${ch}`;
      i += 1;
    } else {
      source += ch;
      i += 1;
    }
  }
  return new RegExp(`^${prefix}${source}$`);
}

export function matchRelPath(relPath: string, globs: string[]): boolean {
  const rel = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return globs.some((g) => {
    try {
      return globToRegExp(g).test(`/${rel}`);
    } catch {
      return false;
    }
  });
}

export function relativeToRoots(roots: string[], filePath: string): string {
  for (const root of roots) {
    if (filePath.startsWith(root + path.sep)) {
      return path.relative(root, filePath);
    }
  }
  return filePath;
}

function* walkFiles(
  roots: string[],
  dir: string,
  depth: number,
  maxDepth: number
): Generator<WorkspaceFileRef> {
  if (depth > maxDepth) {
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_WALK_DIRS.has(entry.name)) {
        continue;
      }
      yield* walkFiles(roots, full, depth + 1, maxDepth);
    } else if (entry.isFile()) {
      yield { abs: full, rel: relativeToRoots(roots, full).replace(/\\/g, "/") };
    }
  }
}

export interface CollectFilesOptions {
  maxFiles?: number;
  maxDepth?: number;
}

/**
 * Collect workspace files matching the globs (fs walk; deterministic order:
 * first root wins for duplicate rel paths). Returns [] on any fs error.
 */
export function collectFilesByGlobs(
  roots: string[],
  globs: string[],
  options: CollectFilesOptions = {}
): WorkspaceFileRef[] {
  const maxFiles = options.maxFiles ?? 64;
  const maxDepth = options.maxDepth ?? 10;
  const normalizedRoots = roots
    .map((r) => String(r || "").trim())
    .filter(Boolean);
  if (!normalizedRoots.length || !globs.length) {
    return [];
  }
  const byRel = new Map<string, WorkspaceFileRef>();
  for (const root of normalizedRoots) {
    try {
      if (!fs.statSync(root).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    for (const ref of walkFiles(normalizedRoots, root, 0, maxDepth)) {
      if (!byRel.has(ref.rel) && matchRelPath(ref.rel, globs)) {
        byRel.set(ref.rel, ref);
        if (byRel.size >= maxFiles) {
          return [...byRel.values()];
        }
      }
    }
  }
  return [...byRel.values()];
}
