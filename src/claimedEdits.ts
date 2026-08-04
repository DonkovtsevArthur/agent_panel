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
    "исправлено:",
    "исправлено —",
    "исправлено -",
    "**исправлено**",
    "✅ исправ",
    "✅исправ",
    "роут изменен",
    "роут изменён",
    "изменен на",
    "изменён на",
    "изменена на",
    "путь изменен",
    "путь изменён",
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
    "route updated",
    "route changed",
    "path updated",
    "path changed",
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
    "исправлено",
    "исправлена",
    "поправил",
    "поправила",
    "изменен",
    "изменён",
    "изменена",
    "изменены",
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
    "роут",
    "route",
    "path",
    "paths",
    "navigate",
    "model.tsx",
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

  const startsDone =
    /^(?:✅\s*)?(?:\*\*)?(готово|done|fixed|исправлено|сделано)(?:\*\*)?([!.:\s]|$)/i.test(
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
  if (looksLikeEditVerificationRequest(raw)) {
    return true;
  }
  const value = raw.toLowerCase().replace(/ё/g, "е");

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
    "поменяй",
    "поменяем",
    "поменять",
    "измени верси",
    "подними верси",
    "смени верси",
    "bump version",
    "change version",
    "update version",
    "сделай",
    "реализуй",
    "реализац",
    "приступ",
    "внеси",
    "по плану",
    "давай сделаем",
    "давай реализ",
    "implement",
    "implementation",
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

  // «по этому / твоему / следующему плану»
  if (
    /(?:^|[^\p{L}\p{N}_])по\s+\S{0,24}\s*плану(?:[^\p{L}\p{N}_]|$)/iu.test(
      value
    ) ||
    /(?:^|[^\p{L}\p{N}_])по\s+плану(?:[^\p{L}\p{N}_]|$)/iu.test(value)
  ) {
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

/**
 * Short follow-up that challenges a prior edit («а в роутах поменял?»).
 * Not a pure Q&A — Agent must keep write tools and either fix or honestly say no.
 */
export function looksLikeEditVerificationRequest(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 280) {
    return false;
  }
  const value = raw.toLowerCase().replace(/ё/g, "е");
  const pastVerbs = [
    "поменял",
    "поменяла",
    "изменил",
    "изменила",
    "исправил",
    "исправила",
    "поправил",
    "поправила",
    "добавил",
    "добавила",
    "убрал",
    "убрала",
    "удалил",
    "удалила",
    "заменил",
    "заменила",
    "сделал",
    "сделала",
    "вернул",
    "вернула",
    "обновил",
    "обновила",
    "перенес",
    "перенесла",
    "fixed",
    "changed",
    "updated",
    "added",
    "removed",
    "renamed",
  ];
  if (!hasAny(value, pastVerbs)) {
    return false;
  }
  if (/[?？]/.test(raw)) {
    return true;
  }
  if (/^(?:так\s+)?а\s+/i.test(raw)) {
    return true;
  }
  if (/^(?:did you|have you)\b/i.test(raw)) {
    return true;
  }
  return false;
}

/**
 * Вопрос / просьба объяснить — в Agent режиме можно отвечать как Ask
 * (readonly tools, без правок). Не срабатывает, если это запрос на правку.
 */
export function looksLikeQuestionRequest(text: string): boolean {
  const raw = String(text || "").trim();
  if (
    !raw ||
    looksLikeUserEditRequest(raw) ||
    looksLikeEditVerificationRequest(raw)
  ) {
    return false;
  }

  if (/[?？]\s*$/u.test(raw) || /[?？]/u.test(raw.slice(0, 280))) {
    return true;
  }

  const head = raw.slice(0, 160).toLowerCase();
  // JS `\b` is ASCII-only — do not use it after Cyrillic tokens.
  const ruStarters = [
    "что ",
    "что\u00a0",
    "как ",
    "как\u00a0",
    "почему ",
    "зачем ",
    "где ",
    "откуда ",
    "когда ",
    "какой ",
    "какая ",
    "какие ",
    "какое ",
    "кто ",
    "сколько ",
    "чем ",
    "в чём ",
    "в чем ",
    "можно ли ",
    "есть ли ",
    "верно ли ",
    "правильно ли ",
    "расскажи ",
    "объясни ",
    "поясни ",
    "покажи ",
    "посмотри ",
    "посомтри ",
    "посмотрим ",
    "разбери ",
    "проанализируй ",
    "найди ",
    "найти ",
    "найди,",
    "найти,",
    "поищи ",
    "где определяется ",
    "где объявлен ",
    "где объявлена ",
    "где объявлено ",
    "где используется ",
    "где лежит ",
    "что такое ",
    "как работает ",
    "в чём разница ",
    "в чем разница ",
  ];
  if (ruStarters.some((prefix) => head.startsWith(prefix))) {
    return true;
  }
  // «давай (внимательно) посмотрим / посмотри …» без edit-глаголов
  if (
    /(?:^|[^\p{L}\p{N}_])давай\s+(?:внимательно\s+)?(?:посмотрим|посмотри|посомтри)\b/iu.test(
      head
    )
  ) {
    return true;
  }

  const enStarters = [
    /^what\b/i,
    /^how\b/i,
    /^why\b/i,
    /^where\b/i,
    /^when\b/i,
    /^which\b/i,
    /^who\b/i,
    /^find\b/i,
    /^locate\b/i,
    /^search\b/i,
    /^explain\b/i,
    /^describe\b/i,
    /^tell me\b/i,
    /^can you (explain|tell|describe|clarify|find)\b/i,
    /^could you (explain|tell|describe|clarify|find)\b/i,
    /^is there\b/i,
    /^are there\b/i,
    /^does\b/i,
    /^is it\b/i,
  ];
  if (enStarters.some((re) => re.test(head))) {
    return true;
  }

  const body = raw.toLowerCase();
  const midNeedles = [
    "что такое",
    "как работает",
    "в чём разница",
    "в чем разница",
    "чем отличается",
    "зачем нужен",
    "зачем нужна",
    "для чего",
    "где определяется",
    "где объявлен",
    "где объявлена",
    "где используется",
    "откуда попадаем",
    "откуда мы попадаем",
    "откуда переход",
    "откуда навиг",
    "откуда откры",
    "откуда вызыва",
    "куда попадаем",
    "what is",
    "how does",
    "how do",
    "where is",
    "where does",
    "where do we",
    "how do we get to",
    "find where",
    "difference between",
  ];
  return hasAny(body, midNeedles);
}
