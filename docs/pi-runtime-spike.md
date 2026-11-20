# Этап 0 — спайк Pi runtime: результаты и решение

Статус: **завершён, go**. Проверено на `@earendil-works/pi-coding-agent@1.5.2`.
Связанный документ: [pi-runtime-migration.md](pi-runtime-migration.md), §5 этап 0.

Цель спайка — ответить на три вопроса, которые нельзя закрыть чтением документации, и решить,
продолжать ли миграцию в заявленном объёме. Поведение продукта не менялось: в `src/` правок нет.

## 1. Итог

| № | Вопрос | Ответ | Влияние на план |
|---|---|---|---|
| 1 | Грузится ли ESM-пакет Pi в extension host VS Code 1.101 через `import()` из CJS-расширения | **Да.** `import()` работает, SDK полностью функционален в host; `require()` — нет (exports map) | Sidecar для VS Code **не нужен**. Меняется только упаковка: ESM-чанк + `createRequire`-баннер |
| 2 | Подключаются ли наши in-process MCP-клиенты Jira/Confluence как серверы Pi | **Да, без переписывания клиентов.** Штатная точка расширения `createMcpExtension({ createTransport })` + адаптер ~110 строк | Этап 5 сокращается: вместо stdio-моста — in-process транспорт |
| 3 | Какие флаги `models.json` принимает корпоративный шлюз Severstal | Шлюз (LiteLLM 1.109.1) **принимает** `prompt_cache_key`, `cache_control` (в сообщениях и в tools), все варианты session-affinity заголовков. Но кэш даёт **автоматический prefix cache vLLM**, а не флаги; закрепления за репликой не обнаружено | Совместимость-флаги не нужны: cache-hit у Pi и Cline одинаковый |

**Решение: go** — этап 1 (извлечение порта) и этап 2 (Pi-адаптер Agent) можно начинать в
заявленном объёме. Гейт этапа 0 пройден: (1) и (2) решаются без переписывания наших MCP-клиентов.

## 2. Методика

| Что | Как проверяли |
|---|---|
| Q1 | Минимальное CJS-расширение (`main: ./extension.js`) с `await import("@earendil-works/pi-coding-agent")`; запуск в настоящем extension host через `@vscode/test-electron` с VS Code **1.101.0** (и, для проверки вперёд, **1.146.0**). Пакет установлен в `node_modules` рядом с расширением |
| Q2 | Компилированные `out/mcp/jiraNative.js` / `out/mcp/confluenceNative.js` из этого репозитория + реализация `McpTransport` поверх их `listTools` / `callTool`; проверка на трёх уровнях: `McpClient` (pi-mcp) → `McpServerConnection` (внутренний класс Pi) → публичный SDK `createAgentSession` + `createMcpExtension` |
| Q3 | Реальные streaming-запросы в `https://gennadiy-test.kube.severstal.severstalgroup.com/gennadiy/v1/chat/completions` с токеном Keycloak из локального стора (`gennadiy auth`); чтение `usage.prompt_tokens_details.{cached_tokens,created_cache_tokens}`, `x-litellm-*` |

Окружение: macOS arm64, Node 24.11.1 (хост-скрипты), VS Code 1.101.0 (Node 22.15.1 / Electron 35.5.1)
и VS Code 1.146.0 (Node 24.22.1 / Electron 43.8.6), шлюз `gennadiy-test`, LiteLLM 1.109.1.

## 3. Q1 — ESM в extension host VS Code 1.101

### 3.1 Результаты

