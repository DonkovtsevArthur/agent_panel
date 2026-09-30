/**
 * Auto mode: pick the engine (agent / plan / ask) per user request, host-side.
 *
 * Deterministic keyword heuristic (RU + EN), in the spirit of the other
 * looksLike* helpers. No LLM call, no latency. Order matters:
 *   1. Build handoff ([[harbor:implement_plan]]) → always agent.
 *   2. Plan intent («составь план», «как лучше реализовать», "draft a plan") → plan.
 *   3. Russian imperative («добавь», «исправь»…) → agent. Imperative mood is
 *      unambiguous in Russian, so it wins over a question frame
 *      («почему падает и почини?» is a fix request).
 *   4. Question frame at sentence start («как/почему/what/how…») → ask.
 *   5. Russian collaborative offer («поменяем на 30?», «давай обновим») →
 *      agent. Action requests even with a trailing "?"; checked after the
 *      question frame so «как обновим?» stays a question.
 *   6. English imperative verb → agent (checked after the question frame so
 *      "how do I run tests?" stays a question).
 *   7. Explain / definition verbs («объясни», "explain") → ask.
 *   8. Trailing "?" → ask.
 *   9. Fallback → agent (in a coding panel an ambiguous prompt usually means
 *      "do it"; agent can still answer a question, ask cannot edit).
 *
 * Cyrillic notes: JS `\b` is ASCII-only, so Russian patterns rely on the
 * distinctive imperative morphology instead of word boundaries, and
 * `(?![а-яё])` guards question-word prefixes («как» ≠ «какой»). Imperative
 * stems also get a trailing `(?![а-яё])` (with optional polite `-те`) so
 * they do not match inside future/infinitive forms: «как обновим/обновить
 * файл?» stays a question while «обнови/обновите файл» is a command.
 */
import { looksLikePlanImplementRequest } from "./planImplement";

export const AUTO_MODE_ID = "auto";

export type AutoResolvedModeId = "agent" | "plan" | "ask";

const PLAN_INTENT_RE = new RegExp(
  [
    // «составь/сделай/предложи (мне) план…», «план реализации/рефакторинга…»
    "(?:составь|сделай|подготовь|предложи|набросай|нарисуй|сгенерируй)[а-яё]*\\s+(?:мне\\s+)?план",
    "план[а-яё]*\\s+(?:реализации|рефакторинга|миграции|работ|действий|изменений|тестирования|переделки)",
    // «как (лучше) реализовать/сделать/добавить…» — how-to-BUILD questions.
    "(?:как|каким\\s+образом)\\s+(?:лучше\\s+|правильнее\\s+|нам\\s+)?(?:реализовать|сделать|построить|организовать|спроектировать|добавить|создать|написать|переписать|рефакторить|мигрировать|протестировать)",
    "(?:предложи|подскажи)\\s+(?:план|подход|подходы|варианты?\\s+реализации)",
    "\\b(?:make|draft|create|write|prepare|propose|come\\s+up\\s+with)\\b[^.!?\\n]{0,30}\\bplan\\b",
    "\\b(?:implementation|migration|refactor)\\s+plan\\b",
    "\\bhow\\s+(?:should|would|could|can)\\s+(?:i|we|you)\\s+(?:implement|build|add|create|write|refactor|migrate|structure|design|approach)\\b",
    "\\bhow\\s+best\\s+to\\b",
  ].join("|"),
  "i"
);

const RU_IMPERATIVE_RE =
  /(?:добавь|исправь|поменяй|перепиши|отрефактори|порефактори|создай|сделай|реализуй|переименуй|закомменти|раскомменти|отформатируй|обнови|удали|запусти|перенеси|вынеси|поставь|установи|настрой|подними|почини|фиксни|пофикси|напиши|включи|выключи|верни|откат)(?:те)?(?![а-яё])/i;

/**
 * Collaborative offers: 1st-person-plural future («поменяем на 30?»,
 * «обновим», «сделаем») and the «давай(те)…» opener. These are action
 * requests even with a trailing "?", so they outrank the trailing-"?" rule.
 * They do NOT outrank QUESTION_FRAME_RE: «как обновим?» stays a question.
 * `[^а-яё]` before «давай» keeps it from matching inside «подавай».
 */
