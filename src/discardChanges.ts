/** Явная команда пользователя отбросить все локальные изменения. */
export function looksLikeDiscardAllChangesRequest(text: string): boolean {
  const value = String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
  if (
    !value ||
    value === "как" ||
    value.startsWith("как ") ||
    value.startsWith("почему ") ||
    value.startsWith("зачем ")
  ) {
    return false;
  }
  if (
    /(не|не надо|не нужно)\s+(убир|убер|убр|откат|отмен|сброс|удал)/.test(
      value
    )
  ) {
    return false;
  }

  const action =
    /(убир|убер|убр|откат|отмен|сброс|discard|revert|restore|reset|undo)/.test(
      value
    );
  const all = /(все|всё|all)/.test(value);
  const changes = /(измен|правк|change|local change)/.test(value);
  return action && all && changes;
}

/** Короткая команда отката без указания файла, коммита или набора изменений. */
export function looksLikeAmbiguousRestoreRequest(text: string): boolean {
  const value = String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return /^(верни|вернуть|верни назад|откати|откатить|отмени|отменить|восстанови|восстановить|restore|revert|undo)$/.test(
    value
  );
}
