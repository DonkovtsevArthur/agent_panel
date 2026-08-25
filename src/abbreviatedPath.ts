/**
 * Model-abbreviated paths (`root/.../lib/foo.ts`, `…/lib/foo.ts`): chat models
 * sometimes shorten the middle of a path with a literal ellipsis segment. Such
 * a link cannot be opened as-is — hosts use the suffix after the ellipsis to
 * resolve the real file by workspace search. Pure module: no vscode imports.
 */

/** A path segment made only of dots (3+) or typographic ellipses (`…`). */
export function isEllipsisSegment(segment: string): boolean {
  let dots = 0;
  let ellipses = 0;
  for (const ch of String(segment || "")) {
    if (ch === ".") {
      dots += 1;
    } else if (ch === "…") {
      ellipses += 1;
    } else {
      return false;
    }
  }
  return dots >= 3 || ellipses >= 1;
}

/** Sentence punctuation that chat models glue onto the end of a path. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

/** `…see foo.ts.` → `…see foo.ts` — trailing punctuation is never part of a file name here. */
export function trimTrailingPathPunctuation(rawPath: string): string {
  return String(rawPath || "").replace(TRAILING_PUNCTUATION, "");
}

/**
 * Suffix after the last ellipsis segment of an abbreviated path
 * (`root/.../lib/foo.ts` → `lib/foo.ts`); undefined when the path is not
 * abbreviated. `..` parent segments are real paths and never match.
 */
export function abbreviatedPathSuffix(rawPath: string): string | undefined {
  const parts = String(rawPath || "")
    .replace(/\\/g, "/")
    .split("/");
  let index = -1;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (isEllipsisSegment(parts[i])) {
      index = i;
      break;
    }
  }
  if (index < 0 || index === parts.length - 1) {
    return undefined;
  }
  const suffix = trimTrailingPathPunctuation(
    parts.slice(index + 1).join("/")
  ).trim();
  return suffix || undefined;
}

/** Escape glob metacharacters so a literal file name survives findFiles. */
export function escapeGlobPattern(value: string): string {
  return String(value || "").replace(/[*?{}[\]!()|^$\\]/g, (ch) => `\\${ch}`);
}
