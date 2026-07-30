/**
 * «Файл уже ок / я объяснил / скажи — перепишу» без реального объяснения в ответе.
 * Без \\b для кириллицы — в JS word-boundary ломается на русском.
 */

function hasAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

export function looksLikeHollowStatusOrDeferral(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) {
    return false;
  }
  const value = raw.toLowerCase();

  const needles = [
    "файл уже содержит",
    "уже содержит нужные",
    "уже содержит нужн",
    "уже всё на месте",
    "уже все на месте",
    "изменения уже есть",
    "я просто объяснил",
    "я объяснил почему",
    "я уже объяснил",
    "как я объяснил",
    "просто объяснил",
    "скажи, перепишу",
    "скажи — перепишу",
    "скажи перепишу",
    "скажи — и перепишу",
    "скажи, переделаю",
    "скажи — переделаю",
    "скажи переделаю",
    "если тебе нужно",
    "если нужно вернуть",
    "если нужно — скажи",
    "если нужно, скажи",
    "вернуть обратно внутрь",
    "вернуть её на старое",
    "вернуть ее на старое",
    "already contains the needed",
    "already has the needed",
    "file already contains",
    "i just explained",
    "i already explained",
    "as i explained",
    "say so, i'll",
    "say so and i'll",
    "tell me and i'll rewrite",
    "if you need me to",
  ];
  if (hasAny(value, needles)) {
    return true;
  }

  // «Скажи / дай знать» + обещание переписать/вернуть
  if (
    hasAny(value, ["скажи", "дай знать", "confirm", "let me know"]) &&
    hasAny(value, [
      "перепишу",
      "переделаю",
      "верну",
      "сделаю",
      "rewrite",
      "restore",
      "fix",
      "move",
    ])
  ) {
    return true;
  }

  // Модель нашла устаревший тест, но перекладывает очевидное обновление
  // ожидания на пользователя вместо завершения изменения поведения.
  if (
    hasAny(value, ["тест", ".test.", ".spec.", "test ", "spec "]) &&
    hasAny(value, [
      "ожидает",
      "будет падать",
      "теперь падает",
      "expects",
      "will fail",
      "failing",
    ]) &&
    hasAny(value, [
      "нужно обновить",
      "обновить ожидание",
      "обновить тест",
      "обновить?",
      "should i update",
      "update the expectation?",
      "update the test?",
    ])
  ) {
    return true;
  }

  // Утверждает, что объяснил, но в сообщении почти нет содержания
  if (
    hasAny(value, ["объяснил", "explained"]) &&
    raw.length < 280 &&
    !hasAny(value, [
      "потому что",
      "because",
      "из-за",
      "figma",
      "макет",
      "слева",
      "справа",
      "left",
      "right",
    ])
  ) {
    return true;
  }

  return false;
}

/** Описание правки shared UI без проверки потребителей. */
export function looksLikeSharedLayoutChangeClaim(text: string): boolean {
  const value = String(text || "").trim().toLowerCase();
  if (!value) {
    return false;
  }
  const moved = hasAny(value, [
    "перенес",
    "перенесла",
    "вынес",
    "вынесла",
    "вернул кнопку",
    "внутрь .content",
    "за пределы",
    "отдельным элементом",
    "структура совпадала",
    "структуре совпадала",
    "flex-ряду",
    "flex ряду",
  ]);
  const ui = hasAny(value, [
    "кнопк",
    "closebutton",
    "button",
    "content",
    "component",
    "компонент",
    "карточки",
    "figma",
    "макет",
  ]);
  return moved && ui;
}
