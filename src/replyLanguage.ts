/**
 * Reply-language guard. Flash-tier models (DeepSeek, Qwen, GLM…) drift into
 * Chinese at the end of long turns: the language rule lives only in the
 * system prompt, while the context fills with English code, logs and tool
 * output. Harbor therefore
 *  1) appends a short language nudge to every turn's runtime prompt, and
 *  2) checks the finale — a reply that is mostly CJK while the UI is ru/en
 *     (and the user did not write CJK themselves) gets ONE follow-up on the
 *     same live session asking to rewrite it in the UI language.
 *
 * Pure helpers (no vscode) — tests import them from out/.
 */
import type { UiLanguage } from "./i18n";

/** Han, kana, Hangul and CJK punctuation / full-width forms. */
const CJK_RE =
  /[　-〿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/g;
const CJK_LETTER_RE =
  /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/g;
const LETTER_RE = /[A-Za-zÀ-ɏЀ-ӿ]/g;

/** Minimum CJK letters before a reply counts as «drifted». */
export const REPLY_LANGUAGE_MIN_CJK = 12;
/**
 * Share of CJK among letters. One Han character is roughly a word while a
 * Latin/Cyrillic word is ~5–7 letters, so 0.2 already means «mostly CJK».
 */
export const REPLY_LANGUAGE_CJK_SHARE = 0.2;

/**
 * Prose only: fenced code, inline code, URLs and paths are quoted material —
 * a Chinese string inside a code sample must not trigger a rewrite.
 */
export function stripQuotedMaterial(text: string): string {
  return String(text || "")
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/(?:^|\s)(?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)+/g, " ");
}

export interface ScriptStats {
  cjk: number;
  letters: number;
}

export function scriptStats(text: string): ScriptStats {
  const prose = stripQuotedMaterial(text);
  const cjk = (prose.match(CJK_LETTER_RE) || []).length;
  const other = (prose.match(LETTER_RE) || []).length;
  return { cjk, letters: cjk + other };
}

/** The text is (mostly) written in a CJK language. */
export function isMostlyCjk(text: string): boolean {
  const { cjk, letters } = scriptStats(text);
  return (
    cjk >= REPLY_LANGUAGE_MIN_CJK &&
    letters > 0 &&
    cjk / letters >= REPLY_LANGUAGE_CJK_SHARE
  );
}

/**
 * True when the finale should be rewritten: the reply is mostly CJK, the UI
 * language is ru/en, and the user's own message has no CJK (a user writing
 * Chinese gets a Chinese answer).
 */
export function needsReplyLanguageRewrite(
  reply: string,
  userText: string,
  lang: UiLanguage
): boolean {
  if (lang !== "ru" && lang !== "en") {
    return false;
  }
  const user = stripQuotedMaterial(userText);
  if ((user.match(CJK_RE) || []).length >= 2) {
    return false;
  }
  return isMostlyCjk(reply);
}

/**
 * Every turn: models heed turn-local nudges more reliably than rules, and the
 * line also reaches sessions whose system prompt was built earlier.
 */
export function replyLanguageUserNudge(lang: UiLanguage): string {
  return lang === "ru"
    ? "[Harbor] Пиши ответ и промежуточные сообщения на русском — даже если в контексте много английского или китайского (код, логи, вывод инструментов). Подписи, заголовки и подготовленные тексты (описание MR, комментарии) тоже на русском. Идентификаторы, пути и команды оставляй как есть."
    : "[Harbor] Write your reply and interim messages in English — even when the context is full of other languages (code, logs, tool output). Labels, headings and drafted texts (MR description, comments) too. Keep identifiers, paths and commands as-is.";
}

export function appendReplyLanguageRuntimeNudge(
  userText: string,
  lang: UiLanguage
): string {
  const base = String(userText || "").trim();
  const nudge = replyLanguageUserNudge(lang);
  return base ? `${base}\n\n${nudge}` : nudge;
}

/** One-shot follow-up on the same session: rewrite, do not redo the work. */
export function replyLanguageRewritePrompt(lang: UiLanguage): string {
  return lang === "ru"
    ? "[Harbor] Твой последний ответ написан не на русском. Перепиши его целиком на русском: тот же смысл, та же структура, те же пути, код и команды. Инструменты не вызывай, работу не повторяй — только ответ на русском."
    : "[Harbor] Your last reply is not in English. Rewrite it fully in English: same meaning, same structure, same paths, code and commands. Do not call tools or redo the work — only the reply in English.";
}

export function replyLanguageRetryLabel(lang: UiLanguage): string {
  return lang === "ru"
    ? "Модель ответила не на языке интерфейса — прошу переписать на русском"
    : "The model replied in another language — asking to rewrite it in English";
}
