/**
 * Harbor TDD-mode rules (localized), injected into the Cline system-prompt
 * rules slot when the composer TDD toggle is on for an agent-capable mode.
 */
export function harborTddModeRulesForLanguage(lang: "en" | "ru"): string {
  if (lang === "ru") {
    return [
      "# Режим: TDD (Harbor)",
      "Пользователь включил TDD. Для изменения поведения кода работай строго по red-green-refactor.",
      "",
      "## Красный",
      "Сначала напиши или поправь падающий тест, который фиксирует новое/исправленное поведение.",
      "Запусти тест и убедись, что он падает именно по ожидаемой причине (не по опечатке/импорту).",
      "",
      "## Зелёный",
      "Пиши ровно столько production-кода, сколько нужно, чтобы тест прошёл — не больше.",
      "Прогоняй минимальный таргет (один тестовый файл/фильтр); смежные тесты или полный suite — только если менялся общий модуль. Не переходи дальше, пока зелёный.",
      "",
      "## Рефактор",
      "Только при зелёном тесте: улучшай структуру, не меняя поведения.",
      "Повторно прогоняй затронутые тесты после каждого шага рефакторинга.",
      "",
      "## Жёсткие правила",
      "Не пиши новую фичу / исправление поведения без теста, который без этого изменения падает.",
      "Не ослабляй и не удаляй существующие проверки только чтобы «получить зелёный»; если тест неверен — явно объясни почему и предложи замену.",
      "Не выдавай финал за «готово», пока целевой тест(ы) не прогнаны и не показали успех.",
      "Q&A без изменения кода, чистка docs/комментариев/конфигов и чистый rename без смены поведения можно делать без TDD-цикла — но любой diff, меняющий runtime-поведение, идёт через красный→зелёный→рефактор.",
      "Если тестовый фреймворк/команда тестов в проекте неизвестны — сначала найди их в repo (package.json / Makefile / CI), не изобретай свой runner.",
      "Финальные проверки (тесты + type-check + lint) объединяй в минимальное число команд, если проект это позволяет.",
    ].join("\n");
  }
  return [
    "# Mode: TDD (Harbor)",
    "The user enabled TDD. For code-behavior changes, follow red-green-refactor strictly.",
    "",
    "## Red",
    "First write or adjust a failing test that captures the new/fixed behavior.",
    "Run it and confirm it fails for the right reason (not a typo / missing import).",
    "",
    "## Green",
    "Write only as much production code as needed to make that test pass — no more.",
    "Run the narrowest target (one test file / filter); nearby tests or full suite only if a shared module changed. Do not proceed until green.",
    "",
    "## Refactor",
    "Only while green: improve structure without changing behavior.",
    "Re-run affected tests after each refactor step.",
    "",
    "## Hard rules",
    "Do not ship a behavior fix or feature without a test that fails without that change.",
    "Do not weaken or delete existing checks just to go green; if a test is wrong, say why and propose a replacement.",
    "Do not claim done until the target test(s) have been run and passed.",
    "Q&A with no code change, pure docs/comments/config cleanup, and behavior-preserving renames may skip the TDD cycle — but any runtime-behavior diff goes red→green→refactor.",
    "If the project's test framework/commands are unknown, discover them first (package.json / Makefile / CI) — do not invent a runner.",
    "Combine final checks (tests + type-check + lint) into as few commands as the project allows.",
  ].join("\n");
}
