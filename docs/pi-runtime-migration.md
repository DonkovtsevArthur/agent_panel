# Миграция ядра Harbor с Cline на Pi — план

Статус: **Pi — ядро по умолчанию в сборке** (`agentPanel.runtime` default `pi`: VS Code и WebStorm-сайдкар);
если чанк Pi недоступен, ход молча падает на Cline (`PiRuntimeUnavailableError` → `runClineAgentTurn`).
Этап 0 пройден (go); этап 1 и первый срез этапа 2 реализованы (флаг `agentPanel.runtime`, см. §13). Документ описывает этапы, объём,
гейты и критерии отката для замены runtime-ядра Harbor Agents (`@cline/sdk` 0.0.75 + форк
`vendor/cline`) на Pi (`@earendil-works/pi-coding-agent`). Результаты этапа 0 — в [pi-runtime-spike.md](pi-runtime-spike.md).

Источники: [docs.pi.dev](https://docs.pi.dev/latest) (SDK, sessions, compaction, MCP, skills, extensions,
custom providers, RPC, security), `npm view @earendil-works/pi-coding-agent` (1.5.2, MIT, 24 МБ unpacked),
и текущий код репозитория.

## 1. Исходное состояние (проверено)

| Что | Значение |
|---|---|
| Ядро | `@cline/sdk` `^0.0.75`, форк в `vendor/cline` (~3.1 ГБ) |
| Бандл для extension host | `out/clineBundle.js` (~10 МБ, CJS, esbuild) |
| Адаптер VS Code / JetBrains | `src/clineRuntime.ts` — 3756 строк |
| Адаптер Figma | `src/figmaClineTurn.ts` — 1108 строк |
| Мост MCP → tools | `src/clineMcpTools.ts` — 347 строк |
| Упоминаний «cline» | 579 в 54 файлах `src/` + `packages/` |
| Патчи в форке | 9 файлов (см. `vendor/README.md`, таблица «Harbor patches in this fork») |
| Реальная поверхность API ядра | `ClineCore.create` + `start / send / stop / abort / restore / compareCheckpoint / subscribe / dispose` |
| Читаемые события ядра | 7 видов `agent_event`: `content_start`, `content_update`, `content_end`, `done`, `usage`, `notice`, `error` |

Вывод: связанность с ядром по API маленькая, но обвязка вокруг него (turn-context, fingerprint сессии,
approvals, карточки шагов, skills, MCP-каталог, checkpoints) — это и есть основной объём.

## 2. Целевое состояние

Pi как runtime-ядро; Harbor остаётся владельцем UI, сессий, настроек, MCP-клиентов и политики доступа.

Что Pi даёт из коробки и ложится на наши потребности (по докам):

- **SDK in-process**: `createAgentSession()` → `session.prompt / steer / followUp / abort / waitForIdle /
  subscribe / dispose`, `AgentSessionRuntime` (`newSession / switchSession / fork / importFromJsonl`).
- **Сессии**: JSONL-дерево с ветками, `SessionManager` авторитетен для модели-контекста,
  `SessionManager.inMemory()` для хостов без файлов.
- **Компакция**: авто по `contextTokens > contextWindow - reserveTokens` (16k) + `keepRecentTokens` (20k),
  hook `session_before_compact`, ручной `/compact`.
- **MCP**: встроенное расширение, exposure `direct / deferred / codemode`, `toolExposure` по паттернам,
  MCP-аннотации (`readOnlyHint`, `destructiveHint`), обрезка результатов > 20 KB с сохранением в файл.
- **Skills**: Agent Skills spec (каталог в системном промпте, `/skill:name`) — совпадает с нашим форматом.
- **Провайдеры**: `models.json` (`api: openai-completions`, `baseUrl`, `headers`, `thinkingFormat`,
  `promptCacheKeyMode`, `supportsCacheControlOnTools`), плюс provider-extension для кастомной авторизации.