| Проверка | 1.101.0 | 1.146.0 |
|---|---|---|
| `require.resolve("@earendil-works/pi-coding-agent")` | ✗ `ERR_PACKAGE_PATH_NOT_EXPORTED` | ✗ то же |
| `require(...)` пакета | ✗ то же (в `exports` есть только условие `import`) | ✗ то же |
| `await import("@earendil-works/pi-coding-agent")` из CJS-расширения | **✓ ≈360 мс** (357–396 в прогонах), 157 экспортов, `VERSION = 1.5.2` | **✓ 495 мс** |
| `await import(pathToFileURL(dist/index.js))` | ✓ <1 мс (модуль уже в кеше) | ✓ |
| `SessionManager.inMemory(cwd)` | ✓ | ✓ |
| `createAgentSession({ sessionManager, noTools: "all" })` | ✓ **20–24 мс**, сессия создана | ✓ 56 мс |
| Импорт esbuild-бандла ESM (14 МБ) из CJS-расширения | ✓ **151 мс** | ✓ 165 мс |
| Тот же бандл **без** `createRequire`-баннера | ✗ `Dynamic require of "child_process" is not supported` | — |

Вывод: extension host 1.101 — обычный Node 22 с работающим ESM-загрузчиком; никаких ограничений
VS Code на динамический `import()` ESM-пакета из CJS-расширения нет. `createAgentSession` в host
не просто импортируется, а реально создаёт сессию.

### 3.2 Что это значит для упаковки

1. **`require()` Pi невозможен** — в `package.json` пакета есть только `exports["."].import`.
   Следствие: нельзя оставлять Pi внешним CJS-зависимым модулем и нельзя рассчитывать на
   `require.resolve` для поиска точки входа. Путь к ESM-чанку нужно знать явно (свой бандл рядом
   с `out/extension.js`), а грузить через `import(pathToFileURL(...))`.
2. **esbuild-бандл Pi в ESM работает**, но требует баннера с `createRequire`, иначе падает на
   первом же `require("child_process")` внутри CJS-зависимостей:
   ```js
   // banner:js
   import{createRequire as __piCreateRequire}from'node:module';const require=__piCreateRequire(import.meta.url);
   ```
   Проверено: без баннера — ошибка, с баннером — импорт 151 мс, `SessionManager` работает.
3. Размер: 14 МБ ESM-чанк (только `createAgentSession` / `SessionManager` / `createMcpExtension` /
   `McpClient`) против нынешнего `out/clineBundle.js` ~10 МБ. Для VSIX приемлемо; на этапе 2
   нужно решить, бандлить Pi целиком или держать `node_modules` (второе — 153 МБ и плохо для VSIX).
4. **Sidecar не нужен** — требование регресс-гейта «VS Code path does not require a sidecar»
   выполнимо. JetBrains/Figma этим спайком не проверялись (этап 6).

### 3.3 Проверка в живом VS Code (probe-расширение)

Для ручной проверки собрано отдельное расширение `pi-runtime-probe` (не часть продукта):
CJS-расширение + `dist/pi.mjs` (14,2 МБ) + `dist/jiraNative.cjs`, VSIX 2,7 МБ.
Команда «Pi runtime probe: run checks» прогоняет те же шаги и пишет `report.json`.

Прогон в VS Code 1.101.0 (Node 22.15.1): **6/6 проверок зелёные за 488 мс** — импорт чанка 200 мс,
`createAgentSession` 24 мс, Jira native 32 инструмента, MCP-сервер подключён, 32 активных
`mcp__jira__*` за 261 мс, `tools/call` через in-process транспорт ок.

Наблюдение по упаковке: в бандле `VERSION` Pi равен версии хост-расширения (`0.0.1`), потому что
`getPackageDir()` ищет ближайший `package.json` от `__dirname` бандла. На работу SDK не влияет, но
на этапе 2 либо задавать `PI_PACKAGE_DIR`, либо не полагаться на `VERSION` / `getDocsPath` /
`getExamplesPath` (последние нужны только CLI).

Установка: `code --install-extension pi-runtime-probe-0.2.0.vsix --force`, затем Reload Window.
Версия 0.2.0 добавляет панель **Pi chat (probe)** (см. §3.4).

### 3.4 Живой чат на Pi в extension host

