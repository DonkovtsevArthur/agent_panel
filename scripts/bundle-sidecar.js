#!/usr/bin/env node
/**
 * Bundle Harbor Node sidecar for JetBrains (stdio JSON-RPC + Cline turns).
 * Output: out/harborSidecar.js
 *
 * - Aliases `vscode` → headless stub
 * - Leaves `./clineBundle.js` external (loaded from out/ at runtime)
 */
const path = require("path");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");
const stub = path.join(root, "src/vscodeHeadlessStub.ts");

async function main() {
  await esbuild.build({
    entryPoints: [path.join(root, "src/sidecarMain.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: path.join(root, "out/harborSidecar.js"),
    sourcemap: true,
    logLevel: "info",
    alias: {
      vscode: stub,
    },
    external: [
      // Loaded at runtime from the same directory as harborSidecar.js
      "./clineBundle.js",
    ],
    // playwright / mcp optional — mark heavy optional deps external if pulled
    packages: "bundle",
  });
  console.log("bundled out/harborSidecar.js (with vscode headless stub)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
