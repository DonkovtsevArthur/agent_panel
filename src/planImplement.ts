/**
 * Plan → Agent (Build) handoff + post-implement corrections:
 * bind the model to the approved plan and to how the project already writes code.
 */

/** Stable marker prepended by the Build button (language-independent). */
export const PLAN_IMPLEMENT_MARKER = "[[harbor:implement_plan]]";

export const PLAN_IMPLEMENT_PREFIX_EN = "Implement the following plan:";
export const PLAN_IMPLEMENT_PREFIX_RU = "Реализуй следующий план:";

/**
 * Strip the Build handoff wrapper (marker + localized implement prefix) so
 * plan cards / Plan.md / chat display show only the plan markdown.
 * Does not change the payload sent to the model.
 */
export function stripPlanImplementWrapper(text: string): string {
  let value = String(text || "")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!value) {
    return "";
  }
  // Marker may sit on its own first line or be glued to the prefix.
  value = value.replace(/\[\[harbor:implement_plan\]\]\s*/gi, "");
  value = value.replace(
    /^(?:Implement the following plan(?:\s+exactly)?[^\n]*|Реализуй следующий план(?:\s+точно)?[^\n]*)\s*/i,
    ""
  );
  return value.trim();
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
    "- Implement every Step in order; treat Acceptance criteria as the definition of done for each step when present.",
    "- If the turn budget ends mid-plan, list completed vs remaining Steps explicitly — do not silently stop after a partial subset.",
    "- Use the components, widgets, shared primitives, and file paths named in the plan (reuse paths and new-by-pattern references). Do NOT invent a parallel component or replace a named existing one with a new one-off.",
    "- If the plan includes an **Implementation** section (props/imports/types/signatures/snippets), treat it as the contract for HOW to call the named components and shape data — build against those exact props and types. Do not re-decide them. You still must read_file the target file before editing to match its current structure, imports, and surrounding code.",
    "- Do not rewrite the architecture or re-plan. Choosing a different UI kit/component than the plan is not allowed.",
    "HOW to write code must come from the project:",
    "- Before write_file / search_replace on an existing path: read_file that file (and its direct imports / 1 sibling in the same feature if needed).",
    "- Match that file's structure, imports, styling, and shared primitives — plan names the target; the repo shows the pattern.",
    "- Do not browse unrelated pages to redesign. Analogues only from the plan paths / same module.",
    "- Prefer search_replace for existing files; write_file only to create a new file or a true full rewrite with COMPLETE contents (never empty or truncated).",
    "- After edits, briefly report done vs remaining plan steps against the plan checklist.",
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

function normalizePlanPath(path: string): string {
  return String(path || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^[`'"]+|[`'"]+$/g, "")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

const PLAN_FILE_PATH_RE =
  /(?:^|[\s,;`'"(])((?:src\/|\.\/|app\/|pages\/|shared\/|entities\/|features\/|widgets\/|media\/|tests\/)?[\w.-]+(?:\/[\w.-]+)+\.\w{1,8})\b/g;

function collectPathTokens(chunk: string, into: Set<string>): void {
  const text = String(chunk || "");
  PLAN_FILE_PATH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLAN_FILE_PATH_RE.exec(text))) {
    const path = normalizePlanPath(match[1]);
    if (path.length >= 6) {
      into.add(path);
    }
  }
}

/**
 * Explicit deliverable paths from a Build plan: **Affected files** /
 * **Затрагиваемые файлы**, plus reuse/create targets in Steps.
 * Skips bare «по паттерну / by pattern» analogues without a create path.
 */
export function extractPlanTargetPaths(planText: string): string[] {
  const value = stripPlanImplementWrapper(planText);
  if (!value) {
    return [];
  }
  const paths = new Set<string>();

  const affected = value.match(
    /\*\*(?:Затрагиваемые файлы|Affected files)\*\*\s*:?\s*([^\n*]+(?:\n(?!\*\*)[^\n]+)*)/i
  );
  if (affected?.[1]) {
    collectPathTokens(affected[1], paths);
  }

  // Explicit reuse / create targets in the plan body (not «by pattern of X» alone).
  const reuseOrCreate =
    /(?:reuse|созда[йть](?:\s+файл)?|create(?:\s+file)?|new(?:\s+file)?|новый(?:\s+файл)?|новая|новое)\s*[:=]?\s*[`'"]?((?:src\/|\.\/|app\/|pages\/|shared\/|entities\/|features\/|widgets\/)[\w./-]+\.\w{1,8})/gi;
  let match: RegExpExecArray | null;
  while ((match = reuseOrCreate.exec(value))) {
    const path = normalizePlanPath(match[1]);
    if (path.length >= 6) {
      paths.add(path);
    }
  }

  // Numbered Steps: keep grounded paths that are deliverables, skip pure
  // analogue citations («по паттерну / by pattern of <path>» only).
  const stepChunks = value.split(/(?:^|\n)\s*(?=\d+\.\s+)/);
  const groundedInStep =
    /(?:^|[\s`'"(—–-])((?:src\/|\.\/|app\/|pages\/|shared\/|entities\/|features\/|widgets\/)[\w./-]+\.\w{1,8})\b/gi;
  const analogueOnly =
    /(?:по\s+паттерну|by\s+pattern(?:\s+of)?)\s*[`«"']?((?:src\/|\.\/|app\/|pages\/|shared\/|entities\/|features\/|widgets\/)[\w./-]+\.\w{1,8})/gi;
  for (const chunk of stepChunks) {
    const step = chunk.trim();
    if (!/^\d+\.\s+\S/.test(step)) {
      continue;
    }
    const analogue = new Set<string>();
    analogueOnly.lastIndex = 0;
    while ((match = analogueOnly.exec(step))) {
      analogue.add(normalizePlanPath(match[1]));
    }
    groundedInStep.lastIndex = 0;
    while ((match = groundedInStep.exec(step))) {
      const path = normalizePlanPath(match[1]);
      if (path.length < 6 || analogue.has(path)) {
        continue;
      }
      paths.add(path);
    }
  }

  return [...paths];
}

function pathCoveredByEdits(
  target: string,
  editedPaths: readonly string[]
): boolean {
  const want = normalizePlanPath(target).toLowerCase();
  if (!want) {
    return false;
  }
  for (const edited of editedPaths) {
    const have = normalizePlanPath(edited).toLowerCase();
    if (!have) {
      continue;
    }
    if (
      have === want ||
      have.endsWith(`/${want}`) ||
      want.endsWith(`/${have}`)
    ) {
      return true;
    }
  }
  return false;
}

/** Plan paths not yet touched by successful edits this turn. */
export function remainingPlanTargetPaths(
  planText: string,
  editedPaths: readonly string[]
): string[] {
  return extractPlanTargetPaths(planText).filter(
    (path) => !pathCoveredByEdits(path, editedPaths)
  );
}

export function buildPlanChecklistNudge(remainingPaths: string[]): string {
  const listed = remainingPaths
    .slice(0, 8)
    .map((path) => `- ${path}`)
    .join("\n");
  const more =
    remainingPaths.length > 8
      ? `\n…and ${remainingPaths.length - 8} more`
      : "";
  return [
    "Plan checklist incomplete: these explicit plan paths were not edited this turn yet:",
    listed + more,
    "Continue with search_replace (preferred) or write_file on the remaining paths.",
    "Do not claim the plan is fully done until those steps are applied (or explain honestly why a path is blocked).",
  ].join("\n");
}
