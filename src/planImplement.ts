/**
 * Plan → Agent (Build) handoff helpers for the Harbor UI.
 * Live Plan.md / card display / Build payload only — no main-like explore brain.
 */

/** Stable marker prepended by the Build button (language-independent). */
export const PLAN_IMPLEMENT_MARKER = "[[harbor:implement_plan]]";

export const PLAN_IMPLEMENT_PREFIX_EN = "Implement the following plan:";
export const PLAN_IMPLEMENT_PREFIX_RU = "Реализуй следующий план:";

/** Editable live-plan filename under extension storage (not workspace PLAN.md). */
export function planMarkdownFileName(lang?: "en" | "ru"): string {
  return lang === "ru" ? "План.md" : "Plan.md";
}

/**
 * Strip the Build handoff wrapper (marker + localized implement prefix) so
 * plan cards / Plan.md / chat display show only the plan markdown.
 */
export function stripPlanImplementWrapper(text: string): string {
  let value = String(text || "")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!value) {
    return "";
  }
  value = value.replace(/\[\[harbor:implement_plan\]\]\s*/gi, "");
  value = value.replace(
    /^(?:Implement the following plan(?:\s+exactly)?[^\n]*|Реализуй следующий план(?:\s+точно)?[^\n]*)\s*/i,
    ""
  );
  return value.trim();
}

/** Build → Agent user payload from plan markdown body. */
export function buildPlanImplementUserText(
  planBody: string,
  prefix: string = PLAN_IMPLEMENT_PREFIX_EN
): string {
  const text = stripPlanImplementWrapper(planBody);
  if (!text) {
    return "";
  }
  const cleanPrefix = String(prefix || PLAN_IMPLEMENT_PREFIX_EN).trim();
  return `${PLAN_IMPLEMENT_MARKER}\n${cleanPrefix}\n\n${text}`;
}

/**
 * True when this user message is a Build handoff (or the same phrasing typed
 * manually with the standard prefix).
 */
export function looksLikePlanImplementRequest(text: string): boolean {
  const value = String(text || "").trim();
  if (!value) {
    return false;
  }
  if (value.includes(PLAN_IMPLEMENT_MARKER)) {
    return true;
  }
  if (/^Implement the following plan:\s*(?:\n|$)/i.test(value)) {
    return true;
  }
  if (/^Реализуй следующий план:\s*(?:\n|$)/i.test(value)) {
    return true;
  }
  if (
    /^Implement the following plan exactly\b/i.test(value) ||
    /^Реализуй следующий план точно\b/i.test(value)
  ) {
    return true;
  }
  return false;
}