В probe добавлена панель чата: `ModelRuntime` + `models.json` (провайдер `openai-completions`),
`createAgentSession` с `SessionManager.inMemory`, стрим через события `message_update`,
Stop через `session.abort()`. Модели — `deepseek-v4.1-flash` / `glm-5.3` / `qwen3.8-27b`,
инструменты выключены.

Проверка headless в VS Code 1.101 с **снятым** `NODE_EXTRA_CA_CERTS`: ответ `pong` за **2,1 с**,
полный путь Keycloak-refresh → loopback-прокси → шлюз → SSE → события Pi.

Находка, важная для этапа 2: Pi **не даёт подставить fetch** ни через `PromptOptions`, ни через
`ProviderConfigInput` — провайдер использует `globalThis.fetch`. Значит корпоративный TLS решается
на уровне процесса: `NODE_EXTRA_CA_CERTS` (из расширения не выставить), обёртка `globalThis.fetch`
с явным `ca` до импорта Pi, либо loopback-прокси (использован в пробе). Обновление токена —
`setRuntimeApiKey` перед запросом или в обёртке fetch (Harbor уже делает так для Cline).
Loopback-прокси — приём спайка, не архитектура продукта; для этапа 2 предпочтительна обёртка
`globalThis.fetch`, чтобы не заводить процесс/порт.

## 4. Q2 — in-process MCP-клиенты как серверы Pi

### 4.1 Результаты

| Проверка | Результат |
|---|---|
| Форма наших клиентов | `{ listTools, callTool, close }` — ровно то, что нужно транспорту |
| Jira native `tools/list` через `McpClient` + наш транспорт | ✓ 32 инструмента, протокол `2025-11-25`, имена `mcp__jira__jira_search` и т. д. |
| Confluence native `tools/list` | ✓ 14 инструментов, `mcp__confluence__confluence_search` … |
| `tools/call` (stub-клиент) | ✓ результат доходит как MCP `content`, `isError` не выставлен |
| `tools/call` в реальный Jira-инструмент (без сети) | ✓ ошибка валидации вернулась как MCP-результат `isError: true`, процесс не упал |
| `McpServerConnection` (реальный класс Pi) с нашим транспортом | ✓ `state: "connected"`, 32 инструмента |
| **Публичный SDK**: `createAgentSession` + inline-расширение `createMcpExtension({ loadConfig, createTransport })` | ✓ в сессии **46 активных MCP-инструментов** (32 Jira + 14 Confluence) за **271 мс**; `mcp__jira__jira_get_issue` вызывается через `session.getToolDefinition(...)` |

Ключевой API, который это делает возможным (публичный, без форка):

```ts
import { createMcpExtension, type McpTransportFactory } from "@earendil-works/pi-coding-agent";

const extension = createMcpExtension({
  loadConfig: () => ({
    servers: [
      { name: "jira", config: { url: "harbor-inprocess://jira", exposure: "direct" }, source: "harbor", scope: "extension" },
    ],
    errors: [],
  }),
  createTransport: (entry) => harborNativeTransport(entry.name), // наш адаптер
});
```

`McpTransportFactory` вызывается для **каждого** сервера (и из `loadConfig`, и зарегистрированного
через `pi.registerMcpServer`), поэтому выбор «этот сервер — native, тот — stdio/HTTP» делается по
`entry.name` / `entry.config`. Важное следствие: переопределив фабрику, мы отвечаем за все серверы —
публичного `createDefaultTransport` в корне пакета нет, поэтому для не-native серверов придётся
собирать `StdioTransport` / `StreamableHttpTransport` из `@earendil-works/pi-mcp` (~30–50 строк) либо
оставить встроенный MCP как есть и зарегистрировать native-инструменты через `pi.registerTool`
(тогда теряется MCP-семантика approvals/exposure). Первый вариант ближе к текущему поведению Harbor.

