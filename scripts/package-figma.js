#!/usr/bin/env node
/**
 * Package the Figma plugin into a distributable zip.
 *
 * Usage:  node scripts/package-figma.js [version]
 * Output: figma/share/harbor-agents-figma-<version>.zip
 *
 * Steps:
 *  1. Build plugin (build:figma) + sidecar (bundle-figma-sidecar.js)
 *  2. Assemble share directory with plugin, sidecar, skills, commands, scripts
 *  3. Generate README + shell wrappers
 *  4. Zip → figma/share/
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const shareRoot = path.join(root, "figma", "share");

function getVersion(arg) {
  if (arg) return arg;
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "figma", "manifest.json"), "utf8")
  );
  if (manifest.version) return manifest.version;
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8")
  );
  return pkg.version || "0.0.0";
}

function buildAll() {
  console.log("Building Figma plugin…");
  execFileSync(process.execPath, [path.join(__dirname, "build-figma.js")], {
    cwd: root,
    stdio: "inherit",
  });
  console.log("Bundling sidecar + skills…");
  execFileSync(
    process.execPath,
    [path.join(__dirname, "bundle-figma-sidecar.js")],
    { cwd: root, stdio: "inherit" }
  );
}

function assemble(version) {
  const dirName = `harbor-agents-figma-${version}`;
  const dest = path.join(shareRoot, dirName);

  // Clean previous
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true });
  }
  fs.mkdirSync(dest, { recursive: true });

  // Plugin files
  const figmaDest = path.join(dest, "figma");
  fs.mkdirSync(figmaDest, { recursive: true });
  for (const f of ["code.js", "ui.html", "manifest.json"]) {
    fs.copyFileSync(path.join(root, "figma", "dist", f), path.join(figmaDest, f));
  }

  // Sidecar + Cline bundle
  const outDest = path.join(dest, "out");
  fs.mkdirSync(outDest, { recursive: true });
  for (const f of ["figmaSidecar.js", "clineBundle.js"]) {
    const src = path.join(root, "out", f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(outDest, f));
    }
  }

  // Skills
  const skillsSrc = path.join(root, "out", "figma-skills");
  if (fs.existsSync(skillsSrc)) {
    fs.cpSync(skillsSrc, path.join(outDest, "figma-skills"), { recursive: true });
  }

  // Commands
  const cmdsSrc = path.join(root, "out", "figma-commands");
  if (fs.existsSync(cmdsSrc)) {
    fs.cpSync(cmdsSrc, path.join(outDest, "figma-commands"), { recursive: true });
  }

  // Host management scripts
  const scriptsDest = path.join(dest, "scripts");
  fs.mkdirSync(scriptsDest, { recursive: true });
  for (const f of [
    "figma-host-install.js",
    "figma-host-ensure.js",
    "figma-host-uninstall.js",
  ]) {
    const src = path.join(root, "scripts", f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(scriptsDest, f));
    }
  }

  // Shell wrappers (.command = double-clickable on macOS, .bat = Windows)
  fs.writeFileSync(
    path.join(dest, "install-host.command"),
    `#!/usr/bin/env bash
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
`,
    { mode: 0o755 }
  );

  fs.writeFileSync(
    path.join(dest, "start-host.command"),
    `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Нужен Node.js 20+ (https://nodejs.org)."
  read -p "Нажмите Enter для закрытия…"
  exit 1
fi
node scripts/figma-host-ensure.js
read -p "Нажмите Enter для закрытия…"
`,
    { mode: 0o755 }
  );

  fs.writeFileSync(
    path.join(dest, "uninstall-host.command"),
    `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node scripts/figma-host-uninstall.js
echo ""
echo "✅ Host удалён."
read -p "Нажмите Enter для закрытия…"
`,
    { mode: 0o755 }
  );

  // Windows .bat wrappers
  fs.writeFileSync(
    path.join(dest, "install-host.bat"),
    `@echo off
cd /d "%~dp0"
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo Нужен Node.js 20+ ^(https://nodejs.org^). Сейчас node не найден в PATH.
  pause
  exit /b 1
)
node scripts\\figma-host-install.js
echo.
echo ✅ Host установлен. Теперь откройте Figma Desktop → Plugins → Development → Import plugin from manifest
echo    Выберите файл: %~dp0figma\\manifest.json
pause
`,
    { mode: 0o755 }
  );

  fs.writeFileSync(
    path.join(dest, "start-host.bat"),
    `@echo off
cd /d "%~dp0"
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo Нужен Node.js 20+ ^(https://nodejs.org^).
  pause
  exit /b 1
)
node scripts\\figma-host-ensure.js
pause
`,
    { mode: 0o755 }
  );

  fs.writeFileSync(
    path.join(dest, "uninstall-host.bat"),
    `@echo off
cd /d "%~dp0"
node scripts\\figma-host-uninstall.js
echo.
echo ✅ Host удалён.
pause
`,
    { mode: 0o755 }
  );

  // README
  fs.writeFileSync(
    path.join(dest, "README.md"),
    `# Harbor Agents для Figma (${version})

Локальный Development-плагин + фоновый Cline host. Не публикуется в Community.

## Требования

- **Figma Desktop** (не браузер)
- **Node.js 20+** (\`node -v\`)
- macOS для автозапуска host (\`install-host.sh\` → LaunchAgent). На других ОС: \`./start-host.sh\` и оставить терминал открытым.

## Установка (один раз)

1. Распакуйте этот архив куда удобно (путь лучше без кириллицы/пробелов).
2. Запустите установщик:
   - **macOS**: двойной клик по **install-host.command**
   - **Windows**: двойной клик по **install-host.bat**
   Откроется терминал, host установится автоматически.
   Проверка: в браузере открыть http://127.0.0.1:17891/v1/health — должно быть \`{"ok":true,…}\`.
3. В Figma Desktop:
   - **Plugins → Development → Import plugin from manifest…**
   - выберите файл: \`${dirName}/figma/manifest.json\`
4. Запуск: **Plugins → Development → Harbor Agents**
5. В Settings плагина добавьте провайдеров / API-ключи.

## Обновление

Замените папку новой версией архива, снова запустите install-host (перепишет автозапуск), в Figma: Remove старый Development-плагин → Import заново (или Reload).

## Удаление host

- **macOS**: двойной клик по **uninstall-host.command**
- **Windows**: двойной клик по **uninstall-host.bat**

## Без автозапуска

Запустите **start-host** (.command на macOS / .bat на Windows) — host будет работать пока открыт терминал.
`
  );

  return { dirName, dest };
}

function zip(dirName, dest) {
  const zipPath = path.join(shareRoot, `${dirName}.zip`);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", dest, zipPath], {
    cwd: shareRoot,
    stdio: "inherit",
  });
  const size = fs.statSync(zipPath).size;
  return { zipPath, size };
}

function main() {
  const version = getVersion(process.argv[2]);
  buildAll();
  const { dirName, dest } = assemble(version);
  const { zipPath, size } = zip(dirName, dest);
  console.log(`\n✓ Package ready: ${zipPath} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`  Share: send the .zip file`);
  console.log(`  Install: unzip → ./install-host.sh → Figma Import manifest`);
}

main();
