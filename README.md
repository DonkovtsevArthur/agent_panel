# Гавань агентов (Harbor Agents)

**Локальная агентская панель для VS Code** — подключаете свой OpenAI-compatible API. Чаты и настройки остаются у вас; своего бэкенда, аналитики и телеметрии у Harbor нет.

В Marketplace: **Harbor Agents**. В интерфейсе VS Code: **Гавань агентов**.

## Зачем это

- **Только ваш API** — OpenAI, Azure, корпоративный шлюз, локальные модели — любой OpenAI-compatible endpoint
- **Приватность** — нет серверов Harbor, нет аналитики и телеметрии
- **Панель в сайдбаре** — несколько агентов (чатов), архив, поиск, ветки диалога
- **Работа с проектом** — tools, упоминания `@file`, выделение из редактора, вложения

## Возможности

- **Режимы:** Агент · План · Спросить (и свои режимы)
- **Tools:** `list_files`, `read_file`, `write_file`, `run_command` (в Плане и Спросить — только чтение)
- **Стриминг** с остановкой; правка и переотправка; regenerate
- Упоминания **`@file`**, вложения и картинки (vision — если модель поддерживает)
- **Контекст редактора** и индикатор окна контекста
- Карточка **ревью diff** и переход в Source Control
- **Ветки** диалога без потери основной
- **Поиск** по агентам workspace
- Сессии хранятся **локально по workspace**

## Требования

- Visual Studio Code `1.85+`
- OpenAI-compatible API (`baseUrl` + `apiKey`) и хотя бы один id модели

## Быстрый старт

1. Установите **Harbor Agents** из Marketplace
2. Откройте **Settings** → **Гавань агентов**
3. Добавьте провайдера (`baseUrl`, `apiKey`) и модели
4. Откройте панель: Command Palette → **Гавань агентов: Открыть**

Совет: выделите код в редакторе → **Гавань агентов: Добавить выделение в чат** (`Cmd+Shift+L` / `Ctrl+Shift+L`).

## Основные настройки

| Настройка | Назначение |
| --- | --- |
| `agentPanel.providers` | Провайдеры OpenAI-compatible (`baseUrl`, `apiKey`) |
| `agentPanel.models` | Список моделей (`id`, `label`, опционально `supportsVision`) |
| `agentPanel.defaultModel` | Модель по умолчанию |
| `agentPanel.systemPrompt` | Системный промпт (опционально) |
| `agentPanel.modes` | Встроенные и свои режимы composer |

Старые ключи `agentPanel.baseUrl` / `agentPanel.apiKey` ещё работают; лучше использовать `providers`.

Пример:

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

- История чатов, список агентов и ключи — в **вашем** хранилище / настройках VS Code
- Harbor Agents **не** отправляет код и чаты на сервис Harbor
- В сеть уходят запросы **только** на endpoint’ы, которые вы указали
- Что логирует и хранит сам API — вне этого расширения; выбирайте доверенный endpoint

## Команды

- **Гавань агентов: Открыть**
- **Гавань агентов: Новый агент**
- **Гавань агентов: Добавить выделение в чат**
- **Гавань агентов: Прикрепить файл**

## Обратная связь

Issues: [GitHub](https://github.com/DonkovtsevArthur/agent_panel/issues)

Лицензия: MIT

---

# Harbor Agents (English)

**Local agent panel for VS Code** — bring your own OpenAI-compatible API. Chats and settings stay on your machine; Harbor has no backend, analytics, or telemetry.

Marketplace name: **Harbor Agents**. In the UI: **Гавань агентов**.

## Why Harbor Agents

- **Your API only** — OpenAI, Azure, corporate gateways, local models — any OpenAI-compatible endpoint
- **Private by design** — no Harbor servers, no analytics, no telemetry
- **Sidebar agent panel** — multiple agents (chats), archive, search, conversation branches
- **Works with your project** — tools, `@file` mentions, editor selection, attachments

## Features

- **Modes:** Agent · Plan · Ask (plus custom modes)
- **Tools:** `list_files`, `read_file`, `write_file`, `run_command` (Plan/Ask are read-only)
- **Streaming** with stop; edit & resend; regenerate
- **@file** mentions, attachments and images (vision when the model supports it)
- **Editor context** and context-window usage indicator
- **Diff review** card with jump to Source Control
- **Branches** without losing the main thread
- **Search** across agents in the workspace
- Sessions stored **locally per workspace**

## Requirements

- Visual Studio Code `1.85+`
- An OpenAI-compatible API (`baseUrl` + `apiKey`) and at least one model id

## Quick start

1. Install **Harbor Agents** from the Marketplace
2. Open **Settings** → **Гавань агентов**
3. Add a provider (`baseUrl`, `apiKey`) and models
4. Open the panel: Command Palette → **Гавань агентов: Открыть**

Tip: select code → **Гавань агентов: Добавить выделение в чат** (`Cmd+Shift+L` / `Ctrl+Shift+L`).

## Settings (essentials)

| Setting | Purpose |
| --- | --- |
| `agentPanel.providers` | OpenAI-compatible providers (`baseUrl`, `apiKey`) |
| `agentPanel.models` | Model list (`id`, `label`, optional `supportsVision`) |
| `agentPanel.defaultModel` | Default model id |
| `agentPanel.systemPrompt` | Optional system prompt |
| `agentPanel.modes` | Built-in and custom composer modes |

Legacy `agentPanel.baseUrl` / `agentPanel.apiKey` still work; prefer `providers`.

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

Corporate TLS (optional): `agentPanel.rejectUnauthorized`, `agentPanel.caBundlePath`.

## Privacy

- Chat history, agents, and keys live in **your** VS Code storage / settings
- Harbor Agents does **not** upload code or chats to a Harbor service
- Network calls go **only** to endpoints you configure
- What that API logs or retains is outside this extension — use a trusted endpoint

## Commands

- **Гавань агентов: Открыть**
- **Гавань агентов: Новый агент**
- **Гавань агентов: Добавить выделение в чат**
- **Гавань агентов: Прикрепить файл**

## Feedback

Issues: [GitHub](https://github.com/DonkovtsevArthur/agent_panel/issues)

License: MIT
