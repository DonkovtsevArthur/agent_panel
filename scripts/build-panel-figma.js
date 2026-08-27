// Concatenates media/src/panel-figma/*.js (allowlist) into figma/dist/ui.js.
//
// IDE panel modules under media/src/panel/ are intentionally NOT included —
// VS Code / WebStorm keep using scripts/build-panel.js → media/panel.js.
//
// Cut list (never in this bundle):
//   06-jetbrains-polyfills.js
//   12-settings-mcp-skills.js
//   15-plan-build-scm.js
//   acquireVsCodeApi primary host path
//   composer-scm / checkpoint / commitAndPush / figmaConnect UI
//
// Run: node scripts/build-panel-figma.js

const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..", "media", "src", "panel-figma");
const OUT_DIR = path.join(__dirname, "..", "figma", "dist");
const OUT_FILE = path.join(OUT_DIR, "ui.js");

/** Designer-only modules — physical cut of IDE panel surface. */
const MODULES = [
  "01-host-bridge.js",
  "02-agent-turn.js",
  "02a-markdown.js",
  "03-app.js",
];

const MARKED_FILE = path.join(__dirname, "..", "media", "marked.js");

/** Markers that must not appear in the Figma UI bundle. */
const FORBIDDEN = [
  "acquireVsCodeApi",
  "composer-scm",
  "figmaConnect",
  "commitAndPush",
  "checkpoint",
  "jetbrains-polyfills",
  "06-jetbrains-polyfills",
  "12-settings-mcp-skills",
  "15-plan-build-scm",
];

function build() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }
  if (!fs.existsSync(MARKED_FILE)) {
    throw new Error("Missing media/marked.js (same parser as VS Code webview)");
  }
  const parts = [fs.readFileSync(MARKED_FILE, "utf8")];
  for (const name of MODULES) {
    const filePath = path.join(SRC_DIR, name);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing Figma panel module: ${filePath}`);
    }
    parts.push(fs.readFileSync(filePath, "utf8"));
  }
  const out = parts.join("\n");
  for (const marker of FORBIDDEN) {
    if (out.includes(marker)) {
      throw new Error(
        `Figma UI bundle must not contain IDE marker "${marker}" — cut failed`
      );
    }
  }
  fs.writeFileSync(OUT_FILE, out, "utf8");
  console.log(
    `Wrote ${OUT_FILE} from marked.js + ${MODULES.length} panel-figma modules (IDE modules cut)`
  );
}

build();
