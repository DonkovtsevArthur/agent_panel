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
    return "Ты — coding-агент в VS Code. Отвечай кратко на русском. В каждом запросе тебе передаются дата/время и состояние редактора (активный файл, курсор, выделение, открытые вкладки) — опирайся на них. У тебя есть инструменты: read_files, search_codebase, run_commands, fetch_web_content (и editor / apply_patch в Agent). Для git status/log/diff и любых shell-команд используй run_commands — не проси пользователя запускать их вручную. Чтобы прочитать страницу — fetch_web_content. Для Figma — MCP tools, если подключены. Никогда не говори, что не можешь открывать внешние URL.";
  }
  return "You are a coding agent in VS Code. Reply concisely in English. Each request includes the current date/time and editor state (active file, cursor, selection, open tabs) — use it. You have these tools: read_files, search_codebase, run_commands, fetch_web_content (and editor / apply_patch in Agent). For git status/log/diff and any shell command, use run_commands instead of asking the user to run it manually. To read a page, call fetch_web_content. For Figma use MCP tools when connected. Never claim you cannot open external URLs.";
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
      "Для git status/log/diff и любых shell-команд используй run_commands — не проси пользователя запускать их вручную.",
      "git commit / git push / git add . через shell блокируются Harbor — коммит и push только через тег панели «Commit and push» (или явная просьба только запушить).",
      "Чтобы прочитать http(s) страницу, вызывай fetch_web_content. Никогда не говори, что не можешь открывать или загружать внешние URL, и не выдумывай требования авторизации.",
      "Для Figma используй MCP-инструменты, если подключены (Settings → MCP Servers).",
    ].join("\n");
  }
  return [
    "# Harbor Agents",
    "Reply concisely in English.",
    "For git status/log/diff and any shell command, use run_commands instead of asking the user to run it manually.",
    "git commit / git push / git add . via shell are blocked by Harbor — commit and push only via the panel «Commit and push» tag (or an explicit push-only request).",
    "To read an http(s) page, call fetch_web_content. Never claim you cannot open or load external URLs, and do not invent authorization requirements.",
    "For Figma use MCP tools when connected (Settings → MCP Servers).",
  ].join("\n");
}

/**
 * Truthful self-identification: Harbor routes every request of this session to
 * `modelId` (the id selected in the UI). Workspace AGENTS.md / .cursor rules may
 * name other model ids in operating-constraint sections — without this block
 * those docs make e.g. a mimo or Claude model claim to be GLM. The block always
 * rides first in the Harbor rules so identity docs cannot override it.
 */
export function harborModelIdentityRulesForLanguage(
  modelId: string,
  lang: UiLanguage
): string {
  const id = String(modelId || "").trim() || "unknown";
  if (lang === "ru") {
    return [
      `# Активная модель — ${id}`,
      `Эту сессию обслуживает модель «${id}» — ровно та, что выбрана в Harbor Agents (Settings → Providers & Models); все запросы хода уходят в неё.`,
      "Если пользователь спрашивает, какая ты модель, — отвечай этим id.",
      "В файлах воркспейса (AGENTS.md, .cursor/rules) могут упоминаться другие id моделей (GLM, Claude, GPT…) — это документация репозитория для других окружений, а не твоя идентичность. Никогда не выдавай их за свою модель.",
    ].join("\n");
  }
  return [
    `# Active model — ${id}`,
    `This session is served by model "${id}" — exactly the one selected in Harbor Agents (Settings → Providers & Models); every request this turn is routed to it.`,
    "If the user asks which model you are, answer with this id.",
    "Workspace files (AGENTS.md, .cursor/rules) may mention other model ids (GLM, Claude, GPT…) — those are repo documentation for other setups, not your identity. Never present them as your own model.",
  ].join("\n");
}

/**
 * Always-on: chat models sometimes shorten the middle of a file path with a
 * literal `...`/`…` segment. Harbor renders paths in replies as clickable file
 * links — an abbreviated path cannot be opened (hosts do resolve the suffix,
 * but a full path is strictly better).
 */
