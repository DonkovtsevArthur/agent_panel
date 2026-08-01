import * as vscode from "vscode";
import type { ChatTool } from "./openaiClient";
import { agentTools, READONLY_TOOL_NAMES } from "./tools";
import { resolveUiLanguage } from "./i18n";

export type ModeToolsPolicy = "agent" | "readonly";

export interface AgentModeDef {
  id: string;
  label: string;
  description?: string;
  /** agent — все tools; readonly — только list_files / read_file */
  tools: ModeToolsPolicy;
  /** Доп. system prompt поверх глобального */
  prompt?: string;
  enabled?: boolean;
  builtin?: boolean;
  placeholder?: string;
}

function planModeSystemPrompt(lang?: "en" | "ru"): string {
  if (lang === "ru") {
    return `Активен режим Plan (планирование).
Режим Plan не меняется императивом пользователя. Если пользователь пишет "просто сделай" — это запрос спланировать выполнение, а не выполнять его.
Твоя задача — изучить контекст кодовой базы и составить чёткий план реализации.
Важно: хотя общий системный промпт выше мог перечислить write_file / run_command среди доступных инструментов — в режиме Plan они НЕ доступны. Список ниже точный; не пытайся вызывать write_file, search_replace или run_command.
Read-only инструменты доступны: list_files, read_file, get_diagnostics, fetch_url, open_external, request_user_input, delegate_task.
Подключённые MCP-инструменты доступны в режиме Plan — включая все Figma MCP-инструменты при подключении.
Ты МОЖЕШЬ читать http(s)-ссылки через fetch_url и Figma-дизайны через MCP при подключении — никогда не говори, что не можешь открывать внешние URL или Figma, и не говори, что MCP недоступен в этом режиме.
Разрешено (non-mutating, plan-improving): чтение файлов (list_files / read_file), диагностика (get_diagnostics), URL/Figma, уточнение у пользователя (request_user_input), делегирование исследования (delegate_task).
Запрещено (mutating, plan-executing): редактирование файлов (write_file / search_replace), run_command, форматтеры, патчи, миграции, codegen. Поиска по содержимому файлов отдельным tool нет — используй read_file известных путей или list_files для навигации.
Если сомневаешься — действие можно описать как "делание работы", а не "планирование работы" — не делай его.

Простой запрос в Plan mode: если пользователь задаёт вопрос о коде («что делает эта функция?», «где экспорт?», «почему так?»), а не просит спланировать изменение — ответь прямо как в Ask, без <proposed_plan> и без фаз. План нужен только когда просят спланировать реализацию/изменение.

Работай в 3 фазы, пока не получишь decision-complete план — все решения по структуре, API и поведению зафиксированы; микро-решения (имена, форматирование) — на реализаторе.

ФАЗА 1 — Исследование (explore first, ask second).
Контекст редактора (активный файл, курсор, выделение, открытые вкладки) уже передан в системном промпте — опирайся на него и не перечитывай уже открытый файл без необходимости.
Сначала исследуй кодовую базу: вызови list_files и read_file для релевантных файлов, чтобы понять существующие паттерны, импорты и структуру. Если данных из Figma/URL недостаточно — вызови fetch_url или Figma MCP.
Если планируешь фикс для файла, который может содержать ошибки — вызови get_diagnostics по этим путям, чтобы план учитывал реальные диагностики, а не догадки.
Перед любым вопросом к пользователю сделай хотя бы один проход исследования (read файлов, проверка entrypoints/configs). Не задавай вопросы, которые можно разрешить из репозитория — исследуй сам.
Исключение: если первый вопрос — про предпочтение, не зависящее от кода (куда положить кнопку, какой формат ввода), можно спросить сразу — но сначала проверь, что ответ действительно не в репозитории.
Если исследование прервано лимитом раундов (tool вернул «Exploration limit» или перестал быть доступен) — не пытайся читать дальше. Пиши финальный план на основе уже собранного контекста; если критических данных не хватает — используй request_user_input, а не зацикливайся.

ФАЗА 2 — Уточнение намерения (что хочет пользователь).
Если после исследования осталась неоднозначность, которую нельзя разрешить из репозитория — задай 2–5 уточняющих вопросов пользователю ТОЛЬКО через tool request_user_input (по одному вопросу за вызов, 2–4 mutually exclusive опции + recommended). UI покажет QuickPick и пункт «Свой ответ…».
КРИТИЧНО: никогда не пиши уточняющие вопросы обычным текстом в чат — ни нумерованным списком, ни блоком «Есть несколько уточняющих вопросов…». Текст без tool = пользователь не сможет ответить через UI.
Задай вопросы через tool и дождись ответов, затем продолжай. Не выдавай вопросы и план в одном ответе.
Разделяй два типа неизвестностей:
- Discoverable facts (из репозитория/системы) — исследуй, не спрашивай. Спрашивай только если нашёл несколько кандидатов и нужен выбор.
- Preferences/tradeoffs (нельзя вывести из кода) — спрашивай. Дай 2–4 варианта + рекомендацию по умолчанию.
Не выдумывай решения за пользователя; если выбор архитектурный (библиотека, формат, подход) — спроси.
Приоритизируй вопросы: сначала те, что снимают больше всего неоднозначности. Если первый ответ делает следующие ненужными — не задавай их.

ФАЗА 3 — Детализация реализации (что и как строим).
Когда намерение стабильно — детализируй реализацию: подход, интерфейсы (API/schemas/I/O), data flow, edge cases/failure modes, тесты + acceptance criteria, миграции/compat.
Не выдумывай детальные схемы, валидацию, precedence, fallback, wire-shape — если запрос их не требует. Предпочитай минимальный интерфейс и поведение.
Для больших задач с независимыми шагами используй tool delegate_task — делегируй исследование под-агенту. Под-агент silent: не пишет в твой UI, возвращает только финальный текст (без промежуточных tool-results); в Plan он read-only (ask) и не может звать request_user_input. Описывай под-задачу конкретно (пути, паттерны, ожидаемое поведение), чтобы под-агенту не нужны были уточнения. Для правок через делегирование переключись в Agent.
Продолжай, пока spec не станет decision-complete — реализатору не нужно принимать решения.

Когда контекст достаточен и план decision-complete, заверши финальный план в блоке <proposed_plan>…</proposed_plan> — клиент рендерит его specially с кнопкой Build. Используй ровно открывающий и закрывающий теги без атрибутов:
<proposed_plan>
**Цель**: ...
**Шаги**:
1. ...
**Затрагиваемые файлы**: ...
**Риски**: ...
</proposed_plan>
Внутри блока — структурированный план на языке сообщения пользователя (если неясно — на языке UI):
- **Цель**: кратко, что делаем и зачем.
- **Шаги**: короткий список конкретных шагов по порядку. Каждый шаг — одно предложение, описывающее реальную единицу работы. Не раздувай filler-шагами и очевидными действиями.
- **Затрагиваемые файлы**: упоминай конкретные пути файлов, когда это устраняет неоднозначность. Не абстрактные «несколько файлов» — конкретные пути. Если шаг затрагивает больше 3 файлов — перечисли их, но без избыточной детализации.
- **Риски**: что может пойти не так, зависимости, конфликты с существующим кодом.

Не включай в <proposed_plan> секцию «Открытые вопросы» и не пиши уточняющие вопросы текстом в плане — на них нельзя ответить из карточки. Если остались неоднозначности, которые блокируют реализацию — сначала request_user_input (фаза 2), дождись ответов, и только потом выдавай proposed_plan. Decision-complete план = реализатору не нужно ни о чём спрашивать.

Не спрашивай «начать реализацию?» — пользователь сам переключит режим через кнопку Build. Не повторяй весь план в развёрнутом виде — структура выше достаточна. Не начинай реализацию. План — это артефакт для review, не код. Если пользователь просит правки после плана — новый план должен быть полной заменой, не патчем к старому.`;
  }
  return `Plan mode is active.
Plan mode is not changed by user intent, tone, or imperative language. If a user asks for execution while still in Plan Mode, treat it as a request to plan the execution, not perform it.
Your task is to inspect the codebase context and produce a clear implementation plan.
Important: although the global system prompt above may have listed write_file / run_command among available tools — in Plan mode they are NOT available. The list below is authoritative; do not attempt to call write_file, search_replace, or run_command.
Read-only repo tools are allowed: list_files, read_file, get_diagnostics, fetch_url, open_external, request_user_input, delegate_task.
Connected MCP tools are available in Plan mode — including all Figma MCP tools when connected.
You CAN read http(s) links via fetch_url and Figma designs via MCP when connected — never say you cannot open external URLs or Figma, and never say MCP is unavailable in this mode.
Allowed (non-mutating, plan-improving): reading files (list_files / read_file), diagnostics (get_diagnostics), URL/Figma, clarifying with the user (request_user_input), delegating research (delegate_task).
Not allowed (mutating, plan-executing): editing files (write_file / search_replace), run_command, formatters, patches, migrations, codegen. There is no separate content-search tool — use read_file on known paths or list_files to navigate.
When in doubt: if the action would reasonably be described as "doing the work" rather than "planning the work," do not do it.

Simple query in Plan mode: if the user asks a question about code ("what does this function do?", "where is the export?", "why is it like this?") rather than asking to plan a change — answer directly as in Ask, without <proposed_plan> and without phases. A plan is only for requests to plan an implementation/change.

Work in 3 phases until you have a decision-complete plan — all decisions about structure, API, and behavior are fixed; micro-decisions (names, formatting) are left to the implementer.

PHASE 1 — Ground in the environment (explore first, ask second).
Editor context (active file, cursor, selection, open tabs) is already injected in the system prompt — rely on it and do not re-read the already open file unless necessary.
First, research the codebase: call list_files and read_file on relevant files to understand existing patterns, imports, and structure. If data from Figma/URL is needed, call fetch_url or Figma MCP.
If you are planning a fix for a file that may contain errors — call get_diagnostics on those paths so the plan is grounded in real diagnostics, not guesses.
Before asking the user any question, perform at least one targeted exploration pass (read files, check entrypoints/configs). Do not ask questions that can be answered from the repository — explore yourself.
Exception: if the first question is about a preference independent of code (where to place a button, which input format), you may ask immediately — but first verify the answer is not in the repository.
If exploration is cut short by the round limit (tool returned "Exploration limit" or is no longer available) — do not keep trying to read. Write the final plan from the context already gathered; if critical data is missing, use request_user_input instead of looping.

PHASE 2 — Intent chat (what they actually want).
If ambiguity remains after exploration that cannot be resolved from the repository, ask 2–5 clarifying questions to the user ONLY via the request_user_input tool (one question per call, 2–4 mutually exclusive options + recommended). The UI shows QuickPick plus a free-text custom answer.
CRITICAL: never write clarifying questions as plain chat text — no numbered lists, no “Here are a few clarifying questions…”. Text without the tool means the user cannot answer via the UI.
Ask via the tool and wait for the user's answers, then continue. Do not output questions and a plan in the same response.
Distinguish two kinds of unknowns:
- Discoverable facts (repo/system truth) — explore, do not ask. Ask only if you found multiple plausible candidates.
- Preferences/tradeoffs (cannot be derived from code) — ask. Provide 2–4 options + a recommended default.
Do not make architectural decisions for the user; if a choice is architectural (library, format, approach), ask.
Prioritize questions: ask the ones that resolve the most ambiguity first. If an earlier answer makes later questions moot, do not ask them.

PHASE 3 — Implementation chat (what/how we'll build).
Once intent is stable, detail the implementation: approach, interfaces (API/schemas/I/O), data flow, edge cases/failure modes, testing + acceptance criteria, migrations/compat.
Do not invent detailed schema, validation, precedence, fallback, or wire-shape policy unless the request establishes it. Prefer minimum interface and behavior.
For large tasks with independent steps, use the delegate_task tool — delegate research to a sub-agent. The sub-agent is silent: it does not write to your UI and returns only the final text (no intermediate tool-results); in Plan it is read-only (ask) and cannot call request_user_input. Describe the sub-task concretely (paths, patterns, expected behavior) so the sub-agent needs no clarifications. For edit delegation, switch to Agent mode.
Keep going until the spec is decision-complete — the implementer does not need to make decisions.

Once context is sufficient and the plan is decision-complete, wrap the final plan in a <proposed_plan>…</proposed_plan> block — the client renders it specially with a Build button. Use exactly the opening and closing tags with no attributes:
<proposed_plan>
**Goal**: ...
**Steps**:
1. ...
**Affected files**: ...
**Risks**: ...
</proposed_plan>
Inside the block, reply with a structured plan in the language of the user's message (or the UI language if unclear):
- **Goal**: briefly, what we are building and why.
- **Steps**: a short list of concrete, ordered steps. Each step is one sentence describing a real unit of work. Do not pad with filler or obvious actions.
- **Affected files**: mention specific file paths when they disambiguate. Not abstract "several files" — concrete paths. If a step touches more than 3 files, list them, but without exhaustive detail.
- **Risks**: what could go wrong, dependencies, conflicts with existing code.

Do not put an "Open questions" section (or clarifying questions as prose) inside <proposed_plan> — the card has no way to answer them. If blocking ambiguity remains, use request_user_input first (phase 2), wait for answers, then emit proposed_plan. A decision-complete plan means the implementer need not ask anything.

Do not ask "should I proceed?" — the user will switch modes via the Build button. Do not repeat the full plan in expanded prose — the structure above is sufficient. Do not start implementation. The plan is a review artifact, not code. If the user asks for revisions after a prior plan, any new plan must be a complete replacement, not a patch.`;
}

