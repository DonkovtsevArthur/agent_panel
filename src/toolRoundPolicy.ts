/**
 * Политика раундов tools (main-like loop):
 * 1) автопродление бюджета, если ход продуктивный и лимит кончился;
 * 2) soft-nudge после серии только explore (list/read);
 * 3) hard-cut — дальше без explore, только write или финальный ответ.
 *
 * Agent (все модели): soft позже (успеть прочитать 1–2 аналога), soft
 * снимает list/read — иначе gateway/контекст раздувается. Build→Agent
 * (implementPlan) — более жёсткий бюджет.
 */

export const EXPLORE_ONLY_TOOLS = new Set([
  "list_files",
  "read_file",
  "search_text",
]);

/**
 * В readonly (Plan/Ask) delegate_task форсируется в ask-под-агент — это
 * тоже исследование, поэтому раунд с delegate_task должен двигать
 * explore-streak наравне с list/read. В Agent mode delegate_task может
 * делать правки — там он productive и streak не двигает.
 */
export const DELEGATE_TASK_TOOL = "delegate_task";

/** Agent: soft-nudge после стольких explore-only раундов (все модели). */
export const EXPLORE_SOFT_NUDGE_ROUNDS = 4;

/** Agent: hard-cut explore (все модели). */
export const EXPLORE_HARD_CUT_ROUNDS = 6;

/** Build→Agent: tighter explore — plan already named files. */
export const IMPLEMENT_EXPLORE_SOFT_NUDGE_ROUNDS = 2;

/** Build→Agent: hard-cut explore. */
export const IMPLEMENT_EXPLORE_HARD_CUT_ROUNDS = 4;

/** Agent with @file / workspace path in the user message. */
export const FOCUSED_EXPLORE_SOFT_NUDGE_ROUNDS = 3;
export const FOCUSED_EXPLORE_HARD_CUT_ROUNDS = 5;

/** Agent cold-start «new page/screen» without named paths. */
export const COLD_PAGE_EXPLORE_SOFT_NUDGE_ROUNDS = 5;
export const COLD_PAGE_EXPLORE_HARD_CUT_ROUNDS = 7;

/** @deprecated alias — same as EXPLORE_SOFT_NUDGE_ROUNDS */
export const KIMI_EXPLORE_SOFT_NUDGE_ROUNDS = EXPLORE_SOFT_NUDGE_ROUNDS;

/** @deprecated alias — same as EXPLORE_HARD_CUT_ROUNDS */
export const KIMI_EXPLORE_HARD_CUT_ROUNDS = EXPLORE_HARD_CUT_ROUNDS;

/**
 * Plan quality-first: мягкие напоминания про grounding.
 * Hard-cut explore отключён — иначе обрывает незакрытые пункты
 * инвентаря (чеклист / блоки макета). Потолок = maxToolRounds + planQuality gate.
 * Same soft threshold for all models (was Kimi-only 8) — Claude needs the
 * extra grounding rounds too before «write the plan now».
 */
export const PLAN_QUALITY_SOFT_NUDGE_ROUNDS = 8;
/** @deprecated alias — same as PLAN_QUALITY_SOFT_NUDGE_ROUNDS */
export const PLAN_QUALITY_KIMI_SOFT_NUDGE_ROUNDS =
  PLAN_QUALITY_SOFT_NUDGE_ROUNDS;

/**
 * Plan revision (prior `<proposed_plan>` in chat): stop re-explore quickly and
 * emit a full replacement card from the last plan + user delta.
 */
export const PLAN_REVISION_SOFT_NUDGE_ROUNDS = 2;

/** Сколько раз можно продлить бюджет раундов. */
export const MAX_ROUND_EXTENSIONS = 1;

/** На сколько раундов продлеваем за раз. */
export const ROUND_EXTENSION_SIZE = 8;

export type ExploreRoundLimits = {
  softNudgeRounds: number;
  hardCutRounds: number;
  /** Soft-nudge снимает list/read из tool list. */
  stripExploreOnSoftNudge: boolean;
  /**
   * When false (Plan quality), never hard-cut / strip explore tools.
   * Soft reminders may repeat; incomplete-plan gate is the real stop.
   */
  hardCutExplore: boolean;
};