`loadConfig` тоже подменяется: Harbor отдаёт свой каталог серверов (native + custom) и не обязан
читать `mcp.json`. Регистрация расширения — `DefaultResourceLoader({ extensionFactories: [extension] })`
(+ обязательный `await loader.reload()`) и `await session.bindExtensions({})`, иначе `session_start`
не эмитится и MCP-серверы не подключаются.

### 4.2 Адаптер

Весь мост — реализация `McpTransport` (107 строк, включая обработку ошибок): `initialize`,
`ping`, `tools/list`, `tools/call`, `resources/list` (пустой), `notifications/*` игнорируются.
Наши `jiraNative.ts` / `confluenceNative.ts` **не меняются** — адаптер вызывает их как есть.
Полный код — в приложении A.

Ограничения, которые надо учесть на этапе 5:

- ресурсов (`resources/*`) у наших клиентов нет — отдаём пустой список, этого достаточно;
- `McpServerConnection` — внутренний класс; в продукте используем только публичный
  `createMcpExtension` + `createTransport` (проверено end-to-end выше);
- аннотации (`readOnlyHint` / `destructiveHint`) наши native-клиенты не отдают; read-only фильтрация
  Plan/Ask в Pi опирается на `toolExposure`, а approvals — на `tool_call` hook. На этапе 3 политику
  из `src/toolApproval.ts` переносим 1:1, как и планировалось;
- lazy/on-demand семантику (`agentPanel.mcp.lazyTools`) мапим на `exposure: "deferred"` +
  `tool_search` вместо `direct`.

## 5. Q3 — флаги `models.json` на корпоративном шлюзе

### 5.1 Что за шлюз

- LiteLLM Proxy **1.109.1** (`x-litellm-version`), OpenAI-compatible, поверх vLLM-роутеров
  (`x-litellm-model-api-base: http://vllm-router-*.genai-router-test.svc.cluster.local:8080/v1`).
- Модели: `deepseek-v4.1-flash` (1 048 576 ctx), `glm-5.3` (524 288), `qwen3.8-27b` (262 144).
- Anthropic Messages API **не экспонируется**: `POST /v1/messages` → `503 no available server`;
  `POST /v1/responses` → `503`. Значит Pi обязан использовать `api: "openai-completions"`.

### 5.2 Замеры (streaming, `stream_options.include_usage`, ~17k prompt)

| Вариант запроса | HTTP | `cached_tokens` | `created_cache_tokens` |
|---|---|---|---|
| baseline #1 (без флагов) | 200 | 0 | 17 088 |
| baseline #2 (тот же префикс) | 200 | **17 088** | 0 |
| `prompt_cache_key` (1-й / 2-й) | 200 | 0 / 17 088 | 17 088 / 0 |
| `cache_control` на system+user (content parts) | 200 | 17 088 | 0 |
| `cache_control` на определении инструмента | 200 | 17 088 | 256 (prompt 17 382) |
| affinity `session_id` + `x-client-request-id` + `x-session-affinity` | 200 | 17 088 | 0 |
| affinity `x-session-id` (единичный прогон) | 200 | 0 | 17 088 |
| `prompt_cache_retention: "24h"` | 200 | 17 088 | 0 |
| `glm-5.3`: baseline → `cache_control` + `prompt_cache_key` | 200 / 200 | 0 → 17 920 | 18 432 → 512 |

Ни одного 400/422: шлюз не отвергает ни одно из этих полей, но и попаданий в кэш они не добавляют.
Кэш — автоматический prefix cache vLLM: на повторном префиксе 17 088 из 17 143 токенов (99,7 %).
`created_cache_tokens` — счётчик vLLM (кэш записан), `cached_tokens` — попадание.

### 5.3 Проверка session affinity (по 5 повторов на формат, свой префикс у каждого)

