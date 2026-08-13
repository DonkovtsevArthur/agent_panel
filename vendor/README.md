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

Версия форка должна совпадать с `@cline/sdk` в корневом `package.json`.

## Harbor notes (edit soft-fail)

Cline `editor` / `apply_patch` return `{ success: false, error }` without throwing.
Do **not** promote that to `isError` in the agent runtime: Cline's mistake-tracker
and loop-detection treat `isError` as consecutive failures and abort the turn.
Harbor only reflects soft-fails in the panel UI (tool step status + skip fake
review seeds) via `src/clineRuntime.ts`.

## Harbor patches in this fork

| Patch | Where | Why |
|-------|--------|-----|
| Forward `maxParallelToolCalls` | `sdk/packages/core/.../local-runtime-host.ts`, `.../types/config.ts` | Session config field was dropped when building `AgentConfig`, so Harbor/`maxParallelToolCalls` never reached `toolExecution: "parallel"`. |
| Subagent LiteLLM-safe model config | `sdk/packages/core/.../local/spawn-tool.ts`, `.../team/subagent-prompts.ts` | Strip catalog `reasoning` capabilities on spawn children; inherit parent thinking/effort; serialize spawns per root. Always wrap child system prompts in full Cline base (openai-compatible used to pass bare spawn text → Claude+tools `streaming_error`). No nested `spawn_agent` / ask_question on children. Parent `extraTools` (Harbor MCP) are concatenated onto child tools. |

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
3. При необходимости `bun run build:sdk` в vendor и/или `file:` deps.
4. Пересобрать `out/clineBundle.js` (`npm run compile` / `scripts/bundle-cline.js`).

Harbor-патчи телеметрии живут только в `src/` и `scripts/` — их не нужно заново вносить в vendor после sync.
