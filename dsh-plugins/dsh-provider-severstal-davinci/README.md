# Провайдер Severstal DaVinci для DeepSeek Harness

**dsh-provider-severstal-davinci** — плагин для [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), который подключает корпоративную AI-платформу **Severstal DaVinci**: маршрут `severstal-davinci` через OpenAI-совместимый шлюз платформы, каталог моделей, корпоративный TLS CA.

**Установка = два шага:** поставить плагин и ввести ключ API в Settings → Models. Файлы конфигурации править не нужно — плагин всё прописывает сам.

## Что даёт

- Маршрут `severstal-davinci` («Severstal DaVinci») в селекторе моделей — сразу после установки.
- 14 chat-моделей из каталога платформы с реальными лимитами из `GET /openai/models`.
- Модель `deepseek-v4.1-flash` объявлена мультимодальной (текст + изображения) — проверено живым запросом.
- Работает всё, что нужно агенту: SSE-стриминг, `stream_options.include_usage`, tool/function calling, поток размышлений (`reasoning_content`), `max_completion_tokens`.
- Доверие корпоративному CA (без него все запросы падают с `TRANSPORT`).
- Полный редактор маршрута в Settings → Models — **включая поле API key**, список моделей, Base URL.

## Установка

1. Откройте **Settings → Plugins** в DeepSeek Harness. Поле установки принимает npm-пакеты, Git-репозитории и локальные каталоги — укажите источник одним из способов:
   - **локальный каталог**: скопируйте папку `dsh-provider-severstal-davinci` на машину и вставьте её путь;
   - **Git-репозиторий**: вставьте URL репозитория (удобно, когда плагин лежит в общем git);
   - **tarball**: соберите `npm pack` и укажите путь к `.tgz`.

   Нажмите «Установить».

2. Откройте **Settings → Models → «Severstal DaVinci» → «Редактировать»** и вставьте ключ в поле **API key** → «Применить».

Всё. Плагин при загрузке сам прописывает маршрут (с каталогом моделей) в запись `llm-pi-ai` профиля через штатный ConfigEditor — тот же путь, которым пишет сама страница Models. Существующие маршруты (`mimo`, `kimi-api` и др.) не затрагиваются; повторная загрузка ничего не дублирует.

Для скриптуемой установки вместо поля можно положить ключ в файл `secrets/api-key` рядом с плагином (см. `secrets/api-key.example`) — плагин сам перенесёт его в credential store при загрузке.

Без VPN до внутренней сети шлюз `ai-platform.kube.severstal.severstalgroup.com` недоступен — запросы будут падать по таймауту.

## Ключ API

- **Основной путь — Settings → Models**: у строки «Severstal DaVinci» в редакторе есть поле **API key** (зелёная точка у строки = ключ задан). Харнесс сохраняет его в credential store под именем `SEVERSTAL_DAVINCI_API_KEY`.
- Альтернатива для автоматизации — файл `secrets/api-key` в каталоге плагина: при наличии файла он главнее (ключ переносится в store при каждой загрузке). Файл в `.gitignore`, в тарболл не попадает.
- Пока ключ не задан, запросы падают с `MISSING_CREDENTIAL` — это ожидаемое «fail-loud» поведение.

## Каталог моделей

| Модель | id в платформе | Контекст | Вывод |
|---|---|---|---|
| DeepSeek V4.1 Flash (текст+изображения) | `deepseek-v4.1-flash` | 1 048 576 | 65 536 |
| GLM-5.3 / GLM-5.3 Flash | `z-ai/glm-5.3`, `z-ai/glm-5.3-flash` | 1 048 576 | 65 536 |
| GPT-5.6 Terra, GPT-6.1 Sol | `openai/...` | ~1 050 000 | 64 000 |
| GPT-6 Luna / Sol | `openai/...` | 922 000 | 64 000 |
| Claude Sonnet 5.5 | `anthropic/claude-sonnet-5.5` | 1 000 000 | 64 000 |
| Claude Opus 5.5 / Fable 5.1 | `anthropic/...` | 200 000 | 64 000 |
| Kimi K3 | `moonshotai/kimi-k3` | 1 048 576 | 65 536 |
| Qwen3.8 27B | `qwen3.8-27b` | 262 144 | 65 536 |
| T-Lite IT | `T-lite-it` | 40 960 | 40 960 |
| Gemini Deep Research | `Gemini Deep Research` | 1 048 576 | 65 535 |

