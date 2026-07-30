/**
 * Ответы вроде «Если TS ругается… попробую пересобрать» —
 * гадание вместо проверки инструментами.
 */
export function looksLikeHedgeOrUnfinishedAction(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) {
    return false;
  }
  const value = raw.toLowerCase();

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

  return false;
}
