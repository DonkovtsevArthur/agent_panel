/**
 * Quality gate for Plan-mode <proposed_plan> artifacts.
 * vscode-free — unit-tested from Node.
 */

import { messageHasFigmaUrl } from "./mcp/figma";

export const PLAN_QUALITY_NUDGE =
  "False: your plan deliverable is not decision-complete. " +
  "Emit a FULL <proposed_plan>…</proposed_plan> (not a PLAN.md via write_file — write_file is forbidden in Plan). " +
  "For Figma: call get_design_context AND get_screenshot when available; otherwise get_figma_data (PAT). " +
  "Every Step must map to a mockup block / user checklist item and name a concrete workspace path (reuse or new-by-pattern of a path you read). " +
  "Affected files must list real paths. Add Acceptance. " +
  "For UI tasks, add an **Implementation** section with the exact props/imports of the target shared components (from read_file of the component source, not from a call site) and key types/signatures — this is the contract the implementer builds against. " +
  "Do NOT conclude «already implemented / page already exists / fully matches» unless the plan lists EACH mockup block with reuse path or an explicit gap. " +
  "If the user asked for a page/screen (or pasted Figma), Goal = that page/route with the Figma frame title — not a tab/вкладка from a similar repo page, and not a different existing page that merely looks similar. " +
  "Do not ground steps in src/pages|entities|features from a different feature area than the Figma/user message implies. " +
  "Layout chrome (Search Bar, sidebar Menu) is not the page deliverable. " +
  "Analogue evidence: every Step with reuse / by-pattern of <path> must include a backtick quote (observed) copied from that path's read_file content (import, className, JSX tag, etc. — not the path itself). Describe HOW only from that quote — do not invent a UI kind that is not in the quote/file. " +
  "Use search_text / list_files / read_file / delegate_task, then rewrite the FULL <proposed_plan>.";

/** Minimal message shape for Plan quality checks (avoids vscode/openai imports). */
export type PlanQualityMessage = {
  role?: string;
  name?: string;
  /** Tool payloads are strings; assistant content may be richer — ignored. */
  content?: unknown;
};

export const PLAN_QUALITY_USER_VISIBLE =
  "План не decision-complete: нет нормального <proposed_plan> с путями, цель подменена (таб/«уже есть»), " +
  "или макет не сверен по блокам. Повторите запрос — нужен план WHAT=Figma/страница с grounded Steps.";

const PROPOSED_PLAN_RE =
  /(?:<proposed_plan>|&lt;proposed_plan&gt;)\s*([\s\S]*?)\s*(?:<\/proposed_plan>|&lt;\/proposed_plan&gt;)/i;

