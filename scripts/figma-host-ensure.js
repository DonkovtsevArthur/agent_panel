#!/usr/bin/env node
/**
 * Ensure Figma Cline host is up (dev helper).
 * Prefers LaunchAgent if installed; otherwise starts a detached node process.
 * Restarts the host when out/figmaSidecar.js is newer than the running process.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn, spawnSync, execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.HARBOR_FIGMA_PORT || 17891);
const SIDECAR = path.join(ROOT, "out", "figmaSidecar.js");

function sidecarBuildMtime() {
  try {
    return fs.statSync(SIDECAR).mtimeMs;
  } catch {
    return 0;
  }
}

function health() {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${PORT}/v1/health`,
      { timeout: 1500 },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            const j = JSON.parse(body);
            resolve(j && j.ok ? j : null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function killPort(port) {
  try {
    const out = execFileSync("lsof", ["-ti", `tcp:${port}`], {
      encoding: "utf8",
    }).trim();
    if (!out) return;
    out.split(/\s+/).forEach((pid) => {
      try {
        process.kill(Number(pid), "SIGTERM");
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* nothing listening */
  }
}

async function waitHealth(maxMs) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const h = await health();
    if (h) return h;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

async function startHost() {
  if (!fs.existsSync(SIDECAR)) {
    spawnSync(process.execPath, [path.join(ROOT, "scripts", "bundle-figma-sidecar.js")], {
      cwd: ROOT,
      stdio: "inherit",
    });
  }
  if (!fs.existsSync(path.join(ROOT, "out", "clineBundle.js"))) {
    console.error("Missing out/clineBundle.js — run npm run compile first.");
    process.exit(1);
  }

  killPort(PORT);
  await new Promise((r) => setTimeout(r, 300));

  const child = spawn(process.execPath, [SIDECAR], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, HARBOR_FIGMA_PORT: String(PORT) },
  });
  child.unref();

  const h = await waitHealth(5000);
  if (!h) {
    console.error("Host did not become healthy — check logs / npm run figma:host");
    process.exit(1);
  }
  console.log(`Figma Cline host started on :${PORT} (pid ${child.pid})`);
  return h;
}

async function main() {
  const wantMtime = sidecarBuildMtime();
  const live = await health();
  if (live) {
    const liveMtime =
      typeof live.buildMtime === "number" ? live.buildMtime : 0;
    if (wantMtime > 0 && liveMtime > 0 && wantMtime <= liveMtime) {
      console.log(`Figma Cline host already up on :${PORT}`);
      return;
    }
    if (wantMtime > liveMtime) {
      console.log("Restarting Figma Cline host (sidecar bundle updated)…");
    } else {
      console.log(`Figma Cline host already up on :${PORT}`);
      return;
    }
  }
  await startHost();
}

main();
