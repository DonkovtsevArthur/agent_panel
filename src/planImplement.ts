/**
 * Plan → Agent (Build) handoff: detect implement-from-plan turns and bind
 * the model to the approved plan (components, paths, steps).
 */

/** Stable marker prepended by the Build button (language-independent). */
export const PLAN_IMPLEMENT_MARKER = "[[harbor:implement_plan]]";

export const PLAN_IMPLEMENT_PREFIX_EN = "Implement the following plan:";
export const PLAN_IMPLEMENT_PREFIX_RU = "Реализуй следующий план:";

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
  // Stronger Build prefixes that mention "exactly" / «как написано».
  if (
    /^Implement the following plan exactly\b/i.test(value) ||
    /^Реализуй следующий план точно\b/i.test(value)
  ) {
    return true;
  }
  return false;
}

/**
 * System contract for Agent mode after Build. Overrides the usual
 * “read analogous UI and invent by pattern” instinct.
 */
export function buildPlanImplementSystemHint(): string {
  return [
    "You are executing an approved plan from Plan mode (Build).",
    "The plan in the user message is a binding contract:",
    "- Implement every Step; if the turn budget ends mid-plan, say which steps remain — do not silently stop after a partial subset.",
    "- Use the components, widgets, shared primitives, and file paths named in the plan. Do NOT invent a parallel component or replace a named existing one with a new one-off.",
    "- Do not rewrite the architecture or re-plan. Micro-decisions (formatting, small naming inside a planned file) are OK; choosing a different UI kit/component than the plan is not.",
    "- Minimal research: read only files listed in Steps / Affected files (and their direct imports). Do not browse unrelated pages to redesign.",
    "- Prefer search_replace / write_file on the planned paths over broad exploration.",
    "- After edits, briefly report done vs remaining plan steps.",
  ].join(" ");
}