- **Параллельные тулы**: по умолчанию, с `withFileMutationQueue()` (per-file очередь) —
  наш патч `executors/file-locks.ts` в Pi уже есть в апстриме.
- **`edit`** — точная замена текста без fuzzy-`apply_patch` → наши патчи про fuzz/EOF/дубли не нужны.
- **Интерфейсы**: SDK (in-process), RPC-сайдкар (JSONL, «for IDEs»), print, JSON-события.
- **Rebranding/форк** допускается (MIT), отдельный раздел в CLI Integration.

Что в Pi **не ядро, а примеры-расширения** (пишем сами):

- git-checkpoints (в примерах — `git-checkpoint.ts`: stash на turn, restore на ветку);
- approvals / permission gates (`tool_call` hook + `ctx.ui.confirm`, пример `permission-gate.ts`);
- plan mode (пример `plan-mode/`: `setActiveTools` + gate);
- subagents (пример `subagent/`: `registerTool` + `exec`);
- todo-план и наши UI-карточки.

## 3. Маппинг функций

| Функция Harbor | Где сейчас | В Pi | Работа |
|---|---|---|---|
| Один чат = одна живая сессия, эвикция по idle | `clineRuntime.ts` (live-session pool, `CLINE_MAX_LIVE_SESSIONS = 12`) | `AgentSession` + `dispose()` | порт (упрощается) |
| Регенерация / edit последнего сообщения (`resetSession` + digest) | `clineRuntime.ts` `toolActivityDigest` | ветки сессии / `importFromJsonl` | порт, возможно проще |
| Turn context (editor/git/diagnostics/env/`@`-mentions) | `src/turnContext.ts` | правила + `session.systemPrompt` transform | без изменений (host-side) |
| Agent → `act`, Plan/Ask → `plan` + command-guard | `src/modes.ts` | `setActiveTools` + `tool_call` gate | написать расширение |
| Approvals по группам (`reads/web/edits/commands/mcp/subagents`) | `src/toolApproval.ts` | `tool_call` hook + `ctx.ui.confirm` | политика — порт 1:1, транспорт — свой |
| Skills + каталог в rules-слоте | `src/harborSkills.ts`, `bundled-skills/` | нативный каталог skills | упрощается |
| MCP-каталог, lazy tools, Jira/Confluence native, large results | `src/mcp/*` (~1k строк), `src/clineMcpTools.ts` | встроенный MCP + exposure | сокращается, но наши native-клиенты надо подключить |
| `code_nav`, `rename_symbol`, `http_request`, Figma canvas tools | `src/codeNav.ts`, `src/httpTool.ts`, `src/figmaCanvasTools.ts` | `registerTool` / custom tools | адаптер ~1 файл |
| `spawn_agent` (наследование режима/thinking, MCP-тулы детям) | патч `spawn-tool.ts` | пример-расширение | написать самим |
| Auto-compact по 75% окна | `harborCompactionInputBudget` | `reserveTokens` / `keepRecentTokens` | конфиг вместо патча |
| Prompt cache маркеры | патч `handler-factory.ts` + `routing.promptCache` | `models.json` флаги совместимости | конфиг, нужен эмпирический тест |
| Model info (`knownModels`, `maxOutputTokens`) | `buildClineModelInfo` | `modelRuntime` / `models.json` | порт |
| **Checkpoints (git-снапшот на run + Compare/Restore)** | `restoreClineChatCheckpoint`, `compareClineChatCheckpoint` + `src/checkpointEditors.ts` | только пример-расширение | **написать самим** |
| Карточки шагов / review / todo | `src/agentSteps.ts`, `src/todo*.ts` | события богаче (`tool_execution_*`, `agent_settled`) | переписать маппинг |
| Langfuse/OTLP, NoOp telemetry | `src/clineNoopTelemetry.ts` | не нужен | удалить |
| git-guard (`beforeTool`) | `src/gitCommandGuardExtension.ts` | `tool_call` hook | порт |

