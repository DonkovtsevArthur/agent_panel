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
    // Harbor fork patches (spawn extras concat, images-first user content,
    // GLM-5.2 catalog vision) live in vendor/cline sources and reach the
    // bundle through the rebuilt node_modules/@cline/* dists — no
    // post-processing of minified output needed anymore.

    // Post-build: patch Anthropic provider for proxy compatibility.
    // The bundle's createAnthropicProviderModule passes config22.fetch
    // directly to @ai-sdk/anthropic. For non-official endpoints we wrap
    // fetch to: (1) strip unsupported anthropic-beta headers, (2) convert
    // system content blocks to plain string, (3) convert non-streaming
    // JSON responses to Anthropic SSE format.
    const bundlePath = path.join(__dirname, "..", "out", "clineBundle.js");
    let code = fs.readFileSync(bundlePath, "utf8");

    const proxyFetchFn = `
function __harborCreateProxyFetch(underlyingFetch) {
  const f = underlyingFetch ?? globalThis.fetch;
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/v1/messages") || init?.method !== "POST") {
      return f(input, init);
    }
    const headers = new Headers(init?.headers);
    headers.delete("anthropic-beta");
    let bodyStr = init?.body;
    let wantsStream = false;
    if (bodyStr) {
      try {
        const body = JSON.parse(bodyStr);
        wantsStream = body.stream === true;
        if (Array.isArray(body.system)) {
          body.system = body.system.filter((block) => block.type === "text").map((block) => block.text).join("\\n");
        }
        bodyStr = JSON.stringify(body);
      } catch (e) {}
    }
    const resp = await f(input, { ...init, headers, body: bodyStr });
    if (!wantsStream || resp.headers.get("content-type")?.includes("text/event-stream")) {
      return resp;
    }
    try {
      const cloned = resp.clone();
      const json = await cloned.json();
      if (json.type === "error") {
        const errBody = "event: error\\ndata: " + JSON.stringify(json) + "\\n\\n";
        return new Response(errBody, { status: resp.status, headers: { "content-type": "text/event-stream" } });
      }
      const id = json.id || "msg_proxy";
      const model = json.model || "unknown";
      const role = json.role || "assistant";
      const contentBlocks = json.content || [];
      const usage = json.usage || {};
      let sse = "";
      sse += "event: message_start\\ndata: " + JSON.stringify({ type: "message_start", message: { id, type: "message", role, content: [], model, stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input_tokens || 0, output_tokens: 0, cache_creation_input_tokens: usage.cache_creation_input_tokens, cache_read_input_tokens: usage.cache_read_input_tokens } } }) + "\\n\\n";
      contentBlocks.forEach((block, idx) => {
        sse += "event: content_block_start\\ndata: " + JSON.stringify({ type: "content_block_start", index: idx, content_block: { type: block.type || "text", ...(block.type === "text" ? { text: "" } : block.type === "tool_use" ? { id: block.id, name: block.name, input: {} } : {}) } }) + "\\n\\n";
        if (block.type === "text" && block.text) {
          sse += "event: content_block_delta\\ndata: " + JSON.stringify({ type: "content_block_delta", index: idx, delta: { type: "text_delta", text: block.text } }) + "\\n\\n";
        }
        if (block.type === "tool_use" && block.input) {
          sse += "event: content_block_delta\\ndata: " + JSON.stringify({ type: "content_block_delta", index: idx, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } }) + "\\n\\n";
        }
        sse += "event: content_block_stop\\ndata: " + JSON.stringify({ type: "content_block_stop", index: idx }) + "\\n\\n";
      });
      sse += "event: message_delta\\ndata: " + JSON.stringify({ type: "message_delta", delta: { stop_reason: json.stop_reason || "end_turn", stop_sequence: null }, usage: { output_tokens: usage.output_tokens || 0 } }) + "\\n\\n";
      sse += "event: message_stop\\ndata: " + JSON.stringify({ type: "message_stop" }) + "\\n\\n";
      return new Response(sse, { status: resp.status, headers: { "content-type": "text/event-stream" } });
    } catch (e) {
      return resp;
    }
  };
}
`;

    // Pattern: the function that creates the Anthropic provider and passes fetch.
    // We inject __harborCreateProxyFetch and wrap the fetch for non-official endpoints.
    const targetPattern = /async function createAnthropicProviderModule\((\w+),\s*(\w+)\)\s*\{/;
    const match = code.match(targetPattern);
    if (match) {
      const [fullMatch, configParam, contextParam] = match;
      const replacement = proxyFetchFn + `async function createAnthropicProviderModule(${configParam}, ${contextParam}) {
  const __isOfficialAnthropic = !${configParam}.baseUrl || ${configParam}.baseUrl.includes("api.anthropic.com");
  const __baseFetch = ${configParam}.fetch;
  ${configParam}.fetch = __isOfficialAnthropic ? __baseFetch : __harborCreateProxyFetch(__baseFetch);
`;
      code = code.replace(fullMatch, replacement);
      fs.writeFileSync(bundlePath, code);
      console.log("  ✓ Applied Anthropic proxy fetch patch");
    } else {
      console.log("  ⚠ Could not find createAnthropicProviderModule to patch");
    }
  })
  .catch(() => process.exit(1));
