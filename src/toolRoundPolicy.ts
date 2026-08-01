/**
 * Политика раундов tools (main-like loop):
 * 1) автопродление бюджета, если ход продуктивный и лимит кончился;
 * 2) soft-nudge после серии только explore (list/read);
 * 3) hard-cut — дальше без explore, только write или финальный ответ.
 *
 * Kimi: soft позже (успеть прочитать 1–2 аналога), но soft уже снимает
 * list/read — иначе gateway падает на раздутом tool-контексте.
 */

export const EXPLORE_ONLY_TOOLS = new Set(["list_files", "read_file"]);

/**
 * В readonly (Plan/Ask) delegate_task форсируется в ask-под-агент — это
 * тоже исследование, поэтому раунд с delegate_task должен двигать
 * explore-streak наравне с list/read. В Agent mode delegate_task может
 * делать правки — там он productive и streak не двигает.
 */
export const DELEGATE_TASK_TOOL = "delegate_task";

/** После стольких explore-only раундов подряд — soft nudge. */
export const EXPLORE_SOFT_NUDGE_ROUNDS = 2;

/** После стольких — hard-cut explore. */
export const EXPLORE_HARD_CUT_ROUNDS = 4;

/** Kimi: soft-nudge позже — успеть прочитать соседние файлы. */
export const KIMI_EXPLORE_SOFT_NUDGE_ROUNDS = 4;

/** Kimi: hard-cut (после soft без explore). */
export const KIMI_EXPLORE_HARD_CUT_ROUNDS = 6;

/** Сколько раз можно продлить бюджет раундов. */
export const MAX_ROUND_EXTENSIONS = 1;

/** На сколько раундов продлеваем за раз. */
export const ROUND_EXTENSION_SIZE = 8;

export type ExploreRoundLimits = {
  softNudgeRounds: number;
  hardCutRounds: number;
  /** Soft-nudge снимает list/read из tool list. */
  stripExploreOnSoftNudge: boolean;
};

export function exploreRoundLimits(options: {
  kimi: boolean;
  /** Build → Agent: меньше explore, быстрее к правкам по плану. */
  implementPlan?: boolean;
}): ExploreRoundLimits {
  // Implement-from-plan: plan already named files/components — do not spend
  // Kimi's long explore budget re-browsing analogous pages.
  if (options.implementPlan) {
    return {
      softNudgeRounds: EXPLORE_SOFT_NUDGE_ROUNDS,
      hardCutRounds: EXPLORE_HARD_CUT_ROUNDS,
      stripExploreOnSoftNudge: true,
    };
  }
  if (options.kimi) {
    return {
      softNudgeRounds: KIMI_EXPLORE_SOFT_NUDGE_ROUNDS,
      hardCutRounds: KIMI_EXPLORE_HARD_CUT_ROUNDS,
      stripExploreOnSoftNudge: true,
    };
  }
  return {
    softNudgeRounds: EXPLORE_SOFT_NUDGE_ROUNDS,
    hardCutRounds: EXPLORE_HARD_CUT_ROUNDS,
    stripExploreOnSoftNudge: true,
  };
}

/** Kimi-only: follow AGENTS.md by reading analogous UI before inventing. */
export function buildKimiWorkspaceFollowHint(): string {
  return [
    "Workspace rules follow-through (required for this model):",
    "Obey injected Workspace rules (AGENTS.md / .cursor/rules).",
    "Before creating a new page, screen, or UI component: list_files in the relevant folder and read_file 1–2 similar existing files in the same tool round (parallel reads); match their structure, imports, styling, and shared primitives.",
    "Do not invent a one-off layout and rewrite it later to look similar — start from the existing pattern.",
    "If the user asks to do it by analogy / like other pages, that is mandatory: open the reference files with tools before write_file.",
  ].join(" ");
}

export function isExploreOnlyTool(name: string): boolean {
  return EXPLORE_ONLY_TOOLS.has(String(name || ""));
}

export function roundWasExploreOnly(
  toolNames: Array<string | undefined>
): boolean {
  const names = toolNames.map((n) => String(n || "")).filter(Boolean);
  return names.length > 0 && names.every((n) => isExploreOnlyTool(n));
}

/**
 * Двигает ли раунд explore-streak. В readonly delegate_task = исследование
 * (под-агент ask), поэтому раунд только из explore + delegate_task тоже
 * считается explore-only для лимитов. В Agent delegate_task может править
 * — там он productive и streak не двигает.
 */
export function roundAdvancesExploreStreak(
  toolNames: Array<string | undefined>,
  readonly: boolean
): boolean {
  const names = toolNames.map((n) => String(n || "")).filter(Boolean);
  if (names.length === 0) {
    return false;
  }
  if (names.every((n) => isExploreOnlyTool(n))) {
    return true;
  }
  if (
    readonly &&
    names.every(
      (n) => isExploreOnlyTool(n) || n === DELEGATE_TASK_TOOL
    )
  ) {
    return true;
  }
  return false;
}

