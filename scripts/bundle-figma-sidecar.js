#!/usr/bin/env node
/**
 * Bundle Harbor Figma sidecar (HTTP + Cline turns).
 * Output: out/figmaSidecar.js
 *
 * - Aliases `vscode` → headless stub
 * - Leaves `./clineBundle.js` external (loaded from out/ at runtime)
 */
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");
const stub = path.join(root, "src/vscodeHeadlessStub.ts");

async function main() {
  await esbuild.build({
    entryPoints: [path.join(root, "src/figmaSidecarMain.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: path.join(root, "out/figmaSidecar.js"),
    sourcemap: true,
    logLevel: "info",
    alias: {
      vscode: stub,
    },
    external: ["./clineBundle.js"],
    packages: "bundle",
  });
  console.log("bundled out/figmaSidecar.js (Figma Cline host)");
  copyBundledFigmaSkills();
}

function copyBundledFigmaSkills() {
  const srcRoot = path.join(root, ".harbor", "skills");
  const dest = path.join(root, "out", "figma-skills");
  if (!fs.existsSync(srcRoot)) {
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(srcRoot)) {
    if (!name.startsWith("figma-")) {
      continue;
    }
    const src = path.join(srcRoot, name);
    if (!fs.statSync(src).isDirectory()) {
      continue;
    }
    fs.cpSync(src, path.join(dest, name), { recursive: true });
  }
  console.log("copied figma-* skills → out/figma-skills/");
  copyBundledFigmaCommands();
}

function copyBundledFigmaCommands() {
  const srcDir = path.join(root, ".harbor", "commands");
  const dest = path.join(root, "out", "figma-commands");
  if (!fs.existsSync(srcDir)) {
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    if (!name.startsWith("figma-") || !name.endsWith(".md")) {
      continue;
    }
    fs.copyFileSync(path.join(srcDir, name), path.join(dest, name));
  }
  console.log("copied figma-* commands → out/figma-commands/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
