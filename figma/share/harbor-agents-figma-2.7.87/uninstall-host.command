#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node scripts/figma-host-uninstall.js
echo ""
echo "✅ Host удалён."
read -p "Нажмите Enter для закрытия…"
