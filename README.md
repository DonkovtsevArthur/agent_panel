# Harbor Agents

**Локальная панель агентов для VS Code** — используйте свой OpenAI-compatible API. Чаты и настройки хранятся на вашей машине; у Harbor нет своего backend, аналитики или телеметрии.

Название в Marketplace и интерфейсе: **Harbor Agents**. По-русски: **Гавань агентов**.

## Зачем Harbor Agents

- **Только ваш API** — OpenAI, Azure, корпоративные gateway, локальные модели: любой OpenAI-compatible endpoint
- **Приватность по умолчанию** — никаких Harbor-серверов, аналитики или телеметрии
- **Панель в sidebar** — несколько агентов (чатов), архив, поиск, ветки диалога
- **Агент по проекту** — поиск по коду, правки файлов, команды в терминале, `@file`, выделение из редактора, вложения
- **MCP** — Figma и свои MCP-серверы (stdio / HTTP), в том числе быстрые пресеты
- **Браузер** — headless-проверка страниц и опциональный Browser agent в реальном Chrome/Edge

## Возможности

- **Режимы:**
  - **Agent** — полный цикл: исследовать, править файлы, запускать команды
  - **Plan** — исследовать и составить план без правок; дальше можно перейти к реализации (Build)
  - **Ask** — вопросы по коду без правок
  - плюс кастомные режимы в Settings
- **Инструменты агента:** поиск по кодовой базе, чтение и правка файлов, терминал, работа с браузером (navigate / snapshot / click / type), делегирование подзадач
- **MCP tools** — tools с подключённых серверов доступны агенту в том же ходе
- Остановка хода, edit & resend, regenerate
- **@file**, вложения и **картинки** — изображение уходит модели как multimodal-вложение (vision, если модель поддерживает)
- **Контекст редактора**, CodeLens «Добавить в чат» над выделением, индикатор context window
- **Карточка diff review** с переходом в Source Control
- **Генерация commit message** в Source Control (по вашему API); промпт и язык — для всех workspace или для текущего
- **Figma** — Connect (OAuth) или Personal Access Token в Settings → MCP Servers; агент читает дизайн по ссылке figma.com
- **Browser agent** — многошаговые задачи в вашем Chrome/Edge (Settings → Browser agent)
- **Ветки ответов** без потери основной нити диалога
- **Поиск** по сообщениям чата
- Сессии хранятся **локально для каждого workspace**

## MCP Servers

В панели: **Settings → MCP Servers**.

- **Figma** — **Connect Figma** (browser OAuth к `mcp.figma.com`). Personal Access Token — запасной вариант. После подключения можно вставлять ссылки `figma.com/design/…` в чат.
- **Пресеты** — быстрое добавление Playwright Browser (`npx @playwright/mcp --headless`) и GitHub (remote MCP + Bearer PAT)
- **Свои серверы** — кнопка **+**:
  - **stdio** — `command` + args (например `npx` / `-y some-mcp --stdio`) и env `KEY=value`
  - **HTTP** — URL MCP endpoint и опциональный Bearer token
- Toggle / Edit / Delete на карточке сервера; статус и ошибки видны в списке.

Конфиг своих серверов: `agentPanel.mcp.servers`. Figma: `agentPanel.figma.enabled`.

## Требования

- Visual Studio Code `1.101+`
- OpenAI-compatible API (`baseUrl` + `apiKey`) и хотя бы один `model id`

## Быстрый старт

1. Установите **Harbor Agents** из Marketplace
2. Откройте **Settings** → **Harbor Agents**
3. Добавьте провайдера (`baseUrl`, `apiKey`) и модели
4. Откройте панель: Command Palette → **Harbor Agents: Open**

Подсказка: выделите код → **Harbor Agents: Add Selection to Chat** (`Cmd+Shift+L` / `Ctrl+Shift+L`).

## Основные настройки

- `agentPanel.providers` — список OpenAI-compatible провайдеров (`baseUrl`, `apiKey`)
- `agentPanel.models` — список моделей (`id`, `label`, опционально `supportsVision`)
- `agentPanel.defaultModel` — модель по умолчанию
- `agentPanel.systemPrompt` — дополнительный system prompt
- `agentPanel.modes` — встроенные и пользовательские режимы composer
- `agentPanel.commitMessage.prompt` — правило/промпт для генерации сообщений коммита (пусто = правила проекта, затем дефолт)
- `agentPanel.commitMessage.language` — язык сообщения коммита (`auto` / `en` / `ru`); область сохранения выбирается в настройках панели: все workspace или текущий
- `agentPanel.figma.enabled` — включить Figma MCP; подключение — Settings → MCP Servers
- `agentPanel.mcp.servers` — свои MCP-серверы (stdio / HTTP); UI: Settings → MCP Servers → +
- `agentPanel.selectionHints.enabled` — CodeLens «Добавить в чат» над выделением в редакторе
- `agentPanel.autoglm.*` — Browser agent (вкл., браузер, auto-approve, путь к бинарнику)

Старые `agentPanel.baseUrl` / `agentPanel.apiKey` тоже работают, но предпочтительнее `providers`.

```json
{
  "agentPanel.providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-..."
    }
  ],
  "agentPanel.models": [
    { "id": "gpt-4o-mini", "label": "GPT-4o mini" },
    { "id": "gpt-4o", "label": "GPT-4o", "supportsVision": true }
  ],
  "agentPanel.defaultModel": "gpt-4o-mini"
}
```

Корпоративный TLS (опционально): `agentPanel.rejectUnauthorized`, `agentPanel.caBundlePath`.