/** Path-like tokens: src/foo/bar.ts, package.json, ./components/X.tsx */
const WORKSPACE_PATH_RE =
  /(?:^|[\s`"'(=[])((?:\.\/)?(?:[\w@.-]+\/)+[\w@.-]+\.[\w]{1,12}|[\w@.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|vue|svelte|css|scss|sass|less|json|md|mdc|py|go|rs|java|kt|swift|yml|yaml))\b/i;

/** Grounded path: must contain a directory separator (real relative path).
 *  Bare filenames like `types.ts` / `table.tsx` do NOT count — there can be
 *  dozens of them in a repo and a bare name grounds nothing. */
const GROUNDED_PATH_RE =
  /(?:^|[\s`"'(=[])(?:\.\/)?(?:[\w@.-]+\/)+[\w@.-]+\.[\w]{1,12}\b/i;

const ABSTRACT_FILES_RE =
  /(?:затрагиваем\w*\s*файл\w*|affected\s*files)\s*:?\s*(?:несколько|several|a\s+few|some\s+files|разные\s+файл|various\s+files)/i;

const UNFIXED_FIELDS_RE =
  /(?:ColumnDef|поля|колонки|лейблы|кнопки|фильтры)\s+(?:не\s+)?(?:зафиксирован|не\s+видны|не\s+определен)|(?:fields|columns|labels|buttons)\s+(?:are\s+)?not\s+(?:fixed|captured|visible|defined|finalized)/i;

const ALREADY_EXISTS_RE =
  /(?:уже\s+(?:есть|реализован|существ|готов|покрыт|сделан)|already\s+(?:exists?|implemented|built|present|covered)|полностью\s+совпада|fully\s+(?:match|matches|covered)|ничего\s+(?:делать|менять)\s+не\s+нужно|nothing\s+to\s+(?:do|build|change)|no\s+changes?\s+needed)/i;

const BLOCK_INVENTORY_RE =
  /(?:блок|block|макет|frame|figma|header|таблиц|table|фильтр|filter).{0,60}(?:reuse|новый\s+по\s+паттерну|new\s+by\s+pattern|пробел|gap|совпад|match|покрыт)/i;

const FIGMA_URL_STRIP =
  /https?:\/\/(?:www\.)?figma\.com\/(?:design|file|board|proto|make|slides|deck)\/[^\s)\]>'"]+/gi;

/** Words that are too generic to serve as domain signals. */
const GENERIC_CODE_WORDS = new Set([
  "src", "page", "ui", "shared", "features", "entities", "widgets",
  "components", "index", "model", "types", "api", "config", "utils",
  "lib", "hooks", "out", "media", "test", "view", "table",
  "header", "footer", "body", "content", "main", "app", "extension",
  "panel", "agent", "loop", "tool", "tools", "mode", "modes", "page",
  "certificate", "certification", "check", "knowledge", "briefing",
  "initial", "annual", "create", "search", "date", "report", "actions",
  "tabs", "tab", "info", "details", "list", "item", "row", "col",
  "column", "form", "modal", "dialog", "button", "filter", "banner",
  "message", "inline", "warning", "page", "module", "store", "effect",
  "event", "state", "data", "type", "dto", "entity", "feature",
  "widget", "shared", "page", "new", "cert", "proto", "spec", "mock",
  "demo", "sample", "example", "test", "util", "helper", "const", "var",
]);

/** Extract domain-area words from src/pages|entities|features|widgets/<dir>/ paths. */
function extractDomainWordsFromPlanPaths(body: string): string[] {
  const re =
    /src\/(?:pages|entities|features|widgets)\/([a-z][a-z0-9_-]{2,})\//gi;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const dir = match[1];
    for (const part of dir.split(/[-_]/)) {
      if (part.length > 3 && !GENERIC_CODE_WORDS.has(part.toLowerCase())) {
        found.push(part.toLowerCase());
      }
    }
  }
  return [...new Set(found)];
}

/** URL-decode the user text (handles encoded Figma URL paths). */
function decodedUserText(text: string): string {
  try {
    return decodeURIComponent(String(text || ""));
  } catch {
    return String(text || "");
  }
}

/**
 * Extract inner body of the last <proposed_plan> block, or null.
 */
export function extractProposedPlanBody(text: string): string | null {
  const value = String(text || "");
  if (!value) {
    return null;
  }
  let last: string | null = null;
  const re = new RegExp(PROPOSED_PLAN_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    last = String(match[1] || "").trim();
  }
  return last;
}

export function proposedPlanHasWorkspacePath(body: string): boolean {
  return WORKSPACE_PATH_RE.test(String(body || ""));
}

/** At least one path with a directory (e.g. `src/ui/Table.tsx`). Bare filenames
 *  (`types.ts`, `paths.ts`) do not qualify — they ground nothing. */
export function proposedPlanHasGroundedPath(body: string): boolean {
  return GROUNDED_PATH_RE.test(String(body || ""));
}

/** User asked to plan/implement a page or screen (not a tab). */
export function looksLikeUserAskedForPageSurface(userText: string): boolean {
  const value = String(userText || "");
  if (!value.trim()) {
    return false;
  }
  if (/(?:страниц\w*|экран\w*|\bpages?\b|\bscreens?\b)/i.test(value)) {
    return true;
  }
  // Bare / near-bare Figma link while planning = that frame is the page target.
  if (
    messageHasFigmaUrl(value) &&
    /(?:план|спланир|реализ|implement|plan\b|build\b|макет)/i.test(value)
  ) {
    return true;
  }
  if (
    messageHasFigmaUrl(value) &&
    value.replace(FIGMA_URL_STRIP, "").trim().length < 40
  ) {
    return true;
  }
  return false;
}

function userWantsFigmaOrPagePlan(userText: string): boolean {
  const value = String(userText || "");
  return (
    looksLikeUserAskedForPageSurface(value) ||
    messageHasFigmaUrl(value) ||
    /(?:составь\s+план|план\s+по\s+реализа|implementation\s+plan)/i.test(value)
  );
}

function extractGoalLine(body: string): string {
  const m = String(body || "").match(
    /\*\*\s*(?:Цель|Goal)\s*\*\*\s*:?\s*([^\n]+)/i
  );
  return m ? String(m[1] || "").trim() : "";
}

