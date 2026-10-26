# Шаблон MR / PR для Harbor Agents

Краткое описание задачи — что сделано, зачем, риск, как проверить. Reviewer читает сначала его, потом целевые файлы.

```markdown
## Что сделано
1–3 пункта по фичам / фиксам. Не перечислять файлы — перечислять поведение.

## Зачем
Одно–два предложения: какую боль / баг закрывает. Ссылка на issue / Jira, если есть.

## Как устроено (для ревью)
Где смотреть в первую очередь (2–3 hot files / модуля), механика в одном абзаце.
Указать target platform: VS Code / WebStorm (JetBrains) / Figma / shared.

## Риск и эффект
| | |
|---|---|
| Польза | коротко: что стало лучше для пользователя |
| Риск | что может сломаться; worst case |
| Поверхность | chat runtime / panel UI / session store / MCP / git / storage… |
| Откат | обратная совместимость данных? feature flag? |

## Проверка
- [ ] `npm run lint`
- [ ] `npm test` (или какие тесты добавлены/обновлены)
- [ ] Ручной smoke: … (конкретные шаги)
- [ ] Parity VS Code ↔ WebStorm, если менялся shared слой
- [ ] Версия в package.json + CHANGELOG, если это user-visible релиз

## Чего НЕ делали
Явные out of scope — чтобы reviewer не искал «а где же X».
```

## Правила хорошего MR

- **Hot files первым делом.** В «Как устроено» — 2–3 файла, без которых diff не читается.
- **Риск — честно.** Особенно: `sessionStore`, `clineRuntime`, protocol в `packages/harbor-host-protocol`, git-пути, auth.
- **Parity.** Логика в `media/` / `packages/` — обе IDE. Host-only фиксы — `src/` + `jetbrains/`.
- **Не тащить drive-by.** Соседний рефактор — отдельный MR.
- **Версия + CHANGELOG** только когда пользователь это видит (Marketplace / UI).