## 4. Архитектура порта

```
src/runtime/
  agentRuntime.ts        // интерфейс (единственная точка, которую знает UI-слой)
  clineRuntimeAdapter.ts // обёртка над текущим src/clineRuntime.ts (этап 1, поведение 1:1)
  piRuntimeAdapter.ts    // Pi SDK (этап 2+)
  stepEvents.ts          // общий маппинг runtime-событий → Harbor AgentStepEvent
```

Интерфейс (черновик, уточняется на этапе 1):

```ts
export interface AgentRuntime {
  start(input: AgentTurnInput, cb: AgentRunCallbacks): Promise<AgentTurnResult>;
  send(chatId: string, text: string, cb: AgentRunCallbacks): Promise<AgentTurnResult>;
  steer(chatId: string, text: string): Promise<"queued" | "handled">;
  abort(chatId: string): void;
  dispose(chatId?: string): Promise<void>;
  restoreCheckpoint?(chatId: string, run?: number): Promise<CheckpointResult>;
  compareCheckpoint?(chatId: string): Promise<CheckpointDiff[]>;
}
```

Настройка `agentPanel.runtime`: `"cline" | "pi"`, по умолчанию `"cline"` до прохождения гейтов этапа 5.
Оба адаптера живут в одной сборке, пока не закрыт этап 6 — это же и есть механизм отката.

## 5. Этапы

Объёмы — оценка одного разработчика, не обязательство.

### Этап 0 — спайк (2–3 дня)

Цель: получить ответы на три вопроса, которые нельзя закрыть чтением доков.

1. **ESM в extension host VS Code 1.101.** Pi — ESM-пакет (`@earendil-works/pi-coding-agent`).
   Проверить: `import()` из CJS-extension в host; если нельзя — sidecar по RPC
   (у нас уже есть схема `out/harborSidecar.js` для JetBrains).
2. **Наши in-process MCP-клиенты.** `createJiraNativeClient` / `createConfluenceNativeClient`
   (`src/mcp/jiraNative.ts`, `confluenceNative.ts`) — объекты формы MCP-клиента. У Pi серверы
   описываются как `command`/`url`; выяснить, регистрируется ли готовый in-process клиент
   (через extension-API или stdio-обёртку).
3. **Prompt cache на корпоративном шлюзе.** Какие флаги `models.json`
   (`promptCacheKeyMode`, `supportsCacheControlOnTools`, `sessionAffinityFormat`) реально принимает
   LiteLLM Severstal и растёт ли cache-hit; сравнить с текущим поведением Cline.

Артефакт: `docs/pi-runtime-spike.md` — результаты, логи, решение go/no-go.
Гейт: если хотя бы (1) и (2) не решаются без переписывания наших MCP-клиентов — пересматриваем объём.

### Этап 1 — извлечение порта (3–5 дней, без изменения поведения)

- Вынести интерфейс `AgentRuntime` + `stepEvents.ts`; `clineRuntime.ts` становится
  `clineRuntimeAdapter.ts` (тело не меняется, только подпись).
- `agentPanelProvider.ts` / `vscodeTurnRunner.ts` / `agentLoop.ts` / `headlessPanelHost.ts` перевести на порт.
  `figmaClineTurn.ts` на этом этапе не трогаем.
