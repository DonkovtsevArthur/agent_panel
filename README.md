# Harbor Agents

**Локальная панель агентов для VS Code** — используйте свой OpenAI-compatible API. Чаты и настройки хранятся на вашей машине; у Harbor нет своего backend, аналитики или телеметрии.

Название в Marketplace и интерфейсе: **Harbor Agents**. По-русски: **Гавань агентов**.

## Зачем Harbor Agents

- **Только ваш API** — OpenAI, Azure, корпоративные gateway, локальные модели: любой OpenAI-compatible endpoint
- **Приватность по умолчанию** — никаких Harbor-серверов, аналитики или телеметрии
- **Панель в sidebar** — несколько агентов (чатов), архив, поиск, ветки диалога
- **Работа с проектом** — tools, `@file`-упоминания, выделение из редактора, вложения

## Возможности

- **Режимы:** Agent · Plan · Ask (плюс кастомные режимы)
- **Инструменты:** `list_files`, `read_file`, `write_file`, `run_command` (`Plan`/`Ask` работают только на чтение)
- **Стриминг** с остановкой, edit & resend, regenerate
- **@file**, вложения и картинки (vision, если модель поддерживает)
- **Контекст редактора** и индикатор использования context window
- **Карточка diff review** с переходом в Source Control
- **Генерация commit message** в Source Control (по вашему API); промпт и язык — для всех workspace или для текущего
- **Ветки ответов** без потери основной нити диалога
- **Поиск** по агентам в текущем workspace
- Сессии хранятся **локально для каждого workspace**

## Требования

- Visual Studio Code `1.85+`
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
- Сетевые запросы идут **только** в те endpoint, которые вы сами настроили
- Что логирует или хранит ваш API, зависит уже от него, поэтому используйте доверенный endpoint

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
- **Works with your project** — tools, `@file` mentions, editor selection, attachments

### Features

- **Modes:** Agent · Plan · Ask (plus custom modes)
- **Tools:** `list_files`, `read_file`, `write_file`, `run_command` (Plan/Ask are read-only)
- **Streaming** with stop; edit & resend; regenerate
- **@file** mentions, attachments and images (vision when the model supports it)
- **Editor context** and context-window usage indicator
- **Diff review** card with jump to Source Control
- **Generate commit messages** in Source Control via your API; prompt and language can be saved for all workspaces or the current one
- **Branches** without losing the main thread
- **Search** across agents in the workspace
- Sessions stored **locally per workspace**

### Requirements

- Visual Studio Code `1.85+`
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

Legacy `agentPanel.baseUrl` / `agentPanel.apiKey` still work; prefer `providers`.

### Privacy

- Chat history, agents, and keys live in **your** VS Code storage / settings
- Harbor Agents does **not** upload code or chats to a Harbor service
- Network calls go **only** to endpoints you configure
- What that API logs or retains is outside this extension — use a trusted endpoint

### Commands

- **Harbor Agents: Open**
- **Harbor Agents: New Agent**
- **Harbor Agents: Add Selection to Chat**
- **Harbor Agents: Attach File**
- **Harbor Agents: Generate Commit Message**

## Feedback

Issues: [GitHub](https://github.com/DonkovtsevArthur/agent_panel/issues)

License: MIT
