@echo off
cd /d "%~dp0"
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo Нужен Node.js 20+ ^(https://nodejs.org^).
  pause
  exit /b 1
)
node scripts\figma-host-ensure.js
pause
