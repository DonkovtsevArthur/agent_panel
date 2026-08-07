# Changelog

История изменений **Harbor Agents** (Гавань агентов). Вкладка **Changelog** на странице расширения в Marketplace.

## [1.1.17] — 2026-08-07

- **Runtime:** параллельные tool calls (`maxParallelToolCalls: 8`) — Settings → Parallel tool calls
- **Runtime:** auto compact контекста Cline (`compaction` agentic) — Settings → Auto compact; карточка шага в чате

## [1.1.15] — 2026-08-06

- **Plan:** плашка «План» для Agent-ответов с кириллицей (эвристика больше не использует JS `\\b`, который не матчит русские слова)

## [1.1.14] — 2026-08-06

- **Plan/Ask:** параллельные субагенты (`spawn_agent`) при включённом Settings → Parallel agents; дети read-focused как родитель

## [1.1.13] — 2026-08-06

- **Plan:** финальный текст для плашки «План» берётся из `submit_and_exit.summary` (Cline часто не пишет отдельный assistant text)

## [1.1.11] — 2026-08-06

- **Agent:** параллельные субагенты (`spawn_agent`) — Settings → Parallel agents; только режим Agent, Plan/Ask без spawn

## [1.1.10] — 2026-08-06

- **Plan:** не сбрасывать stream-бабл перед финалом (чтобы не терять плашку «План»); запасной текст из messages

## [1.1.6] — 2026-08-06

- **Plan:** финальный план всегда в карточке «План» — hint `<proposed_plan>` + fallback-обёртка, если модель забыла теги

## [1.1.5] — 2026-08-06

- **Figma:** MCP tools через Cline `createMcpTools` — скриншоты доходят в tool-result; nudge по ссылке; OCR-fallback если модель без vision
- **UI:** статус-строка показывает сырые статусы Cline (session / finishReason / notice / error)

## [1.1.4] — 2026-08-06

- **UI:** статус-строка показывает сырые статусы Cline (session / finishReason / notice / error)

## [1.1.3] — 2026-08-06

- **Runtime:** лимит раундов tools больше не режет ход Harbor `maxToolRounds` — iteration budget у Cline (unset = без жёсткого потолка); настройка deprecated

## [1.1.2] — 2026-08-06

- **Runtime:** Phase 2 — ClineCore local session host вместо тонкого Agent; mode/tools/plan-guard через DefaultRuntimeBuilder; MCP как extraTools

## [1.1.1] — 2026-08-06

- **Plan/Ask:** plan-mode command-guard на тонком Cline Agent — блокирует mutating shell; roadmap полного runtime — `docs/cline-full-runtime-migration.md`

## [1.1.0] — 2026-08-06

Крупный релиз runtime и панели:

- **Agent runtime:** единый цикл для всех моделей — поиск по коду, чтение/правка файлов, терминал, браузер; Plan/Ask без правок, Agent — полный цикл
- **Plan/Ask:** plan-mode command-guard блокирует mutating shell (`sed`/`rm`/…); roadmap полного Cline session runtime — `docs/cline-full-runtime-migration.md`
- **MCP:** tools подключённых серверов в том же ходе; пресеты Playwright Browser и GitHub; Figma Connect / PAT
- **Browser agent:** многошаговые задачи в реальном Chrome/Edge (Settings → Browser agent); headless browser tools без изменений
- **Картинки:** вложение уходит выбранной модели как multimodal; Harbor больше не подменяет модель на vision
- **UI:** CodeLens «Добавить в чат» над выделением (переключатель в Settings); обновлён README под актуальные возможности

## [1.0.181] — 2026-08-05

- **Settings:** переключатель «Подсказки при выделении кода» (`agentPanel.selectionHints.enabled`) — вкл/выкл CodeLens «Добавить в чат» над выделением в редакторе

## [1.0.177] — 2026-08-04

- **Plan:** после «уже совпадает / no new work» не достраивать Build-план — skip Implementation / component-API / quote dumps; флаг `invent_new_despite_match` если снова invent new page
- **Settings:** категория Browser agent снова открывается (была не в whitelist `showSettingsCategory`)

## [1.0.176] — 2026-08-04

- **Browser agent (AutoGLM):** tool `browser_task` для многошаговых задач в реальном Chrome/Edge; Settings → Browser agent (enable / browser / auto-approve / binary path); headless `browser_*` без изменений
- **Plan:** gate на `request_user_input` — отказ, если вопрос «тот же компонент / отдельный экран / reuse похожей фичи» (discoverable HOW); Figma title = WHAT, сначала search/read домена макета + аналога
- **Plan/Figma hints:** anti-drift — похожая «ежегодная проверка» ≠ clarify; не писать «мне нужно уточнить» вместо tools

## [1.0.175] — 2026-08-04

