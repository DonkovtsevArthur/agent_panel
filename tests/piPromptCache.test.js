const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

// `piTurnRunner` pulls in the runtime config, which loads `vscode` — alias the
// headless stub exactly like scripts/bundle-sidecar.js does.
const OUT = path.join(__dirname, "..", "out");
const stub = require(path.join(OUT, "vscodeHeadlessStub.js"));
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "vscode") return stub;
  return originalLoad.call(this, request, ...rest);
};

const { piPromptCacheCompat, piContextFingerprint } = require(path.join(
  OUT,
  "runtime/piTurnRunner.js"
));

test("openai-compatible provider gets Anthropic-style cache markers when opted in", () => {
  assert.deepEqual(piPromptCacheCompat(undefined, true), {
    cacheControlFormat: "anthropic",
  });
  assert.deepEqual(piPromptCacheCompat("openai", true), {
    cacheControlFormat: "anthropic",
  });
});

test("markerless by default (strict OpenAI upstreams reject cache_control)", () => {
  assert.equal(piPromptCacheCompat(undefined, false), undefined);
  assert.equal(piPromptCacheCompat("openai", false), undefined);
});

test("anthropic-messages transport is left alone — it marks the prompt itself", () => {
  assert.equal(piPromptCacheCompat("anthropic", true), undefined);
});

test("fingerprint tracks the provider prompt-cache flag", () => {
  const base = {
    providers: [{ id: "p1", baseUrl: "https://gw/v1", protocol: "openai" }],
    models: [{ id: "m1", providerId: "p1", contextWindow: 200000 }],
    defaultContextWindow: 128000,
  };
  const off = piContextFingerprint({ ...base, promptCache: { enabled: false } });
  const on = piContextFingerprint({ ...base, promptCache: { enabled: true } });
  assert.notEqual(off, on);

  // Per-provider override wins over the global flag.
  const overridden = piContextFingerprint({
    ...base,
    providers: [{ ...base.providers[0], promptCache: false }],
    promptCache: { enabled: true },
  });
  assert.equal(overridden, off);
});

test("fingerprint is stable for identical config and tracks model limits", () => {
  const cfg = {
    providers: [{ id: "p1", baseUrl: "https://gw/v1", protocol: "openai", promptCache: true }],
    models: [{ id: "m1", providerId: "p1", contextWindow: 200000, maxOutputTokens: 8192 }],
    defaultContextWindow: 128000,
    promptCache: { enabled: false },
  };
  assert.equal(piContextFingerprint(cfg), piContextFingerprint(JSON.parse(JSON.stringify(cfg))));
  const wider = {
    ...cfg,
    models: [{ ...cfg.models[0], contextWindow: 400000 }],
  };
  assert.notEqual(piContextFingerprint(cfg), piContextFingerprint(wider));
});
