import type { ChatMessage } from "./openaiClient";
import {
  looksLikeClaimedFileChanges,
  looksLikeManualPatchReply,
  looksLikeUserEditRequest,
} from "./claimedEdits";
import { looksLikeHedgeOrUnfinishedAction } from "./hedgeReplies";
import {
  looksLikeDeniedSuccessfulEdit,
  looksLikeHollowStatusOrDeferral,
  looksLikeSharedLayoutChangeClaim,
} from "./hollowReplies";
import { looksLikeRefusedRequestedEdit } from "./versionBump";

export const MISSING_WRITE_USER_NUDGE =
  "False: you described code changes but did NOT successfully call write_file or search_replace in this step. Editing tools ARE available. Do NOT claim you already returned/fixed/restored anything. Call search_replace for a focused edit or write_file for full content, then reply briefly.";

export const MISSING_WRITE_USER_VISIBLE =
  "Файлы не изменены: модель описала правки («вернул / исправил»), но не применила их успешно через write_file или search_replace в этом шаге. Повторите запрос — изменения нужно применить через инструменты.";

export const HEDGE_USER_NUDGE =
  "Do not speculate («возможно», «если TypeScript ругается», «попробую пересобрать»). Either call tools now (read_file / run_command with the real build or tsc command) and report the actual result, or give a final factual answer without unfinished promises. Never end with «I'll try…».";

export const HEDGE_USER_VISIBLE =
  "Модель ответила догадкой («возможно / если TS ругается / попробую пересобрать») вместо проверки. Повторите запрос — нужно проверить через инструменты и дать фактический результат.";

export const HOLLOW_USER_NUDGE =
  "False: do NOT claim you already explained something or that the file is already correct unless THIS reply contains the actual explanation. Write the concrete reason in the reply now. Do not defer obvious follow-up work to the user. If an existing test expects the old behavior, update its expectation with search_replace and run that single test file now; do not ask permission. If a layout change is needed, call search_replace or write_file now. Before changing shared UI, search usages (rg) and update consumers or keep a backwards-compatible API.";

export const HOLLOW_USER_VISIBLE =
  "Модель ответила пустышкой («файл уже ок / я объяснил / скажи — перепишу») без реального объяснения в сообщении. Повторите запрос — нужен конкретный ответ или применение правки через инструмент.";

export const DENIED_WRITE_USER_NUDGE =
  "False: tool results show a successful search_replace or write_file THIS turn. Do NOT claim the file was already correct, already updated earlier, or that no editor changes were needed. State briefly what you changed (old → new). If you also synced package-lock, mention that as a follow-up, not as a substitute for the edit.";

export const DENIED_WRITE_USER_VISIBLE =
  "Модель успешно применила правку через инструмент, но в ответе отрицает это («уже было / правок не потребовалось»). Повторите запрос — нужен краткий отчёт о реальном изменении.";

export const IMPACT_USER_NUDGE =
  "You changed (or claim to change) shared UI layout/structure. Before finishing: run_command with rg/grep to find imports and usages of this component, check whether other call sites break, update them if needed, and report the impact. Do NOT say «скажи — верну/переделаю». Prefer backwards-compatible API (optional props) over breaking shared components unilaterally.";

export const IMPACT_USER_VISIBLE =
  "Модель поменяла (или описала) shared UI без проверки других мест использования. Повторите запрос — нужно найти consumers и учесть влияние на другие компоненты.";

export const ASK_USER_VIA_TOOL_NUDGE =
  "False: do NOT write clarifying questions as plain chat text (no numbered lists, no «Есть несколько уточняющих вопросов»). Call request_user_input — one question per call, with 2–4 mutually exclusive options and a recommended default. The UI shows QuickPick plus a free-text custom answer. Ask every blocking question via that tool before any <proposed_plan>. Do not finish this turn with prose questions.";

export const ASK_USER_VIA_TOOL_USER_VISIBLE =
  "Модель задала уточняющие вопросы текстом вместо tool request_user_input. Повторите запрос — вопросы должны прийти через выбор вариантов (и «Свой ответ…») в VS Code.";

export type HonestFinaleDecision =
  | { kind: "ok"; text: string }
  | { kind: "nudge_write" }
  | { kind: "nudge_hedge" }
  | { kind: "nudge_hollow" }
  | { kind: "nudge_denied_write" }
  | { kind: "nudge_impact" }
  | { kind: "nudge_ask_user" }
  | { kind: "replace"; text: string };

/**
 * Успешный файловый edit в tool-раунде сразу перед финальным текстом.
 * Смотрим результаты tool (ok:true), а не только факт вызова.
 */
