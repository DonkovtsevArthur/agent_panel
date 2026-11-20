"use strict";
/**
 * Bundles the Pi SDK into one ESM chunk for the extension host.
 *
 * Pi is ESM-only and cannot be require()'d from a CJS extension, so the adapter
 * loads out/pi/pi.mjs with a native import(). esbuild needs a createRequire
 * banner for the CJS dependencies inside Pi (see docs/pi-runtime-spike.md §3.2).
 *
 * Part of `npm run compile` (and therefore of `package`): Pi is the default
 * agent core, so a build without the chunk is a build error, not a warning.
 * `PI_NODE_MODULES` still allows bundling from an external node_modules.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const entry = path.join(__dirname, "pi-entry.mjs");
const outfile = path.join(root, "out", "pi", "pi.mjs");

let esbuild;
try {
  esbuild = require("esbuild");
} catch {
  console.error("esbuild не найден: выполните `npm i` в репозитории.");
  process.exit(1);
}

// Pi is a required dependency; PI_NODE_MODULES only relocates node_modules.
const piDepsDir = process.env.PI_NODE_MODULES || path.join(root, "node_modules");
if (!fs.existsSync(path.join(piDepsDir, "@earendil-works", "pi-coding-agent"))) {
  console.error(
    "bundle-pi: пакет @earendil-works/pi-coding-agent не установлен — чанк out/pi/pi.mjs не собран.\n" +
      "Pi — ядро по умолчанию, без него сборка не выпускается. Выполните `npm i` " +
      "(или задайте PI_NODE_MODULES=<node_modules с пакетом>)."
  );
  process.exit(1);
}

fs.mkdirSync(path.dirname(outfile), { recursive: true });
esbuild.buildSync({
  entryPoints: [entry],
  nodePaths: [piDepsDir],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile,
  banner: {
    js: "import{createRequire as __piCreateRequire}from'node:module';const require=__piCreateRequire(import.meta.url);",
  },
  logLevel: "info",
});
console.log(`built ${path.relative(root, outfile)}`);
