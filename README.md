# Harbor Agents / Гавань агентов

Local agent panel for VS Code / Cursor: агентская панель с чатом, подключением к любой OpenAI-compatible API и работой с файлами проекта.

**Бренд:** англ. Harbor Agents · рус. Гавань агентов.

**Главная фишка:** данные никуда не утекают. Нет своего бэкенда, аналитики и телеметрии — чаты и настройки хранятся локально, а запросы уходят только на тот API, который вы сами указали.

## Возможности

- Список агентов (каждый агент — отдельный чат)
- Архив и восстановление, безвозвратное удаление из архива
- Выбор модели из настроек (провайдеры, избранное)
- Tool-calling: `list_files`, `read_file`, `write_file`, `run_command`
- Контекст редактора и индикатор использования контекстного окна
- Карточка ревью изменённых файлов и переход в Source Control
- Сохранение сессий локально (по workspace)

## Приватность

- Сессии, настройки и ключи — на вашей машине (VS Code / Cursor settings + локальное хранилище)
- Расширение не отправляет код и чаты на сторонние сервисы «от себя»
- Единственный сетевой выход — ваш OpenAI-compatible endpoint (`baseUrl` / провайдер)

## Быстрый старт

1. Установите расширение из `.vsix` в VS Code или Cursor
2. В Settings → **Гавань агентов** укажите `baseUrl`, `apiKey` и список моделей
3. Откройте панель: `Cmd+Shift+P` → **Гавань агентов: Открыть**

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