export function precedingToolRoundHadSuccessfulWrite(
  messages: ChatMessage[]
): boolean {
  let i = messages.length - 1;
  // пропуск финального assistant без tools, если он уже в хвосте
  if (
    i >= 0 &&
    messages[i].role === "assistant" &&
    !(messages[i].tool_calls && messages[i].tool_calls!.length > 0)
  ) {
    i -= 1;
  }

  let sawTool = false;
  while (i >= 0) {
    const m = messages[i];
    if (m.role === "tool") {
      sawTool = true;
      if (
        (m.name === "write_file" || m.name === "search_replace") &&
        toolResultLooksSuccessful(m.content, m.name)
      ) {
        return true;
      }
      i -= 1;
      continue;
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      // Без tool results нельзя подтвердить успех — не доверяем только именам.
      return false;
    }
    break;
  }
  return false;
}

function toolResultLooksSuccessful(
  content: ChatMessage["content"],
  toolName: string
): boolean {
  const raw =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((p) => (p.type === "text" ? p.text : ""))
            .join("\n")
        : "";
  if (!raw.trim()) {
    return false;
  }
  try {
    const parsed = JSON.parse(raw) as {
      ok?: unknown;
      error?: unknown;
      path?: unknown;
      created?: unknown;
      added?: unknown;
      removed?: unknown;
      replacements?: unknown;
      unchanged?: unknown;
    };
    if (parsed.error) {
      return false;
    }
    if (parsed.ok === false || parsed.unchanged === true) {
      return false;
    }
    const added = Number(parsed.added) || 0;
    const removed = Number(parsed.removed) || 0;
    const created = Boolean(parsed.created);
    const replacements = Number(parsed.replacements) || 0;
    // ok:true с 0 правок = no-op, не считаем успешной записью
    if (parsed.ok === true) {
      return (
        created ||
        added > 0 ||
        removed > 0 ||
        (toolName === "search_replace" && replacements > 0)
      );
    }
    if (typeof parsed.path === "string" && parsed.path.trim()) {
      return created || added > 0 || removed > 0;
    }
  } catch {
    // non-json tool payload — не считаем успешной записью
  }
  return false;
}

function turnHadUsageSearch(messages: ChatMessage[]): boolean {
  for (const m of messages) {
    if (m.role !== "assistant" || !m.tool_calls?.length) {
      continue;
    }
    for (const call of m.tool_calls) {
      const name = call.function?.name || "";
      const args = String(call.function?.arguments || "").toLowerCase();
      if (name === "run_command") {
        if (
          /\brg\b/.test(args) ||
          /\bgrep\b/.test(args) ||
          /git\s+grep/.test(args) ||
          /\bag\b/.test(args) ||
          /\back\b/.test(args)
        ) {
          return true;
        }
      }
      if (name === "list_files" && /shared|components|ui|widgets/.test(args)) {
        return true;
      }
    }
  }
  return false;
}

