# Agent Panel

Расширение для VS Code / Cursor: агентская панель с чатом, подключением к любой OpenAI-compatible API и работой с файлами проекта.

## Возможности

- Список агентов (каждый агент — отдельный чат)
- Архив и восстановление, безвозвратное удаление из архива
- Выбор модели из настроек
- Tool-calling: `list_files`, `read_file`, `write_file`, `run_command`
- Контекст редактора и индикатор использования контекстного окна
- Карточка ревью изменённых файлов и переход в Source Control
- Сохранение сессий (по workspace)

## Быстрый старт

1. Установите расширение из `.vsix` в VS Code или Cursor
2. В Settings → **Agent Panel** укажите `baseUrl`, `apiKey` и список моделей
3. Откройте панель: `Cmd+Shift+P` → **Agent Panel: Open**

## Настройки

```json
{
  "agentPanel.baseUrl": "https://api.openai.com/v1",
  "agentPanel.apiKey": "sk-...",
  "agentPanel.defaultModel": "gpt-4o-mini",
  "agentPanel.models": [
    { "id": "gpt-4o-mini", "label": "GPT-4o mini" },
    { "id": "gpt-4o", "label": "GPT-4o" }
  ]
}
```

Опционально для корпоративных TLS:

- `agentPanel.rejectUnauthorized` — проверка сертификата
- `agentPanel.caBundlePath` — путь к CA bundle

## Сборка / установка

```bash
npm install
npm run compile
npx @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension ./vscode-agent-panel-*.vsix --force
# или
cursor --install-extension ./vscode-agent-panel-*.vsix --force
```

После установки: **Developer: Reload Window**.
