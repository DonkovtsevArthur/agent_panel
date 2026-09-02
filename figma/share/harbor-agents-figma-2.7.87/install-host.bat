@echo off
cd /d "%~dp0"
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo Нужен Node.js 20+ ^(https://nodejs.org^). Сейчас node не найден в PATH.
  pause
  exit /b 1
)
node scripts\figma-host-install.js
echo.
echo ✅ Host установлен. Теперь откройте Figma Desktop → Plugins → Development → Import plugin from manifest
echo    Выберите файл: %~dp0figma\manifest.json
pause
