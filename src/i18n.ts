import * as vscode from "vscode";

export type UiLanguage = "en" | "ru";
export type UiLanguageSetting = "auto" | UiLanguage;

export function resolveUiLanguage(setting: UiLanguageSetting): UiLanguage {
  if (setting === "en" || setting === "ru") {
    return setting;
  }
  const raw = String(vscode.env.language || "").toLowerCase();
  return raw.startsWith("ru") ? "ru" : "en";
}

export function defaultSystemPromptForLanguage(lang: UiLanguage): string {
  if (lang === "ru") {
    return "Ты — coding-агент в VS Code. Отвечай кратко на русском. В каждом запросе тебе передаются дата/время и состояние редактора (активный файл, курсор, выделение, открытые вкладки) — опирайся на них. У тебя есть инструменты: list_files, read_file, write_file, run_command, fetch_url, open_external. Для git status/log/diff и любых shell-команд используй run_command — не проси пользователя запускать их вручную. Чтобы открыть http(s) ссылку в браузере пользователя, вызывай open_external; чтобы самому прочитать страницу — fetch_url. Для Figma — MCP tools, если подключены. Никогда не говори, что не можешь открывать внешние URL.";
  }
  return "You are a coding agent in VS Code. Reply concisely in English. Each request includes the current date/time and editor state (active file, cursor, selection, open tabs) — use it. You have these tools: list_files, read_file, write_file, run_command, fetch_url, open_external. For git status/log/diff and any shell command, use run_command instead of asking the user to run it manually. To open an http(s) link in the user's browser, call open_external; to read a page yourself, call fetch_url. For Figma use MCP tools when connected. Never claim you cannot open external URLs.";
}

/**
 * Harbor-specific rules injected into the Cline base prompt's {{CLINE_RULES}} slot.
 * Returns ONLY Harbor additions (language, git/Figma/URL conventions) — the base
 * prompt (env block, tool list, parallelism, plan/act) is provided by Cline itself.
 * Used when the user has not customized the system prompt in Settings.
 */
export function harborDefaultRulesForLanguage(lang: UiLanguage): string {
  if (lang === "ru") {
    return [
      "# Harbor Agents",
      "Отвечай кратко на русском.",
      "Для git status/log/diff и любых shell-команд используй run_command — не проси пользователя запускать их вручную.",
      "Чтобы открыть http(s) ссылку в браузере пользователя, вызывай open_external; чтобы самому прочитать страницу — fetch_url. Никогда не говори, что не можешь открывать внешние URL, и не выдумывай требования авторизации.",
      "Для Figma используй MCP-инструменты, если подключены (Settings → MCP Servers).",
    ].join("\n");
  }
  return [
    "# Harbor Agents",
    "Reply concisely in English.",
    "For git status/log/diff and any shell command, use run_command instead of asking the user to run it manually.",
    "To open an http(s) link in the user's browser, call open_external; to read a page yourself, call fetch_url. Never claim you cannot open external URLs, and do not invent authorization requirements.",
    "For Figma use MCP tools when connected (Settings → MCP Servers).",
  ].join("\n");
}

/**
 * Injected into Cline rules only when Settings → Parallel agents is on
 * (`enableSpawnAgent`). When off, spawn_agent is not registered and this
 * text is omitted.
 */
export function harborSubagentsRulesForLanguage(lang: UiLanguage): string {
  if (lang === "ru") {
    return [
      "# spawn_agent — ДОСТУПЕН",
      "В этом ходе у тебя есть tool spawn_agent (параллельные субагенты). Никогда не пиши, что субагенты/параллельные агенты недоступны — это ложь.",
      "Рабочий паттерн (как у зрелых coding-агентов):",
      "1) При необходимости быстро собери каркас (list/read top-level), чтобы знать конкретные пути.",
      "2) Для 2+ независимых частей вызови spawn_agent (systemPrompt + task) — в task давай конкретные файлы/папки и что описать, не общую «исследуй всё».",
      "3) Несколько spawn_agent можно в одном ответе; после их завершения сам сведи итог.",
      "Не подменяй делегирование только своими read_files/search_codebase. Не используй team_* вместо spawn_agent для этой настройки.",
    ].join("\n");
  }
  return [
    "# spawn_agent — AVAILABLE",
    "This turn includes the spawn_agent tool (parallel sub-agents). Never claim subagents/parallel agents are unavailable — that is false.",
    "Working pattern:",
    "1) If needed, quickly gather a skeleton (list/read top-level) so you know concrete paths.",
    "2) For 2+ independent parts call spawn_agent (systemPrompt + task) — put concrete files/folders and what to report in task, not a vague “explore everything”.",
    "3) Multiple spawn_agent calls may be in one response; after they finish, synthesize yourself.",
    "Do not substitute delegation with only your own read_files/search_codebase. Do not use team_* instead of spawn_agent for this setting.",
  ].join("\n");
}