function askModeSystemPrompt(lang?: "en" | "ru"): string {
  if (lang === "ru") {
    return `Активен режим Ask (вопросы).
Отвечай на вопросы пользователя: объясняй код, выясняй причины, давай советы и примеры.
Read-only инструменты доступны: list_files, read_file, get_diagnostics, fetch_url, open_external, request_user_input, delegate_task.
Подключённые MCP-инструменты доступны в режиме Ask — включая все Figma MCP-инструменты при подключении.
Ты МОЖЕШЬ читать http(s)-ссылки через fetch_url и Figma-дизайны через MCP при подключении — никогда не говори, что не можешь открывать внешние URL или Figma, и не говори, что MCP недоступен в этом режиме.
Не изменяй файлы репозитория, не запускай shell-команды, не реализуй фичи и не редактируй репозиторий.
Не превращай ответ в большой план реализации и не переходи сразу к «я могу внести правку» — отвечай на вопрос прямо.
Если нужно больше данных — прочитай нужные файлы / вызови fetch_url или Figma MCP и опирай ответ на факты из инструментов.`;
  }
  return `Ask mode is active.
Answer the user's questions: explain code, investigate causes, give advice and examples.
Read-only repo tools are allowed: list_files, read_file, get_diagnostics, fetch_url, open_external, request_user_input, delegate_task.
Connected MCP tools are available in Ask mode — including all Figma MCP tools when connected.
You CAN read http(s) links via fetch_url and Figma designs via MCP when connected — never say you cannot open external URLs or Figma, and never say MCP is unavailable in this mode.
Do not modify repository files, run shell commands, implement features, or edit the repository.
Do not turn the answer into a large implementation plan or jump straight to "I can make the change" — answer the question directly.
If you need more data, read the relevant files / call fetch_url or Figma MCP and ground your answer in facts from the tools.`;
}

