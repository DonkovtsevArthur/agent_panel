/**
 * Remove compiled output before a full build.
 * `tsc` never deletes .js files whose .ts source was removed, so stale modules
 * accumulated in out/ and shipped inside the VSIX (and tests could import them).
 */
const fs = require("fs");
const path = require("path");

const outDir = path.join(__dirname, "..", "out");
fs.rmSync(outDir, { recursive: true, force: true });
