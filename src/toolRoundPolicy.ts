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
/** After host OCR + screenshot explore probes — nudge to <proposed_plan> sooner. */
export const PLAN_SCREENSHOT_PREFLIGHT_SOFT_NUDGE_ROUNDS = 3;

/**
 * Plan revision (prior `<proposed_plan>` in chat): stop re-explore quickly and
 * emit a full replacement card from the last plan + user delta.
 */
export const PLAN_REVISION_SOFT_NUDGE_ROUNDS = 2;

/**
 * Plan mechanical soft-strip: small non-UI plans (version, config, focused
 * fix) — early strip so the LLM emits a compact <proposed_plan>.
 */
export const PLAN_MECHANICAL_SOFT_NUDGE_ROUNDS = 2;

/**
 * Agent mechanical fast lane: version / one-field / ≤2 files — cut explore
 * early and push search_replace (not UI/Figma/page work).
 */
export const AGENT_MECHANICAL_SOFT_NUDGE_ROUNDS = 1;
export const AGENT_MECHANICAL_HARD_CUT_ROUNDS = 3;

/**
 * System hint for Agent mechanical turns — skip analogue-UI ritual.
 */
export const AGENT_MECHANICAL_HINT =
  "Mechanical Agent task: small non-UI change (version bump, one config field, rename, focused fix — not a page/Figma/multi-file feature). " +
  "At most 1–2 read_file of the target path(s). Prefer search_replace immediately. " +
  "Do not browse analogous UI pages, shared components, or CHANGELOG unless asked. " +
  "Skip request_user_input when the target is clear. Finish briefly after the edit.";

/**
 * Agent stay-in-mode Q&A: question without an explicit edit request.
 * Tools are stripped to readonly for the turn; this hint reinforces answer-first.
 */
export const AGENT_QUESTION_HINT =
  "This user message is a question — no explicit request to edit code. " +
  "UI mode stays Agent, but for THIS turn answer like Ask: use list_files / read_file / search_text / fetch_url / MCP to gather facts, then answer the question directly. " +
  "Do NOT call write_file, search_replace, or run_command. " +
  "Do NOT dump an implementation checklist («Реализация завершена» / «Что сделано» / «Implementation complete») recycled from earlier turns — answer THIS question (e.g. where navigation comes from). " +
  "If the user later asks to change code, they will say so explicitly.";

/** Soft cap: longer briefs without trivial/file anchors stay on full Plan path. */
export const MECHANICAL_PLAN_MAX_CHARS = 280;

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