export function harborFullPathRulesForLanguage(lang: UiLanguage): string {
  if (lang === "ru") {
    return [
      "# Пути к файлам в ответах",
      "Упоминая файлы воркспейса, всегда указывай полный путь от корня воркспейса. Никогда не сокращай середину пути через «...» или «…» — пользователь кликает по этим путям, чтобы открыть файл.",
    ].join("\n");
  }
  return [
    "# File paths in replies",
    "When mentioning workspace files, always give the full path from the workspace root. Never shorten the middle of a path with \"...\" or \"…\" — the user clicks these paths to open the file.",
  ].join("\n");
}

/**
 * Fewer model round trips on multi-file work: each tool call costs a full
 * gateway round trip, so batching independent reads is the single biggest
 * latency lever. Scoped to reads/searches — edits must wait for read results.
 */
export function harborBatchReadsRulesForLanguage(lang: UiLanguage): string {
  if (lang === "ru") {
    return [
      "# Экономия round-trip'ов",
      "ВАЖНО: все независимые tool calls (read_files, search_codebase, run_commands, fetch_web_content) ОБЯЗАНЫ быть в одном ответе. Никогда не вызывай их по одному — это критически важно для производительности.",
      "Несколько файлов, которые ты уже решил прочитать, запрашивай ОДНИМ вызовом read_files (список путей), а не по файлу на сообщение; держи батч в пределах ~5 файлов.",
      "Если тебе нужно прочитать 2 файла — сгенерируй 2 tool_use блока в одном assistant-сообщении, а не 2 отдельных хода.",
      "Не перечитывай файл, содержимое которого уже есть в контексте (контекст хода, предыдущие чтения).",
      "В больших файлах при известном регионе запрашивай сразу диапазон start_line/end_line, не листай с первой строки.",
      "Правки файлов (edit/apply_patch) не объединяй в батч с непрочитанными результатами — выполняй после чтения.",
    ].join("\n");
  }
  return [
    "# Round-trip economy",
    "CRITICAL: all independent tool calls (read_files, search_codebase, run_commands, fetch_web_content) MUST be issued in a single response. Never call them one at a time — this is essential for performance.",
    "When you have already decided to read several files, request them with ONE read_files call (a list of paths), not one file per message; keep a batch within ~5 files.",
    "If you need to read 2 files — generate 2 tool_use blocks in one assistant message, not 2 separate turns.",
    "Do not re-read a file whose content is already in context (turn context, earlier reads).",
    "For large files where you know the region, request the start_line/end_line range directly instead of paging from line 1.",
    "Never batch file edits (edit/apply_patch) ahead of unread results — run them after reads.",
  ].join("\n");
}

/**
 * Output token safety: models that emit a single very long text response
 * (no tool calls) can hit the per-call max_tokens ceiling mid-sentence.
 * The runtime treats that as a failed turn.  These rules nudge the model
 * to keep plain-text responses compact and route long artefacts through
 * tool calls (write_to_file, apply_patch) instead.
 */
export function harborOutputTokenRulesForLanguage(lang: UiLanguage): string {
  if (lang === "ru") {
    return [
      "# Лимит output-токенов",
      "Каждый твой ответ (assistant message) имеет жёсткий лимит токенов. Если ответ обрезается на полуслове — ход считается неуспешным.",
      "Длинные артефакты (код, конфиги, документацию, планы) записывай через tool calls (write_to_file, apply_patch), а не генерируй их целиком в тексте ответа.",
      "Если объём текста в ответе превышает ~4000 токенов — разбей на несколько шагов с tool calls между ними.",
      "Вместо длинного объяснения «что и почему» — сначала выполни действие (tool call), потом кратко поясни результат.",
    ].join("\n");
  }
  return [
    "# Output token limit",
    "Every assistant message has a hard token limit. If a response is cut off mid-sentence, the turn is treated as failed.",
    "Route long artefacts (code, configs, documentation, plans) through tool calls (write_to_file, apply_patch) instead of generating them inline as plain text.",
    "If the text in a single response would exceed ~4000 tokens, split the work into multiple steps with tool calls in between.",
    "Instead of a long explanation of what and why — execute the action (tool call) first, then briefly explain the result.",
  ].join("\n");
}