| Формат заголовков | Попаданий в кэш | «Холодных» маршрутов (кэш создан заново) |
|---|---|---|
| без заголовков | 4 / 5 | 1 |
| `openai` (`session_id`, `x-client-request-id`, `x-session-affinity`) | 3 / 5 | 2 |
| `openai-nosession` (`x-client-request-id`, `x-session-affinity`) | 3 / 5 | 2 |
| `openrouter` (`x-session-id`) | 5 / 5 | 0 |

Закрепления за репликой не видно: холодные маршруты есть во всех форматах, включая отсутствие
заголовков. Разброс — следствие балансировки между репликами vLLM-роутера, а не affinity.
Один прогон `openrouter` без холодных маршрутов — статистический шум (n = 5).

### 5.4 Вердикт по флагам

| Флаг `models.json` | Принимает ли шлюз | Практический смысл | Рекомендация для Severstal |
|---|---|---|---|
| `promptCacheKeyMode: "auto" \| "enabled" \| "disabled"` | Да, `prompt_cache_key` проходит (200) | Нулевой: попадания даёт prefix cache vLLM, а не ключ. При `auto` Pi и не отправит ключ для этого `baseUrl` (условие — `api.openai.com` либо long retention) | Оставить `auto` (фактически «не отправлять»); `enabled` безвреден, но бесполезен |
| `supportsCacheControlOnTools: boolean` | Не применимо | Флаг действует только для `anthropic-messages` (в Pi: `anthropic-messages.js`, `toolCacheControl`). Этого API у шлюза нет | Не задавать. Для `openai-completions` Pi вешает `cache_control` на последний tool при `cacheControlFormat: "anthropic"` — шлюз это принимает (200) |
| `sessionAffinityFormat: "openai" \| "openai-nosession" \| "openrouter"` | Да, все три набора заголовков проходят | Закрепления за репликой не обнаружено; на попадания в кэш не влияет | `sendSessionAffinityHeaders` не включать (дефолт `false`), формат не выбирать |
| `cacheControlFormat: "anthropic"` (смежный) | Да, маркеры в сообщениях и в tools принимаются | Паритет с текущим поведением Cline при включённом prompt cache; на шлюзе маркеры избыточны | Можно оставить для совместимости с другими апстримами; на Severstal не обязателен |
| `supportsLongCacheRetention` + `prompt_cache_retention` | Да, `prompt_cache_retention: "24h"` проходит | Игнорируется vLLM | Не включать |

### 5.5 Сравнение с текущим поведением Cline

- Cline: `agentPanel.promptCache.enabled` по умолчанию **`true`**, поэтому Harbor включает
  capability `prompt-cache` и metadata `routing.promptCache` (если у провайдера не выставлено
  `promptCache: false`), а вендорный патч `handler-factory.ts` расставляет Anthropic-style
  `cache_control`. URL-эвристика `baseUrlSuggestsPromptCache` влияет только на подсказку в Settings.
  Шлюз такие запросы принимает (проверено выше).
- Pi с дефолтным `compat` маркеров не ставит; разница только в теле запроса — на попадания в кэш
  она не влияет, потому что кэш делает vLLM (17 088 из 17 143 токенов на повторе).
- Итог: **паритет по cache-hit достигается и без compat-флагов**; `cacheControlFormat: "anthropic"`
  нужен только если хочется сохранить текущую форму запроса Cline. Критерий «cache-hit не хуже
  текущего» на тестовом шлюзе выполняется — на проде перепроверить (см. §7).

## 6. Влияние на план миграции

1. **Этап 2**: `piRuntimeAdapter.ts` грузит Pi через `import()` ESM-чанка; в сборку добавить
   `scripts/bundle-pi.js` (esbuild, `format=esm`, баннер `createRequire`) и не пытаться
   `require()`-ить пакет. Оценка этапа не меняется.
