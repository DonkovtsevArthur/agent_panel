/**
 * Plan → Agent (Build) handoff + post-implement corrections:
 * bind the model to the approved plan and to how the project already writes code.
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
  if (
    /^Implement the following plan exactly\b/i.test(value) ||
    /^Реализуй следующий план точно\b/i.test(value)
  ) {
    return true;
  }
  return false;
}

/**
 * Follow-up after Build / an earlier edit: user says the UI/table/component
 * was wrong or they mixed something up.
 */
export function looksLikeEditCorrectionRequest(text: string): boolean {
  const value = String(text || "").trim();
  if (!value || looksLikePlanImplementRequest(value)) {
    return false;
  }
  // Avoid matching huge paste-only messages with a stray word.
  if (value.length > 4_000) {
    return false;
  }
  return (
    /(?:таблиц\w*|колонк\w*|компонент\w*|экран\w*|страниц\w*|макет\w*|фигм\w*).{0,40}(?:не\s+та|не\s+тот|не\s+ту|не\s+те|неверн|не\s+правильн|перепутал|ошиб\w*|друг\w+)/i.test(
      value
    ) ||
    /(?:перепутал|ошибся|не\s+та\s+таблиц|не\s+тот\s+компонент|другая\s+таблиц|другой\s+компонент|не\s+тот\s+экран|переделай|перепиши)/i.test(
      value
    ) ||
    /(?:wrong|incorrect|not\s+the\s+right)\s+(?:table|columns?|component|screen|page|layout|figma)/i.test(
      value
    ) ||
    /(?:table|component|screen|page).{0,40}(?:wrong|incorrect|mixed\s+up)/i.test(
      value
    ) ||
    /(?:i\s+mixed\s+up|mixed\s+up\s+the|redo\s+the\s+(?:table|component|screen))/i.test(
      value
    )
  );
}

/**
 * System contract for Agent mode after Build.
 * Plan = what; repository files = how (style/imports/patterns).
 */
export function buildPlanImplementSystemHint(): string {
  return [
    "You are executing an approved plan from Plan mode (Build).",
    "The plan in the user message is a binding contract for WHAT to build:",
    "- Implement every Step; if the turn budget ends mid-plan, say which steps remain — do not silently stop after a partial subset.",
    "- Use the components, widgets, shared primitives, and file paths named in the plan. Do NOT invent a parallel component or replace a named existing one with a new one-off.",
    "- Do not rewrite the architecture or re-plan. Choosing a different UI kit/component than the plan is not allowed.",
    "HOW to write code must come from the project:",
    "- Before write_file / search_replace on an existing path: read_file that file (and its direct imports / 1 sibling in the same feature if needed).",
    "- Match that file's structure, imports, styling, and shared primitives — plan names the target; the repo shows the pattern.",
    "- Do not browse unrelated pages to redesign. Analogues only from the plan paths / same module.",
    "- Prefer search_replace for existing files; write_file only to create a new file or a true full rewrite with COMPLETE contents (never empty or truncated).",
    "- After edits, briefly report done vs remaining plan steps.",
  ].join(" ");
}

/**
 * System contract when the user corrects a previous UI/implementation choice.
 */
export function buildEditCorrectionSystemHint(): string {
  return [
    "The user is correcting a previous implementation (wrong table, columns, component, screen, or they mixed something up).",
    "Before any write_file / search_replace: read_file the current target file(s) you will change.",
    "Prefer search_replace for a focused fix. Do NOT full-rewrite with write_file unless creating a new file — and never write empty or drastically shorter content over a substantial file.",
    "Match existing project patterns in the file you edit (imports, shared UI, table API, FSD layout).",
    "If the task involved Figma: re-use vision-helper / Figma labels already in the conversation, or call get_screenshot again on the correct node — do not invent a different table from a random repo page.",
    "Keep the correction scoped: fix what the user named; do not redesign unrelated screens.",
  ].join(" ");
}
