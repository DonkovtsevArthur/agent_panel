/**
 * Quality gate for Plan-mode <proposed_plan> artifacts.
 * vscode-free — unit-tested from Node.
 */

import { messageHasFigmaUrl } from "./mcp/figma";
import { HARBOR_VISION_HELPER_MARKER } from "./figmaVisionFormat";

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
  "Analogue evidence: every Step with reuse / by-pattern of <path> — and every Step that cites a path you already read_file'd — must include a backtick quote (observed) copied from that path's content (import, className, JSX tag, etc. — not the path itself). Describe HOW only from that quote — do not invent a UI kind that is not in the quote/file. " +
  "Use search_text / list_files / read_file / delegate_task, then rewrite the FULL <proposed_plan>.";

/** Minimal message shape for Plan quality checks (avoids vscode/openai imports). */
export type PlanQualityMessage = {
  role?: string;
  name?: string;
  /** Tool payloads are strings; assistant content may be richer — ignored. */
  content?: unknown;
  tool_calls?: Array<{ function?: { name?: string } | null } | null> | null;
};

export type PlanQualityReason =
  | "plan_file_write"
  | "prose_already_exists"
  | "unfixed_fields"
  | "missing_grounded_path"
  | "missing_steps"
  | "missing_figma_tools"
  | "page_to_tab"
  | "page_to_similar"
  | "already_exists_no_inventory"
  | "missing_analogue_quote"
  | "missing_implementation"
  | "missing_component_api_read"
  | "checklist_coverage"
  | "goal_frame_title"
  | "figma_block_inventory";

export type PlanQualityDiagnosis = {
  /** Primary (first) failing reason — stable for logs / single-reason tests. */
  reason: PlanQualityReason;
  /** All failing reasons in this diagnosis (capped); length ≥ 1. */
  reasons: PlanQualityReason[];
  nudge: string;
};

/** Max reasons packed into one combined nudge (keeps prompt focused). */
const MAX_PLAN_QUALITY_REASONS = 4;

const PLAN_QUALITY_NUDGES: Record<PlanQualityReason, string> = {
  plan_file_write:
    "False: do not write_file a PLAN.md / implementation-plan. Emit a FULL <proposed_plan>…</proposed_plan> card instead (write_file is forbidden in Plan).",
  prose_already_exists:
    "False: do not conclude «already implemented / page already exists» in prose. Call Figma MCP if the user pasted a Figma URL, inventory each mockup block with reuse path or an explicit gap, then emit a FULL <proposed_plan>…</proposed_plan>.",
  unfixed_fields:
    "False: the plan still says fields/columns/labels are not fixed. Call Figma MCP / screenshot_url or request_user_input, then rewrite the FULL <proposed_plan> with concrete labels — never ship «fields not fixed» inside the plan.",
  missing_grounded_path:
    "False: every Step and Affected files must name a concrete workspace path with a directory (e.g. src/pages/Foo.tsx) — not bare filenames or «several files». Use search_text / list_files / read_file, then rewrite the FULL <proposed_plan>.",
  missing_steps:
    "False: the plan needs a **Steps** / **Шаги** section with numbered items (1. 2. …), each grounded to a workspace path. Rewrite the FULL <proposed_plan>.",
  missing_figma_tools:
    "False: the user pasted a Figma URL but you did not call Figma MCP yet. Call get_design_context AND get_screenshot on the URL node (or get_figma_data on PAT), then ground blocks and rewrite the FULL <proposed_plan>.",
  page_to_tab:
    "False: Goal/Steps redefined the requested page/screen as adding a tab on an existing page. Goal must be the Figma/page route; keep tabs only as inner UI of that new page. Rewrite the FULL <proposed_plan>.",
  page_to_similar:
    "False: Steps ground in a different feature area (src/pages|entities|features/<dir>/) than the Figma/user message. Re-ground to the requested area or create new paths by pattern; rewrite the FULL <proposed_plan>.",
  already_exists_no_inventory:
    "False: «already implemented / fully matches» requires a per-block inventory (each mockup block → reuse path or explicit gap). List every block, then rewrite the FULL <proposed_plan>.",
  missing_analogue_quote:
    "False: every Step with reuse / by-pattern / «как в» <path> — and every Step citing a path you already read_file'd — needs a backtick observed quote copied from that file's content (≥6 chars, not the path). Rewrite the FULL <proposed_plan> with those quotes.",
  missing_implementation:
    "False: for this UI/page/Figma plan add an **Implementation** section with exact props/imports of target shared components (from read_file of the component source) and key types/signatures — the Build contract. Rewrite the FULL <proposed_plan>.",
  missing_component_api_read:
    "False: the plan names a shared primitive (Table, Layout, Modal, …) but you did not read_file that component's source (shared/ui or components path). search_text → read_file the component itself (not only a call site), put exact props/imports in **Implementation**, rewrite the FULL <proposed_plan>.",
  checklist_coverage:
    "False: the user gave a numbered/bulleted checklist — Steps must cover every item 1:1 (count AND meaning: each item's key words must appear in Steps). Do not collapse or rename items away. Rewrite the FULL <proposed_plan>.",
  goal_frame_title:
    "False: Goal must include the Figma frame/page title from the vision-helper Visible UI (Title). Do not replace it with a similar repo page name. Rewrite the FULL <proposed_plan> with that title in **Goal**.",
  figma_block_inventory:
    "False: vision-helper listed concrete UI labels (Columns / Filters / Actions / Tabs) that are missing from the plan. Map each label into Steps (reuse path, new-by-pattern, or explicit gap) — do not drop mockup blocks. Rewrite the FULL <proposed_plan>.",
};