const RU_COLLAB_RE =
  /(?:^|[^а-яё])(?:давай(?:те)?|поменяем|обновим|сделаем|добавим|удалим|создадим|исправим|поправим|перепишем|переименуем|запустим|установим|настроим|поднимем|починим|напишем|включим|выключим|верн[её]м|перенес[её]м|вынесем|отформатируем|закомментируем|раскомментируем|реализуем|отрефакторим|порефакторим|поставим|протестируем|подключим|отключим|переключим|выложим|разбер[её]м)/i;

const QUESTION_FRAME_RE = new RegExp(
  [
    // RU start-of-text question words; (?![а-яё]) keeps «как» from eating «какой».
    "^(?:как|каким\\s+образом|почему|зачем|что|чем|где|когда|кто|кому|чему|кем|какой|какая|какое|какие|сколько|чья|можно\\s+ли|нужно\\s+ли|стоит\\s+ли|правда\\s+ли|действительно|есть\\s+ли)(?![а-яё])",
    "^(?:how|why|what|where|when|who|whom|whose|which|is|are|was|were|do|does|did|can|could|should|would|will|may|might|any)\\b",
  ].join("|"),
  "i"
);

const EN_IMPERATIVE_RE =
  /\b(?:add|create|make|build|fix|remove|delete|implement|refactor|rename|move|migrate|update|upgrade|write|change|set\s+up|install|configure|bump|extract|introduce|enable|disable|switch)\b/i;

const EXPLAIN_RE = new RegExp(
  [
    "(?:объясни|объясните|расскажи|расскажите|поясни|поясните|разъясни|опиши|опишите|что\\s+такое|что\\s+за|чем\\s+отличается|в\\s+ч[её]м\\s+разница|разница\\s+между|в\\s+ч[её]м\\s+отличие)",
    "\\b(?:explain|describe|walk\\s+me\\s+through|tell\\s+me\\s+about|what\\s+is|what\\s+are|difference\\s+between)\\b",
  ].join("|"),
  "i"
);

/**
 * Whether this turn needs a visible plan card (`update_todo`).
 * Skipping it saves a full LLM round-trip on short Q&A and one-liners.
 */
export function needsPlanCard(userText: string): boolean {
  const text = String(userText || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return true;
  }
  if (looksLikePlanImplementRequest(text)) {
    return true;
  }
  if (PLAN_INTENT_RE.test(text)) {
    return true;
  }
  if (EXPLAIN_RE.test(text) || /[?？]\s*$/.test(text)) {
    return false;
  }
  if (QUESTION_FRAME_RE.test(text) && text.length < 120) {
    return false;
  }
  if (RU_IMPERATIVE_RE.test(text) || EN_IMPERATIVE_RE.test(text)) {
    return (
      text.length >= 60 ||
      /(?:\n|;|,| и | and | затем | then | потом )/i.test(text)
    );
  }
  return text.length >= 100;
}

/**
 * Whether this turn should carry the verify_edits nudge. Pure Q&A /
 * explanations rarely edit files — skip the extra prompt tokens.
 * Short imperative fixes («почини X») still return true.
 */
export function needsVerifyNudge(userText: string): boolean {
  const text = String(userText || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return true;
  }
  if (EXPLAIN_RE.test(text)) {
    return false;
  }
  // Collaborative offers edit files — keep the verify nudge despite "?".
  if (RU_COLLAB_RE.test(text)) {
    return true;
  }
  if (/[?？]\s*$/.test(text)) {
    return false;
  }
  if (
    QUESTION_FRAME_RE.test(text) &&
    !RU_IMPERATIVE_RE.test(text) &&
    text.length < 120
  ) {
    return false;
  }
  return true;
}

/** Resolve the Auto picker choice into a concrete engine id for one turn. */
export function resolveAutoMode(userText: string): AutoResolvedModeId {
  const text = String(userText || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return "agent";
  }
  if (looksLikePlanImplementRequest(text)) {
    return "agent";
  }
  if (PLAN_INTENT_RE.test(text)) {
    return "plan";
  }
  if (RU_IMPERATIVE_RE.test(text)) {
    return "agent";
  }
  if (QUESTION_FRAME_RE.test(text)) {
    return "ask";
  }
  // Collaborative offers («поменяем на 30?», «давай обновим») are actions
  // phrased with a trailing "?", not questions — agent, not ask.
  if (RU_COLLAB_RE.test(text)) {
    return "agent";
  }
  if (EN_IMPERATIVE_RE.test(text)) {
    return "agent";
  }
  if (EXPLAIN_RE.test(text)) {
    return "ask";
  }
  if (/[?？]\s*$/.test(text)) {
    return "ask";
  }
  return "agent";
}
