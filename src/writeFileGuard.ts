/**
 * Block catastrophic write_file rewrites (empty / truncated) over existing
 * non-empty files. Pure helper — unit-tested without vscode.
 */

/** Existing file must be at least this long before truncation guard applies. */
export const WRITE_TRUNCATE_MIN_BEFORE_CHARS = 400;

/**
 * New content shorter than this fraction of the previous file is treated as
 * a truncated rewrite (unless the new content is still reasonably large).
 */
export const WRITE_TRUNCATE_MAX_RATIO = 0.15;

/** Floor: never treat a rewrite as truncated if new content is at least this. */
export const WRITE_TRUNCATE_MIN_KEEP_CHARS = 80;

export interface WriteFileGuardOptions {
  /** File already existed on disk. */
  created: boolean;
  /** Previous file contents (empty string if created). */
  before: string;
  /** Proposed new contents. */
  content: string;
}

/**
 * Returns an error message for the model, or null if the write is allowed.
 */
export function validateWriteFileAgainstExisting(
  options: WriteFileGuardOptions
): string | null {
  if (options.created) {
    return null;
  }
  const before = String(options.before ?? "");
  const content = String(options.content ?? "");
  const beforeTrimmed = before.trim();
  if (!beforeTrimmed) {
    return null;
  }

  if (!content.trim()) {
    return [
      "Refused write_file: new content is empty, but the existing file is not.",
      "This would wipe the file. Prefer search_replace for a focused fix,",
      "or call write_file again with the FULL file contents.",
      "Do not claim you rewrote/fixed the file.",
    ].join(" ");
  }

  const beforeLen = before.length;
  const contentLen = content.length;
  if (beforeLen < WRITE_TRUNCATE_MIN_BEFORE_CHARS) {
    return null;
  }
  const minKeep = Math.max(
    WRITE_TRUNCATE_MIN_KEEP_CHARS,
    Math.floor(beforeLen * WRITE_TRUNCATE_MAX_RATIO)
  );
  if (contentLen < minKeep) {
    return [
      `Refused write_file: new content is drastically shorter (${contentLen} chars) than the existing file (${beforeLen} chars).`,
      "This looks like a truncated rewrite that would destroy most of the file.",
      "Prefer search_replace for the specific change, or rewrite with complete file contents.",
      "Do not claim you rewrote/fixed the file.",
    ].join(" ");
  }
  return null;
}

/** JSON tool error payload when the guard fires. */
export function writeFileGuardErrorJson(message: string): string {
  return JSON.stringify({
    ok: false,
    error: message,
    refused: "destructive_write",
  });
}