Не включены: embedding-модель (`USER-bge-m3`), image-gen модели (`seedream`, `gemini-3-pro-image`, `gpt-5.4-image-2`) и модели без объявленных лимитов (`qwen/qwen3.8-max`, `x-ai/grok-4.7`, `google/gemini-3.8-flash` и др.). Каталог живёт в обычной записи `severstal-davinci` внутри `llm-pi-ai` вашего профиля — дописать модели можно прямо в редакторе строки (Settings → Models). При обновлении платформы DaVinci лимиты сверяйте с `GET /openai/models`.

## TLS / корпоративный CA

Шлюз обслуживает сертификат, подписанный корпоративным CA (`Severstal Internal CA` ← корень `SeverstalGroupRoot`). Корень установлен в keychain macOS, но его нет в CA-бандле Node — запросы из харнесса падают с `SELF_SIGNED_CERT_IN_CHAIN`, что в UI выглядит как ошибка `Connection error. (code: TRANSPORT)`.

Поэтому `index.js` при загрузке добавляет цепочку CA из `certs/severstal-ca.pem` в доверенные сертификаты процесса (`tls.setDefaultCACertificates`, системные и публичные CA сохраняются). Настраивать ничего не нужно; при смене корпоративного CA обновите файл в `certs/` (корень действителен до 2041 года).

## Как это устроено

- `cordis.patch.yml` вставляет один entry (`llm-pi-ai-severstal`), чей модуль (`index.js`) при загрузке делает три вещи: расширяет доверие CA процесса; прописывает маршрут `severstal-davinci` (каталог моделей зашит в модуле) в запись `llm-pi-ai` профиля через сервис `configEditor` (штатный путь Settings → Models, с валидацией, откатом и hot-reload); опционально сидирует ключ из `secrets/api-key` в credential store.
- Никакого второго монтажа LLM-адаптера нет: маршрут обслуживает штатный адаптер `llm-pi-ai` профиля — поэтому нет коллизий каталога/авторизаций и нет npm-зависимостей.
- Маршрут обязан жить в namespace `llm-pi-ai`: страница Settings → Models рисует поле API key только для провайдеров этого namespace (жёсткая раскладка `layoutOf` в клиенте). Поэтому плагин «переселяет» маршрут именно туда, а не объявляет его в собственном entry.

## Проверка

1. В Settings → Models появится строка «Severstal DaVinci» (красная точка — ключ ещё не задан).
2. «Редактировать» → поле **API key** → вставить ключ → «Применить» — точка станет зелёной.
3. Выберите модель (например, DeepSeek V4.1 Flash) в селекторе моделей сессии и отправьте запрос.
4. Попросите что-нибудь, требующее инструмента — должен прийти tool-call и стрим размышлений.

## Совместимость

Проверено на DeepSeek Harness 0.2.2-rc.1. Плагин не зависит от внутренних пакетов приложения, кроме публичного API сервисов `configEditor`/`credentials`/`hmr`; при обновлении платформы DaVinci обновите лимиты моделей (источник — `GET /openai/models`).

## Troubleshooting

- Ошибка `Connection error.` с `code: TRANSPORT` — почти всегда TLS или сеть: проверьте VPN до внутренней сети и актуальность `certs/severstal-ca.pem`.
- `MISSING_CREDENTIAL` — не задан ключ API: Settings → Models → «Severstal DaVinci» → «Редактировать» → поле API key (или файл `secrets/api-key`).
- Маршрут не появляется в селекторе — посмотрите `debug.log` рядом с плагином: там пишутся причины (например, конфликт home-patch). Проверьте, что бандл установлен и включён (Settings → Plugins).
- Запросы падают по таймауту — нет VPN до внутренней сети (`ai-platform.kube.severstal.severstalgroup.com`).