## Приватность

- История чатов, агенты и ключи хранятся в **вашем** VS Code storage / settings
- Harbor Agents **не** отправляет код или чаты в какой-либо Harbor service
- Сетевые запросы идут **только** в те endpoint, которые вы сами настроили (LLM API и MCP-серверы)
- Что логирует или хранит ваш API / MCP, зависит уже от него — используйте доверенные сервисы

## Команды

- **Harbor Agents: Open**
- **Harbor Agents: New Agent**
- **Harbor Agents: Add Selection to Chat**
- **Harbor Agents: Attach File**
- **Harbor Agents: Generate Commit Message**

---

## English

**Local agent panel for VS Code** — bring your own OpenAI-compatible API. Chats and settings stay on your machine; Harbor has no backend, analytics, or telemetry.

Marketplace and UI name: **Harbor Agents**.

### Why Harbor Agents

- **Your API only** — OpenAI, Azure, corporate gateways, local models — any OpenAI-compatible endpoint
- **Private by design** — no Harbor servers, no analytics, no telemetry
- **Sidebar agent panel** — multiple agents (chats), archive, search, conversation branches
- **Project agent** — codebase search, file edits, terminal commands, `@file`, editor selection, attachments
- **MCP** — Figma and your own MCP servers (stdio / HTTP), including quick presets
- **Browser** — headless page checks and an optional Browser agent in real Chrome/Edge

### Features

- **Modes:**
  - **Agent** — full loop: explore, edit files, run commands
  - **Plan** — explore and draft a plan without edits; then switch to implement (Build)
  - **Ask** — questions about the code without edits
  - plus custom modes in Settings
- **Agent tools:** codebase search, read/edit files, terminal, browser (navigate / snapshot / click / type), subtask delegation
- **MCP tools** — tools from connected servers are available in the same turn
- Stop a run; edit & resend; regenerate
- **@file** mentions, attachments and **images** — sent to the model as multimodal content (vision when the model supports it)
- **Editor context**, floating Add to Chat above selections, context-window usage indicator
- **Diff review** card with jump to Source Control
- **Generate commit messages** in Source Control via your API; prompt and language can be saved for all workspaces or the current one
- **Figma** — Connect (OAuth) or Personal Access Token in Settings → MCP Servers; the agent reads designs from figma.com links
- **Browser agent** — multi-step tasks in your Chrome/Edge (Settings → Browser agent)
- **Branches** without losing the main thread
- **Search** within the chat
- Sessions stored **locally per workspace**

### MCP Servers

In the panel: **Settings → MCP Servers**.

- **Figma** — **Connect Figma** (browser OAuth to `mcp.figma.com`). Personal Access Token is an optional fallback. After connecting, paste `figma.com/design/…` links in chat.
- **Presets** — quick add Playwright Browser (`npx @playwright/mcp --headless`) and GitHub (remote MCP + Bearer PAT)
- **Custom servers** — **+** button:
  - **stdio** — `command` + args (e.g. `npx` / `-y some-mcp --stdio`) and `KEY=value` env lines
  - **HTTP** — MCP endpoint URL and optional Bearer token
- Toggle / Edit / Delete on each card; status and errors show in the list.

Custom servers config: `agentPanel.mcp.servers`. Figma: `agentPanel.figma.enabled`.

### Requirements

- Visual Studio Code `1.101+`
- An OpenAI-compatible API (`baseUrl` + `apiKey`) and at least one model id

### Quick start

1. Install **Harbor Agents** from the Marketplace
2. Open **Settings** → **Harbor Agents**
3. Add a provider (`baseUrl`, `apiKey`) and models
4. Open the panel: Command Palette → **Harbor Agents: Open**

Tip: select code → **Harbor Agents: Add Selection to Chat** (`Cmd+Shift+L` / `Ctrl+Shift+L`).

### Settings (essentials)

- `agentPanel.providers` — OpenAI-compatible providers (`baseUrl`, `apiKey`)
- `agentPanel.models` — model list (`id`, `label`, optional `supportsVision`)
- `agentPanel.defaultModel` — default model id
- `agentPanel.systemPrompt` — optional system prompt
- `agentPanel.modes` — built-in and custom composer modes
- `agentPanel.commitMessage.prompt` — rule/prompt for commit message generation (empty = project rules, then built-in default)
- `agentPanel.commitMessage.language` — commit message language (`auto` / `en` / `ru`); save scope is chosen in the panel settings: all workspaces or the current one
- `agentPanel.figma.enabled` — enable Figma MCP; connect via Settings → MCP Servers
- `agentPanel.mcp.servers` — custom MCP servers (stdio / HTTP); UI: Settings → MCP Servers → +
- `agentPanel.selectionHints.enabled` — floating Add to Chat above editor selections
- `agentPanel.autoglm.*` — Browser agent (enable, browser, auto-approve, binary path)

Legacy `agentPanel.baseUrl` / `agentPanel.apiKey` still work; prefer `providers`.

### Privacy

- Chat history, agents, and keys live in **your** VS Code storage / settings
- Harbor Agents does **not** upload code or chats to a Harbor service
- Network calls go **only** to endpoints you configure (LLM API and MCP servers)
- What those services log or retain is outside this extension — use trusted endpoints

### Commands

- **Harbor Agents: Open**
- **Harbor Agents: New Agent**
- **Harbor Agents: Add Selection to Chat**
- **Harbor Agents: Attach File**
- **Harbor Agents: Generate Commit Message**

## Feedback

Issues: [GitHub](https://github.com/DonkovtsevArthur/agent_panel/issues)

License: MIT