/**
 * Plan redefines a requested page/screen as "add a tab" (common repo drift).
 * Tabs mentioned as inner UI of a page are OK if Goal still is the page.
 */
export function looksLikePageToTabDrift(
  userText: string,
  planBody: string
): boolean {
  if (!looksLikeUserAskedForPageSurface(userText)) {
    return false;
  }
  const body = String(planBody || "");
  const goal = extractGoalLine(body);
  const head = goal || body.slice(0, 500);
  const goalHasTab = /(?:таб\w*|вкладк\w*|\btabs?\b)/i.test(head);
  const goalHasPageSurface =
    /(?:страниц\w*|экран\w*|\bpage\b|\bscreen\b|\broute\b|роут)/i.test(head);
  const goalHasExisting =
    /(?:существующ\w*|existing|already\b|текущ\w*|current\b)/i.test(head);
  // Drift: the Goal names a tab as the deliverable.
  // - "вкладка" + "существующ" → adding a tab to an existing page = drift,
  //   even if "страница" also appears (e.g. "вкладку на существующей странице").
  // - "вкладка" without any page/screen/route word → deliverable is a tab = drift.
  // - "вкладка" + "страница" (no "существующ") → could be "page with tabs" (inner
  //   UI) — not flagged, stays conservative.
  const goalIsTab =
    goalHasTab && (!goalHasPageSurface || goalHasExisting);
  // Step 1 redefined as "add a tab" (legacy signal, kept for back-compat).
  const step1IsTabAdd =
    /(?:^|\n)\s*1\.\s+[^\n]{0,160}(?:добавить|сделать|создать|встроить|реализовать|зарегистрировать|интегрировать|прописать)\s+(?:таб\w*|вкладк\w*|\btab\b)/i.test(
      body
    ) &&
    !/\*\*\s*(?:Цель|Goal)\s*\*\*[^\n]{0,200}(?:страниц|экран|\bpage\b|\bscreen\b|роут|\broute\b)/i.test(
      body
    );
  // Any numbered step that adds/integrates a tab AND grounds it to an existing
  // repo path or says "существующий" — the classic page→tab drift pattern.
  // Catches drift hidden past step 1 (models write a correct Goal "страница"
  // and bury "Добавить/Зарегистрировать вкладку" in step 4+). Allows up to 60
  // chars between the verb and "вкладка" (e.g. "Расширить модель вкладками").
  // A genuine inner-UI tab of a NEW page rarely references an existing repo
  // tabs file or says "существующий".
  const anyStepIsTabAdd =
    /(?:^|\n)\s*\d+\.\s+[^\n]{0,240}?(?:добавить|сделать|создать|встроить|реализовать|расширить|зарегистрировать|интегрировать|прописать|внести|дополнить)[^\n]{0,60}?(?:таб\w*|вкладк\w*|\btabs?\b)[^\n]{0,240}?(?:существующ\w*|existing|[\w@.-]+\/[\w@.-]+\.[\w]{1,12}|[\w@.-]*tab[\w@.-]*\.(?:ts|tsx|js|jsx))/i.test(
      body
    );
  return goalIsTab || step1IsTabAdd || anyStepIsTabAdd;
}

/**
 * «Страница уже есть / полностью совпадает» без inventory блоков макета —
 * типичный дрейф на похожий экран в репо.
 */
export function looksLikeAlreadyExistsWithoutInventory(
  text: string,
  userText?: string
): boolean {
  const value = String(text || "");
  if (!ALREADY_EXISTS_RE.test(value)) {
    return false;
  }
  if (userText && !userWantsFigmaOrPagePlan(userText)) {
    return false;
  }
  const body = extractProposedPlanBody(value) || value;
  if (BLOCK_INVENTORY_RE.test(body)) {
    return false;
  }
  return true;
}

/**
 * Prose finale claiming the page is done, without <proposed_plan>, when the
 * user asked for a Figma/page implementation plan.
 */
export function looksLikeProseAlreadyExistsSkip(
  text: string,
  userText?: string
): boolean {
  const value = String(text || "");
  if (/<proposed_plan>|&lt;proposed_plan&gt;/i.test(value)) {
    return false;
  }
  if (!userText || !userWantsFigmaOrPagePlan(userText)) {
    return false;
  }
  return ALREADY_EXISTS_RE.test(value);
}

/**
 * Model tries to ship the plan as a markdown file instead of <proposed_plan>.
 */
