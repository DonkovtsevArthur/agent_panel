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

/**
 * Harbor Plan-mode rules (localized), injected into the Cline rules slot.
 * - Overrides Cline's manual-switch contract («toggle to Act mode»): in Harbor
 *   the user starts implementation with the «Собрать» / Build button.
 * - Card tag rules (same contract as HARBOR_PLAN_MODE_CARD_HINT).
 * - Required plan template: Build starts a fresh Agent turn that does not see
 *   Plan-mode tool results, so the plan must be self-contained.
 */
export function harborPlanModeRulesForLanguage(lang: "en" | "ru"): string {
  if (lang === "ru") {
    return [
      "# Режим: Plan (Harbor)",
      "Переключения в Act mode в Harbor нет. Не проси пользователя «toggle to Act mode» / «переключиться в Act» и не упоминай тумблер Act. Когда план готов, заверши ход: пользователь сам нажмёт кнопку «Собрать» — она передаст план агенту на реализацию. Можно одной строкой сказать: «Нажмите „Собрать“, чтобы реализовать план», или предложить поправить план.",
      "",
      "## Карточка плана",
      "Оборачивай финал в <proposed_plan>…</proposed_plan> ТОЛЬКО когда предлагаешь план реализации изменения, которое просил пользователь. Теги без атрибутов.",
      "НЕ оборачивай приветствия, вопросы о статусе («как там?»), подтверждения, уточняющие вопросы, отчёты о состоянии workspace/git/файлов и обычные ответы о существующем коде — это обычный текст без тегов. Не выдумывай план только потому, что включён Plan.",
      "Если завершаешь через submit_and_exit — положи тот же блок <proposed_plan>…</proposed_plan> в поле summary (только если это план реализации).",
      "Не пиши PLAN.md инструментами. Один план на ответ: при ревизии выдай полный новый план, не патч к старому.",
      "",
      "## Когда план рано писать",
      "Если без ответа пользователя нельзя выбрать подход (несколько равноценных вариантов, неясен объём, неясна целевая платформа) — НЕ пиши <proposed_plan>: кратко опиши варианты и задай вопрос обычным текстом. Вопросы внутрь <proposed_plan> не клади.",
      "",
      "## Шаблон плана (внутри <proposed_plan>)",
      "«Собрать» запускает отдельный ход агента, который НЕ видит результатов твоих инструментов (прочитанных файлов, grep, вывода команд) — только текст плана. План должен быть самодостаточным: конкретные пути, `path:line`, имена функций; без «как обсуждали выше».",
      "Разделы — markdown-заголовки `##` в этом порядке (пустые разделы пропускай, кроме обязательных):",
      "1. `## Цель` (обязательно) — 1–2 предложения: что меняется и зачем.",
      "2. `## Контекст` — что ты нашёл: ключевые места кода с `path:line`, текущее поведение, ограничения из правил проекта.",
      "3. `## Шаги` (обязательно) — нумерованный список. Каждый шаг начинается с короткого заголовка жирным (2–5 слов), затем тире и суть: `1. **Типы нового ответа** — сгруппировать по стажировкам в `path:line``. В сути: что сделать + в каких файлах (`path`) + суть изменения (функция, поле, условие). Один шаг — одно проверяемое действие; без «и т.д.».",
      "4. `## Затронутые файлы` (обязательно) — список `path` — создать / изменить / удалить.",
      "5. `## Проверка` (обязательно) — команды (тесты, сборка, линт) и что проверить руками.",
      "6. `## Риски` — что может сломаться, обратная совместимость, миграции.",
      "7. `## Вне рамок` — что сознательно не делаем.",
      "Сниппеты кода — только когда без них шаг неоднозначен; короткие, не целые файлы.",
    ].join("\n");
  }
  return [
    "# Mode: Plan (Harbor)",
    "Harbor has no Act-mode toggle. Do not tell the user to \"toggle to Act mode\" / \"switch to Act\" or mention the Act toggle. When the plan is ready, end your turn: the user clicks the \"Build\" button, which hands the plan to the agent for implementation. You may say in one line: \"Click Build to implement the plan\", or offer to adjust the plan.",
    "",
    "## Plan card",
    "Wrap a finale in <proposed_plan>…</proposed_plan> ONLY when you are proposing an implementation plan for a change the user asked to make. Use the tags with no attributes.",
    "Do NOT wrap greetings, status checks (\"how's it going?\"), acknowledgements, clarifying questions, workspace/git/file status reports, or ordinary Q&A about existing code — those stay plain chat text with no tags. Never invent a plan just because Plan mode is on.",
    "If you finish with submit_and_exit, put that same <proposed_plan>…</proposed_plan> block in the summary field (only when it is an implementation plan).",
    "Do not write PLAN.md via tools. One plan per reply: when revising, emit the full new plan, not a patch to the old one.",
    "",
    "## When it is too early for a plan",
    "If you cannot choose an approach without the user (several equally valid options, unclear scope, unclear target platform) — do NOT emit <proposed_plan>: briefly describe the options and ask in plain text. Never put questions inside <proposed_plan>.",
    "",
    "## Plan template (inside <proposed_plan>)",
    "Build starts a separate agent turn that does NOT see your tool results (files read, grep, command output) — only the plan text. The plan must be self-contained: concrete paths, `path:line`, function names; no \"as discussed above\".",
    "Sections are `##` markdown headings in this order (skip empty optional ones):",
    "1. `## Goal` (required) — 1–2 sentences: what changes and why.",
    "2. `## Context` — what you found: key code locations with `path:line`, current behavior, constraints from project rules.",
    "3. `## Steps` (required) — numbered list. Each step starts with a short bold title (2–5 words), then a dash and the gist: `1. **New response types** — group by internship in `path:line``. The gist: what to do + which files (`path`) + the change (function, field, condition). One step = one verifiable action; no \"etc.\".",
    "4. `## Affected files` (required) — list of `path` — create / modify / delete.",
    "5. `## Verification` (required) — commands (tests, build, lint) and what to check manually.",
    "6. `## Risks` — what may break, backward compatibility, migrations.",
    "7. `## Out of scope` — what we deliberately do not do.",
    "Code snippets only when a step is ambiguous without them; short, never whole files.",
  ].join("\n");
}

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
 * just because the picker is on Plan. Ask never gets a Plan card: it is Q&A,
 * so model-emitted tags are stripped and structured answers stay plain chat.
 * Do not wrap Build/Agent recaps: that would resurrect the composer «Собрать»
 * tag after the plan is already executed.
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
  // Ask is Q&A: no Plan card / Build chip ever. Strip model-emitted
  // <proposed_plan> tags (history mimicry) and never heuristic-wrap a
  // structured answer — Cline's plan-mode base prompt pushes Goal/Steps
  // outlines into Ask too (harborAskModeRulesForLanguage counters it).
  if (modeId === "ask") {
    return stripProposedPlanTags(value);
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
