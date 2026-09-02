#!/usr/bin/env bash
# Если LaunchAgent не ставили — запуск host вручную в терминале
set -euo pipefail
cd "$(dirname "$0")"
exec node out/figmaSidecar.js
