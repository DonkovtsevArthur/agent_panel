// Concatenates media/src/panel/*.js (in the fixed order below) into media/panel.js.
//
// This is intentionally a plain text concatenation, NOT an esbuild bundle:
// - No minification, no renaming — tests under tests/*.test.js grep the
//   built media/panel.js by exact function name/text, and the JetBrains
//   plugin (jetbrains/src/main/kotlin/com/harbor/agents/HarborWebviewHtml.kt)
//   copies media/panel.js verbatim as a single <script src> file.
// - Module order matters: it must reproduce the original file's top-to-bottom
//   declaration order so the shared IIFE scope resolves identically.
//
// Run manually after editing files under media/src/panel/:
//   node scripts/build-panel.js
//
// Not wired into `npm run compile` — rebuild explicitly when you change a module.

const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..", "media", "src", "panel");
const OUT_FILE = path.join(__dirname, "..", "media", "panel.js");

// Fixed order — mirrors the original media/panel.js top-to-bottom layout.
// File 01 opens the shared `(function () {` IIFE; this script appends the
// closing `})();` after the last file.
const MODULES = [
  "01-bootstrap-i18n.js",
  "02-dom-refs.js",
  "03-notifications.js",
  "04-i18n-apply.js",
  "05-composer-core.js",
  "06-jetbrains-polyfills.js",
  "07-composer-dom.js",
  "08-scroll-and-turns.js",
  "09-timeline-tools.js",
  "10-navigation-search.js",
  "11-settings-providers-models.js",
  "12-settings-mcp-skills.js",
  "13-settings-persist-modes.js",
  "14-agents-archive.js",
  "15-plan-build-scm.js",
  "16-render-utils.js",
  "17-message-render.js",
  "18-pickers-and-send.js",
  "19-clipboard-bindings.js",
  "20-message-router.js",
];

function build() {
  const parts = [];
  for (const name of MODULES) {
    const filePath = path.join(SRC_DIR, name);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing panel module: ${filePath}`);
    }
    // Read verbatim — no whitespace normalization. Blank lines at module
    // boundaries are meaningful (they reproduce the original file's
    // spacing); trimming them here previously dropped 10 separator blank
    // lines across the file.
    parts.push(fs.readFileSync(filePath, "utf8"));
  }
  const body = parts.join("");
  const out = body.endsWith("\n") ? `${body}})();\n` : `${body}\n})();\n`;
  fs.writeFileSync(OUT_FILE, out, "utf8");
  console.log(`Wrote ${OUT_FILE} from ${MODULES.length} modules in ${SRC_DIR}`);
}

build();
