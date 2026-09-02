#!/usr/bin/env node
/** Remove macOS LaunchAgent for Harbor Figma Cline host. */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const LABEL = "com.harbor.agents.figma-host";
const plist = path.join(
  os.homedir(),
  "Library",
  "LaunchAgents",
  `${LABEL}.plist`
);

if (process.platform !== "darwin") {
  console.error("Uninstall is macOS-only.");
  process.exit(1);
}

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
console.log("Harbor Figma Cline host uninstalled.");
