# MR: 2.9.124–2.9.126 — TDD-режим, точный «+N» в списке агентов, починка редактирования после Stop

**Branch:** `list_agent` · **Version:** `2.9.123` → `2.9.126` · **Platforms:** VS Code + WebStorm (shared), Figma — нет

## Что сделано

1. **Режим TDD в композере.** Чип **TDD** рядом с выбором режима: red-green-refactor в system prompt только для agent-режима. Флаг живёт в чате (`tddMode`), переживает переключение агентов и входит в fingerprint Cline-сессии (переключение TDD = новая сессия). В VS Code HTML генерируется отдельно от shell.
2. **«+N» в списке агентов — только свои строки.** Раньше брались numstat по dirty-путям: чужие правки и соседние чаты попадали в счётчик. Теперь review-карточка хранит хэши строк, которые агент сам добавил/удалил за ход (`git diff HEAD` до/после); live-пересечение с текущим HEAD отсекает закоммиченное и чужое.
3. **Редактирование сообщения после Stop / хода с инструментами.** Webview-индекс уезжал из-за tool-строк, которых нет в его кеше. Добавлен `userOrdinal` (порядковый номер user-сообщений) + `resolveEditUserIndex`. Если host отклонил правку — мёртвый edit-composer закрывается, пузырь снова редактируем.

## Зачем

- TDD был только в shell WebStorm — в VS Code недостижим без костылей.
- Счётчик dirty-строк агента врал при параллельных чатах и shared-файлах — нельзя понять, что агент не закоммитил.
- После Stop редактирование «зависало»: поле оставалось, кнопка не реагировала.

## Как устроено (для ревью)

| Область | Файлы |
|--------|--------|
| TDD rules | `src/tddMode.ts` (новый), `src/clineRuntime.ts` (gate `tools === "agent"`, fingerprint) |
| TDD UI + store | `media/src/panel/18-pickers-and-send.js`, `01/02/04/05/20`, `agentPanelProvider`, `headlessPanelHost`, `sessionStore.tddMode` |
| Line bag / «+N» | `src/agentPendingDiff.ts` (parse diff, `agentLineDelta`, `pendingDiffByAgent`), `src/turnFileChanges.ts` (`collectLineSets`), `src/clineRuntime.ts` (baseline → `onReview(edits, lineEdits)`) |
| Edit by ordinal | `src/sessionStore.ts` (`resolveEditUserIndex`), protocol `userOrdinal`, webview `08-scroll-and-turns.js` (`dropStaleEditComposer`) |

Hot path для ревью: **`agentPendingDiff.ts` → `clineRuntime` turnLineEdits → provider/headless publishReview**.

## Риск и эффект

| | |
|---|---|
| Польза | TDD доступен в VS Code; «+N» отражает только правки агента; edit после Stop работает |
| Риск | `agentPendingDiff` — новый формат review-payload (`lines`); старые карточки без `lines` → счётчик 0 (деградация, не краш). `collectLineSets` ходит в git на start/end хода — cost на больших репо (maxBuffer 64MB, untracked cap 1MB/400 файлов) |
| Поверхность | chat runtime, session store, panel UI, review tracker; git read-only |
| Откат | `lines` опциональны в JSON — старый host/webview не ломаются. `tddMode` / `userOrdinal` — additive поля |

## Проверка

- [ ] `npm run lint`
- [ ] `npm test` — обновлены `agentListV2`, `sessionStore`, `turnFileChanges`; новый `tddMode.test.js`
- [ ] Smoke VS Code: TDD on → ход агента; редактирование сообщения после Stop; «+N» в списке при параллельных чатах
- [ ] Smoke WebStorm (shell): тот же чип TDD + edit
- [ ] CHANGELOG 2.9.124–126, `package.json` 2.9.126

## Чего НЕ делали

- Figma-плагин — не трогали
- Автоматический запуск тестов модели при TDD (только system-prompt правила)
- Миграция старых review-карточек без `lines` (остаются без числового «+N»)