/**
 * Appended to the runtime user prompt when the turn references a Figma URL
 * but the lazy connect failed: the model must say how to connect Figma MCP
 * instead of claiming Figma access is impossible.
 */
export function harborFigmaUnavailableNoteForLanguage(lang: UiLanguage): string {
  if (lang === "ru") {
    return [
      "[Harbor] Figma MCP сейчас недоступен (подключение не удалось).",
      "Не отвечай, что доступ к Figma невозможен принципиально: попроси пользователя подключить PAT в Settings → MCP Servers и прислать ссылку снова.",
    ].join(" ");
  }
  return [
    "[Harbor] Figma MCP is currently unavailable (connect attempt failed).",
    "Do not claim Figma access is impossible: ask the user to connect a PAT in Settings → MCP Servers and resend the link.",
  ].join(" ");
}

/**
 * Appended to the runtime user prompt (UI text unchanged) on EVERY turn:
 * reused Cline sessions keep the systemPrompt from `core.start` (core.send
 * cannot update it), so a session created before a Harbor update would
 * otherwise never learn its real model id. Models also heed turn-local
 * nudges more reliably than rules alone.
 */
export function appendModelIdentityRuntimeNudge(
  userText: string,
  modelId: string,
  lang: UiLanguage
): string {
  const base = String(userText || "").trim();
  const id = String(modelId || "").trim() || "unknown";
  const nudge =
    lang === "ru"
      ? `[Harbor] Активная модель этого чата — «${id}». Если спрашивают, какая ты модель, — отвечай этим id; id из файлов репозитория (AGENTS.md, .cursor/rules) — не твоя идентичность.`
      : `[Harbor] The active model of this chat is "${id}". If asked which model you are, answer with this id; ids mentioned in repo files (AGENTS.md, .cursor/rules) are not your identity.`;
  return base ? `${base}\n\n${nudge}` : nudge;
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

/**
 * Injected into Cline rules only for Harbor's Ask mode. Ask and Plan share the
 * same underlying Cline `plan` mode (read-only tools), so Cline's base prompt
 * always says "You are in Plan mode" / "toggle to Act mode" — this overrides
 * that framing so the model calls the mode "Ask" (what the user actually sees
 * in the UI) and doesn't tell the user to "switch to Act mode".
 */
export function harborAskModeRulesForLanguage(lang: UiLanguage): string {
  if (lang === "ru") {
    return [
      "# Режим: Ask",
      "Ты сейчас в режиме Ask интерфейса Harbor Agents (не Plan). Под капотом это тот же read-only движок, что у Plan (поэтому базовый системный промпт говорит «Plan mode»), но в интерфейсе и в общении с пользователем этот режим называется именно «Ask».",
      "Если пользователь спрашивает, в каком режиме ты — отвечай «Ask», а не «Plan».",
      "Не предлагай пользователю «переключиться в Act mode» и не упоминай тумблер Act — в Ask это неприменимо, просто отвечай на вопросы и не предлагай план изменений.",
    ].join("\n");
  }
  return [
    "# Mode: Ask",
    "You are currently in Harbor Agents' Ask mode (not Plan). Under the hood it shares the same read-only engine as Plan (so the base system prompt says \"Plan mode\"), but in the UI and to the user this mode is called \"Ask\".",
    "If the user asks what mode you're in, answer \"Ask\", not \"Plan\".",
    "Do not tell the user to \"switch to Act mode\" or mention the Act toggle — that doesn't apply in Ask; just answer questions and don't propose an implementation plan.",
  ].join("\n");
}

/** Framing for custom Settings modes with tools: readonly (not builtin Ask/Plan). */
export function harborCustomReadonlyModeRulesForLanguage(
  modeLabel: string,
  lang: UiLanguage
): string {
  const label = String(modeLabel || "").trim() || (lang === "ru" ? "только чтение" : "read-only");
  if (lang === "ru") {
    return [
      `# Режим: ${label}`,
      `Ты в пользовательском read-only режиме «${label}» Harbor Agents. Под капотом тот же read-only движок, что у Plan (базовый промпт может говорить «Plan mode»), но для пользователя это режим «${label}».`,
      `Не предлагай «переключиться в Act mode» — правок файлов и mutating shell нет; исследуй и отвечай.`,
    ].join("\n");
  }
  return [
    `# Mode: ${label}`,
    `You are in Harbor Agents' custom read-only mode "${label}". Under the hood it shares Plan's read-only engine (the base prompt may say "Plan mode"), but to the user this mode is "${label}".`,
    `Do not tell the user to "switch to Act mode" — no file edits or mutating shell; explore and answer.`,
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

/**
 * Appended to the runtime user prompt in Agent/Plan when update_todo is
 * registered — makes the model maintain the visible plan card.
 */
export function harborTodoUserNudgeForLanguage(lang: UiLanguage): string {
  if (lang === "ru") {
    return [
      "[Harbor] Инструмент update_todo ДОСТУПЕН — вызывай его ВСЕГДА, на каждый запрос в режимах Agent и Plan, без исключений.",
      "Сделай это САМЫМ ПЕРВЫМ инструментом: построй полный план задачи как список шагов (первый — 'in_progress', остальные 'pending').",
      "Даже для одношаговой задачи передай один шаг. Затем обновляй статусы по мере выполнения (каждый вызов заменяет карточку целиком).",
      "В конце — финальный вызов со всеми шагами 'done'.",
      "После update_todo СРАЗУ переходи к выполнению — НЕ спрашивай пользователя, не предлагай план, просто делай.",
    ].join(" ");
  }
  return [
    "[Harbor] Tool update_todo is AVAILABLE — call it ALWAYS, on every user request in Agent and Plan modes, without exception.",
    "Do it as your VERY FIRST tool: build the full task plan as a step list (first step 'in_progress', the rest 'pending').",
    "Even a single-step task gets one step. Then update statuses as you go (each call replaces the whole card).",
    "At the end, make a final call with every step 'done'.",
    "After update_todo, IMMEDIATELY proceed to execute — do NOT ask the user, do NOT present the plan for approval, just do it.",
  ].join(" ");
}

/** Append update_todo call instructions to the runtime user prompt. */
export function appendTodoRuntimeNudge(
  userText: string,
  enabled: boolean,
  lang: UiLanguage
): string {
  const base = String(userText || "").trim();
  if (!enabled) {
    return base;
  }
  const nudge = harborTodoUserNudgeForLanguage(lang);
  return base ? `${base}\n\n${nudge}` : nudge;
}

/**
 * Session rules for update_todo — the model maintains the visible plan card.
 * Injected into the Cline rules slot for Agent/Plan sessions.
 */
export function harborTodoRulesForLanguage(lang: UiLanguage): string {
  if (lang === "ru") {
    return [
      "# update_todo — карточка плана",
      "Инструмент update_todo показывает пользователю карточку «План · N/M» с шагами и прогрессом задачи.",
      "Правила:",
      "1) В режимах Agent и Plan вызывай update_todo ВСЕГДА, на каждый запрос пользователя — первый инструмент с полным списком шагов: все 'pending', первый — 'in_progress'. Даже для одношаговой задачи передай один шаг.",
      "2) После завершения шага (или смены плана) вызови update_todo снова с ОБНОВЛЁННЫМ полным списком — вызов заменяет карточку целиком, это не append.",
      "3) Закончив всё — последний вызов со всеми шагами 'done'.",
      "4) Только main-агент: из spawn_agent-детей не вызывать.",
    ].join("\n");
  }
  return [
    "# update_todo — plan card",
    "The update_todo tool shows the user a «Plan · N/M» card with task steps and progress.",
    "Rules:",
    "1) In Agent and Plan modes call update_todo ALWAYS, on every user request — call it as your FIRST tool with the full step list: all 'pending', the first one 'in_progress'. Even a single-step task gets one step.",
    "2) After completing a step (or when the plan changes) call update_todo again with the FULL updated list — each call replaces the card, it is not an append.",
    "3) When everything is done, make a final call with every step 'done'.",
    "4) Main agent only: never call it from spawned sub-agents.",
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
