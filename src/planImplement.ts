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
 * for the proposed-plan card (Build / Plan.md) — only real implementation plans.
 */
export const HARBOR_PLAN_MODE_CARD_HINT = [
  "Harbor Plan UI: wrap a finale in <proposed_plan>…</proposed_plan> ONLY when you are proposing an implementation plan for a change the user asked to make (Goal/Steps/Affected files or the equivalent inside the block).",
  "Do NOT wrap greetings, status checks (e.g. «как там?», «how's it going?»), acknowledgements, clarifying questions, workspace/git/file status reports, or ordinary Q&A about existing code — those stay plain chat text with no tags. Never invent a plan just because Plan mode is on.",
  "Use those tags with no attributes. If you finish with submit_and_exit, put that same <proposed_plan>…</proposed_plan> block in the summary field only when it is an implementation plan — Harbor shows the Plan card from that summary.",
  "Do not write PLAN.md via tools. Do not put clarifying questions inside <proposed_plan>.",
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
 * Callers must already decide the text is an implementation plan.
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

const PROPOSED_PLAN_CAPTURE_RE =
  /(?:<proposed_plan>|&lt;proposed_plan&gt;)\s*([\s\S]*?)\s*(?:<\/proposed_plan>|&lt;\/proposed_plan&gt;)/gi;

/** Drop <proposed_plan> chrome so Q&A / status answers render as plain chat. */
export function stripProposedPlanTags(text: string): string {
  let value = String(text || "");
  if (!value) {
    return "";
  }
  value = value.replace(PROPOSED_PLAN_CAPTURE_RE, (_, inner: string) =>
    String(inner || "").trim()
  );
  value = value.replace(/(?:<proposed_plan>|&lt;proposed_plan&gt;)/gi, "");
  value = value.replace(/(?:<\/proposed_plan>|&lt;\/proposed_plan&gt;)/gi, "");
  return value.trim();
}

/** 3+ markdown/plain numbered steps — forgotten-tags fallback in Plan mode. */
function hasNumberedPlanSteps(text: string): boolean {
  const matches = String(text || "").match(
    /^[ \t]{0,3}(?:\d+[.)]|\d+\s+[-–—])\s+\S/gm
  );
  return (matches?.length || 0) >= 3;
}

/**
 * Greetings / status checks / acks — not a request to draft a plan.
 * Keep this conservative so real plan prompts are never classified as casual.
 */
export function looksLikeCasualUserTurn(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw || looksLikePlanImplementRequest(raw)) {
    return false;
  }
  const normalized = raw
    .replace(/\s+/g, " ")
    .replace(/[!?…]+$/g, "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized.length > 96) {
    return false;
  }
  return (
    /^(привет|здравствуй(?:те)?|хай|ку|hi|hello|hey|yo)(?:\s|$|,)/.test(
      normalized
    ) ||
    /^(как\s+(?:там|дела|оно|жизнь)|чё\s+там|че\s+там|ну\s+что|что\s+нового|что\s+слышно)/.test(
      normalized
    ) ||
    /^(?:how'?s\s+it\s+going|whats?\s+up|how\s+are\s+you|how\s+goes\s+it)(?:\s|$)/.test(
      normalized
    ) ||
    /^(?:ok|ок|ладно|спасибо|thanks|thank you|понял|ясно|хорошо|lgtm|👍)$/.test(
      normalized
    )
  );
}

function isReadFocusedMode(modeId: string): boolean {
  const id = String(modeId || "").toLowerCase();
  return id === "plan" || id === "ask";
}

/** Latest user bubble text in a UI transcript (for Build-handoff detection). */
export function lastUiUserText(
  messages: Array<{ role?: string; text?: string }> | undefined
): string {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role === "user") {
      return String(list[i]?.text || "");
    }
  }
  return "";
}

/**
 * Finale text shown in chat. Show a Plan card only for an implementation plan
 * (model tags, Goal+Steps, or Plan-mode numbered steps) — not for Q&A / status
 * just because the picker is on Plan. Do not wrap Build/Agent recaps: that
 * would resurrect the composer «Собрать» tag after the plan is already executed.
 */
export function assistantFinaleDisplayText(
  text: string,
  opts: {
    modeId?: string;
    hadFileEdits?: boolean;
    previousUserText?: string;
  } = {}
): string {
  const value = String(text || "");
  if (!value.trim()) {
    return value;
  }
  const modeId = String(opts.modeId || "");
  const userText = opts.previousUserText || "";
  if (!isReadFocusedMode(modeId)) {
    if (looksLikePlanImplementRequest(userText)) {
      return value;
    }
    if (opts.hadFileEdits) {
      return value;
    }
  }
  if (looksLikeCasualUserTurn(userText)) {
    return stripProposedPlanTags(value);
  }
  if (hasProposedPlanTags(value)) {
    return value;
  }
  if (looksLikeImplementationPlan(value)) {
    return ensureProposedPlanWrapper(value);
  }
  // Plan mode: models sometimes omit tags; keep the card for a real outline.
  if (
    modeId === "plan" &&
    value.trim().length >= 200 &&
    hasNumberedPlanSteps(value)
  ) {
    return ensureProposedPlanWrapper(value);
  }
  return value;
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
