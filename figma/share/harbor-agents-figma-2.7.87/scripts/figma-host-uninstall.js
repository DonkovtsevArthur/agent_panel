#!/usr/bin/env node
/** Remove auto-start for Harbor Figma Cline host (macOS LaunchAgent / Windows registry). */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, execSync } = require("child_process");

const LABEL = "com.harbor.agents.figma-host";
const PORT = process.env.HARBOR_FIGMA_PORT || "17891";

if (process.platform === "darwin") {
  const plist = path.join(
    os.homedir(),
    "Library",
    "LaunchAgents",
    `${LABEL}.plist`
  );
  try {
    execFileSync("launchctl", ["bootout", `gui/${process.getuid()}`, plist], {
      stdio: "ignore",
    });
  } catch {
    /* ignore */
  }
  if (fs.existsSync(plist)) {
    fs.unlinkSync(plist);
  }
  console.log("Harbor Figma Cline host uninstalled (macOS LaunchAgent removed).");
} else if (process.platform === "win32") {
  const regKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
  const regName = "HarborFigmaHost";
  try {
    execSync(`reg delete "${regKey}" /v "${regName}" /f`, { stdio: "ignore" });
  } catch {
    /* ignore */
  }
  // Kill running sidecar
  try {
    execSync(`for /f "tokens=5" %a in ('netstat -aon ^| findstr :${PORT}') do taskkill /PID %a /F`, { stdio: "ignore" });
  } catch {
    /* ignore */
  }
  console.log("Harbor Figma Cline host uninstalled (Windows startup entry removed).");
} else {
  console.log("Auto-start uninstall not supported on this OS. Kill the host process manually.");
}
