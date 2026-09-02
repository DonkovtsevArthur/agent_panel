# Harbor Agents для Figma (2.7.87)

Локальный Development-плагин + фоновый Cline host. Не публикуется в Community.

## Требования

- **Figma Desktop** (не браузер)
- **Node.js 20+** (`node -v`)
- macOS для автозапуска host (`install-host.sh` → LaunchAgent). На других ОС: `./start-host.sh` и оставить терминал открытым.

## Установка (один раз)

1. Распакуйте этот архив куда удобно (путь лучше без кириллицы/пробелов).
2. Установите host:
   ```bash
   cd harbor-agents-figma-2.7.87
   ./install-host.sh
   ```
   Проверка: в браузере открыть http://127.0.0.1:17891/v1/health — должно быть `{"ok":true,…}`.
3. В Figma Desktop:
   - **Plugins → Development → Import plugin from manifest…**
   - выберите файл: `harbor-agents-figma-2.7.87/figma/manifest.json`
4. Запуск: **Plugins → Development → Harbor Agents**
5. В Settings плагина добавьте своих провайдеров / API-ключи (чужие настройки не переносятся).

## Обновление

Замените папку новой версией архива, снова `./install-host.sh` (перепишет LaunchAgent), в Figma: Remove старый Development-плагин → Import заново (или Reload).

## Удаление host

```bash
./uninstall-host.sh
```

## Без LaunchAgent

```bash
./start-host.sh
```

Затем откройте плагин в Figma.
