# Harbor UI + полный мозг Cline — план миграции

Цель: **свой UI Harbor**, поведение агента как у полного Cline (mode policy, tools, images, guard, session hooks), без бренда Cline в продукте.

## Сейчас (Phase 2)

`src/clineRuntime.ts` → **`ClineCore.create({ backendMode: "local" })`**:

- Mode → `DefaultRuntimeBuilder` (builtins + plan command-guard)
- MCP — Harbor bridge `clineMcpTools` как `extraTools` (`disableMcpSettingsTools`)
- Картинки — `userImages` на `start`
- Один ход чата Harbor = одна Cline-сессия (`interactive: false`)
- Список чатов — Harbor `sessionStore` / `workspaceState`

## Целевая схема

```
Harbor webview / agentPanelProvider / sessionStore
        │  send | abort | mode | model | attachments | mcp creds
        ▼
clineRuntime  ──host──►  ClineCore / LocalRuntimeHost
        │                      │
        │                      ├─ mode → tools + command-guard
        │                      ├─ images / history
        │                      ├─ compaction / spawn (по мере нужды)
        ▼                      ▼
   onStep / stream / review   (события → тот же Harbor UI)
```

Harbor остаётся: чаты, Settings UI, nls, Build, workspaceState.  
Cline владеет: что можно в Ask/Plan/Agent и как исполнять tools.

## Фазы

### MVP — закрыто

1. **Plan/Ask command-guard** — сначала на thin Agent; теперь через runtime-builder.
2. **Images** — `userImages` / image parts на ход.
3. **Контракт** host↔Cline в этом файле и `AGENTS.md`.

Критерий: Ask + «поправь формулировку» → tools читают/ищут, mutating shell блокируется.

### Phase 2 — session host (сделано)

1. Тонкий `Agent` заменён на **ClineCore** local host.
2. Проброс: `mode`, `cwd`, provider/model, abort, `userImages`.
3. Маппинг `CoreSessionEvent.agent_event` → Harbor `onStep` / delta / review.
4. Harbor `sessionStore` — список чатов; transcript хода зеркалится в history как раньше.

Критерий: смена Ask↔Agent пересобирает tools/guard через builder; один path для mode.

### Phase 3 — выровнять входы

1. History restore с image parts (не только текст).
2. MCP: либо оставить Harbor bridge как host-provided tools, либо их MCP loader + наши credentials.
3. Rules: Harbor `AGENTS.md` / `.cursor/rules` → через Cline user-instructions extension или наш prepareTurn.
4. Долгоживущая Cline-сессия, привязанная к id чата Harbor (сейчас — новая сессия на каждый ход).

### Phase 4 — опционально

- **Spawn / parallel agents (сделано):** `enableSpawnAgent` при `agentPanel.subagents.enabled` (default on) во всех режимах. Children наследуют mode-preset родителя (Plan/Ask = read-focused + command-guard; Agent = act). UI: Settings toggle + карточка `spawn_agent`. Harbor MCP детям не прокидывается. Teams (`enableAgentTeams`) — нет.
- **Parallel tool calls (сделано):** `agentPanel.parallelToolCalls.enabled` (default on) → `maxParallelToolCalls: 8`; off → `1` (sequential).
- **Auto compact (сделано):** `agentPanel.autoCompact.enabled` (default on) → `compaction: { enabled: true, strategy: "agentic" }`; notice → UI step `compaction`.
- Checkpoints, approvals UI (или оставить yolo) — ещё открыто.
- Teams / task board — позже (нужна долгоживущая Cline-сессия из Phase 3).

## Не делать

- Не тащить Cline webview / брендинг в Marketplace.
- Не писать agent list в `globalState`.
- Не сравнивать продукт с Cursor в copy.

## Ключевые файлы

| Файл | Роль |
|------|------|
| `src/clineRuntime.ts` | Host-адаптер (ClineCore) |
| `scripts/clineSdkEntry.mjs` | Что экспортируем из `@cline/sdk` в бандл |
| `src/clineMcpTools.ts` | Harbor MCP → extraTools до Phase 3 |
| `src/agentPanelProvider.ts` | UI host: mode/attachments/abort |
| `vendor/cline/` | Форк; патчи мозга здесь |
