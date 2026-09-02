#!/usr/bin/env node
/**
 * One-time install of Harbor Figma Cline host as a background service (macOS LaunchAgent).
 * After this, the plugin talks to http://127.0.0.1:17891 with no manual `figma:host`.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const LABEL = "com.harbor.agents.figma-host";
const PORT = process.env.HARBOR_FIGMA_PORT || "17891";

function nodePath() {
  return process.execPath;
}

function sidecarPath() {
  return path.join(ROOT, "out", "figmaSidecar.js");
}

function ensureBundled() {
  const out = sidecarPath();
  if (!fs.existsSync(out)) {
    console.log("Building Figma Cline host…");
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "bundle-figma-sidecar.js")],
      { cwd: ROOT, stdio: "inherit" }
    );
    if (r.status !== 0) {
      process.exit(r.status || 1);
    }
  }
  if (!fs.existsSync(path.join(ROOT, "out", "clineBundle.js"))) {
    console.error(
      "Missing out/clineBundle.js — run `npm run compile` once, then retry."
    );
    process.exit(1);
  }
}

function launchAgentsDir() {
  return path.join(os.homedir(), "Library", "LaunchAgents");
}

function plistPath() {
  return path.join(launchAgentsDir(), `${LABEL}.plist`);
}

function writePlist() {
  const home = path.join(os.homedir(), ".harbor", "figma");
  const logs = path.join(home, "logs");
  fs.mkdirSync(logs, { recursive: true });
  const node = nodePath();
  const script = sidecarPath();
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${script}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HARBOR_FIGMA_PORT</key>
    <string>${PORT}</string>
    <key>HARBOR_FIGMA_HOME</key>
    <string>${home}</string>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${path.join(logs, "host.stdout.log")}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(logs, "host.stderr.log")}</string>
</dict>
</plist>
`;
  fs.mkdirSync(launchAgentsDir(), { recursive: true });
  fs.writeFileSync(plistPath(), plist, "utf8");
}

function bootout() {
  try {
    execFileSync("launchctl", ["bootout", `gui/${process.getuid()}`, plistPath()], {
      stdio: "ignore",
    });
  } catch {
    /* not loaded */
  }
}

function bootstrap() {
  execFileSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, plistPath()], {
    stdio: "inherit",
  });
}

function installWindowsStartup() {
  const { execSync } = require("child_process");
  const node = nodePath().replace(/\\/g, "\\\\");
  const script = sidecarPath().replace(/\\/g, "\\\\");
  const regKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
  const regName = "HarborFigmaHost";
  const cmd = `reg add "${regKey}" /v "${regName}" /t REG_SZ /d "\\"${node}\\" \\"${script}\\"" /f`;
  try {
    execSync(cmd, { stdio: "ignore" });
  } catch (e) {
    console.error("Failed to set Windows startup registry:", e.message);
    process.exit(1);
  }
}

function startHostNow() {
  const child = spawn(nodePath(), [sidecarPath()], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, HARBOR_FIGMA_PORT: String(PORT) },
  });
  child.unref();
}

function main() {
  if (process.platform === "darwin") {
    ensureBundled();
    writePlist();
    bootout();
    bootstrap();
    console.log(`Harbor Figma Cline host installed (${LABEL}).`);
    console.log(`Listening on http://127.0.0.1:${PORT} — KeepAlive, starts at login.`);
    console.log("Uninstall: npm run figma:host:uninstall");
  } else if (process.platform === "win32") {
    ensureBundled();
    installWindowsStartup();
    startHostNow();
    console.log("Harbor Figma Cline host installed (Windows startup registry).");
    console.log(`Listening on http://127.0.0.1:${PORT} — starts at login.`);
    console.log("Uninstall: npm run figma:host:uninstall");
  } else {
    ensureBundled();
    startHostNow();
    console.log("Harbor Figma Cline host started.");
    console.log(`Listening on http://127.0.0.1:${PORT}`);
    console.log("Auto-start not supported on this OS — run `npm run figma:host:ensure` after reboot.");
  }
}

main();
