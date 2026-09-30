/**
 * Detect assistant turns that end without tool calls but are clearly not a
 * final answer (flash-tier models often narrate «проверю…» / "I'll check…"
 * and stop). Harbor then injects one short nudge via the live Cline session
 * so the loop continues instead of closing on a dangling preamble.
 */
import type { UiLanguage } from "./i18n";

export type UnfinishedTurnKind = "empty" | "tool-announce";

/** Max auto-continue nudges per Harbor turn (bounded — no infinite loops). */
export const MAX_TOOL_CONTINUE_ATTEMPTS = 2;

/**
 * JS `\b` is ASCII-only — it does not bind to Cyrillic (see autoMode.ts).
 * RU verbs therefore use `(?![а-яё])` as the trailing guard instead.
 */
const RU_TOOL_VERB =
  "проверю|открою|прочитаю|прогоню|запущу|посмотрю|взгляну|вызову|обновлю|изменю|поменяю|сделаю|начну|применю|выполню";
const RU_ANNOUNCE = `(?:сначала\\s+|затем\\s+|теперь\\s+|далее\\s+)?(?:я\\s+)?(?:${RU_TOOL_VERB})(?![а-яё])`;
const EN_ANNOUNCE =
  "\\b(?:i(?:'ll|\\s+will)|let\\s+me|going\\s+to|will)\\s+(?:check|open|read|run|look\\s+at|update|change|bump|edit|inspect|start|grab|fetch|apply|execute)\\b";

/** Future / imminent tool use in the closing part of the message. */
const TOOL_ANNOUNCE_RE = new RegExp(
  [RU_ANNOUNCE, EN_ANNOUNCE].join("|"),
  "i"
);

/** Last sentence is pure a future tool step (even when it ends with `.`). */
const LAST_SENTENCE_ANNOUNCE_RE = new RegExp(
  [`^\\s*${RU_ANNOUNCE}`, `^\\s*${EN_ANNOUNCE}`].join("|"),
  "i"
);

/**
 * The same sentence already delivers the answer («проверю позже, а пока вот
 * ответ: 42») — then it is a completed reply, not a dangling preamble.
 */
const LAST_SENTENCE_ANSWER_RE =
  /(?:а\s+пока|но\s+однако|однако|но\s+вот|вот\s+ответ|вот\s+итог|тем\s+не\s+менее|при\s+этом|however|but\s+here|the\s+answer\s+is|here(?:'s| is) (?:the )?answer)/i;

/**
 * Classify the assistant text of a turn that produced no tool calls.
 * Returns `null` when the text looks like a real final answer.
 */
export function detectUnfinishedAssistantTurn(
  text: string
): UnfinishedTurnKind | null {
  const value = String(text || "").trim();
  if (!value) {
    return "empty";
  }
  // Announce detection only near the end so «проверю позже, а пока ответ: 42»
  // stays a completed answer.
  const tail = value.length <= 280 ? value : value.slice(-280);
  if (!TOOL_ANNOUNCE_RE.test(tail)) {
    return null;
  }
  if (/[:：…]\s*$/.test(value)) {
    return "tool-announce";
  }
  if (!/[.!?]\s*$/.test(value)) {
    return "tool-announce";
  }
  const lastSentence = value.split(/(?<=[.!?])\s+/).pop() || "";
  if (
    lastSentence.length < 120 &&
    LAST_SENTENCE_ANNOUNCE_RE.test(lastSentence) &&
    !LAST_SENTENCE_ANSWER_RE.test(lastSentence)
  ) {
    return "tool-announce";
  }
  return null;
}

/**
 * Nudge injected as a follow-up user prompt on the same Cline session.
 * Short and imperative — flash models drop long instructions.
 */
export function toolContinueNudgePrompt(
  kind: UnfinishedTurnKind,
  lang: UiLanguage
): string {
  if (lang === "ru") {
    return kind === "empty"
      ? "[Harbor] Предыдущий ответ получился пустым. Вызови нужные инструменты (read_files / editor / run_commands) и доведи задачу до конца, либо дай готовый финальный ответ. Не останавливайся на обещаниях."
      : "[Harbor] Ты объявил(а) инструменты, но не вызвал(а) ни одного. Немедленно вызови нужные инструменты (read_files / editor / run_commands и т.п.) и доведи задачу до конца. Если инструменты не нужны — дай готовый финальный ответ без обещаний.";
  }
  return kind === "empty"
    ? "[Harbor] The previous reply was empty. Call the needed tools (read_files / editor / run_commands) and finish the task, or give a complete final answer. Do not stop at promises."
    : "[Harbor] You announced tool use but made no tool calls. Call the needed tools now (read_files / editor / run_commands etc.) and finish the task. If no tools are needed, give a complete final answer without promises.";
}