/**
 * Appended to the runtime user prompt (UI text unchanged) when Parallel agents
 * is on — models heed turn-local nudges more reliably than rules alone.
 */
export function harborSubagentsUserNudgeForLanguage(lang: UiLanguage): string {
  if (lang === "ru") {
    return [
      "[Harbor] Tool spawn_agent ДОСТУПЕН.",
      "При 2+ независимых частях: при необходимости быстро глянь каркас, затем spawn_agent с конкретными путями/файлами в task.",
      "Запрещено отвечать «субагенты недоступны».",
    ].join(" ");
  }
  return [
    "[Harbor] Tool spawn_agent is AVAILABLE.",
    "For 2+ independent parts: briefly map the skeleton if needed, then spawn_agent with concrete paths/files in task.",
    "Never claim subagents are unavailable.",
  ].join(" ");
}

/** Append parallel-agents call instructions to the runtime user prompt. */
export function appendSubagentsRuntimeNudge(
  userText: string,
  enabled: boolean,
  lang: UiLanguage
): string {
  const base = String(userText || "").trim();
  if (!enabled) {
    return base;
  }
  const nudge = harborSubagentsUserNudgeForLanguage(lang);
  return base ? `${base}\n\n${nudge}` : nudge;
}

/**
 * When the chat model cannot view images: use inspect_images, never spawn_agent.
 */
export function harborVisionInspectRulesForLanguage(lang: UiLanguage): string {
  if (lang === "ru") {
    return [
      "# inspect_images — ДОСТУПЕН",
      "Выбранная модель чата не видит пиксели. Если описания скрина не хватает или ты «не видишь» картинку — вызови inspect_images с конкретным вопросом.",
      "Не пиши, что не видишь изображение. Не вызывай spawn_agent, чтобы посмотреть картинку: субагент — та же текстовая модель без vision.",
    ].join("\n");
  }
  return [
    "# inspect_images — AVAILABLE",
    "The selected chat model cannot view pixels. If the screenshot description is missing or incomplete, call inspect_images with a specific question.",
    "Do not say you cannot see the image. Do not spawn_agent to look at a picture — the child inherits the same text model.",
  ].join("\n");
}

export function harborVisionInspectUserNudgeForLanguage(
  lang: UiLanguage
): string {
  if (lang === "ru") {
    return "[Harbor] Если не хватает описания скрина — вызови inspect_images(question). Не spawn_agent ради vision.";
  }
  return "[Harbor] If the screenshot description is not enough, call inspect_images(question). Do not spawn_agent for vision.";
}

export function appendVisionInspectRuntimeNudge(
  userText: string,
  enabled: boolean,
  lang: UiLanguage
): string {
  const base = String(userText || "").trim();
  if (!enabled) {
    return base;
  }
  const nudge = harborVisionInspectUserNudgeForLanguage(lang);
  return base ? `${base}\n\n${nudge}` : nudge;
}