2. **Этап 5**: MCP-часть сокращается — вместо stdio-моста пишем `src/runtime/harborMcpTransport.ts`
   (~110 строк для native + 30–50 строк на `StdioTransport`/`StreamableHttpTransport` для custom
   серверов) и один `createMcpExtension({ loadConfig, createTransport })`; Jira/Confluence native
   остаются как есть. `largeResult.ts` заменяется штатной обрезкой Pi, но проверить формат пути.
3. **Этап 5 (кэш)**: никаких compat-флагов не требуется; в приёмку добавить снятие
   `usage.prompt_tokens_details.cached_tokens` до/после на одинаковом префиксе.
4. **Этап 1** не затрагивается — интерфейс `AgentRuntime` и адаптер Cline остаются как в плане.
5. **Смета**: 27–42 дня остаётся в силе; предпосылка «Pi ESM может потребовать sidecar» снята,
   зато добавляется задача упаковки ESM-чанка (~0,5 дня).

## 7. Что не проверено

- **Продовый шлюз** (проверялся `gennadiy-test`): перед гейтом этапа 5 повторить §5 на боевом
  `baseUrl` — набор моделей, наличие `/v1/messages` и поведение кэша могут отличаться.
- **1M-контекст и компакция**: спайк не гонял длинные сессии; пороги `reserveTokens` /
  `keepRecentTokens` проверяются на этапе 5.
- **Figma-плагин и JetBrains**: ESM в sandbox Figma и RPC-режим не проверялись (этап 6).
- **Approvals / Plan-Ask / checkpoints**: вне этапа 0.
- **Память процесса** после загрузки 14 МБ чанка не измерялась (важно для `CLINE_MAX_LIVE_SESSIONS`
  на этапе 2 — замерить RSS после 12 сессий).
- **Custom stdio/HTTP MCP через нашу фабрику**: проверялись только native-серверы; сборка
  `StdioTransport` / `StreamableHttpTransport` (включая OAuth-провайдер Figma) — работа этапа 5.
- **Стоимость**: `created_cache_tokens` — счётчик vLLM; как его учитывает биллинг шлюза, не
  выясняли (тарифы на тестовом стенде нулевые).

## Приложение A. Адаптер in-process MCP (прототип)

```js
export function createInProcessTransport({ client, name, version = "1.0.0" }) {
  const messageListeners = new Set();
  const closeListeners = new Set();
  let closed = false;
  let protocolVersion = "2025-06-18";

  const emit = (m) => { for (const l of messageListeners) l(m); };
  const respond = (id, result) => queueMicrotask(() => emit({ jsonrpc: "2.0", id, result }));
  const fail = (id, code, message) => queueMicrotask(() => emit({ jsonrpc: "2.0", id, error: { code, message } }));

  return {
    async start() { if (closed) throw new Error("transport closed"); },
    async send(message) {
      if (closed) throw new Error("transport closed");
      if (!message || message.id === undefined || !message.method) return; // notification
      const { id, method, params } = message;
      try {
        switch (method) {
          case "initialize":
            protocolVersion = params?.protocolVersion ?? protocolVersion;
            return respond(id, {
              protocolVersion,
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name, version },
            });
          case "ping":
          case "logging/setLevel":
            return respond(id, {});
          case "tools/list": {
            const listed = await client.listTools();
            return respond(id, { tools: listed.tools });
          }
          case "tools/call": {
            const result = await client.callTool({ name: params?.name, arguments: params?.arguments ?? {} });
            return respond(id, result);
          }
          case "resources/list":
            return respond(id, { resources: [] });
          case "resources/templates/list":
            return respond(id, { resourceTemplates: [] });
          default:
            return fail(id, -32601, `Method not found: ${method}`);
        }
      } catch (error) {
        fail(id, -32603, error instanceof Error ? error.message : String(error));
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      try { await client.close(); } finally { for (const l of closeListeners) l(); }
    },
    onMessage(l) { messageListeners.add(l); return () => messageListeners.delete(l); },
    onError() { return () => {}; },
    onClose(l) { closeListeners.add(l); return () => closeListeners.delete(l); },
    setProtocolVersion(v) { protocolVersion = v; },
  };
}
```

