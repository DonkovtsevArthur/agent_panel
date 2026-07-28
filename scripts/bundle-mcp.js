const esbuild = require("esbuild");

esbuild
  .build({
    entryPoints: ["src/mcp/manager.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    outfile: "out/mcpBundle.js",
    external: ["vscode"],
    sourcemap: true,
    logLevel: "info",
  })
  .catch(() => process.exit(1));