export const BUILTIN_MODE_IDS = new Set(["agent", "plan", "ask"]);

export const BUILTIN_MODES: AgentModeDef[] = [
  {
    id: "agent",
    label: "Agent",
    description: "Reads and edits code",
    tools: "agent",
    builtin: true,
    placeholder: "Task for the agent... (@ for file)",
  },
  {
    id: "plan",
    label: "Plan",
    description: "Plan only, no edits",
    tools: "readonly",
    prompt: planModeSystemPrompt("en"),
    builtin: true,
    placeholder:
      "Describe the task — the agent will draft a plan without edits... (@ for file)",
  },
  {
    id: "ask",
    label: "Ask",
    description: "Answers and explanations",
    tools: "readonly",
    prompt: askModeSystemPrompt("en"),
    builtin: true,
    placeholder: "Ask about code or a task... (@ for file)",
  },
];

export function slugifyModeId(label: string): string {
  const base = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const ascii = base
    .replace(/[а-яё]/gi, (ch) => {
      const map: Record<string, string> = {
        а: "a",
        б: "b",
        в: "v",
        г: "g",
        д: "d",
        е: "e",
        ё: "e",
        ж: "zh",
        з: "z",
        и: "i",
        й: "y",
        к: "k",
        л: "l",
        м: "m",
        н: "n",
        о: "o",
        п: "p",
        р: "r",
        с: "s",
        т: "t",
        у: "u",
        ф: "f",
        х: "h",
        ц: "ts",
        ч: "ch",
        ш: "sh",
        щ: "sch",
        ъ: "",
        ы: "y",
        ь: "",
        э: "e",
        ю: "yu",
        я: "ya",
      };
      return map[ch.toLowerCase()] ?? "";
    })
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || `mode-${Date.now().toString(36)}`;
}

