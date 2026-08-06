const esbuild = require("esbuild");

esbuild
  .build({
    entryPoints: ["scripts/clineSdkEntry.mjs"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: "out/clineBundle.js",
    external: ["vscode"],
    sourcemap: true,
    logLevel: "info",
    banner: {
      js: [
        "var __harbor_import_meta_url = require('url').pathToFileURL(__filename).href;",
        "var import_meta = { url: __harbor_import_meta_url };",
      ].join("\n"),
    },
    // Replace ESM import.meta.url usages with our CJS-safe stand-in.
    define: {
      "import.meta.url": "__harbor_import_meta_url",
    },
  })
  .catch(() => process.exit(1));
