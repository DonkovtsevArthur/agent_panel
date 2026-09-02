# Harbor Agents для Figma (2.7.87)

Локальный Development-плагин + фоновый Cline host. Не публикуется в Community.

## Требования

- **Figma Desktop** (не браузер)
- **Node.js 20+** (`node -v`)
- macOS для автозапуска host (`install-host.sh` → LaunchAgent). На других ОС: `./start-host.sh` и оставить терминал открытым.

## Установка (один раз)

1. Распакуйте этот архив куда удобно (путь лучше без кириллицы/пробелов).
2. Запустите установщик:
   - **macOS**: двойной клик по **install-host.command**
   - **Windows**: двойной клик по **install-host.bat**
   Откроется терминал, host установится автоматически.
   Проверка: в браузере открыть http://127.0.0.1:17891/v1/health — должно быть `{"ok":true,…}`.
3. В Figma Desktop:
   - **Plugins → Development → Import plugin from manifest…**
   - выберите файл: `harbor-agents-figma-2.7.87/figma/manifest.json`
4. Запуск: **Plugins → Development → Harbor Agents**
5. В Settings плагина добавьте провайдеров / API-ключи.

## Обновление

Замените папку новой версией архива, снова запустите install-host (перепишет автозапуск), в Figma: Remove старый Development-плагин → Import заново (или Reload).

## Удаление host

- **macOS**: двойной клик по **uninstall-host.command**
- **Windows**: двойной клик по **uninstall-host.bat**

## Без автозапуска

Запустите **start-host** (.command на macOS / .bat на Windows) — host будет работать пока открыт терминал.
