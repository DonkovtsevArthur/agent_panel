const path = require("path");
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
  .catch(() => process.exit(1));