/** Утилита для strip-логики: убираем explore-инструменты (+ delegate в readonly). */
export function isExploreOrDelegatedTool(
  name: string,
  readonly: boolean
): boolean {
  if (isExploreOnlyTool(name)) {
    return true;
  }
  return readonly && name === DELEGATE_TASK_TOOL;
}

export function shouldExtendToolRounds(options: {
  extensionsUsed: number;
  hadProductiveTool: boolean;
  answered: boolean;
  /** readonly (Plan/Ask): delegate_task/request_user_input ok — тоже повод продлить. */
  readonlyProductive?: boolean;
}): boolean {
  if (options.answered) {
    return false;
  }
  if (options.extensionsUsed >= MAX_ROUND_EXTENSIONS) {
    return false;
  }
  return Boolean(options.hadProductiveTool || options.readonlyProductive);
}

export function buildExploreSoftNudge(options: {
  agentsMd: boolean;
  readonly: boolean;
  plan?: boolean;
  kimi?: boolean;
  /** Build → Agent: правь по плану, не ищи «лучший» аналог. */
  implementPlan?: boolean;
}): string {
  if (options.readonly) {
    if (options.plan) {
      return [
        "Stop exploring the repository.",
        "You already have enough context from the tools above.",
        "Do not call list_files or read_file again.",
        "Now write the final plan: wrap it in a <proposed_plan>…</proposed_plan> block with Goal, Steps, Affected files, and Risks. Do not answer in prose — the plan is the deliverable.",
      ].join(" ");
    }
    return [
      "Stop exploring the repository.",
      "You already have enough context from the tools above.",
      "Do not call list_files or read_file again.",
      "Reply to the user now with a concise answer based on what you already gathered.",
    ].join(" ");
  }
  if (options.agentsMd) {
    return [
      "Stop exploring the repository.",
      "You already have enough context (package.json / README / src listing is enough).",
      "Do not call list_files or read_file again.",
      "Immediately call write_file for AGENTS.md (create or update), then briefly confirm in chat what you wrote.",
    ].join(" ");
  }
  if (options.implementPlan) {
    return [
      "Stop exploring the repository.",
      "list_files and read_file are no longer available this turn.",
      "You should already have read the planned/target files — now search_replace (preferred) or write_file with COMPLETE contents on those paths.",
      "Match the project patterns from the files you read. Do not invent a substitute component. Never wipe a file with empty/truncated content. List any remaining steps.",
    ].join(" ");
  }
  if (options.kimi) {
    return [
      "Stop exploring the repository.",
      "list_files and read_file are no longer available this turn.",
      "Call write_file now matching the analogous files you already read (same structure, imports, styling, shared UI).",
      "Do not invent a layout from scratch. If no edits are needed, reply briefly.",
    ].join(" ");
  }
  return [
    "Stop exploring the repository.",
    "You already have enough context from the tools above.",
    "Do not call list_files or read_file again.",
    "If you need to change files, call write_file now; otherwise reply briefly to the user.",
  ].join(" ");
}

export function buildExploreHardNudge(options: {
  agentsMd: boolean;
  readonly: boolean;
  plan?: boolean;
  implementPlan?: boolean;
}): string {
  if (options.readonly) {
    if (options.plan) {
      return [
        "Exploration limit reached.",
        "list_files and read_file are no longer allowed this turn.",
        "Write the final plan now: wrap it in a <proposed_plan>…</proposed_plan> block with Goal, Steps, Affected files, and Risks, based only on the information already gathered. Do not call tools and do not answer in prose.",
      ].join(" ");
    }
    return [
      "Exploration limit reached.",
      "list_files and read_file are no longer allowed this turn.",
      "Answer the user now using only the information already gathered. Do not call tools.",
    ].join(" ");
  }
  if (options.agentsMd) {
    return [
      "Exploration limit reached.",
      "list_files and read_file are no longer allowed this turn.",
      "Call write_file for AGENTS.md now (short guide), then confirm briefly. No more reading.",
    ].join(" ");
  }
  if (options.implementPlan) {
    return [
      "Exploration limit reached.",
      "list_files and read_file are no longer allowed this turn.",
      "Call search_replace (preferred) or write_file with COMPLETE contents for the remaining plan/correction steps on the named paths. Match project patterns. Do not invent substitutes or wipe files. No more reading.",
    ].join(" ");
  }
  return [
    "Exploration limit reached.",
    "list_files and read_file are no longer allowed this turn.",
    "Call write_file if edits are still needed; otherwise reply to the user. No more reading.",
  ].join(" ");
}