export function looksLikePlanFileWriteClaim(text: string): boolean {
  const value = String(text || "");
  return (
    /(?:write_file|записан|создал|сохран).{0,40}(?:PLAN[-_]|план[а-я]*\.(?:md|txt)|implementation[-_]?plan)/i.test(
      value
    ) ||
    /(?:PLAN[-_]|план[а-я]*\.(?:md|txt)|implementation[-_]?plan).{0,40}(?:write_file|записан|создал|сохран)/i.test(
      value
    )
  );
}

/**
 * Plan grounds its steps in an existing page from a different feature area
 * than the Figma/user message implies (e.g. user asks for «Удостоверение» in
 * «Первичный инструктаж», model reuses src/pages/notification-certificate/...).
 * Signal: the plan references src/pages|entities|features/<dir>/ paths whose
 * domain word (first significant segment) does NOT appear anywhere in the
 * decoded user text (including the Figma URL path).
 */
export function looksLikePageToSimilarPageDrift(
  userText: string,
  planBody: string
): boolean {
  if (!looksLikeUserAskedForPageSurface(userText)) {
    return false;
  }
  const body = String(planBody || "");
  const domainWords = extractDomainWordsFromPlanPaths(body);
  if (!domainWords.length) {
    return false;
  }
  const decoded = decodedUserText(userText).toLowerCase();
  // Check each domain word: if NONE of them appear in the user's text, the
  // plan is grounded in a foreign feature area.
  const matched = domainWords.filter((w) => decoded.includes(w));
  // Only flag if there are domain words AND at least one is foreign.
  // If even one domain word matches the user text, the plan might be legit
  // (e.g. user asked about "notification" and plan grounds in notification-*).
  return domainWords.length > 0 && matched.length === 0;
}

function normalizePlanPath(path: string): string {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
}

function collectReadFileContents(
  messages: PlanQualityMessage[] | undefined
): Map<string, string> {
  const map = new Map<string, string>();
  if (!messages?.length) {
    return map;
  }
  for (const message of messages) {
    if (message.role !== "tool" || message.name !== "read_file") {
      continue;
    }
    if (typeof message.content !== "string") {
      continue;
    }
    try {
      const parsed = JSON.parse(message.content) as {
        path?: string;
        content?: string;
        error?: string;
      };
      if (parsed.error || !parsed.path || typeof parsed.content !== "string") {
        continue;
      }
      map.set(normalizePlanPath(parsed.path), parsed.content);
    } catch {
      // ignore non-JSON tool payloads
    }
  }
  return map;
}

function findReadContentForPath(
  reads: Map<string, string>,
  path: string
): string | undefined {
  const key = normalizePlanPath(path);
  const direct = reads.get(key);
  if (direct !== undefined) {
    return direct;
  }
  for (const [readPath, content] of reads) {
    if (readPath.endsWith(key) || key.endsWith(readPath)) {
      return content;
    }
  }
  return undefined;
}