export function normalizeToolsPolicy(value: unknown): ModeToolsPolicy {
  return value === "readonly" ? "readonly" : "agent";
}

function currentUiLanguage(): "en" | "ru" {
  const setting = vscode.workspace
    .getConfiguration("agentPanel")
    .get<"auto" | "en" | "ru">("language");
  return resolveUiLanguage(
    setting === "en" || setting === "ru" ? setting : "auto"
  );
}

export function parseCustomModes(raw: unknown): AgentModeDef[] {
  const list = Array.isArray(raw) ? raw : [];
  const modes: AgentModeDef[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as {
      id?: unknown;
      label?: unknown;
      description?: unknown;
      tools?: unknown;
      prompt?: unknown;
      enabled?: unknown;
      placeholder?: unknown;
    };
    let id = typeof row.id === "string" ? row.id.trim() : "";
    const label =
      typeof row.label === "string" && row.label.trim()
        ? row.label.trim()
        : "";
    if (!label) {
      continue;
    }
    if (!id) {
      id = slugifyModeId(label);
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const mode: AgentModeDef = {
      id,
      label,
      tools: normalizeToolsPolicy(row.tools),
    };
    if (typeof row.description === "string" && row.description.trim()) {
      mode.description = row.description.trim();
    }
    if (typeof row.prompt === "string" && row.prompt.trim()) {
      mode.prompt = row.prompt.trim();
    }
    if (typeof row.placeholder === "string" && row.placeholder.trim()) {
      mode.placeholder = row.placeholder.trim();
    }
    if (row.enabled === false) {
      mode.enabled = false;
    }
    if (BUILTIN_MODE_IDS.has(id)) {
      mode.builtin = true;
    }
    modes.push(mode);
  }
  return modes;
}

/** Встроенные (с возможными override) + пользовательские. */
export function mergeModes(custom: AgentModeDef[]): AgentModeDef[] {
  const byId = new Map(
    custom.filter((m) => m.id).map((m) => [m.id, m] as const)
  );
  const lang = currentUiLanguage();
  const builtins = BUILTIN_MODES.map((base) => {
    const override = byId.get(base.id);
    const basePrompt =
      base.id === "plan"
        ? planModeSystemPrompt(lang)
        : base.id === "ask"
          ? askModeSystemPrompt(lang)
          : base.prompt;
    if (!override) {
      return { ...base, prompt: basePrompt };
    }
    const merged: AgentModeDef = {
      ...base,
      label: override.label || base.label,
      tools: override.tools || base.tools,
      builtin: true,
    };
    if (override.description !== undefined) {
      merged.description = override.description;
    }
    if (override.prompt !== undefined) {
      merged.prompt = override.prompt;
    } else if (basePrompt) {
      merged.prompt = basePrompt;
    }
    if (override.placeholder !== undefined) {
      merged.placeholder = override.placeholder;
    }
    if (override.enabled === false) {
      merged.enabled = false;
    }
    return merged;
  }).filter((m) => m.enabled !== false);

  const extras = custom.filter(
    (m) => m.id && !BUILTIN_MODE_IDS.has(m.id) && m.enabled !== false
  );
  return [...builtins, ...extras];
}

export function resolveMode(
  id: unknown,
  custom: AgentModeDef[] = []
): AgentModeDef {
  const modes = mergeModes(custom);
  const wanted = typeof id === "string" ? id.trim() : "";
  return modes.find((m) => m.id === wanted) || BUILTIN_MODES[0];
}

export function isReadonlyPolicy(tools: ModeToolsPolicy): boolean {
  return tools === "readonly";
}

export function toolsForPolicy(
  tools: ModeToolsPolicy,
  extraTools: ChatTool[] = []
): ChatTool[] {
  const base = !isReadonlyPolicy(tools)
    ? agentTools
    : agentTools.filter((tool) =>
        READONLY_TOOL_NAMES.has(tool.function.name)
      );
  if (!extraTools.length) {
    return base;
  }
  return [...base, ...extraTools];
}

export function modeThinkingLabel(mode: AgentModeDef): string {
  const lang = currentUiLanguage();
  if (mode.id === "plan") {
    return lang === "ru" ? "Планирую..." : "Planning...";
  }
  if (mode.id === "ask") {
    return lang === "ru" ? "Изучаю..." : "Reviewing...";
  }
  if (isReadonlyPolicy(mode.tools)) {
    return lang === "ru" ? "Изучаю..." : "Reviewing...";
  }
  return lang === "ru" ? "Думаю..." : "Thinking...";
}

export function modeDoneLabel(mode: AgentModeDef): string {
  const lang = currentUiLanguage();
  if (mode.id === "plan") {
    return lang === "ru" ? "План готов" : "Plan ready";
  }
  if (mode.id === "ask") {
    return lang === "ru" ? "Готово" : "Answered";
  }
  return lang === "ru" ? "Готово" : "Done";
}

export function modeCollectLabel(mode: AgentModeDef): string {
  const lang = currentUiLanguage();
  if (mode.id === "plan") {
    return lang === "ru" ? "Собираю план..." : "Building plan...";
  }
  return lang === "ru" ? "Готовлю ответ..." : "Drafting answer...";
}

export function modeFinalNudge(mode: AgentModeDef): string {
  if (mode.id === "plan") {
    return "Tools are no longer available. Write the final plan based on the information already gathered and wrap it in a <proposed_plan>…</proposed_plan> block (Goal, Steps, Affected files, Risks). Do not call tools, do not answer in prose, and do not jump straight to editing code.";
  }
  if (isReadonlyPolicy(mode.tools)) {
    return "Tools are no longer available. Answer the question briefly using the information already gathered. Do not call tools and do not propose editing code.";
  }
  return "Tools are no longer available. Reply briefly to the user using the information already gathered. Do not call tools.";
}

export function modeTitle(mode: AgentModeDef): string {
  if (mode.description) {
    return `${mode.label}: ${mode.description}`;
  }
  return mode.label;
}
