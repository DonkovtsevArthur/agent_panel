/**
 * Plan → Agent (Build) handoff helpers for the Harbor UI.
 * Live Plan.md / card display / Build payload only — no main-like explore brain.
 */

/** Stable marker prepended by the Build button (language-independent). */
export const PLAN_IMPLEMENT_MARKER = "[[harbor:implement_plan]]";

export const PLAN_IMPLEMENT_PREFIX_EN = "Implement the following plan:";
export const PLAN_IMPLEMENT_PREFIX_RU = "Реализуй следующий план:";

/**
 * Appended to the system prompt in Harbor Plan mode so Cline wraps the finale
 * for the proposed-plan card (Build / Plan.md).
 */
export const HARBOR_PLAN_MODE_CARD_HINT = [
  "Harbor Plan UI: when you deliver an implementation plan (not a short Q&A answer), wrap the ENTIRE final plan in exactly one block:",
  "<proposed_plan>",
  "…markdown plan…",
  "</proposed_plan>",
  "Use those tags with no attributes. Put Goal/Steps/Affected files (or the equivalent) inside the block.",
  "If you finish with submit_and_exit, put that same <proposed_plan>…</proposed_plan> block in the summary field — Harbor shows the Plan card from that summary.",
  "Do not write PLAN.md via tools. Do not put clarifying questions inside <proposed_plan>.",
  "Short factual answers to code questions (no implementation plan) stay outside the tags as plain text.",
].join(" ");

const PROPOSED_PLAN_RE =
  /(?:<proposed_plan>|&lt;proposed_plan&gt;)\s*[\s\S]*?(?:<\/proposed_plan>|&lt;\/proposed_plan&gt;)/i;

const PROPOSED_PLAN_OPEN_RE =
  /(?:<proposed_plan>|&lt;proposed_plan&gt;)/i;

/** Editable live-plan filename under extension storage (not workspace PLAN.md). */
export function planMarkdownFileName(lang?: "en" | "ru"): string {
  return lang === "ru" ? "План.md" : "Plan.md";
}

export function hasProposedPlanTags(text: string): boolean {
  const value = String(text || "");
  return PROPOSED_PLAN_RE.test(value) || PROPOSED_PLAN_OPEN_RE.test(value);
}

/**
 * Heuristic: finale looks like an implementation plan (even without tags).
 * Used so Agent-mode Figma/plan answers still get the Plan card / Build chip.
 *
 * Note: do NOT use JS `\b` around Cyrillic — in JavaScript word boundaries are
 * ASCII-only ([A-Za-z0-9_]), so `\bЦель` / `план\b` never match.
 */
export function looksLikeImplementationPlan(text: string): boolean {
  const value = String(text || "").trim();
  if (value.length < 120) {
    return false;
  }
  if (hasProposedPlanTags(value)) {
    return true;
  }
  const hasGoal =
    /(?:^|\n)\s*#{0,3}[^\n]{0,40}(?:\*\*)?(?:Goal|Цель)(?:\*\*)?(?:\s|:|$)/im.test(
      value
    );
  const hasSteps =
    /(?:^|\n)\s*#{0,3}[^\n]{0,40}(?:\*\*)?(?:Steps|Шаги|Implementation|Чек-?лист)(?:\*\*)?(?:\s|:|$)/im.test(
      value
    );
  if (hasGoal && hasSteps) {
    return true;
  }
  // Common free-form plan headings from models that ignore Harbor tags.
  if (
    /(?:План\s+реализации|Implementation\s+plan|Составлю\s+план)/i.test(
      value
    ) &&
    value.length >= 400
  ) {
    return true;
  }
  return false;
}

/**
 * If the model forgot <proposed_plan> tags, wrap the whole finale so the Harbor
 * plan card / Build chip still appear. No-op when tags already exist or empty.
 */
export function ensureProposedPlanWrapper(text: string): string {
  const value = String(text || "").trim();
  if (!value) {
    return "";
  }
  if (hasProposedPlanTags(value)) {
    return value;
  }
  // Tiny replies (acks / one-liners) are not plans.
  if (value.length < 80) {
    return value;
  }
  return `<proposed_plan>\n${value}\n</proposed_plan>`;
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