function stripFalsePrefix(nudge: string): string {
  return String(nudge || "")
    .replace(/^False:\s*/i, "")
    .trim();
}

function diagnosis(reason: PlanQualityReason): PlanQualityDiagnosis {
  return {
    reason,
    reasons: [reason],
    nudge: PLAN_QUALITY_NUDGES[reason],
  };
}

/** Pack 1..N reasons into one diagnosis (combined nudge when N>1). */
export function diagnosisFromReasons(
  reasons: PlanQualityReason[]
): PlanQualityDiagnosis | null {
  const unique: PlanQualityReason[] = [];
  for (const reason of reasons) {
    if (!unique.includes(reason)) {
      unique.push(reason);
    }
    if (unique.length >= MAX_PLAN_QUALITY_REASONS) {
      break;
    }
  }
  if (!unique.length) {
    return null;
  }
  if (unique.length === 1) {
    return diagnosis(unique[0]);
  }
  const lines = unique.map(
    (reason, index) =>
      `${index + 1}) ${stripFalsePrefix(PLAN_QUALITY_NUDGES[reason])}`
  );
  return {
    reason: unique[0],
    reasons: unique,
    nudge:
      "False: plan is not decision-complete — fix ALL of the following, then rewrite the FULL <proposed_plan>:\n" +
      lines.join("\n"),
  };
}

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

/** Full last `<proposed_plan>…</proposed_plan>` block (tags included), or null. */
export function extractLastProposedPlanBlock(text: string): string | null {
  const value = String(text || "");
  if (!value) {
    return null;
  }
  let last: string | null = null;
  const re =
    /(?:<proposed_plan>|&lt;proposed_plan&gt;)\s*[\s\S]*?\s*(?:<\/proposed_plan>|&lt;\/proposed_plan&gt;)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    last = String(match[0] || "").trim();
  }
  return last;
}

function messageContentAsText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const part of content) {
    if (part && typeof part === "object" && "text" in part) {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") {
        parts.push(text);
      }
    }
  }
  return parts.join("\n");
}

/**
 * Recover the latest assistant `<proposed_plan>` from the turn history.
 * Used when the finale dropped the card after quality nudges.
 */