const ANALOGUE_PATH_CAPTURE =
  /(?:reuse|по\s+паттерну|новый\s+по\s+паттерну|by\s+pattern(?:\s+of)?|new\s+by\s+pattern(?:\s+of)?)\s*[`«"']?((?:\.\/)?(?:[\w@.-]+\/)+[\w@.-]+\.[\w]{1,12})/gi;

/** Minimum length for an observed backtick quote (path-only quotes are excluded). */
export const MIN_ANALOGUE_QUOTE_CHARS = 6;

/** Numbered Step chunks from a plan body (1. … 2. …). */
export function extractNumberedPlanSteps(planBody: string): string[] {
  const body = String(planBody || "").trim();
  if (!body) {
    return [];
  }
  const parts = body.split(/(?:^|\n)\s*(?=\d+\.\s+)/);
  const steps: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (/^\d+\.\s+\S/.test(trimmed)) {
      steps.push(trimmed);
    }
  }
  return steps;
}

/** Grounded analogue paths cited via reuse / by-pattern in a step. */
export function extractAnaloguePathsFromStep(step: string): string[] {
  const found: string[] = [];
  ANALOGUE_PATH_CAPTURE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANALOGUE_PATH_CAPTURE.exec(String(step || ""))) !== null) {
    const p = normalizePlanPath(match[1]);
    if (p) {
      found.push(p);
    }
  }
  return [...new Set(found)];
}

/**
 * Backtick spans in a step that can count as observed evidence.
 * Excludes the cited path itself and very short tokens.
 */
export function extractObservedQuotesFromStep(
  step: string,
  analoguePaths: string[] = []
): string[] {
  const pathKeys = new Set(analoguePaths.map(normalizePlanPath));
  const quotes: string[] = [];
  const re = /`([^`]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(String(step || ""))) !== null) {
    const raw = String(match[1] || "").trim();
    if (raw.length < MIN_ANALOGUE_QUOTE_CHARS) {
      continue;
    }
    const asPath = normalizePlanPath(raw);
    if (pathKeys.has(asPath)) {
      continue;
    }
    // Skip pure path-shaped quotes that are just the analogue path in another form.
    if (GROUNDED_PATH_RE.test(` ${raw}`) && /\/.+\./.test(raw)) {
      continue;
    }
    quotes.push(raw);
  }
  return quotes;
}

function contentContainsQuote(content: string, quote: string): boolean {
  const hay = String(content || "");
  const needle = String(quote || "");
  if (!hay || !needle) {
    return false;
  }
  if (hay.includes(needle)) {
    return true;
  }
  // Tolerate quote taken from a single line with different surrounding spaces.
  const compactHay = hay.replace(/\s+/g, " ");
  const compactNeedle = needle.replace(/\s+/g, " ");
  return compactHay.includes(compactNeedle);
}

/**
 * A reuse / by-pattern Step lacks a backtick quote that appears in the
 * analogue's read_file content (or the analogue was never read).
 * Skipped when messages are absent (can't verify) or there are no analogue Steps.
 */
export function looksLikeMissingAnalogueQuote(
  planBody: string,
  messages?: PlanQualityMessage[]
): boolean {
  if (!messages?.length) {
    return false;
  }
  const reads = collectReadFileContents(messages);
  if (!reads.size) {
    return false;
  }
  const steps = extractNumberedPlanSteps(planBody);
  for (const step of steps) {
    const paths = extractAnaloguePathsFromStep(step);
    if (!paths.length) {
      continue;
    }
    const quotes = extractObservedQuotesFromStep(step, paths);
    for (const path of paths) {
      const content = findReadContentForPath(reads, path);
      if (content === undefined) {
        return true;
      }
      if (!quotes.length) {
        return true;
      }
      const matched = quotes.some((q) => contentContainsQuote(content, q));
      if (!matched) {
        return true;
      }
    }
  }
  return false;
}

export type PlanQualityOptions = {
  userText?: string;
  messages?: PlanQualityMessage[];
};

/**
 * True when a Plan-mode finale wraps <proposed_plan> but is not
 * grounded enough for Build (paths missing, abstract files, unfixed Figma,
 * page→tab WHAT drift, page→similar-page drift, missing analogue observed
 * quote, or «already exists» without inventory).
 */
export function looksLikeIncompleteProposedPlan(
  text: string,
  options?: PlanQualityOptions
): boolean {
  const body = extractProposedPlanBody(text);
  if (!body) {
    return false;
  }
  if (UNFIXED_FIELDS_RE.test(body)) {
    return true;
  }
  if (ABSTRACT_FILES_RE.test(body) && !proposedPlanHasGroundedPath(body)) {
    return true;
  }
  if (!proposedPlanHasGroundedPath(body)) {
    return true;
  }
  // Must have a Steps / Шаги section with at least one numbered item.
  const hasStepsHeader =
    /\*\*\s*(?:Шаги|Steps)\s*\*\*/i.test(body) ||
    /(?:^|\n)\s*(?:Шаги|Steps)\s*:/i.test(body);
  const hasNumberedStep = /(?:^|\n)\s*\d+\.\s+\S/.test(body);
  if (!hasStepsHeader || !hasNumberedStep) {
    return true;
  }
  if (
    options?.userText &&
    looksLikePageToTabDrift(options.userText, body)
  ) {
    return true;
  }
  if (
    options?.userText &&
    looksLikePageToSimilarPageDrift(options.userText, body)
  ) {
    return true;
  }
  if (
    looksLikeAlreadyExistsWithoutInventory(text, options?.userText)
  ) {
    return true;
  }
  if (looksLikeMissingAnalogueQuote(body, options?.messages)) {
    return true;
  }
  return false;
}

/** Any Plan-mode quality failure (with or without <proposed_plan>). */
export function looksLikePlanQualityFailure(
  text: string,
  options?: PlanQualityOptions
): boolean {
  if (looksLikePlanFileWriteClaim(text)) {
    return true;
  }
  if (looksLikeProseAlreadyExistsSkip(text, options?.userText)) {
    return true;
  }
  if (/<proposed_plan>|&lt;proposed_plan&gt;/i.test(text)) {
    return looksLikeIncompleteProposedPlan(text, options);
  }
  return false;
}
