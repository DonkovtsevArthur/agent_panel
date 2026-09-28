#!/usr/bin/env node
/**
 * Copy packaged default skills next to the compiled sidecar (`out/bundled-skills`)
 * so JetBrains / headless hosts can seed ~/.harbor/skills without the repo tree.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "bundled-skills");
const dest = path.join(root, "out", "bundled-skills");

function main() {
  if (!fs.existsSync(src)) {
    console.warn("sync-bundled-skills: bundled-skills/ missing — skip");
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  const names = fs
    .readdirSync(dest, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  console.log(`synced bundled-skills → out/bundled-skills (${names.length}): ${names.join(", ")}`);
}

main();
