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
