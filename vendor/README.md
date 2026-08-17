# vendor/

## `vendor/cline` — форк Cline

Локальная копия [cline/cline](https://github.com/cline/cline) (SDK + apps).

Harbor UI живёт в корне репозитория; **runtime-агент** — Cline (`@cline/sdk` / packages в `sdk/packages/`).

## `vendor/tabcoder` — форк TabCoder (autocomplete UX)

Snapshot [alexandrevilain/tabcoder](https://github.com/alexandrevilain/tabcoder) (Apache-2.0). See `vendor/tabcoder/HARBOR.md`.

Harbor **does not** run TabCoder as a nested extension and **does not** use its AI SDK / provider profiles. Runtime Tab autocomplete is in `src/tabAutocomplete*.ts` (hole-fill prompts + debounce/filters adapted from TabCoder); completions call Harbor `openaiClient` with Settings providers.

If a Marketplace TabCoder extension is also installed, disable one of them — two inline completion providers will compete.

## Как это связано (Cline)

| Путь | Роль |
|------|------|
| `vendor/cline/` | Форк: правим Plan/Act, tools, providers здесь |
| `node_modules/@cline/*` | Собранный пакет той же версии для extension host (пока) |
| `src/clineRuntime.ts` | Адаптер Harbor UI ↔ Cline Agent |
| `out/clineBundle.js` | CJS-бандл SDK для VS Code (esbuild) |

После правок в форке: собрать SDK (`bun run build:sdk` в `vendor/cline`), затем переключить зависимости Harbor на `file:./vendor/cline/sdk/packages/...` и пересобрать `out/clineBundle.js`.

Версия форка должна совпадать с `@cline/sdk` в корневом `package.json` (сейчас **0.0.75**).

### Re-fork (обновлено для 0.0.75)

Базовый процесс прежний, но после wholesale-замены дерева `vendor/cline` на свежую версию:
1. Перенести патчи listed above на новые версии файлов. 4 из 9 файлов (subagent-prompts, spawn-tool, user-input-builder, types/config) были неизменны upstream 0.0.71→0.0.75 — правятся `git checkout`. Остальные портируются вручную (agent-runtime дедуп, image-guard тройка, local-runtime-host forward, GLM-каталог, handler-factory metadata forward для prompt cache — см. таблицу ниже).
2. GLM-5.2 vision capability теперь патчится в `catalog.generated.ts` (раньше — regex-постобработкой минифицированного бандла). Когда апстрим обновит каталог, перепроверить количество и формат записей `"z-ai/glm-5.2"`.
3. `scripts/bundle-cline.js` больше не делает пост-обработку минифицированного output — все патчи приходят из пересобранных dist-пакетов.
4. Без bun: `esbuild` собирает `shared → llms → core → agents` по конфигу каждого `bun.mts`, затем `cp` в `node_modules/@cline/*/dist/index.js` (держать `.orig` бэкапы), затем `node scripts/bundle-cline.js`.

### Сборка без bun (esbuild)

Штатный билд SDK требует `bun` (`bun run build:sdk`). Если `bun` не установлен, правки в `vendor/cline/.../*.ts` **не попадают в рантайм** — Extension грузит `out/clineBundle.js`, который собирается из `node_modules/@cline/*/dist` (опубликованная копия), а не из исходников форка. Повторите шаг билда `agents` (а при необходимости — `core`/`llms`/`shared`) на **esbuild** (есть в корне репо как dep):

```bash
# 1. Собрать agents из правленного исходника (повтор bun.mts):
node_modules/.bin/esbuild \
  vendor/cline/sdk/packages/agents/src/index.ts \
  --bundle --format=esm --target=node22 --packages=bundle \
  --external:@cline/llms --external:nanoid \
  --outfile=vendor/cline/sdk/packages/agents/dist/index.js

# 2. Синхронизировать свежий dist в node_modules (оригинал — в .orig):
cp node_modules/@cline/agents/dist/index.js node_modules/@cline/agents/dist/index.js.orig
cp vendor/cline/sdk/packages/agents/dist/index.js node_modules/@cline/agents/dist/index.js

# 3. Пересобрать бандл:
node scripts/bundle-cline.js

# 4. Reload Window в VS Code (host держит старый бандл в памяти).
```

Проверка, что патч «лёг»: `grep -c "ваш-маркер" out/clineBundle.js` — должен вернуть > 0. После сборки держите `node_modules/@cline/*/dist/index.js.orig` бэкапы и при `npm install` / смене версии `@cline/sdk` повторяйте синхронизацию dist (или переведите deps на `file:./vendor/cline/sdk/packages/...`, тогда ручная синхронизация не нужна — `@cline/agents` указывает на собранный форк напрямую).

## Harbor notes (edit soft-fail)

Cline `editor` / `apply_patch` return `{ success: false, error }` without throwing.
Do **not** promote that to `isError` in the agent runtime: Cline's mistake-tracker
and loop-detection treat `isError` as consecutive failures and abort the turn.
Harbor only reflects soft-fails in the panel UI (tool step status + skip fake
review seeds) via `src/clineRuntime.ts`.

## Harbor patches in this fork

Base upstream: **cline-sdk v0.0.75** (`sdk/core/v0.0.75` tag).

| Patch | Where | Why |
|-------|--------|-----|
| Forward `maxParallelToolCalls` | `sdk/packages/core/.../local-runtime-host.ts`, `.../types/config.ts` | Session config field was dropped when building `AgentConfig`, so Harbor/`maxParallelToolCalls` never reached `toolExecution: "parallel"`. |
| Subagent LiteLLM-safe model config | `sdk/packages/core/.../local/spawn-tool.ts`, `.../team/subagent-prompts.ts` | Strip catalog `reasoning` capabilities on spawn children; inherit parent thinking/effort; serialize spawns per root. Always wrap child system prompts in full Cline base (openai-compatible used to pass bare spawn text → Claude+tools `streaming_error`). No nested `spawn_agent` / ask_question on children. Parent `extraTools` (Harbor MCP) are concatenated onto child tools. |
| Duplicate tool-call dedup | `sdk/packages/agents/src/agent-runtime.ts` | Models (notably GLM-5.2) sometimes emit two `tool_use` blocks with the same name + input. The first executes; the duplicate gets a synthesized non-error `tool-result` (`deduplicated:true`) so the 1:1 `tool_use`/`tool_result` pairing and array order stay intact. |
| Image-first user content | `sdk/packages/core/.../orchestration/user-input-builder.ts` | Running Cline puts text first, then `userImages`. GLM often only reads the first content part — keep pixels ahead of the prompt. |
| Empty-image guard | `sdk/packages/core/.../config/agent-message-codec.ts`, `sdk/packages/llms/.../providers/compat.ts`, `sdk/packages/shared/.../llms/ai-sdk-format.ts` | `image:null` / empty data paths return a text placeholder instead of a malformed image part. `compat.ts` accepts either `data` or `image` field and passes through `data:` URLs. |
| GLM-5.2 vision capability | `sdk/packages/llms/src/catalog/catalog.generated.ts` | Cline catalogs list `z-ai/glm-5.2` without `images`; `modelSupportsImageInput` then fail-closes and strips pixels. Added `"images"` to the capabilities of all 8 catalog entries. |
| Prompt-cache gateway metadata | `sdk/packages/core/src/services/llms/handler-factory.ts` | Structurally forwards session `providerConfig.metadata` (Harbor's `routing.promptCache` with the anthropic-cache-control model-id route) into `createGateway({ providerConfigs })`. Upstream `ProviderConfig` has no `metadata` field, so without this patch the gateway never sees per-session routing overrides and opt-in prompt-cache markers (`agentPanel.promptCache` in `src/config.ts`, commit 0c21428) silently stop being sent — no error, just full-price input. Verify after re-fork: `grep -c "providerConfig.metadata\|metadata?.routing" out/clineBundle.js` > 0. |
| Prompt-cache deprecated providerOptions key | `sdk/packages/llms/src/providers/routing/anthropic-compatible.ts` | `createPromptCacheProviderOptions` wrote the cache_control marker into three providerOptions buckets: `openaiCompatible` (camelCase), `[providerId]` (raw id), and the camelCase alias. For Harbor's `providerId: "openai-compatible"` the raw-id bucket is the deprecated hyphenated key (AI SDK `DeprecationWarning: providerOptions key 'openai-compatible'`) and the alias is a duplicate of the explicit `openaiCompatible` bucket. Skip both for that provider id; other providers keep both buckets. Verify after re-fork: no `DeprecationWarning` mentioning `openai-compatible` in the extension host console on a prompt-cache-enabled chat turn. |

## Телеметрия (не режем в форке)

Апстрим Cline содержит PostHog / OpenTelemetry / Langfuse. **Не удаляйте** эти деревья из `vendor/cline` при sync — иначе каждый re-fork даёт конфликты.

Harbor глушит телеметрию **вне** vendor:

| Слой | Что делает |
|------|------------|
| `src/clineRuntime.ts` + `src/clineNoopTelemetry.ts` | `ClineCore.create({ telemetry: NoOp, distinctId: "harbor-agents" })` — нет live adapters, нет записи machine-id в `~/.cline` |
| `scripts/bundle-cline.js` + `scripts/stubs/*` | esbuild alias / onResolve: Langfuse и OTLP exporters → noop stubs |

### Re-fork апстрима

1. Заменить дерево `vendor/cline` нужной версией Cline (wholesale).
2. Выровнять `@cline/sdk` (и связанные `@cline/*`) в корневом `package.json`.
3. При необходимости `bun run build:sdk` в vendor и/или `file:` deps. Без bun — esbuild-обход (см. «Сборка без bun» выше).
4. Пересобрать `out/clineBundle.js` (`npm run compile` / `scripts/bundle-cline.js`).

Harbor-патчи телеметрии живут только в `src/` и `scripts/` — их не нужно заново вносить в vendor после sync.