/** Count workspace-like file mentions (dir/file.ext or common root files). */
export function countPlanFileMentions(userText: string): number {
  const value = String(userText || "");
  if (!value.trim()) {
    return 0;
  }
  const found = new Set<string>();
  const grounded =
    /(?:^|[\s`"'(=[])((?:\.\/)?(?:[\w@.-]+\/)+[\w@.-]+\.[\w]{1,12})\b/gi;
  const root =
    /(?:^|[\s`"'(=[])((?:\.\/)?(?:package(?:-lock)?\.json|tsconfig\.json|README\.md|CHANGELOG\.md|\.env(?:\.[\w-]+)?))\b/gi;
  for (const re of [grounded, root]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(value)) !== null) {
      found.add(String(match[1] || "").replace(/^\.\//, "").toLowerCase());
    }
  }
  return found.size;
}

/**
 * Plan needs full Phase-1 grounding (UI / Figma / multi-item / architecture).
 * Inverted pair of {@link looksLikeMechanicalPlanRequest}.
 */
export function looksLikeComplexPlanRequest(userText: string): boolean {
  const value = String(userText || "").trim();
  if (!value) {
    return false;
  }
  if (/figma\.com/i.test(value)) {
    return true;
  }
  if (looksLikeColdPageExploreRequest(value)) {
    return true;
  }
  if (/(?:макет|mockup|design\s+system)/i.test(value)) {
    return true;
  }
  // Page/screen/component surface — unless the ask is clearly about version.
  const aboutVersionOnly =
    /(?:верси\w*|version|package\.json|semver|\bbump\b)/i.test(value) &&
    !/(?:страниц|экран|page|screen|компонент|component|макет)/i.test(value);
  if (
    !aboutVersionOnly &&
    /(?:страниц\w*|экран\w*|\bpages?\b|\bscreens?\b|роуте?\b|\broutes?\b)/i.test(
      value
    )
  ) {
    return true;
  }
  if (
    !aboutVersionOnly &&
    /(?:компонент\w*|\bcomponents?\b|shared\/ui|layout\w*)/i.test(value)
  ) {
    return true;
  }
  if (
    /(?:реализ|implement|спланир|план).{0,48}(?:страниц|экран|page|screen|компонент|component)/i.test(
      value
    )
  ) {
    return true;
  }
  const numbered = value.match(/(?:^|\n)\s*\d+[.)]\s+\S/g);
  if (numbered && numbered.length >= 3) {
    return true;
  }
  if (
    /(?:архитектур|спроектируй|миграци|\bschema\b|несколько\s+модул|multiple\s+modules|end[\s-]?to[\s-]?end|весь\s+модул|whole\s+module|большой\s+рефактор|large\s+refactor)/i.test(
      value
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Plan: small non-UI change — universal via inversion.
 * mechanical = (plan/change intent) AND NOT complex AND (trivial | ≤2 files | short).
 */
export function looksLikeMechanicalPlanRequest(userText: string): boolean {
  const value = String(userText || "").trim();
  if (!value) {
    return false;
  }
  const lower = value.toLowerCase().replace(/ё/g, "е");
  // Q&A — answer as Ask, do not force a short plan card.
  // Avoid `\b` after Cyrillic: JS word-chars are ASCII-only.
  if (
    /^(?:какая|какой|какое|какие|сколько)(?:\s|$|[?!.:,])/i.test(lower) ||
    /^(?:что\s+делает|где\s+)/i.test(lower) ||
    /^(?:why|what|which|how\s+does)\b/i.test(lower)
  ) {
    return false;
  }
  if (looksLikeComplexPlanRequest(value)) {
    return false;
  }

  const planIntent =
    /(?:план\w*|спланир\w*|\bplan\b|proposed_plan|распиши\s+шаг|что\s+нужно\s+сделать)/i.test(
      value
    );
  const changeIntent =
    /(?:поменя|смени|обнов|подним|постав|добав|убери|удал|исправ|переимен|rename|bump|change|update|set\b|fix\b|remove)/i.test(
      lower
    );
  const trivialKeywords =
    /(?:верси\w*|version|package\.json|package-lock|semver|\bbump\b|одно\s+поле|одно\s+значени|одну\s+строк|one\s+field|one\s+line|tsconfig|readme|changelog)/i.test(
      value
    );

  if (!planIntent && !changeIntent && !trivialKeywords) {
    return false;
  }

  const fileCount = countPlanFileMentions(value);
  if (trivialKeywords) {
    return true;
  }
  if (fileCount > 0 && fileCount <= 2) {
    return true;
  }
  if (value.length <= MECHANICAL_PLAN_MAX_CHARS && (planIntent || changeIntent)) {
    return true;
  }
  return false;
}

export type ExploreBudgetSignal =
  | "implement"
  | "focused"
  | "cold_page"
  | "mechanical"
  | "default";

/**
 * Agent fast lane: stricter than Plan mechanical — requires trivial keywords
 * or ≤2 named files. Bare short «исправь баг» / «напиши тесты» stay on the
 * default medium budget.
 */
export function looksLikeAgentMechanicalRequest(userText: string): boolean {
  const value = String(userText || "").trim();
  if (!value || !looksLikeMechanicalPlanRequest(value)) {
    return false;
  }
  const lower = value.toLowerCase().replace(/ё/g, "е");
  if (
    /(?:тест\w*|\btests?\b|\bspec\b|unit\s+test|e2e|покрой|coverage|покрытие)/i.test(
      lower
    )
  ) {
    return false;
  }
  if (
    /(?:фич\w*|\bfeature\b|рефактор|refactor|миграц|migration|архитектур)/i.test(
      lower
    )
  ) {
    return false;
  }
  const trivialKeywords =
    /(?:верси\w*|version|package\.json|package-lock|semver|\bbump\b|одно\s+поле|одно\s+значени|одну\s+строк|one\s+field|one\s+line|tsconfig|readme|changelog)/i.test(
      value
    );
  const fileCount = countPlanFileMentions(value);
  return trivialKeywords || (fileCount > 0 && fileCount <= 2);
}

export function classifyExploreBudgetSignal(options: {
  implementPlan?: boolean;
  userText?: string;
  /** Plan-only: mechanical small plan. */
  planMechanical?: boolean;
  /** Agent: mechanical small edit (fast lane). */
  agentMechanical?: boolean;
}): ExploreBudgetSignal {
  if (options.implementPlan) {
    return "implement";
  }
  if (options.planMechanical || options.agentMechanical) {
    return "mechanical";
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
  /** User correcting a prior edit — even tighter: read target → search_replace. */
  editCorrection?: boolean;
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
  /**
   * Plan mechanical (version / one-field): early soft-strip, skip Phase-1 spam.
   * Ignored when planRevision is set (revision already soft=2).
   */
  planMechanical?: boolean;
  /**
   * Plan + attached screenshot: host already ran OCR + explore probes —
   * soft-remind to write <proposed_plan> sooner than a cold Plan turn.
   */
  screenshotPreflight?: boolean;
  /**
   * Agent mechanical fast lane (version / ≤2 files). Wins over focused-path
   * budget; never used for Plan quality (use planMechanical there).
   */
  agentMechanical?: boolean;
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
  // User correction («убери LayoutContent», «таблица не та») — apply fast.
  if (options.editCorrection) {
    return {
      softNudgeRounds: AGENT_MECHANICAL_SOFT_NUDGE_ROUNDS,
      hardCutRounds: AGENT_MECHANICAL_HARD_CUT_ROUNDS,
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
  const planMechanical =
    options.planMechanical === true ||
    (options.planQuality === true &&
      looksLikeMechanicalPlanRequest(String(options.userText || "")));
  if (options.planQuality && planMechanical) {
    return {
      softNudgeRounds: PLAN_MECHANICAL_SOFT_NUDGE_ROUNDS,
      hardCutRounds: Number.MAX_SAFE_INTEGER,
      stripExploreOnSoftNudge: true,
      hardCutExplore: false,
    };
  }
  if (options.planQuality && options.screenshotPreflight) {
    return {
      softNudgeRounds: PLAN_SCREENSHOT_PREFLIGHT_SOFT_NUDGE_ROUNDS,
      hardCutRounds: Number.MAX_SAFE_INTEGER,
      stripExploreOnSoftNudge: false,
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
  const agentMechanical =
    options.agentMechanical === true ||
    (options.agentMechanical !== false &&
      looksLikeAgentMechanicalRequest(String(options.userText || "")));
  if (agentMechanical) {
    return {
      softNudgeRounds: AGENT_MECHANICAL_SOFT_NUDGE_ROUNDS,
      hardCutRounds: AGENT_MECHANICAL_HARD_CUT_ROUNDS,
      stripExploreOnSoftNudge: true,
      hardCutExplore: true,
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
  /** Short correction / verification — keep search_text for paired sites. */
  editCorrection?: boolean;
}): boolean {
  if (options.readonly) {
    return false;
  }
  if (options.editCorrection) {
    return true;
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
  /** User correcting a prior edit — apply named fix now. */
  editCorrection?: boolean;
  /** Plan follow-up: stop re-explore, emit revised full card. */
  planRevision?: boolean;
  /** Plan mechanical: stop explore, emit short card. */
  planMechanical?: boolean;
  /** Agent mechanical: stop explore, edit the target now. */
  agentMechanical?: boolean;
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
    if (options.plan && options.planMechanical) {
      return [
        "Stop exploring the repository.",
        "list_files, read_file, search_text, and delegate_task are no longer available this turn.",
        "This is a mechanical plan (small non-UI change) — emit a short FULL <proposed_plan>…</proposed_plan> now:",
        "Goal, 2–4 Steps, Affected files, Acceptance. Skip Implementation, Phase 1 inventory, CHANGELOG/tags research unless asked.",
        "Do not call request_user_input unless a real preference is blocking. Do not answer in prose — the plan card is the deliverable.",
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
  if (options.editCorrection) {
    return [
      "Stop browsing with list_files / read_file.",
      "list_files and read_file are no longer available this turn — search_text stays available.",
      "Apply the user's short directive with search_replace (preferred) on the target file(s).",
      "If this is a path / route / PATHS / navigate / export change: search_text for the old and new symbols and update every related call site before claiming done.",
      "Do not redesign unrelated screens. Finish briefly after all paired sites are fixed.",
    ].join(" ");
  }
  if (options.agentMechanical) {
    return [
      "Stop exploring the repository.",
      "list_files and read_file are no longer available this turn.",
      "This is a mechanical edit — call search_replace (preferred) or write_file on the target path now, then finish briefly.",
      "Do not browse analogous UI or shared components.",
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
  editCorrection?: boolean;
  agentMechanical?: boolean;
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
  if (options.editCorrection) {
    return [
      "Exploration limit reached.",
      "list_files and read_file are no longer allowed this turn.",
      "Apply the user's directive with search_replace now.",
      "search_text remains available to find paired sites (routes, PATHS, navigate, links) — update them before finishing.",
    ].join(" ");
  }
  if (options.agentMechanical) {
    return [
      "Exploration limit reached.",
      "list_files and read_file are no longer allowed this turn.",
      "Mechanical edit: search_replace (preferred) or write_file the target now, then finish briefly. No more browsing.",
    ].join(" ");
  }
  return [
    "Exploration limit reached.",
    "list_files and read_file are no longer allowed this turn.",
    "Call search_replace / write_file if edits are still needed; otherwise reply to the user.",
    "After edits, search_text remains available to check consumers of shared UI. No more list_files/read_file.",
  ].join(" ");
}