export function extractLastProposedPlanFromMessages(
  messages?: PlanQualityMessage[]
): string | null {
  if (!messages?.length) {
    return null;
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "assistant") {
      continue;
    }
    const block = extractLastProposedPlanBlock(
      messageContentAsText(message.content)
    );
    if (block) {
      return block;
    }
  }
  return null;
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
  /(?:reuse|по\s+паттерну|новый\s+по\s+паттерну|by\s+pattern(?:\s+of)?|new\s+by\s+pattern(?:\s+of)?|как\s+в|по\s+образцу|аналог(?:у|ом|а)?)\s*[`«"']?((?:\.\/)?(?:[\w@.-]+\/)+[\w@.-]+\.[\w]{1,12})/gi;

/** Grounded path tokens inside a Step (directory + file). */
const STEP_GROUNDED_PATH_CAPTURE =
  /(?:^|[\s`"'(=[—–-])((?:\.\/)?(?:[\w@.-]+\/)+[\w@.-]+\.[\w]{1,12})\b/gi;

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

/** All grounded workspace paths mentioned in a numbered Step. */
export function extractGroundedPathsFromStep(step: string): string[] {
  const found: string[] = [];
  STEP_GROUNDED_PATH_CAPTURE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STEP_GROUNDED_PATH_CAPTURE.exec(String(step || ""))) !== null) {
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
 * Analogue evidence gate (no UI-label dictionaries):
 * - reuse / by-pattern / «как в» Steps must always carry a non-path backtick quote
 *   (structural — even when tool messages are unavailable);
 * - any grounded path in a Step that was read_file'd this turn must also have a
 *   quote that appears in that file's content (bare «таблица — src/…/x.tsx»
 *   counts when x.tsx was read — forces evidence from the real file);
 * - create-only paths never read are skipped (nothing to verify against).
 */
