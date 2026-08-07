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