Подключение (проверено end-to-end):

```js
const extension = {
  name: "harbor-native-mcp",
  hidden: true,
  replaceable: true,
  factory: createMcpExtension({
    loadConfig: () => ({
      servers: [
        { name: "jira", config: { url: "harbor-inprocess://jira", exposure: "direct" }, source: "harbor", scope: "extension" },
        { name: "confluence", config: { url: "harbor-inprocess://confluence", exposure: "direct" }, source: "harbor", scope: "extension" },
      ],
      errors: [],
    }),
    createTransport: (entry) => createInProcessTransport({
      client: entry.name === "confluence" ? confluenceClient : jiraClient,
      name: entry.name,
    }),
    startupWaitMs: 5000,
  }),
};

const loader = new DefaultResourceLoader({
  cwd, agentDir,
  extensionFactories: [extension],
  disabledBuiltinExtensions: ["mcp"], // иначе штатный MCP тоже прочитает mcp.json
});
await loader.reload();
const { session } = await createAgentSession({ cwd, agentDir, resourceLoader: loader, sessionManager });
await session.bindExtensions({}); // без этого session_start не эмитится
```

## Приложение B. Воспроизведение

**Q1.** VS Code 1.101.0 скачивается `@vscode/test-electron`; расширение — CJS, в `activate`:

```js
const mod = await import("@earendil-works/pi-coding-agent"); // ≈360 мс, 157 экспортов
const sm = mod.SessionManager.inMemory(process.cwd());
const { session } = await mod.createAgentSession({ sessionManager: sm, noTools: "all", agentDir });
```

Бандл: `esbuild pi-entry.mjs --bundle --platform=node --format=esm --target=node22 --banner:js="import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);"` →
14 МБ, импорт из CJS-расширения 151 мс.

**Q2.** Harness — CJS-скрипт, который `require`-ит `out/mcp/jiraNative.js` и `out/mcp/confluenceNative.js`,
подключает их через транспорт из приложения A и проверяет `McpClient` → `McpServerConnection` →
`createAgentSession`. Результат: 32/14 инструментов, `connected`, 46 активных в сессии.
Числа выше — из этого прогона.

**Q3.** Запросы к `/v1/chat/completions` с `stream: true, stream_options: {include_usage: true}`,
токен из `~/.local/share/gennadiy/auth.json` (`keycloak.access`). Метрики — из последнего SSE-чанка
(`usage.prompt_tokens_details.cached_tokens` / `created_cache_tokens`) и заголовков `x-litellm-*`.
Для повтора на проде достаточно заменить `BASE` на боевой `baseUrl` и прогнать те же варианты.

## Приложение C. Сырые данные

Q1 (VS Code 1.101.0, Node 22.15.1, Electron 35.5.1): `import()` 357–396 мс; файловый URL <1 мс;
`SessionManager.inMemory` 0 мс; `createAgentSession` 20–24 мс; esbuild-бандл 151 мс.
VS Code 1.146.0 (Node 24.22.1, Electron 43.8.6): 495 / 0 / 0 / 56 / 165 мс.

Q2: Jira 32 инструмента, Confluence 14; `McpServerConnection.state = "connected"`;
`createAgentSession` 20 мс, регистрация 46 MCP-инструментов 271 мс.

Q3 (`deepseek-v4.1-flash`, prompt 17 143): baseline 0 → 17 088 cached; `prompt_cache_key`
0 → 17 088; `cache_control` 17 088; tool + `cache_control` 17 088 / 256 created;
`prompt_cache_retention` 17 088. `glm-5.3` (18 478): 0 → 17 920 cached / 512 created.
Латентность: тёплый кэш 0,4–1,6 с, холодный 0,7–3,3 с (n мало, для выводов о производительности
не использовать).