- Гейт: `npm run compile`, `npm test`, `npm run lint`, ручной smoke по
  [VS Code regression gate](jetbrains-port.md#vs-code-regression-gate). Поведение не меняется —
  ни одной новой фичи.

### Этап 2 — Pi-адаптер, Agent-режим (5–8 дней)

- `npm i @earendil-works/pi-coding-agent`; `piRuntimeAdapter.ts` на `createAgentSession` (+ `SessionManager`
  поверх нашего `workspaceState`-стора либо рядом с ним).
- Маппинг событий → `AgentStepEvent`; tool mapping наших extraTools (code_nav, http_request, Figma canvas,
  commit tools) через `registerTool`/customTools.
- Turn-context, `@`-mentions, vision (включая `figmaVisionHelper` fallback) — host-side, без изменений.
- Гейт: Agent-турн целиком (стрим, Stop, tool-карточки, ошибки, повтор) на флаге `runtime: "pi"`
  при `runtime: "cline"` по умолчанию.

### Этап 3 — guardrails: approvals, Plan/Ask, todo, skills (4–6 дней)

- Approvals: политика из `src/toolApproval.ts` 1:1, транспорт — `tool_call` hook + `ctx.ui.confirm`
  → наш модал VS Code / диалог WebStorm.
- Plan/Ask: `setActiveTools` (read/grep/find/ls) + блокировка write-тулов и опасных bash-команд
  в `tool_call`; git-guard (`src/gitCommandGuardExtension.ts`) — тем же hook-ом.
- todo/plan-карточка и nudge-правила.
- Skills: нативный каталог Pi + наши источники (`bundled-skills/`, `.harbor/skills`, extra dirs),
  сохранить per-source тоглы и лог `skill-usage.jsonl`.
- Гейт: те же smoke-сценарии + проверка, что Plan-режим не может писать/шеллить.

### Этап 4 — checkpoints (4–6 дней)

- Свой git-слой: снапшот на run (worktree/stash в отдельный ref), `restore`, `compare` → `vscode.diff`
  (переиспользовать `src/checkpointEditors.ts`).
- UI-карточка checkpoint'а без изменений формата.
- Гейт: restore возвращает файлы, compare открывает диффы, «давние» checkpoint'ы чистятся.
- Риск: это единственный крупный блок, который в Pi пишется с нуля — если этап 0 покажет, что
  pi-пример `git-checkpoint.ts` покрывает 80 %, объём падает.

### Этап 5 — MCP, провайдеры, компакция (4–6 дней)

- Jira/Confluence native + кастомные серверы через MCP-расширение Pi; сохранить
  `agentPanel.mcp.lazyTools` / `toolsOnDemand` семантику на exposure Pi.
- `src/mcp/largeResult.ts` заменить штатной обрезкой Pi (> 20 KB → файл), проверив формат пути для модели.
- Providers Setting → `models.json` (или custom `ModelRuntime`); `harborCompactionInputBudget` → `reserveTokens`.
- Гейт: Jira search/issue/worklog, Confluence page, Figma MCP, `http_request`, компакция на длинной сессии,
  prompt cache (результат этапа 0).

### Этап 6 — WebStorm, Figma, упаковка, выпиливание форка (5–8 дней)

- JetBrains: Pi по RPC-режиму (или тот же in-process путь, что на этапе 0) → `packages/harbor-core` /
  `out/harborSidecar.js`; зеркалить host-only фиксы по [jetbrains-port.md](jetbrains-port.md).
- Figma: `figmaClineTurn.ts` → порт; canvas tools через `registerTool`.
- Переключить дефолт `agentPanel.runtime = "pi"`, снять Cline-адаптер, удалить `vendor/cline`,
  `node_modules/@cline/*`, `scripts/bundle-cline.js`, патчи из `vendor/README.md`; обновить
  `docs/architecture.md`, `AGENTS.md` (runtime-раздел), `package.json` deps.
- Гейт: полный регресс-гейт VS Code + WebStorm acceptance checklist + Figma smoke; один релиз на флаге
  «прожить» до удаления форка.

## 6. Критерии паритета (Definition of Done)

- [ ] Agent / Plan / Ask: режимы, стрим, Stop, ошибки, повтор, regenerate/edit
- [ ] Approvals: master-флаг + 6 групп, модал/диалог, отказ не ломает turn
- [ ] Checkpoints: снапшот на run, restore, compare, карточка
- [ ] Skills: каталог, per-source тоглы, usage-log, лимит 40 + предупреждение
- [ ] MCP: Jira/Confluence native (чтение + запись + Tempo), Figma, custom, lazy/on-demand
- [ ] Компакция: срабатывает на 1M-окнах по нашему порогу, карточка в UI
- [ ] Prompt cache: cache-hit не хуже текущего на корпоративном шлюзе
- [ ] `code_nav` / `rename_symbol` / `http_request` / `@`-mentions / vision-fallback
- [ ] Под-агенты (`spawn_agent`) с наследованием режима и MCP-тулов
- [ ] Ретенция сессий: `CLINE_MAX_LIVE_SESSIONS`-эквивалент, idle-evict, память процесса
- [ ] VS Code нативный путь без sidecar-процесса (обязательное условие регресс-гейта)

## 7. Откат

- Флаг `agentPanel.runtime` остаётся на весь срок миграции; Cline-адаптер и `vendor/cline` живут до этапа 6.
- Дефолт флага — `pi` (сборка без `out/pi/pi.mjs` не выпускается: `@earendil-works/pi-coding-agent` —
  обязательная зависимость, `bundle-pi` падает при её отсутствии). Отсутствующий/битый чанк в рантайме
  не ломает чат: `runAgentTurn` логирует причину и вызывает `runClineAgentTurn`.
- Откат = `agentPanel.runtime: "cline"`, без отката кода. Начиная с этапа 6 (удаление форка) откат — только
  через тег/release.
- Стоп-условие миграции (считаем эксперимент неудачным): этап 3 или 4 выходит за 2× оценку,
  либо prompt cache / компакция деградируют более чем на 10 % на реальных сессиях.

## 8. Риски и открытые вопросы

| Риск | Влияние | Проверка |
|---|---|---|
| Pi ESM не грузится в VS Code extension host | sidecar-процесс → конфликт с требованием «VS Code path does **not** require a sidecar» | этап 0, вопрос 1 |
| In-process MCP-клиенты Jira/Confluence не подключаются | переписывание `jiraNative.ts` / `confluenceNative.ts` на stdio-мост | этап 0, вопрос 2 |
| Checkpoint-паритет дороже ожидаемого | +4–6 дней | этап 4, пилот на 3 сценариях |
| Компакция/кэш на 1M-окнах и LiteLLM ведут себя иначе | деградация качества и стоимости | этапы 0 и 5 на реальных чатах |
| Pi < 1.5.2 меняет API (SDK помечен как развивающийся) | повторные порты | зафиксировать версию, следить за changelog пакета |
| Расхождение с WebStorm/Figma при переносе порта | двойная работа | порт в `packages/`/`src/runtime/`, гейт после каждого этапа |
| Потеря накопленной экспертизы по форку (9 патчей) | вернувшиеся баги | часть закрыта в апстриме Pi; остальное — зафиксировать в `vendor/README.md` перед удалением |

Не проверено (и не утверждается): наличие в Pi нативных todo/plan-инструментов, точная семантика
`SessionManager` при внешнем сторе, поведение `steer` при активном compaction.

## 9. Сводная оценка

| Этап | Дни (оценка) |
|---|---|
| 0 — спайк | 2–3 |
| 1 — порт | 3–5 |
| 2 — Pi-адаптер Agent | 5–8 |
| 3 — guardrails | 4–6 |
| 4 — checkpoints | 4–6 |
| 5 — MCP/провайдеры/компакция | 4–6 |
| 6 — WebStorm/Figma/упаковка | 5–8 |
| **Итого** | **27–42** (≈ 6–8 недель одного разработчика) |

Оценка выше изначальной (3–5 недель) намеренно: разбор доков показал, что checkpoints, approvals,
plan-mode и subagents в Pi — примеры-расширения, а не ядро, и их придётся поддерживать самим.

## 10. Что в скоуп не входит

- Замена собственных UI-компонентов и стора сессий на Pi-формат (JSONL) — только адаптация, не переезд.
- Переход на codemode/tool_search как обязательный режим (можно включить позже отдельно).
- Мультипровайдерные плюшки Pi (image/classifier-модели, `models.generateImages`) — вне задачи.
- Изменения в Figma-плагине сверх адаптера runtime.

## 11. Лицензия и third-party notices

Проверено на пакете `@earendil-works/pi-coding-agent@1.5.2` и репозитории `github.com/earendil-works/pi`:

- Лицензия **MIT**, `Copyright (c) 2025 Mario Zechner`. Тот же MIT у `pi-agent-core` и `pi-ai`.
- Разрешено использование, модификация, распространение, сублицензирование и продажа, в том числе в закрытом
  корпоративном продукте; copyleft и требования открывать наши изменения нет; ребрендинг допускается
  (в доках Pi есть раздел «Fork and rebrand Pi»).
- **Нюанс:** в npm-тарболе файла `LICENSE` нет (`files` включает только `dist`, `docs`, `examples`,
  `schemas`, `CHANGELOG.md`). MIT требует сохранять copyright-notice в копиях и «substantial portions»,
  поэтому при бандлинге Pi в VSIX обязан появиться notice с текстом из репозитория.
- Сервисы Pi (`radius.pi.dev`: `/share`, `/bug`, OAuth-логин Radius) — не код и нами не используются.
- 22 runtime-зависимости (`pi-mcp`, `pi-codemode`, `quickjs-wasi`, `typebox`, `undici`, `diff`, `minimatch`, …) —
  обычный OSS (MIT / Apache-2.0 / ISC), их notices собираем так же, как сейчас для `@cline/*`.

Задача этапа 6 (не забыть): добавить Pi и его зависимости в `THIRD-PARTY-NOTICES` / раздел лицензий VSIX
и JetBrains-плагина, с полным текстом MIT и copyright-строкой.

## 12. С чего начинается новая сессия

Стартовая задача для агента в новой сессии (этап 0 из §5):

> Реализуем [docs/pi-runtime-migration.md](pi-runtime-migration.md), этап 0 — спайк. Нужно ответить на три
> вопроса: (1) грузится ли ESM-пакет `@earendil-works/pi-coding-agent` в VS Code extension host 1.101
> через `import()` из CJS-extension; (2) можно ли подключить наши in-process MCP-клиенты
> (`src/mcp/jiraNative.ts`, `confluenceNative.ts`) как серверы Pi; (3) какие флаги `models.json`
> (`promptCacheKeyMode`, `supportsCacheControlOnTools`, `sessionAffinityFormat`) принимает корпоративный
> шлюз Severstal. Результат — `docs/pi-runtime-spike.md` и решение go/no-go. Платформа: VS Code.
> Поведение продукта не меняем, код в `src/` — только в изолированной ветке спайка.

## 13. Первый срез Pi-адаптера (реализовано)

Переключение ядра: `agentPanel.runtime` — `cline` (по умолчанию) или `pi`.
Шов — `runAgentTurn` в `src/agentLoop.ts`: через него идут и VS Code-панель, и headless-хост,
поэтому флаг переключает чат целиком, без правок UI.

Что уже работает на Pi (проверено в extension host VS Code 1.101, Node 22.15.1):

| Блок | Где | Статус |
|---|---|---|
| Типы хода и выбор рантайма | `src/runtime/agentRuntime.ts` | ✓ |
| Pi-раннер: живая сессия на чат, стрим, Stop, usage, TTFT, tool-карточки | `src/runtime/piTurnRunner.ts` | ✓ |
| Loopback-прокси: CA из `~/.harbor/certs/pinned` / `NODE_EXTRA_CA_CERTS`, ключ на запрос (Keycloak-refresh для Gennady), 401-retry | `src/runtime/piGatewayProxy.ts` | ✓ |
| Сборка Pi в один ESM-чанк (`createRequire`-баннер) | `scripts/bundle-pi.js` → `out/pi/pi.mjs` | ✓ |
| Диспетчер в `runAgentTurn`, освобождение ресурсов в `dispose()` | `src/agentLoop.ts`, `src/agentPanelProvider.ts` | ✓ |
| Настройки Harbor в промпте: кастомный system prompt, identity продукта/модели, язык рассуждений, prompt режима | `buildPiAppendPrompt` в `piTurnRunner.ts` (через `src/i18n.ts`) | ✓ |
| Правила воркспейса (AGENTS.md / project context files) | `DefaultResourceLoader` с `noContextFiles: false` | ✓ |
| Skills: каталог из `~/.harbor/skills`, `.harbor/skills`, extra dirs | `additionalSkillPaths` (SKILL.md — тот же формат) | ✓ |
| MCP: Jira/Confluence native, Figma, custom — read-only, с учётом lazy/on-demand | `createHarborMcpTransport` + `getMcpManager()` | ✓ |
| Approvals: master-флаг + группы (`tools.autoApprove`, `tools.approvals`) + модал | inline-extension `tool_call` → `requestHarborToolApproval` | ✓ |
| Agent-режим: `edit`, `write`, `bash` (read-only режимы — без них) | `AGENT_TOOLS` / `READ_ONLY_TOOLS` по `modeDef.tools` | ✓ |

Сборка и проверка:

```bash
npm i @earendil-works/pi-coding-agent@1.5.2   # опционально, dev-only
npm run build:pi                              # out/pi/pi.mjs (14 МБ)
npm run lint && npm test                      # tsc + 350 тестов
```

Host-прогоны (VS Code 1.101):

- «прочитай version из package.json» → `version: 2.9.x`, tool-шаги `grep`/`read` с файлами и числом совпадений;
- «выполни echo harbor-pi-ok» → карточка `run_commands`, в результате `harbor-pi-ok`;
- «создай note.txt с текстом hello» → карточка `editor`, файл создан с нужным содержимым.

Ограничения среза (сознательно, следующие этапы):

- `find` отключён: Pi-тул требует `fd`, которого нет в системе по умолчанию (вернём со своим бинарём);
- карточки инструментов Pi маппятся на Cline-имена (`read→read_files`, `grep→search_codebase`,
  `ls→list_files`) и получают `metrics` (файлы, число совпадений, строки), поэтому в ленте видно
  «прочитал X», «искал Y (N)», а у ошибок — текст причины;
- MCP подключён: подключённые в Harbor серверы (Jira/Confluence native, Figma, custom) отдаются Pi
  как in-process серверы с теми же именами `mcp__<server>__*`, но **только read-only** инструменты —
  запись/переходы ждут approvals этапа 3;
- нет skills, checkpoints, Plan/Ask-гейтинга, компакции и eviction живых сессий — этапы 3–5;
- история сидируется best-effort через `SessionManager.appendMessage`, а не из JSONL;
- `npm run compile` включает `bundle-pi` (после `clean-out`), поэтому чанк `out/pi/pi.mjs` всегда в `out/`;

Откат: `agentPanel.runtime = "cline"` — без пересборки и без изменения кода.

### Как проверить, что включён Pi

0. **Статус-бар VS Code**, справа: `Harbor: Pi` или `Harbor: Cline` (клик — подробности).
1. **Command Palette → «Harbor Agents: Show agent core»** (`agentPanel.showRuntime`) — показывает
   ядро (`Pi (@earendil-works/pi-coding-agent)` или Cline), число провайдеров/моделей и наличие
   собранного Pi-чанка.
2. **Busy-line панели** в начале хода: у Pi — `Pi · <model>`, у Cline — фазы `thinking/reading/…`.
3. **Settings → `agentPanel.runtime`** — значение `pi` (дефолт) или `cline` (откат).
4. Косвенно: после первого Pi-хода появляется `~/.harbor/pi-agent/models.json` (и `probe`-подобный
   loopback-прокси в процессе хоста), а в чате доступны только read-only инструменты.
