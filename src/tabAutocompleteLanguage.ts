/**
 * Per-language Tab prompt nudges + debounce / token tweaks.
 */

export function languageFamily(
  languageId: string | undefined
): "typescript" | "javascript" | "python" | "go" | "other" {
  const lang = String(languageId || "").toLowerCase();
  if (
    lang === "typescript" ||
    lang === "typescriptreact" ||
    lang === "tsx"
  ) {
    return "typescript";
  }
  if (
    lang === "javascript" ||
    lang === "javascriptreact" ||
    lang === "jsx"
  ) {
    return "javascript";
  }
  if (lang === "python") {
    return "python";
  }
  if (lang === "go") {
    return "go";
  }
  return "other";
}

/** Extra TASK nudge appended to the hole-fill user prompt. */
export function languageFillNudge(languageId: string | undefined): string {
  const family = languageFamily(languageId);
  switch (family) {
    case "typescript":
      return " Language: TypeScript — prefer typed identifiers, narrow fills, Effector/React idioms only when already present nearby.";
    case "javascript":
      return " Language: JavaScript — modern ESM/const, no TypeScript-only syntax unless the file already uses it.";
    case "python":
      return " Language: Python — respect indentation, prefer snake_case, no braces/semicolons, idiomatic comprehensions only when natural.";
    case "go":
      return " Language: Go — idiomatic short names, handle err when nearby code does, no TypeScript/JS syntax.";
    default:
      return "";
  }
}

/**
 * Scale debounce for language (Python/Go slightly slower — denser structure).
 * Base ms comes from aggressiveness.
 */
export function languageDebounceScale(languageId: string | undefined): number {
  const family = languageFamily(languageId);
  if (family === "python" || family === "go") {
    return 1.25;
  }
  if (family === "typescript" || family === "javascript") {
    return 1;
  }
  return 1.1;
}

/** Adjust max_tokens for language (TS mid-line can be short; Python a bit longer). */
export function languageMaxTokens(
  languageId: string | undefined,
  baseTokens: number
): number {
  const family = languageFamily(languageId);
  let n = baseTokens;
  if (family === "python") {
    n = Math.round(baseTokens * 1.15);
  } else if (family === "go") {
    n = Math.round(baseTokens * 1.1);
  } else if (family === "typescript" || family === "javascript") {
    n = baseTokens;
  }
  return Math.max(24, Math.min(140, n));
}
