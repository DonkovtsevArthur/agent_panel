/**
 * Ответы вроде «Если TS ругается… попробую пересобрать» —
 * гадание вместо проверки инструментами.
 * Также: анонс будущей работы без tool calls («Создаю файлы. Начну…»).
 */
export function looksLikeHedgeOrUnfinishedAction(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) {
    return false;
  }
  const value = raw.toLowerCase().replace(/ё/g, "е");

  const unfinishedTail =
    /[:…]\s*$/.test(raw) ||
    /\b(попробую|давайте попробуем|сейчас проверю|сейчас пересоберу|i'?ll try|let me try|let me rebuild|i will rebuild)\b/i.test(
      raw
    );

  const hedgeNeedles = [
    "если typescript ругается",
    "если ts ругается",
    "если компилятор ругается",
    "возможно, index.ts",
    "ещё не подхватился",
    "еще не подхватился",
    "не подхватился",
    "попробую пересобрать",
    "пересобрать, чтобы проверить",
    "чтобы проверить:",
    "возможно стоит",
    "возможно, стоит",
    "может быть нужно",
    "might not have been picked up",
    "may not have been picked up",
    "if typescript complains",
    "if tsc complains",
    "try rebuilding",
    "i'll try to rebuild",
    "i will try to rebuild",
    "let me rebuild to check",
  ];

  if (hedgeNeedles.some((n) => value.includes(n))) {
    return true;
  }

  // «Возможно…» + обещание действия без фактов
  if (
    unfinishedTail &&
    (/\bвозможно\b/.test(value) ||
      /\bprobably\b/.test(value) ||
      /\bmight\b/.test(value) ||
      /\bmaybe\b/.test(value))
  ) {
    return true;
  }

  // Короткий анонс будущей работы вместо tool call
  // («Создаю файлы. Начну с обновления путей…»).
  if (raw.length <= 400 && looksLikeFutureWorkAnnouncement(value)) {
    return true;
  }

  return false;
}

function looksLikeFutureWorkAnnouncement(value: string): boolean {
  const starters = [
    /^создаю(\s|$|[.,!?])/,
    /^создам(\s|$|[.,!?])/,
    /^пишу(\s|$|[.,!?])/,
    /^напишу(\s|$|[.,!?])/,
    /^добавляю(\s|$|[.,!?])/,
    /^добавлю(\s|$|[.,!?])/,
    /^обновляю(\s|$|[.,!?])/,
    /^обновлю(\s|$|[.,!?])/,
    /^начинаю(\s|$|[.,!?])/,
    /^начну(\s|$|[.,!?])/,
    /^сейчас (сделаю|создам|напишу|добавлю|обновлю|исправлю)(\s|$|[.,!?])/,
    /^i('?ll| will) (create|write|add|update|start|implement)\b/,
    /^let me (create|write|add|update|start|implement)\b/,
    /^creating\b/,
    /^i('?m| am) (creating|writing|adding|updating|starting)\b/,
  ];
  if (starters.some((re) => re.test(value))) {
    return true;
  }
  // «… Начну с …» — план без факта правки (без JS \b: кириллица не word-char)
  const unfinished =
    /(^|[^\p{L}\p{N}_])(начну|начинаю|сейчас сделаю|сейчас создам)([^\p{L}\p{N}_]|$)/u.test(
      value
    ) ||
    /\b(i'?ll start|let me start|i will start)\b/i.test(value);
  const done =
    /(^|[^\p{L}\p{N}_])(готово|сделано|исправил|добавил|создал|написала?|wrote|created|added|done)([^\p{L}\p{N}_]|$)/u.test(
      value
    );
  if (unfinished && !done) {
    return true;
  }
  return false;
}