- **Agent tools:** builtin `browser_navigate` / `browser_snapshot` / `browser_click` / `browser_type` / `browser_close` (persistent headless session поверх Playwright из `screenshot_url`)
- **Settings → MCP:** Quick add пресеты Playwright Browser (`npx @playwright/mcp --headless`) и GitHub (remote MCP + Bearer PAT)
- **Agent orchestration:** soft hint `AGENT_ORCHESTRATION_HINT` — когда звать `delegate_task` / `request_user_input` / browser verify
- **Plan:** tool `find_references` (symbols + usages через language service) в Plan/Ask/Agent
- **Plan + скрин/URL:** если на диске уже есть незакомментированная страница с Title/лейблами OCR — host поднимает исход в `full_match` (не invent greenfield), даже когда explore-пробы ошиблись

## [1.0.174] — 2026-08-04

- **Plan + скрин/URL:** host-ветвление после probes — `full_match` (reuse / no wander), `needs_clarify` (QuickPick на хосте), `build` (soft=1 + strip explore); запрет invent new page при full_match

## [1.0.173] — 2026-08-04

- **Plan + URL страницы:** тот же zcode-depth preflight, что у скрина — headless screenshot → OCR → 4 explore-пробы → clarifications / полный план (Figma URL по-прежнему Figma-first)

## [1.0.172] — 2026-08-04

- **Plan + скриншот (zcode depth):** 4 глубоких explore-пробы (вкл. Effector); soft-nudge → полный план / clarifications; `SCREENSHOT_CLARIFY_HINT` при stub; inventory/Title critical на скрин-ходах

## [1.0.171] — 2026-08-04

- **Figma Connect:** если браузер не открылся — toast «Открыть ссылку» + URL в буфере; CA bundle из Settings применяется и к Figma MCP (NODE_EXTRA_CA_CERTS)

## [1.0.170] — 2026-08-04

- **Figma MCP:** remote OAuth работает из коробки для всех пользователей плагина — DCR идёт под whitelisted именем `Codex` (раньше `Harbor Agents` получал 403 Forbidden). Кнопка **Connect Figma** снова основной путь; PAT — запасной вариант

## [1.0.169] — 2026-08-04

- **Plan + скриншот:** баланс anti-drift — имя папки ≠ done, но после `read_file` и совпадения OCR → план «уже совпадает / no new work» с inventory; Implementation не требуется, если работы нет

## [1.0.168] — 2026-08-04

- **Plan + скриншот:** anti-drift — похожая страница в репо ≠ «уже реализовано»; soft-nudge к `<proposed_plan>` после **3** раундов (хост уже сделал OCR + explore probes)

## [1.0.162] — 2026-08-04

- **Agent:** короткие follow-up «а в роутах поменял?» — это правка (не soft-readonly Q&A); paired sites (path/route/navigate) через `search_text`; «✅ Исправлено» без реального write режется даже в readonly

## [1.0.161] — 2026-08-04

- **Agent:** вопрос без явной просьбы править (`looksLikeQuestionRequest`) — soft-readonly tools + `AGENT_QUESTION_HINT`; UI-режим Agent не меняется, модель отвечает фактами вместо чеклиста «Реализация завершена»

## [1.0.158] — 2026-08-04

- Кнопки «Ответвить» и «Обновить» у ответа доступны во время работы модели (ветка создаётся сразу; regenerate останавливает текущий ход)

## [1.0.155] — 2026-08-04

- **Plan / Build:** живой `План.md` / `Plan.md`, компактная карточка с Preview, быстрый revision без пересборки Phase 1, Figma-first и multi-reason quality; после Build — честный partial-финал, если пути из плана ещё не тронуты
- **Agent:** mechanical fast lane для версии / ≤2 файлов (короткий explore, только diagnostics); память выученных ошибок в `.harbor/learned-errors.md` (коррекции пользователя, plan-quality, verification)
- **Архив:** кнопка «Удалить все», локализованные даты и диалоги удаления
- Discard правок агента надёжнее матчит dirty-пути; review-пути нормализуются относительно корня репозитория
- Контекстное меню: Add File / Selection to Chat Harbor с хоткеями
- Plan/Ask: цвет пикера, обводка сообщений и лоадер в списке; активный агент и чат заметнее
- Thinking только по реальному reasoning (без пустого «Thinking…»); изоляция выбранной модели между чатами
- Защита `version` в `package.json` от записи без semver; убран Speed routing

## [1.0.3] — 2026-07-31

- В статусе хода («Думаю…» и др.) серым показывать текущую модель

## [1.0.2] — 2026-07-31

- Не обрывать ход на анонсе «Создаю / Начну…» без `write_file`: дожимать правку
- Распознавать запросы вроде «приступим к реализации по этому плану»

## [1.0.1] — 2026-07-31

- Changed files: в карточку review попадают все файлы, ставшие dirty за ход (в т.ч. через `run_command`), а не только `write_file`

## [1.0.0] — 2026-07-30

- Первый стабильный релиз для Marketplace
- Changelog на странице расширения
- README и настройки Speed routing без устаревших описаний (стриминг, Agent explore)

## [0.7.228] — 2026-07-30

- При редактировании сообщения пользователя можно выбрать режим Agent / Plan / Ask

## [0.7.227] — 2026-07-30

