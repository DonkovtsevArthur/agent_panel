#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Нужен Node.js 20+ (https://nodejs.org)."
  read -p "Нажмите Enter для закрытия…"
  exit 1
fi
node scripts/figma-host-ensure.js
read -p "Нажмите Enter для закрытия…"