function editedSharedLookingPath(messages: ChatMessage[]): boolean {
  for (const m of messages) {
    if (
      m.role !== "tool" ||
      (m.name !== "write_file" && m.name !== "search_replace")
    ) {
      continue;
    }
    const raw = typeof m.content === "string" ? m.content : "";
    try {
      const parsed = JSON.parse(raw) as { path?: string; ok?: boolean };
      if (parsed.ok === false) {
        continue;
      }
      const p = String(parsed.path || "").toLowerCase().replace(/\\/g, "/");
      if (
        /(^|\/)(shared|components|widgets|ui)\//.test(p) ||
        /\/ui\//.test(p) ||
        p.includes("notification") ||
        p.includes("toast") ||
        p.includes("modal")
      ) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

/**
 * Honest clarifying reply: model asks for a missing decision (version, choice)
 * instead of claiming an edit. Like Zed — allow ask when proceeding would be guessing.
 */
export function looksLikeMissingInfoQuestion(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 900) {
    return false;
  }
  const value = raw.toLowerCase().replace(/ё/g, "е");

  const needles = [
    "какую версию",
    "на какую версию",
    "какую именно",
    "укажи,",
    "укажи ",
    "уточни",
    "which version",
    "what version",
    "to which version",
    "which one",
  ];
  if (needles.some((n) => value.includes(n))) {
    return true;
  }

  // Short/medium question asking the user to choose or specify.
  if (
    raw.length <= 600 &&
    /[?？]/.test(raw) &&
    /(?:^|\n)\s*(какую|какой|какая|какие|укажи|уточни|which|what)\b/im.test(raw)
  ) {
    return true;
  }

  return false;
}

/**
 * Plan/Ask: model dumped clarifying questions as chat prose instead of
 * calling request_user_input (no QuickPick / custom answer UI).
 */
export function looksLikeProseClarifyingQuestions(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw || raw.length < 40) {
    return false;
  }
  // proposed_plan is the deliverable — do not treat it as a prose Q dump
  if (/<proposed_plan>|&lt;proposed_plan&gt;/i.test(raw)) {
    return false;
  }
  const value = raw.toLowerCase().replace(/ё/g, "е");
  const qMarks = (raw.match(/[?？]/g) || []).length;

  if (
    /уточняющ\w*\s+вопрос|clarifying question|есть несколько вопрос|несколько уточн|помогут дать точный план|перед тем как (составить|дать|писать) план|нужн\w+ уточн/i.test(
      value
    )
  ) {
    return true;
  }

  const hasList = /(?:^|\n)\s*(?:\d+[.)]|[-*•])\s+\S+/m.test(raw);
  if (qMarks >= 2 && hasList) {
    return true;
  }

  if (
    qMarks >= 2 &&
    hasList &&
    /(?:какой|какая|какие|где|нужен ли|есть ли|should|which|where|or)\b/i.test(
      value
    )
  ) {
    return true;
  }

  // Prose clarification WITHOUT question marks: model asks the user to
  // describe/clarify the structure or composition of a design/layout, or
  // hands off to a mode switch instead of calling request_user_input.
  // Catches flowing "if typical → template, if unique → describe the
  // structure once (or switch to Agent and I'll build iteratively)" replies
  // that the qMarks+list branch above misses.
  // The imperative alone is ambiguous (could be the model instructing the
  // user), so require a corroboration signal: data insufficiency, a
  // consequence clause ("тогда дам план"), a mode-switch, or a template/
  // iterative hand-off.
  const clarifyImperative =
    /(?:уточните|уточни|опишите|опиши|перечислите)\s+(?:макет|структур|состав|поля|кнопки|фильтр|конкретн|детал)/i;
  const dataInsufficiency =
    /не\s+вижу|не\s+видно|не\s+хватает|в\s+сжатом\s+виде|только\s+каркас|частично|недостаточно|insufficient|cannot\s+see|don't\s+see|do\s+not\s+see/i;
  const consequenceClause =
    /тогда\s+(?:дам|сделаю|смогу|реализую|продолжу|составлю|дам\s+план)|чтобы\s+(?:сделать|реализовать|продолжить|составить\s+план)/i;
  const modeSwitchNudge =
    /переключитесь\s+в\s+режим|switch\s+to\s+(?:agent|plan|ask)\s+mode/i;
  const handoffCorroboration =
    /итеративн|по\s+ссылке|по\s+шаблону|iterative|by\s+(?:the\s+)?link|template/i;
  if (
    clarifyImperative.test(value) &&
    (dataInsufficiency.test(value) ||
      consequenceClause.test(value) ||
      modeSwitchNudge.test(value) ||
      handoffCorroboration.test(value))
  ) {
    return true;
  }
  if (modeSwitchNudge.test(value) && handoffCorroboration.test(value)) {
    return true;
  }

  return false;
}