export function looksLikeMissingAnalogueQuote(
  planBody: string,
  messages?: PlanQualityMessage[]
): boolean {
  const steps = extractNumberedPlanSteps(planBody);
  if (!steps.length) {
    return false;
  }
  const reads = collectReadFileContents(messages);

  for (const step of steps) {
    const analoguePaths = extractAnaloguePathsFromStep(step);
    const groundedPaths = extractGroundedPathsFromStep(step);
    const pathKeys = [...new Set([...analoguePaths, ...groundedPaths])];
    const quotes = extractObservedQuotesFromStep(step, pathKeys);

    // Structural: explicit analogue markers require observed quote.
    if (analoguePaths.length > 0 && quotes.length === 0) {
      return true;
    }

    // Without tool payloads we can only enforce structure (quote present).
    if (!reads.size) {
      continue;
    }

    const toVerify = new Set<string>(analoguePaths);
    for (const path of groundedPaths) {
      if (findReadContentForPath(reads, path) !== undefined) {
        toVerify.add(path);
      }
    }
    if (!toVerify.size) {
      continue;
    }
    if (!quotes.length) {
      return true;
    }

    for (const path of toVerify) {
      const content = findReadContentForPath(reads, path);
      if (content === undefined) {
        // Path not in surviving tool payloads (never read or compacted away) —
        // structural quote already required for analogue markers; skip.
        continue;
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
  /**
   * Follow-up after a prior `<proposed_plan>` in chat history.
   * Skips re-fetch gates (Figma tools / component API read / vision inventory)
   * so a scope edit can ship a full replacement card without re-explore.
   */
  planRevision?: boolean;
};

/** True when an earlier assistant turn already shipped a `<proposed_plan>`. */
export function historyHasProposedPlan(
  messages?: PlanQualityMessage[]
): boolean {
  return extractLastProposedPlanFromMessages(messages) != null;
}

/**
 * System hint for Plan follow-ups: full card replacement from the last plan,
 * without restarting Phase 1 / Figma / broad repo explore.
 */
export const PLAN_REVISION_HINT =
  "Plan revision: a <proposed_plan> already exists earlier in this chat. " +
  "Start from that last plan. Apply ONLY the user's latest delta (scope, constraints, wording). " +
  "Emit a FULL replacement <proposed_plan>…</proposed_plan> card " +
  "(complete Goal / Steps / Affected / Acceptance / Implementation as needed). " +
  "Do NOT restart Phase 1: do not re-call Figma MCP and do not re-explore the repo with " +
  "list_files / search_text / read_file / delegate_task unless the user changes WHAT " +
  "(new screen, new checklist items, new Figma node) or a previously cited path is no longer valid. " +
  "When removing scope (e.g. no backend/API), delete matching Steps and trim Affected / " +
  "Implementation / Acceptance — keep grounded UI steps and their observed quotes intact.";

/** Shared UI primitives that require reading component source, not only a call site. */
const SHARED_PRIMITIVE_NAMES = [
  "Table",
  "LayoutPageContent",
  "Layout",
  "InlineMessage",
  "Alert",
  "Checkbox",
  "Modal",
  "Form",
] as const;

function toolNameEndsWith(name: string, suffix: string): boolean {
  return name === suffix || name.endsWith(`__${suffix}`) || name.endsWith(`/${suffix}`);
}

/** True when turn called modern Figma pair or legacy get_figma_data. */
export function turnHadFigmaPlanTools(
  messages?: PlanQualityMessage[]
): boolean {
  if (!messages?.length) {
    return false;
  }
  let hasDesignContext = false;
  let hasScreenshot = false;
  let hasLegacyData = false;
  for (const message of messages) {
    const names: string[] = [];
    if (message.role === "tool" && message.name) {
      names.push(String(message.name));
    }
    if (message.role === "assistant" && message.tool_calls?.length) {
      for (const call of message.tool_calls) {
        const n = call?.function?.name;
        if (n) {
          names.push(String(n));
        }
      }
    }
    for (const name of names) {
      if (toolNameEndsWith(name, "get_design_context")) {
        hasDesignContext = true;
      }
      if (toolNameEndsWith(name, "get_screenshot")) {
        hasScreenshot = true;
      }
      if (toolNameEndsWith(name, "get_figma_data")) {
        hasLegacyData = true;
      }
    }
  }
  return (hasDesignContext && hasScreenshot) || hasLegacyData;
}

/**
 * Plan + Figma URL + MCP connected: block repo explore until Figma tools ran.
 * Matches what stronger planners (Kimi) do by habit — weak models skip MCP
 * and invent from the URL slug / a similar page unless explore is unavailable.
 */
export function shouldForceFigmaBeforeExplore(options: {
  planMode: boolean;
  figmaConnected: boolean;
  userText?: string;
  messages?: PlanQualityMessage[];
}): boolean {
  if (!options.planMode || !options.figmaConnected) {
    return false;
  }
  if (!messageHasFigmaUrl(options.userText || "")) {
    return false;
  }
  return !turnHadFigmaPlanTools(options.messages);
}

/** System hint while explore is stripped pending Figma fetch. */
export const FIGMA_FIRST_FORCE_HINT =
  "HARD RULE: the user pasted a Figma URL and Figma MCP is connected. " +
  "Your FIRST tool call(s) this turn MUST be Figma MCP — " +
  "get_design_context AND get_screenshot on the URL node, or get_figma_data on PAT. " +
  "list_files / read_file / search_text / delegate_task are unavailable until that fetch succeeds. " +
  "Do not invent UI from the URL title or a similar repo page. After Figma returns, explore the repo for HOW.";

/** Tool-result JSON when explore is invoked before Figma despite the strip. */
export const FIGMA_FIRST_EXPLORE_BLOCKED_JSON = JSON.stringify({
  error:
    "Figma URL present: call get_design_context AND get_screenshot " +
    "(or get_figma_data on PAT) on the URL node BEFORE list_files / read_file / " +
    "search_text / delegate_task. Repo explore is HOW after the mockup is fetched.",
});

function looksLikeUiOrFigmaPlan(userText?: string): boolean {
  const value = String(userText || "");
  if (!value.trim()) {
    return false;
  }
  return looksLikeUserAskedForPageSurface(value) || messageHasFigmaUrl(value);
}

/** Extract **Implementation** / **Реализация** section body, or null. */
export function extractImplementationSection(planBody: string): string | null {
  const body = String(planBody || "");
  const match = body.match(
    /\*\*\s*(?:Implementation|Реализация)\s*\*\*\s*:?\s*([\s\S]*?)(?=\n\s*\*\*[^*\n]+\*\*|\s*$)/i
  );
  const section = match ? String(match[1] || "").trim() : "";
  return section || null;
}

const IMPLEMENTATION_API_SIGNAL_RE =
  /(?:\bimport\s|props\b|columns\s*=|\btype\s+[A-Z]\w+|children\b|<[A-Z]\w+)/i;

export function looksLikeMissingImplementationSection(
  planBody: string,
  userText?: string
): boolean {
  if (!looksLikeUiOrFigmaPlan(userText)) {
    return false;
  }
  const section = extractImplementationSection(planBody);
  if (!section) {
    return true;
  }
  if (!proposedPlanHasGroundedPath(section)) {
    return true;
  }
  if (!IMPLEMENTATION_API_SIGNAL_RE.test(section)) {
    return true;
  }
  return false;
}

function pathLooksLikeComponentSource(path: string, primitive: string): boolean {
  const p = normalizePlanPath(path).toLowerCase();
  const name = primitive.toLowerCase();
  if (!p.includes(name)) {
    return false;
  }
  return (
    /(?:^|\/)shared\/ui\//i.test(p) ||
    /(?:^|\/)components\//i.test(p) ||
    /(?:^|\/)shared\/components\//i.test(p) ||
    new RegExp(`(?:^|/)${name}\\.[\\w]+$`, "i").test(p)
  );
}

/** Primitives named in the plan that lack a matching component-source read_file. */
export function looksLikeMissingComponentApiRead(
  planBody: string,
  messages?: PlanQualityMessage[]
): boolean {
  const body = String(planBody || "");
  if (!body.trim()) {
    return false;
  }
  const mentioned = SHARED_PRIMITIVE_NAMES.filter((name) =>
    new RegExp(`\\b${name}\\b`).test(body)
  );
  if (!mentioned.length) {
    return false;
  }
  if (!messages?.length) {
    return false;
  }
  const reads = collectReadFileContents(messages);
  if (!reads.size) {
    return false;
  }
  for (const primitive of mentioned) {
    let found = false;
    for (const path of reads.keys()) {
      if (pathLooksLikeComponentSource(path, primitive)) {
        found = true;
        break;
      }
    }
    if (!found) {
      return true;
    }
  }
  return false;
}

/** Numbered / bulleted checklist items from the user message (Figma URLs stripped). */
export function extractUserChecklistItems(userText: string): string[] {
  const cleaned = String(userText || "")
    .replace(FIGMA_URL_STRIP, "\n")
    .replace(/\r/g, "");
  const items: string[] = [];
  for (const line of cleaned.split("\n")) {
    const trimmed = line.trim();
    if (/^\d+[.)]\s+\S/.test(trimmed) || /^[-*•]\s+\S/.test(trimmed)) {
      items.push(trimmed);
    }
  }
  return items;
}

/** Significant tokens from a checklist line (numbering / bullets stripped). */
export function significantChecklistTokens(item: string): string[] {
  const cleaned = String(item || "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^[-*•]\s+/, "")
    .toLowerCase();
  return cleaned
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !GENERIC_CODE_WORDS.has(t));
}

/**
 * Checklist gap: fewer Steps than items, OR an item whose key tokens
 * never appear in Steps (semantic collapse).
 */
export function looksLikeChecklistCoverageGap(
  planBody: string,
  userText?: string
): boolean {
  if (!userText) {
    return false;
  }
  const items = extractUserChecklistItems(userText);
  if (items.length < 2) {
    return false;
  }
  const steps = extractNumberedPlanSteps(planBody);
  if (steps.length < items.length) {
    return true;
  }
  const stepsText = steps.join("\n").toLowerCase();
  for (const item of items) {
    const tokens = significantChecklistTokens(item);
    if (!tokens.length) {
      continue;
    }
    if (!tokens.some((token) => stepsText.includes(token))) {
      return true;
    }
  }
  return false;
}

function collectVisionHelperTexts(
  messages?: PlanQualityMessage[]
): string[] {
  if (!messages?.length) {
    return [];
  }
  const out: string[] = [];
  for (const message of messages) {
    if (message.role !== "tool") {
      continue;
    }
    const content =
      typeof message.content === "string" ? message.content : "";
    if (content.includes(HARBOR_VISION_HELPER_MARKER)) {
      out.push(content);
    }
  }
  return out;
}

/** Best-effort Title from vision-helper Visible UI section. */
export function extractVisionHelperFrameTitle(
  messages?: PlanQualityMessage[]
): string | null {
  for (const content of collectVisionHelperTexts(messages)) {
    const titleLine =
      content.match(
        /(?:^|\n)\s*(?:#{1,3}\s*)?Title\s*:?\s*([^\n]+)/i
      ) ||
      content.match(
        /(?:^|\n)\s*\*\*Title\*\*\s*:?\s*([^\n]+)/i
      );
    if (!titleLine?.[1]) {
      continue;
    }
    const title = String(titleLine[1] || "")
      .replace(/^["'«»]+|["'«»]+$/g, "")
      .trim();
    if (title.length >= 4) {
      return title;
    }
  }
  return null;
}

function significantTitleTokens(title: string): string[] {
  return String(title || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && !GENERIC_CODE_WORDS.has(t));
}

export function looksLikeGoalMissingFrameTitle(
  planBody: string,
  messages?: PlanQualityMessage[]
): boolean {
  const title = extractVisionHelperFrameTitle(messages);
  if (!title) {
    return false;
  }
  const tokens = significantTitleTokens(title);
  if (!tokens.length) {
    return false;
  }
  const goal = extractGoalLine(planBody).toLowerCase();
  if (!goal) {
    return true;
  }
  return !tokens.some((token) => goal.includes(token));
}

/**
 * Concrete UI labels from vision-helper sections (Columns / Filters /
 * Actions / Buttons / Tabs). Title is handled by goal_frame_title.
 */
export function extractVisionHelperUiLabels(
  messages?: PlanQualityMessage[]
): string[] {
  const sectionRe =
    /(?:^|\n)\s*(?:#{1,3}\s*|\*\*)?(Columns|Filters|Actions|Buttons|Tabs|Other text)(?:\*\*)?\s*:?\s*([^\n]+)/gi;
  const labels: string[] = [];
  for (const content of collectVisionHelperTexts(messages)) {
    const visible =
      content.match(
        /##\s*Visible UI[\s\S]*?(?=\n##\s|\s*$)/i
      )?.[0] || content;
    sectionRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = sectionRe.exec(visible)) !== null) {
      const raw = String(match[2] || "").trim();
      if (!raw || /^\(/.test(raw)) {
        continue;
      }
      for (const part of raw.split(/[,;|•·]/)) {
        const label = part
          .replace(/^[-*]\s+/, "")
          .replace(/^["'«»]+|["'«»]+$/g, "")
          .trim();
        if (label.length < 3) {
          continue;
        }
        const tokens = label
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .filter((t) => t.length >= 3 && !GENERIC_CODE_WORDS.has(t));
        if (!tokens.length) {
          continue;
        }
        if (!labels.some((existing) => existing.toLowerCase() === label.toLowerCase())) {
          labels.push(label);
        }
      }
    }
  }
  return labels;
}

function labelCoveredInPlan(label: string, planLower: string): boolean {
  const normalized = label.toLowerCase().trim();
  if (normalized.length >= 4 && planLower.includes(normalized)) {
    return true;
  }
  const tokens = normalized
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 4 && !GENERIC_CODE_WORDS.has(t));
  if (!tokens.length) {
    // Short labels (e.g. «ФИО»): require exact phrase if ≥3 chars.
    return normalized.length >= 3 && planLower.includes(normalized);
  }
  return tokens.some((token) => planLower.includes(token));
}

/**
 * True when vision-helper listed ≥2 UI labels and the plan covers fewer
 * than half of them (mockup blocks dropped).
 */
export function looksLikeMissingFigmaBlockInventory(
  planBody: string,
  messages?: PlanQualityMessage[]
): boolean {
  const labels = extractVisionHelperUiLabels(messages);
  if (labels.length < 2) {
    return false;
  }
  const planLower = String(planBody || "").toLowerCase();
  if (!planLower.trim()) {
    return true;
  }
  let covered = 0;
  for (const label of labels) {
    if (labelCoveredInPlan(label, planLower)) {
      covered += 1;
    }
  }
  const need = Math.ceil(labels.length / 2);
  return covered < need;
}

function diagnoseIncompleteProposedPlan(
  text: string,
  options?: PlanQualityOptions
): PlanQualityDiagnosis | null {
  const body = extractProposedPlanBody(text);
  if (!body) {
    return null;
  }
  const reasons: PlanQualityReason[] = [];

  if (UNFIXED_FIELDS_RE.test(body)) {
    reasons.push("unfixed_fields");
  }
  if (ABSTRACT_FILES_RE.test(body) && !proposedPlanHasGroundedPath(body)) {
    reasons.push("missing_grounded_path");
  } else if (!proposedPlanHasGroundedPath(body)) {
    reasons.push("missing_grounded_path");
  }
  const hasStepsHeader =
    /\*\*\s*(?:Шаги|Steps)\s*\*\*/i.test(body) ||
    /(?:^|\n)\s*(?:Шаги|Steps)\s*:/i.test(body);
  const hasNumberedStep = /(?:^|\n)\s*\d+\.\s+\S/.test(body);
  if (!hasStepsHeader || !hasNumberedStep) {
    reasons.push("missing_steps");
  }
  const revision = options?.planRevision === true;
  if (
    !revision &&
    options?.userText &&
    messageHasFigmaUrl(options.userText) &&
    !turnHadFigmaPlanTools(options.messages)
  ) {
    reasons.push("missing_figma_tools");
  }
  if (
    options?.userText &&
    looksLikePageToTabDrift(options.userText, body)
  ) {
    reasons.push("page_to_tab");
  }
  if (
    options?.userText &&
    looksLikePageToSimilarPageDrift(options.userText, body)
  ) {
    reasons.push("page_to_similar");
  }
  if (looksLikeAlreadyExistsWithoutInventory(text, options?.userText)) {
    reasons.push("already_exists_no_inventory");
  }
  if (looksLikeMissingAnalogueQuote(body, options?.messages)) {
    reasons.push("missing_analogue_quote");
  }
  if (looksLikeMissingImplementationSection(body, options?.userText)) {
    reasons.push("missing_implementation");
  }
  // Revision turns reuse prior component/Figma grounding — do not force re-read.
  if (
    !revision &&
    looksLikeMissingComponentApiRead(body, options?.messages)
  ) {
    reasons.push("missing_component_api_read");
  }
  if (looksLikeChecklistCoverageGap(body, options?.userText)) {
    reasons.push("checklist_coverage");
  }
  if (
    !revision &&
    looksLikeGoalMissingFrameTitle(body, options?.messages)
  ) {
    reasons.push("goal_frame_title");
  }
  if (
    !revision &&
    looksLikeMissingFigmaBlockInventory(body, options?.messages)
  ) {
    reasons.push("figma_block_inventory");
  }

  return diagnosisFromReasons(reasons);
}

/**
 * Diagnose why a Plan-mode finale is not decision-complete.
 * Returns failing reason(s) + a targeted (or combined) nudge, or null when OK.
 */
export function diagnosePlanQualityFailure(
  text: string,
  options?: PlanQualityOptions
): PlanQualityDiagnosis | null {
  if (looksLikePlanFileWriteClaim(text)) {
    return diagnosis("plan_file_write");
  }
  if (looksLikeProseAlreadyExistsSkip(text, options?.userText)) {
    return diagnosis("prose_already_exists");
  }
  if (/<proposed_plan>|&lt;proposed_plan&gt;/i.test(text)) {
    return diagnoseIncompleteProposedPlan(text, options);
  }
  return null;
}

/**
 * True when a Plan-mode finale wraps <proposed_plan> but is not
 * grounded enough for Build (paths missing, abstract files, unfixed Figma,
 * page→tab WHAT drift, page→similar-page drift, missing analogue evidence
 * (structural quote / quote∉read_file), or «already exists» without inventory).
 */
export function looksLikeIncompleteProposedPlan(
  text: string,
  options?: PlanQualityOptions
): boolean {
  return diagnoseIncompleteProposedPlan(text, options) !== null;
}

/** Any Plan-mode quality failure (with or without <proposed_plan>). */
export function looksLikePlanQualityFailure(
  text: string,
  options?: PlanQualityOptions
): boolean {
  return diagnosePlanQualityFailure(text, options) !== null;
}
