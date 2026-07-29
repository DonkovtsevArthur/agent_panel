/**
 * Эвристики «ложная готовность» / запрос на правку кода.
 * Без vscode — тестируется отдельно.
 *
 * Важно: в JS `\b` не работает с кириллицей (\\w = только ASCII),
 * поэтому для русского используем includes/стемы, не \\b.
 */

function hasAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

export function looksLikeClaimedFileChanges(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) {
    return false;
  }
  const value = raw.toLowerCase();

  const claimNeedles = [
    "вот что исправлено",
    "вот что сделано",
    "что исправлено",
    "что сделано",
    "изменения применены",
    "правки внесены",
    "я исправил",
    "я поправил",
    "я переименовал",
    "я обновил",
    "я добавил",
    "я переписал",
    "я вернул",
    "я убрал",
    "я удалил",
    "я восстановил",
    "я сделал",
    "переименована",
    "переименован",
    "переписан корректно",
    "переписал структуру",
    "переписала структуру",
    "перезаписал файл",
    "перезаписала файл",
    "перезаписал",
    "перезаписала",
    "файл обновл",
    "файлы обновл",
    "файл уже содержит",
    "уже содержит нужные",
    "изменения уже есть",
    "вернул проп",
    "вернул props",
    "вернул кнопку",
    "вернула кнопку",
    "вернул на место",
    "вернула на место",
    "обратно внутрь",
    "восстановил проп",
    "поставил обратно",
    "оставил проп",
    "пропсы на месте",
    "пропсы снова",
    "ничего не сломается",
    "теперь не рендер",
    "теперь кнопка",
    "кнопка отмены теперь",
    "here is what i changed",
    "here's what i changed",
    "what i changed",
    "i've renamed",
    "i renamed",
    "i've fixed",
    "i fixed",
    "i've updated",
    "i updated",
    "i've applied",
    "i restored",
    "i returned the",
    "put back the",
    "changes applied",
    "won't break",
    "nothing will break",
  ];
  if (hasAny(value, claimNeedles)) {
    return true;
  }

  const pastEdit = hasAny(value, [
    "вернул",
    "вернула",
    "вернули",
    "убрал",
    "убрала",
    "убрали",
    "удалил",
    "удалила",
    "удалили",
    "добавл",
    "поменял",
    "поменяла",
    "изменил",
    "изменила",
    "заменил",
    "заменила",
    "исправил",
    "исправила",
    "поправил",
    "поправила",
    "переписал",
    "переписала",
    "перезаписал",
    "перезаписала",
    "переименовал",
    "переименовала",
    "восстановил",
    "восстановила",
    "вынес",
    "вынесла",
    "перенес",
    "перенесла",
    "перенесли",
    "вырезал",
    "вырезала",
    "сделал",
    "сделала",
    "оставил",
    "оставила",
    "rewrote",
    "restored",
    "moved",
    "returned",
  ]);

  const codeSignals = hasAny(value, [
    "prop",
    "проп",
    "import",
    "export",
    ".tsx",
    ".ts",
    ".jsx",
    ".js",
    "component",
    "компонент",
    "кнопк",
    "button",
    "файл",
    "file",
    "функци",
    "function",
    "interface",
    "рендер",
    "render",
    "cancel",
    "content",
    "flex",
    "heading",
    "структур",
    "closebutton",
    "layout",
    "css",
    "className",
    "classname",
  ]);

  if (pastEdit && codeSignals) {
    return true;
  }

  if (
    value.includes("теперь") &&
    codeSignals &&
    hasAny(value, ["рендер", "работа", "появл", "скрыв", "не показ", "disabled"])
  ) {
    return true;
  }

  const startsDone = /^(готово|done|fixed|исправлено|сделано)([!.:\s]|$)/i.test(
    raw
  );
  if (startsDone && (pastEdit || codeSignals)) {
    return true;
  }

  const fenceCount = (raw.match(/```/g) || []).length;
  if (fenceCount >= 2 && raw.length >= 500) {
    return true;
  }

  return false;
}

/** Просьба вставить/применить код вручную вместо write_file. */
export function looksLikeManualPatchReply(text: string): boolean {
  const value = String(text || "").trim().toLowerCase();
  if (!value) {
    return false;
  }
  const needles = [
    "вставь",
    "вставьте",
    "замени",
    "замените",
    "добавь в проект",
    "добавьте в проект",
    "подготовил точные изменения",
    "точные изменения",
    "ручного применения",
    "ручного внесени",
    "вручную",
    "инструменты редактирования",
    "редактирование файлов сейчас недоступ",
    "недоступны",
    "недоступно",
    "apply these changes",
    "insert this code",
    "replace with",
    "paste this into",
    "manual application",
    "apply manually",
    "editing tools",
    "currently unavailable",
    "tools are unavailable",
    "file editing tools",
  ];
  return hasAny(value, needles);
}

/** Пользователь просит/уточняет правку кода — без write_file финал подозрителен. */
export function looksLikeUserEditRequest(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) {
    return false;
  }
  const value = raw.toLowerCase();

  const needles = [
    "верни",
    "вернуть",
    "вернул",
    "зачем ты",
    "зачем убрал",
    "зачем удалил",
    "не убирай",
    "не удаляй",
    "исправ",
    "поправ",
    "пофикси",
    "добавь",
    "убери",
    "удали",
    "переименуй",
    "перепиши",
    "сделай",
    "реализуй",
    "внеси",
    "по плану",
    "давай сделаем",
    "apply",
    "fix",
    "rename",
    "restore",
    "put back",
    "don't remove",
    "why did you remove",
    "why remove",
  ];
  if (hasAny(value, needles)) {
    return true;
  }

  if (
    /^(а зачем|зачем|верни|не надо|нет,|нет\b)/i.test(raw) &&
    raw.length < 240
  ) {
    return true;
  }

  return false;
}
