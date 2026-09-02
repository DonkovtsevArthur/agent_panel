#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Нужен Node.js 20+ (https://nodejs.org). Сейчас node не найден в PATH."
  read -p "Нажмите Enter для закрытия…"
  exit 1
fi
node scripts/figma-host-install.js
echo ""
echo "✅ Host установлен. Теперь откройте Figma Desktop → Plugins → Development → Import plugin from manifest"
echo "   Выберите файл: $(dirname "$0")/figma/manifest.json"
read -p "Нажмите Enter для закрытия…"
