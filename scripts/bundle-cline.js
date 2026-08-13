const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const stubsDir = path.join(__dirname, "stubs");
const langfuseTelemetryStub = path.join(
  stubsDir,
  "langfuse-telemetry-noop.mjs"
);
const langfuseOtelStub = path.join(stubsDir, "langfuse-otel-noop.mjs");
const langfuseCoreStub = path.join(stubsDir, "langfuse-core-noop.mjs");
const otlpExporterStub = path.join(stubsDir, "otlp-exporter-noop.mjs");

/** Redirect Cline Langfuse module (source or dist) to Harbor noop. */
function harborNoLangfuseTelemetryPlugin() {
  return {
    name: "harbor-no-langfuse-telemetry",
    setup(build) {
      build.onResolve(
        { filter: /(^|[\\/])langfuse-telemetry(\.[cm]?[jt]sx?)?$/ },
        () => ({
          path: langfuseTelemetryStub,
        })
      );
    },
  };
}

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
    // Keep vendor/cline telemetry trees intact; strip network sinks at Harbor bundle boundary.
    alias: {
      "@langfuse/otel": langfuseOtelStub,
      "@langfuse/core": langfuseCoreStub,
      "@opentelemetry/exporter-trace-otlp-http": otlpExporterStub,
      "@opentelemetry/exporter-metrics-otlp-http": otlpExporterStub,
      "@opentelemetry/exporter-logs-otlp-http": otlpExporterStub,
    },
    plugins: [harborNoLangfuseTelemetryPlugin()],
  })
  .then(() => {
    // Harbor: spawn children inherit parent extraTools (MCP). Vendor source
    // is spawn-tool.ts; this keeps the running CJS bundle aligned when the
    // bundled factory still matches the Harbor-patched shape.
    const outfile = path.join(__dirname, "..", "out", "clineBundle.js");
    let source = fs.readFileSync(outfile, "utf8");
    const oldSnippet = `createSubAgentTools: () => {
    let Y10 = Z10.enableTools ? G63({ cwd: Z10.cwd, telemetry: Z10.telemetry, ...z12[B$2({ mode: Z10.mode })], enableAskQuestion: false, executors: J10 }) : [];
    return J$3(Y10);
  }`;
    const newSnippet = `createSubAgentTools: () => {
    let Y10 = Z10.enableTools ? G63({ cwd: Z10.cwd, telemetry: Z10.telemetry, ...z12[B$2({ mode: Z10.mode })], enableAskQuestion: false, enableSpawnAgent: false, enableAgentTeams: false, executors: J10 }) : [];
    let extras = Array.isArray(Z10.extraTools) ? Z10.extraTools : [];
    return J$3(Y10.concat(extras));
  }`;
    if (source.includes(oldSnippet) && !source.includes("Y10.concat(extras)")) {
      source = source.replace(oldSnippet, newSnippet);
    }
    // Running Cline puts text first, then userImages. GLM often only reads the
    // first content part — keep pixels ahead of the prompt.
    const oldImageOrder = "let Y10 = [{ type: \"text\", text: $10 }, ...W10];";
    const newImageOrder = "let Y10 = [...W10, { type: \"text\", text: $10 }];";
    if (source.includes(oldImageOrder)) {
      source = source.replace(oldImageOrder, newImageOrder);
    }
    // Cline catalogs list z-ai/glm-5.2 without "images"; modelSupportsImageInput
    // then fail-closes and strips pixels. Advertise vision on those entries.
    const patchedGlm = source.replace(
      /("z-ai\/glm-5\.2":\s*\{id:\s*"z-ai\/glm-5\.2"[^[]*?capabilities:\s*\[)(?![^\]]*"images")/g,
      '$1"images", '
    );
    if (patchedGlm !== source) {
      source = patchedGlm;
    }
    fs.writeFileSync(outfile, source);
  })
  .catch(() => process.exit(1));