- Единый main-like цикл агента для всех моделей
- Figma MCP и связанные tools доступны во всех режимах (Agent / Plan / Ask)
- Исправлен выбор модели в сообщении

## [0.7.176] — 2026-07-30

- Speed routing для Plan / Ask: тяжёлая модель может идти на быстрый helper (Settings → Speed routing)
- Политика tool-раундов: soft nudge после 2 explore-only раундов, hard-cut после 4, авто-extend при продуктивном ходе
- `fetch_url` / `open_external` только когда в сообщении есть URL

## [0.7.146] — 2026-07-30

- Быстрые действия для выделенного кода
- Очистка Markdown в списках агентов
- Сохранение позиции при редактировании сообщений
- Markdown в описаниях агентов
- Более безопасные статусы агентов и Git-операции

## [0.7.122] — 2026-07-29

- Честный финал хода: без ложных «готово» и пустых записей файлов
- Diff до/после и подсказки для работы с git history

## [0.7.97] — 2026-07-28

- Список агентов — скрываемая колонка рядом с чатом
- Кнопки настроек и нового агента в шапке чата
- Подсветка активного агента и обновление списка после создания

## [0.7.77] — 2026-07-28

- Модели и провайдеры в одной секции настроек
- Доработана локализация интерфейса

## [0.7.63] — 2026-07-28

- Инструменты `fetch_url` и `open_external`
- Уточнено описание Figma: подключение через Personal Access Token

## [0.7.59] — 2026-07-28

- MCP Servers: Figma и пользовательские серверы (stdio / HTTP)

## [0.7.54] — 2026-07-28

- Генерация commit message в Source Control через ваш API
- Настройки языка и промпта — глобально или для текущего workspace

## [0.7.47] — 2026-07-28

- Pre-run ошибки (endpoint, вложения, модели) показываются в конкретном чате

## [0.7.46] — 2026-07-28

- Независимые помощник, статусы и скролл для каждого чата
- Обновление интерфейса и локализации под брендинг Harbor Agents

## [0.7.17] — 2026-07-28

- Брендинг Harbor Agents / Гавань агентов
- Подготовка к публикации в Marketplace (иконка, README)

## [0.7.9] — 2026-07-27

- Ветвление диалога: переключение и удаление веток

## [0.7.5] — 2026-07-27

- Поиск по чату с подсветкой совпадений
- Режимы composer: Agent / Plan / Ask и кастомные режимы в Settings

## [0.6.86] — 2026-07-27

- Флаг vision у моделей; изображения только для vision-моделей
- Меню вложений «+» и `@`-упоминания файлов workspace

## [0.6.83] — 2026-07-27

- Вложения в чат: превью, paste и drop
- Исправлена загрузка сообщений с вложениями при открытии панели

## [0.6.72] — 2026-07-27

- Редактирование сообщений пользователя
- Статусы хода в ленте чата
- Сворачиваемые tool-шаги (run / read / write)

## [0.6.64] — 2026-07-27

- Regenerate последнего ответа ассистента
- Запоминание модели последнего ответа

## [0.6.61] — 2026-07-27

- Копирование сообщений и блоков кода
- Toast после копирования

## [0.6.50] — 2026-07-26

- Переименование агента по клику на название
- В README описана приватность: данные не уходят за пределы выбранного API

## [0.6.46] — 2026-07-25

- Enter применяет «Готово» в модалках модели и провайдера

## [0.6.44] — 2026-07-25

- Названия провайдеров в списке моделей обновляются сразу после переименования

## [0.6.43] — 2026-07-25

- Избранные модели (иконка сердца) — первыми в селекторе чата

## [0.6.40] — 2026-07-25

- Параметры модели в попапе по иконке info
- Подсветка строки модели при наведении

## [0.6.35] — 2026-07-25

- Автосохранение настроек при изменении полей

## [0.6.33] — 2026-07-25

- Провайдеры и компактный список моделей (свитч, модалка)

## [0.6.26] — 2026-07-25

- Гибкий импорт моделей (JSON, max input/output)
- README без корпоративных деталей

## [0.6.21] — 2026-07-24

- Экран настроек
- Иконки Material Symbols Outlined

## [0.6.15] — 2026-07-24

- Агенты хранятся локально по workspace (`workspaceState`)
- Пустые агенты удаляются сразу, без архива

## [0.6.11] — 2026-07-24

- Индикатор контекста — компактный кружок с подсказкой

## [0.6.6] — 2026-07-24

- Индикатор контекста под композером
- Модель «агент = чат» (ветки — отдельные чаты того же агента)

## [0.6.1] — 2026-07-24

- Архив агентов с восстановлением
- Учёт context window

## [0.5.8] — 2026-07-24

- Обновлена иконка удаления

## [0.5.5] — 2026-07-24

- Список агентов и чатов
- Сохранение сессий между перезагрузками

## [0.4.21] — 2026-07-24

- Исправлено скрытие кнопки Source Control после discard

## [0.4.20] — 2026-07-24

- Первый релиз: чат с OpenAI-compatible API, tools и ревью изменений
