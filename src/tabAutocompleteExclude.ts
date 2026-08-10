/**
 * Glob-based path filters for Tab autocomplete (exclude dist/generated/…).
 * Tiny matcher — no extra dependency (supports `*`, `**`, `?`).
 */

/** Defaults when the setting is missing / not an array. */
export const DEFAULT_TAB_EXCLUDE_GLOBS: readonly string[] = [
  "**/dist/**",
  "**/out/**",
  "**/build/**",
  "**/node_modules/**",
  "**/*.min.js",
  "**/*generated*",
];

/**
 * Convert a single glob to a anchored RegExp (forward-slash paths, case-insensitive).
 */
export function globToRegExp(glob: string): RegExp | undefined {
  const g = String(glob || "")
    .trim()
    .replace(/\\/g, "/");
  if (!g) {
    return undefined;
  }

  let re = "";
  let i = 0;
  while (i < g.length) {
    if (g[i] === "*" && g[i + 1] === "*") {
      if (g[i + 2] === "/") {
        // `**/` — zero or more path segments including trailing slash
        re += "(?:.*/)?";
        i += 3;
      } else {
        re += ".*";
        i += 2;
      }
      continue;
    }
    if (g[i] === "*") {
      re += "[^/]*";
      i += 1;
      continue;
    }
    if (g[i] === "?") {
      re += "[^/]";
      i += 1;
      continue;
    }
    const c = g[i];
    if (/[.+^${}()|[\]\\]/.test(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
    i += 1;
  }

  try {
    return new RegExp(`^${re}$`, "i");
  } catch {
    return undefined;
  }
}

/** Normalize setting value; empty array means “no exclude globs”. */
export function normalizeExcludeGlobs(raw: unknown): string[] {
  if (raw === undefined || raw === null) {
    return [...DEFAULT_TAB_EXCLUDE_GLOBS];
  }
  if (!Array.isArray(raw)) {
    return [...DEFAULT_TAB_EXCLUDE_GLOBS];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const s = String(item || "").trim();
    if (!s || seen.has(s)) {
      continue;
    }
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * True when `filePath` (absolute or relative) matches any exclude glob.
 * Also checks workspace-relative form and basename-only patterns.
 */
export function pathMatchesAnyExcludeGlob(
  filePath: string,
  globs: readonly string[],
  workspaceRelative?: string
): boolean {
  if (!globs.length) {
    return false;
  }

  const abs = String(filePath || "").replace(/\\/g, "/");
  const rel = String(workspaceRelative || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  const base = abs.split("/").pop() || "";

  const candidates = new Set<string>();
  if (abs) {
    candidates.add(abs);
    // Strip drive letter for glob convenience on Windows-style abs paths.
    candidates.add(abs.replace(/^[A-Za-z]:/, ""));
  }
  if (rel) {
    candidates.add(rel);
  }
  if (base) {
    candidates.add(base);
  }

  for (const glob of globs) {
    const rx = globToRegExp(glob);
    if (!rx) {
      continue;
    }
    for (const candidate of candidates) {
      if (rx.test(candidate)) {
        return true;
      }
    }
    // Patterns without `/` also match if any path segment equals the pattern.
    if (!glob.includes("/") && !glob.includes("*") && !glob.includes("?")) {
      const needle = glob.toLowerCase();
      for (const candidate of candidates) {
        if (
          candidate
            .split("/")
            .some((seg) => seg.toLowerCase() === needle)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}