/** Built-in / legacy defaults — treat as «not customized» so UI language can swap them. */
export function isBuiltinSystemPrompt(value: string): boolean {
  const text = String(value || "").trim();
  if (!text) {
    return true;
  }
  const known = [
    defaultSystemPromptForLanguage("ru"),
    defaultSystemPromptForLanguage("en"),
    // legacy defaults
    "Ты — coding-агент в VS Code. Отвечай кратко на русском. В каждом запросе тебе передаются дата/время и состояние редактора (активный файл, курсор, выделение, открытые вкладки) — опирайся на них. У тебя есть инструменты: list_files, read_file, write_file, run_command. Для git status/log/diff и любых shell-команд используй run_command — не проси пользователя запускать их вручную.",
    "You are a coding agent in VS Code. Reply concisely in English. Each request includes the current date/time and editor state (active file, cursor, selection, open tabs) — use it. You have these tools: list_files, read_file, write_file, run_command. For git status/log/diff and any shell command, use run_command instead of asking the user to run it manually.",
    "Ты — coding-агент в VS Code. Отвечай кратко на русском. В каждом запросе тебе передаются дата/время и состояние редактора (активный файл, курсор, выделение, открытые вкладки) — опирайся на них. У тебя есть инструменты: list_files, read_file, write_file, run_command, open_external. Для git status/log/diff и любых shell-команд используй run_command — не проси пользователя запускать их вручную. Чтобы открыть http(s) ссылку в браузере пользователя, вызывай open_external — не говори, что не можешь открывать внешние URL.",
    "You are a coding agent in VS Code. Reply concisely in English. Each request includes the current date/time and editor state (active file, cursor, selection, open tabs) — use it. You have these tools: list_files, read_file, write_file, run_command, open_external. For git status/log/diff and any shell command, use run_command instead of asking the user to run it manually. To open an http(s) link in the user's browser, call open_external — do not claim you cannot open external URLs.",
    "Ты — coding-агент в VS Code. Отвечай кратко на русском. В каждом запросе тебе передаются дата/время и состояние редактора (активный файл, курсор, выделение, открытые вкладки) — опирайся на них. У тебя есть инструменты: list_files, read_file, write_file, run_command, fetch_url, open_external. Для git status/log/diff и любых shell-команд используй run_command — не проси пользователя запускать их вручную. Если пользователь даёт http(s) ссылку и спрашивает про страницу или цвета — сразу вызывай fetch_url и отвечай по полю colors[] / content. Никогда не пиши, что не можешь открывать или загружать внешние URL, и не выдумывай требования авторизации.",
    "You are a coding agent in VS Code. Reply concisely in English. Each request includes the current date/time and editor state (active file, cursor, selection, open tabs) — use it. You have these tools: list_files, read_file, write_file, run_command, fetch_url, open_external. For git status/log/diff and any shell command, use run_command instead of asking the user to run it manually. If the user shares an http(s) link and asks about the page or its colors, call fetch_url immediately and answer from colors[] / content. Never claim you cannot open or load external URLs, and do not invent authorization requirements.",
    "Ты — coding-агент в VS Code. Отвечай кратко на русском. В каждом запросе тебе передаются дата/время и состояние редактора (активный файл, курсор, выделение, открытые вкладки) — опирайся на них. У тебя есть инструменты: list_files, read_file, write_file, run_command, fetch_url, open_external. Для git status/log/diff и любых shell-команд используй run_command — не проси пользователя запускать их вручную. Если пользователь даёт http(s) ссылку и спрашивает что угодно про страницу — сразу вызывай fetch_url и отвечай по title/description/headings/content/colors/links. Никогда не пиши, что не можешь открывать или загружать внешние URL, и не выдумывай требования авторизации.",
    "You are a coding agent in VS Code. Reply concisely in English. Each request includes the current date/time and editor state (active file, cursor, selection, open tabs) — use it. You have these tools: list_files, read_file, write_file, run_command, fetch_url, open_external. For git status/log/diff and any shell command, use run_command instead of asking the user to run it manually. If the user shares an http(s) link and asks anything about that page, call fetch_url immediately and answer from title/description/headings/content/colors/links. Never claim you cannot open or load external URLs, and do not invent authorization requirements.",
  ];
  return known.includes(text);
}

export function defaultProviderNameForLanguage(lang: UiLanguage): string {
  return lang === "ru" ? "Основной" : "Default";
}

export function defaultCommitMessagePromptForLanguage(
  lang: UiLanguage
): string {
  if (lang === "ru") {
    return [
      "ИНСТРУКЦИЯ ДЛЯ ГЕНЕРАЦИИ COMMIT MESSAGE:",
      "1. Анализируй изменения в коде",
      "2. Определи тип изменений (feat/fix/docs/style/refactor/test/chore/perf)",
      "3. Определи область изменений (компонент/функция/модуль)",
      "4. Создай краткое описание на РУССКОМ языке",
      "5. Используй формат: <тип>(<область>): <описание>",
      "ВАЖНО:",
      "- ВСЕГДА используй РУССКИЙ язык для описания",
      "- НИКОГДА не используй английский язык",
      "- Описание должно быть понятным и кратким",
      "Примеры:",
      "- feat(auth): добавить форму входа",
      "- fix(ui): исправить отображение модального окна",
      "- docs(api): обновить документацию API",
      "- refactor(components): вынести логику в отдельный хук",
      "- test(utils): добавить тесты для функции форматирования",
    ].join("\n");
  }
  return [
    "INSTRUCTION FOR COMMIT MESSAGE GENERATION:",
    "1. Analyze the code changes",
    "2. Determine the change type (feat/fix/docs/style/refactor/test/chore/perf)",
    "3. Determine the change scope (component/function/module)",
    "4. Write a short description in ENGLISH",
    "5. Use the format: <type>(<scope>): <description>",
    "IMPORTANT:",
    "- ALWAYS use ENGLISH for the description",
    "- NEVER use Russian",
    "- The description must be clear and concise",
    "Examples:",
    "- feat(auth): add login form",
    "- fix(ui): fix modal window display",
    "- docs(api): update API documentation",
    "- refactor(components): extract logic into a separate hook",
    "- test(utils): add tests for the formatting function",
  ].join("\n");
}

export function isBuiltinCommitMessagePrompt(value: string): boolean {
  const text = String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!text) {
    return true;
  }
  if (
    text === defaultCommitMessagePromptForLanguage("ru") ||
    text === defaultCommitMessagePromptForLanguage("en")
  ) {
    return true;
  }
  // Tolerate minor edits / old copies of the built-in instruction.
  return (
    text.startsWith("ИНСТРУКЦИЯ ДЛЯ ГЕНЕРАЦИИ COMMIT MESSAGE:") ||
    text.startsWith("INSTRUCTION FOR COMMIT MESSAGE GENERATION:")
  );
}
