# vendor/cline — форк Cline

Локальная копия [cline/cline](https://github.com/cline/cline) (SDK + apps).

Harbor UI живёт в корне репозитория; **runtime-агент** — Cline (`@cline/sdk` / packages в `sdk/packages/`).

## Как это связано

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
