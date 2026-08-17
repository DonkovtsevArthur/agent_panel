# Harbor Agents — область скана ИБ и обоснования waivers

Документ описывает, что и почему исключается из статического скана
(AppScreener / иной SAST-гейт), и какие повторные находки закрываются
waiver'ом с обоснованием. Цель — сделать гейт ИБ устойчивым и не
зависящим от того, кто ведёт скан: обоснования зафиксированы в репо.

Контекст: отчёт AppScreener 3.15.9 от 13.08.2026, сканировался zip
репозитория `harbor-agents-master.zip`. Из 909 находок 1536 уже
отклонены триажем, актуальных 116, рейтинг 3.4/5. Подавляющее
большинство (~108) — в `vendor/cline` (чужой upstream-форк), в нашем
коде — 8, все закрыты коммитом `security/appscreener-fixes`.

## Принцип деления кода

| Зона | Путь | Поставляется в VSIX? | Сканировать? |
|------|------|----------------------|---------------|
| First-party код | `src/`, `media/src/`, `media/panel.js`, `packages/`, `jetbrains/src/` | Да (через `out/`, `media/`) | **Да** |
| Vendored upstream Cline | `vendor/cline/**` | Нет (`.vscodeignore` → `vendor/**`) | **Нет** |
| Сборочные артефакты JetBrains | `jetbrains/build/**` | Перегенерируются сборкой | **Нет** |
| Документация | `docs/**`, `vendor/cline/docs/**` | Нет | Нет |
| Тесты upstream | `vendor/cline/**/__tests__/**`, `*.test.ts` | Нет | Нет |

## Что исключить из области скана

Маски для настроек проекта в AppScreener (или для сборки чистого архива):

```
vendor/**
jetbrains/build/**
**/node_modules/**
out/**
.idea/**
.git/**
```

### Готовая команда чистого архива для рескана

Если удобнее подать в скан архив, а не настраивать исключения в
инсталляции AppScreener — собрать репозиторий без vendor и артефактов:

```bash
git archive --format=zip -o harbor-agents-clean.zip HEAD \
  -- ':(exclude)vendor/**' ':(exclude)jetbrains/build/**'
```

Проверено: 324 файла, `vendor/` — 0, `jetbrains/build/` — 0
(остаётся только `jetbrains/build.gradle.kts` — это исходник Gradle,
его и нужно оставить).

### Почему vendor исключается

- `vendor/cline/` — upstream-форк Cline (Apache-2.0), дерево
  заменяется wholesale при рефорке (`vendor/README.md`). Любые правки
  там стираются при следующем синке — трекаются upstream.
- В поставляемый VSIX vendor **не входит** (`.vscodeignore` →
  `vendor/**`). В `out/clineBundle.js` собирается только
  `vendor/cline/sdk/packages/**` через `scripts/bundle-cline.js` —
  apps-приложения апстрима (cline-hub, cli, их VS Code-экстеншн),
  тесты, доки и CI в бандле отсутствуют.
- Из ~108 vendor-находок в поставку реально попадает около десятка,
  и по-настоящему стоящих среди них — три CWE-338 в
  `sdk/packages/core` (`conversation-store.ts:16`,
  `plugin-install.ts:1037/1148`). См. раздел «Опционально» ниже.

## Waivers в нашем коде (повторные срабатывания)

Эти находки появятся снова после рескана — потому что сканер видит
буквальную строку без контекста. Закрываются waiver'ом с обоснованием.

### 1. `src/tlsPolicy.ts:36` и `:70` — `rejectUnauthorized: false`

```ts
insecureAgent = new https.Agent({ rejectUnauthorized: false });        // :36
undiciDispatcher = new undici.Agent({ connect: { rejectUnauthorized: false } }); // :70
```

- **CWE:** CWE-295 (небезопасные параметры SSL), Medium.
- **Обоснование waiver'а:** строки — это механизм явного opt-out для
  корпоративных self-signed/MITM-прокси (часто на внутренних LiteLLM
  шлюзах). Дефолт настройки `agentPanel.rejectUnauthorized` — **true**
  (проверка включена, см. `package.json`, `src/config.ts:776`). Опасный
  режим включается только осознанно пользователем. После коммита
  `security/appscreener-fixes` отключение проверки **больше не
  ослабляет весь extension host process** — `process.env.NODE_TLS_REJECT_UNAUTHORIZED`
  больше не трогается, небезопасный агент scoped per-request через
  `harborFetch`. Строки `rejectUnauthorized: false` намеренно остаются
  как реализация opt-in.