export function turnHadSuccessfulRequestUserInput(
  messages: ChatMessage[]
): boolean {
  for (const m of messages) {
    if (m.role !== "tool" || m.name !== "request_user_input") {
      continue;
    }
    try {
      const parsed = JSON.parse(String(m.content || "")) as {
        ok?: unknown;
      };
      if (parsed && parsed.ok === true) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

/**
 * Единый гейт перед показом финала пользователю.
 */
export function decideHonestFinale(input: {
  text: string;
  canEdit: boolean;
  messages: ChatMessage[];
  userText: string;
  hadSuccessfulWrite?: boolean;
  gitOperationCompleted?: boolean;
  /** Kimi only: allow clarifying questions without nudge_write. */
  kimi?: boolean;
  allowNudgeWrite?: boolean;
  allowNudgeHedge?: boolean;
  allowNudgeHollow?: boolean;
  allowNudgeImpact?: boolean;
  /** Plan/Ask: nudge prose clarifying questions → request_user_input. */
  allowNudgeAskUser?: boolean;
}): HonestFinaleDecision {
  const text = String(input.text || "").trim();
  const allowNudgeWrite = input.allowNudgeWrite !== false;
  const allowNudgeHedge = input.allowNudgeHedge !== false;
  const allowNudgeHollow = input.allowNudgeHollow !== false;
  const allowNudgeImpact = input.allowNudgeImpact !== false;
  const allowNudgeAskUser = input.allowNudgeAskUser !== false;
  const kimi = input.kimi === true;

  if (!input.canEdit) {
    // Plan / Ask mode: объяснение — это deliverable, не пустышка.
    // Hollow-детектор («я объяснил / скажи — перепишу») здесь ложносрабатывает:
    // в readonly модель и должна объяснять и может отложить реализацию на Agent.
    // Оставляем hedge + prose-clarifying (должны идти через request_user_input).
    // <proposed_plan> — финальный артефакт Plan mode (Goal/Steps/Risks):
    // Risks и future-tense шаги легитимно содержат «возможно стоит» / «начну с…»,
    // что ложнит hedge-детектор. Защищаем тегом до любых nudge/replace.
    if (/<proposed_plan>|&lt;proposed_plan&gt;/i.test(text)) {
      return { kind: "ok", text };
    }
    if (looksLikeHedgeOrUnfinishedAction(text)) {
      return allowNudgeHedge
        ? { kind: "nudge_hedge" }
        : { kind: "replace", text: HEDGE_USER_VISIBLE };
    }
    if (
      looksLikeProseClarifyingQuestions(text) &&
      !turnHadSuccessfulRequestUserInput(input.messages)
    ) {
      return allowNudgeAskUser
        ? { kind: "nudge_ask_user" }
        : { kind: "ok", text };
    }
    return { kind: "ok", text };
  }

  // Успешный commit/push — отдельная завершённая задача. Текст коммита может
  // описывать UI-правки, но это не новая правка и не повод читать файлы заново.
  if (input.gitOperationCompleted) {
    return { kind: "ok", text };
  }

  const hadWrite =
    input.hadSuccessfulWrite === true ||
    precedingToolRoundHadSuccessfulWrite(input.messages);
  const claimsEdit =
    looksLikeClaimedFileChanges(text) || looksLikeManualPatchReply(text);
  const userWantsEdit = looksLikeUserEditRequest(input.userText);
  const hollow = looksLikeHollowStatusOrDeferral(text);
  const sharedClaim = looksLikeSharedLayoutChangeClaim(text);
  const sharedEdited = editedSharedLookingPath(input.messages);
  const searchedUsages = turnHadUsageSearch(input.messages);
  // Kimi only: honest clarifying (version / choice) without write is OK —
  // avoid MISSING_WRITE → long meta-thinking. Other models still get nudged.
  const clarifying = kimi && looksLikeMissingInfoQuestion(text);

  // Явная ложь «уже сделал» без успешного файлового edit
  if (!hadWrite && claimsEdit) {
    if (allowNudgeWrite) {
      return { kind: "nudge_write" };
    }
    return { kind: "replace", text: MISSING_WRITE_USER_VISIBLE };
  }

  // Успешный edit есть, но финал врёт «уже было / правок не потребовалось»
  if (hadWrite && looksLikeDeniedSuccessfulEdit(text)) {
    if (allowNudgeHollow) {
      return { kind: "nudge_denied_write" };
    }
    return { kind: "replace", text: DENIED_WRITE_USER_VISIBLE };
  }

  // Пользователь просил изменить, а модель говорит «уже так / менять нечего» без write
  if (
    !hadWrite &&
    userWantsEdit &&
    looksLikeRefusedRequestedEdit(text)
  ) {
    if (allowNudgeWrite) {
      return { kind: "nudge_write" };
    }
    return { kind: "replace", text: MISSING_WRITE_USER_VISIBLE };
  }

  // «Файл уже ок / я объяснил / скажи — перепишу» без содержания
  if (hollow) {
    if (allowNudgeHollow) {
      return { kind: "nudge_hollow" };
    }
    return { kind: "replace", text: HOLLOW_USER_VISIBLE };
  }

  // Shared UI layout claim/edit без поиска usages
  if (
    (sharedClaim || (hadWrite && sharedEdited)) &&
    !searchedUsages
  ) {
    if (allowNudgeImpact) {
      return { kind: "nudge_impact" };
    }
    return { kind: "replace", text: IMPACT_USER_VISIBLE };
  }

  // Follow-up на правку без write — дожимаем (кроме clarifying у Kimi).
  if (
    !hadWrite &&
    userWantsEdit &&
    allowNudgeWrite &&
    !clarifying
  ) {
    return { kind: "nudge_write" };
  }

  if (looksLikeHedgeOrUnfinishedAction(text)) {
    return allowNudgeHedge
      ? { kind: "nudge_hedge" }
      : { kind: "replace", text: HEDGE_USER_VISIBLE };
  }

  return { kind: "ok", text };
}
