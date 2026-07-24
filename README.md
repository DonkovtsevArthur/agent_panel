# Agent Panel

VS Code extension: local agent panel for VS Code (OpenAI-compatible).

Полная корпоративная инструкция: ``.

## Быстрый старт

1. VPN
2. Установить extension (`.vsix`) в **Visual Studio Code**
3. В Settings → **Agent Panel** указать API Key из **Давинчи** (`sk-...`)
4. Открыть панель: `Cmd+Shift+P` → **Agent Panel: Open**
5. При TLS-проблемах запускайте VS Code через ``

## Настройки

```json
{
  "agentPanel.baseUrl": "",
  "agentPanel.apiKey": "sk-...",
  "agentPanel.defaultModel": "DeepSeek-V4-Flash",
  "agentPanel.rejectUnauthorized": false,
  "agentPanel.caBundlePath": "",
  "agentPanel.models": [
    { "id": "DeepSeek-V4-Flash", "label": "DeepSeek V4 Flash" },
    { "id": "Qwen3-Coder-Next", "label": "Qwen3 Coder Next" },
    { "id": "Gemma-4-31b", "label": "Gemma 4 31B" }
  ]
}
```

## Сборка / установка

```bash
npm install
npm run compile
npx @vscode/vsce package --allow-missing-repository --skip-license
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --install-extension ./vscode-agent-panel-0.1.2.vsix --force
```

## Возможности

- Чат в сайдбаре + выбор модели
- Tool-calling: `list_files`, `read_file`, `write_file`
- TLS через CA bundle / `rejectUnauthorized: false`