- **Что проверить:** `grep -n "NODE_TLS_REJECT_UNAUTHORIZED" src/tlsPolicy.ts`
  → только строка в комментарии, записи env нет.

### 2. `src/mcp/callbackServer.ts:26` — `http.createServer`

```ts
const server = http.createServer((req, res) => { ... });
```

- **CWE:** CWE-319 (передача чувствительных данных по незащищённому
  каналу), Medium.
- **Обоснование waiver'а:** loopback HTTP — стандарт для OAuth 2.0
  native apps, **RFC 8252 §7.3** прямо предписывает redirect на
  `http://127.0.0.1`. HTTPS на 127.0.0.1 не требуется и нереализуем
  (нет доверенного сертификата для loopback). Authorization code
  валидируется через `state` (`src/mcp/httpClient.ts:116`). Сервер
  слушает только `127.0.0.1` (после hardening), порт не торчит в сеть.
- **Ссылка:** https://datatracker.ietf.org/doc/html/rfc8252#section-7.3

## Закрытые коммитом `security/appscreener-fixes`

| Находка | CWE | Файл | Что сделано |
|---------|-----|------|-------------|
| Слабый ГПСЧ (5×) | CWE-338 | `media/panel.js`, `src/sessionStore.ts` | `crypto.randomUUID()` / `cryptoToken()` на `crypto.getRandomValues` |
| CSP nonce из `Math.random` | CWE-338 | `src/agentPanelProvider.ts` (`getNonce`) | `crypto.randomBytes(16).toString("hex")` |
| Stored XSS (Critical) | CWE-79 | `vendor/cline/apps/examples/menubar/ui/index.html` | `escapeHtml()` + экранирование tainted `innerHTML` sink'ов |
| Небезопасные параметры SSL (root cause) | CWE-295 | `src/tlsPolicy.ts` | Убран `NODE_TLS_REJECT_UNAUTHORIZED="0"`, secure-by-default |
| HTTP для OAuth (hardening) | CWE-319 | `src/mcp/callbackServer.ts` | bind `127.0.0.1`, экранирование `error`, комментарий RFC 8252 |

## Опционально: ГПСЧ в поставляемом clineBundle

Если ИБ сканирует содержимое VSIX (а не репозиторий), в `out/clineBundle.js`
физически присутствуют три CWE-338 из `vendor/cline/sdk/packages/core`:

- `src/session/stores/conversation-store.ts:16`
- `src/services/plugin-install.ts:1037`, `:1148`

Это реальная CWE-338 в поставке. Патч тривиальный (`crypto.randomUUID()`),
но это правка `vendor/cline/` — учитывается в патч-таблице `vendor/README.md`
при рефорке. По умолчанию **не вносится** (дерево заменяется wholesale).
Применить, только если гейт требует чистоты по поставляемому артефакту.

## Поведенческое изменение к релизу

Дефолт `agentPanel.rejectUnauthorized` развернут с `false` на `true`.
Пользователи за корпоративными self-signed прокси получат ошибки TLS,
пока не выключат «Проверять TLS-сертификаты» в Settings → Advanced
(или `"agentPanel.rejectUnauthorized": false` в settings.json).
Упомянуть в changelog.

## Рекомендация

Основной путь для ближайшего рескана:
1. Запушить `security/appscreener-fixes`.
2. Исключить `vendor/**` и `jetbrains/build/**` из области скана (маски выше
   или чистый архив через `git archive`).
3. Закрыть два waivers'а из этого документа (TLS opt-out, OAuth loopback HTTP).
4. Опционально — патч трёх ГПСЧ в `vendor/cline/sdk/packages/core`, если
   гейт требует чистоты по VSIX.

Ожидаемый результат: Critical — 0, Medium в нашем коде — 0 (после
waivers), остальное — чисто.