/** User message names a workspace path or @-file — tighter explore. */
export function userMessageHasFocusedPath(userText: string): boolean {
  const value = String(userText || "");
  if (!value.trim()) {
    return false;
  }
  if (/(?:^|[\s(])@[\w./\\-]+\.\w{1,8}\b/.test(value)) {
    return true;
  }
  if (
    /(?:^|[\s`"'(])(?:\.\/|src\/|app\/|pages\/|shared\/|entities\/|features\/|widgets\/|media\/|tests\/)[\w./\\-]+\.\w{1,8}\b/.test(
      value
    )
  ) {
    return true;
  }
  return false;
}

/** Cold-start new page/screen without focused paths. */
export function looksLikeColdPageExploreRequest(userText: string): boolean {
  const value = String(userText || "").trim();
  if (!value || userMessageHasFocusedPath(value)) {
    return false;
  }
  return /(?:новая|новую|новый|новое)\s+(?:страниц|экран|роуте?|page|screen)|(?:созда[йть]|добавь|сделай)\s+(?:страниц|экран|роуте?|page|screen)|(?:new|add|create)\s+(?:a\s+)?(?:page|screen|route)|(?:page|screen)\s+from\s+figma/i.test(
    value
  );
}

export type ExploreBudgetSignal = "implement" | "focused" | "cold_page" | "default";

export function classifyExploreBudgetSignal(options: {
  implementPlan?: boolean;
  userText?: string;
}): ExploreBudgetSignal {
  if (options.implementPlan) {
    return "implement";
  }
  const userText = String(options.userText || "");
  if (userMessageHasFocusedPath(userText)) {
    return "focused";
  }
  if (looksLikeColdPageExploreRequest(userText)) {
    return "cold_page";
  }
  return "default";
}

export function exploreRoundLimits(options: {
  kimi: boolean;
  /** Build → Agent: меньше explore, быстрее к правкам по плану. */
  implementPlan?: boolean;
  /**
   * Plan mode quality-first: per-item grounding before <proposed_plan>.
   * Soft reminders only — no hard-cut that would strand ungrounded items.
   */
  planQuality?: boolean;
  /**
   * Plan follow-up after a prior plan card: soft-strip explore soon so the
   * model revises the card instead of restarting Phase 1.
   */
  planRevision?: boolean;
  /** User message — adaptive Agent explore (focused path / cold page). */
  userText?: string;
}): ExploreRoundLimits {
  // Implement-from-plan: plan already named files/components — do not spend
  // the long explore budget re-browsing analogous pages.
  if (options.implementPlan) {
    return {
      softNudgeRounds: IMPLEMENT_EXPLORE_SOFT_NUDGE_ROUNDS,
      hardCutRounds: IMPLEMENT_EXPLORE_HARD_CUT_ROUNDS,
      stripExploreOnSoftNudge: true,
      hardCutExplore: true,
    };
  }
  if (options.planQuality && options.planRevision) {
    return {
      softNudgeRounds: PLAN_REVISION_SOFT_NUDGE_ROUNDS,
      // Soft-strip only — no hard-cut; quality gate still applies.
      hardCutRounds: Number.MAX_SAFE_INTEGER,
      stripExploreOnSoftNudge: true,
      hardCutExplore: false,
    };
  }
  if (options.planQuality) {
    return {
      softNudgeRounds: PLAN_QUALITY_SOFT_NUDGE_ROUNDS,
      // Unused while hardCutExplore is false — keep a large sentinel for tests.
      hardCutRounds: Number.MAX_SAFE_INTEGER,
      stripExploreOnSoftNudge: false,
      hardCutExplore: false,
    };
  }
  const signal = classifyExploreBudgetSignal({
    userText: options.userText,
  });
  if (signal === "focused") {
    return {
      softNudgeRounds: FOCUSED_EXPLORE_SOFT_NUDGE_ROUNDS,
      hardCutRounds: FOCUSED_EXPLORE_HARD_CUT_ROUNDS,
      stripExploreOnSoftNudge: true,
      hardCutExplore: true,
    };
  }
  if (signal === "cold_page") {
    return {
      softNudgeRounds: COLD_PAGE_EXPLORE_SOFT_NUDGE_ROUNDS,
      hardCutRounds: COLD_PAGE_EXPLORE_HARD_CUT_ROUNDS,
      stripExploreOnSoftNudge: true,
      hardCutExplore: true,
    };
  }
  // Agent default: same explore budget for all models (was Kimi-only 4/6).
  return {
    softNudgeRounds: EXPLORE_SOFT_NUDGE_ROUNDS,
    hardCutRounds: EXPLORE_HARD_CUT_ROUNDS,
    stripExploreOnSoftNudge: true,
    hardCutExplore: true,
  };
}

/** After hard-cut, allow search_text once the turn already edited files. */
export function hardCutAllowsSearchText(options: {
  readonly: boolean;
  hadProductiveTool: boolean;
  hadSuccessfulWrite?: boolean;
  impactNudgeAttempts?: number;
}): boolean {
  if (options.readonly) {
    return false;
  }
  return Boolean(
    options.hadProductiveTool ||
      options.hadSuccessfulWrite ||
      (options.impactNudgeAttempts ?? 0) > 0
  );
}

/** Agent: follow workspace rules by reading analogous UI before inventing. */
export function buildKimiWorkspaceFollowHint(): string {
  return [
    "Workspace rules follow-through (required):",
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
  /** Plan follow-up: stop re-explore, emit revised full card. */
  planRevision?: boolean;
}): string {
  if (options.readonly) {
    if (options.plan && options.planRevision) {
      return [
        "Stop re-exploring the repository.",
        "list_files, read_file, search_text, and delegate_task are no longer available this turn.",
        "A prior <proposed_plan> already exists — apply ONLY the user's latest delta and emit a FULL replacement <proposed_plan>…</proposed_plan> now.",
        "Keep grounded UI steps and observed quotes; remove/adjust Steps, Affected, Implementation, and Acceptance for the delta (e.g. drop backend/API scope).",
        "Do not restart Phase 1 or re-call Figma. Do not answer in prose — the revised plan card is the deliverable.",
      ].join(" ");
    }
    if (options.plan) {
      return [
        "Progress check (explore tools remain available — this is not a hard stop):",
        "If you already have a checklist of mockup blocks / user items, keep grounding any item that still lacks a verified workspace path (reuse or new-by-pattern of a path you read) via search_text / list_files / read_file / delegate_task.",
        "Do not drop remaining items because of round count.",
        "Only when every item is grounded, write the final <proposed_plan>…</proposed_plan> with Goal, Steps (1:1 with items, each naming a concrete path), Affected files, Acceptance, and Risks.",
        "Do not answer in prose — the plan is the deliverable. Do not invent paths you did not verify with tools.",
      ].join(" ");
    }
    return [
      "Stop exploring the repository.",
      "You already have enough context from the tools above.",
      "Do not call list_files, read_file, or search_text again.",
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
  // Agent (all models): write by analogy — same soft text that used to be Kimi-only.
  return [
    "Stop exploring the repository.",
    "list_files and read_file are no longer available this turn.",
    "Call write_file / search_replace now matching the analogous files you already read (same structure, imports, styling, shared UI).",
    "Do not invent a layout from scratch. If no edits are needed, reply briefly.",
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
        "list_files, read_file, and search_text are no longer allowed this turn.",
        "Write the final <proposed_plan>…</proposed_plan> now from what you already gathered: Goal, Steps (each with a concrete path you found — reuse or new-by-pattern), Affected files, Acceptance, Risks.",
        "If a critical path was never found, say so in Risks and use only verified paths. Do not invent files. Do not answer in prose outside the plan block.",
      ].join(" ");
    }
    return [
      "Exploration limit reached.",
      "list_files, read_file, and search_text are no longer allowed this turn.",
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
      "Call search_replace (preferred) or write_file with COMPLETE contents for the remaining plan/correction steps on the named paths. Match project patterns. Do not invent substitutes or wipe files.",
      "After edits, search_text remains available to check consumers of shared UI. No more list_files/read_file.",
    ].join(" ");
  }
  return [
    "Exploration limit reached.",
    "list_files and read_file are no longer allowed this turn.",
    "Call search_replace / write_file if edits are still needed; otherwise reply to the user.",
    "After edits, search_text remains available to check consumers of shared UI. No more list_files/read_file.",
  ].join(" ");
}
