const test = require("node:test");
const assert = require("node:assert/strict");

const {
  KIMI_MIN_MAX_TOKENS,
  resolveModelCapabilities,
  resolveModelContextWindow,
  resolveModelRequestMaxTokens,
} = require("../out/modelCapabilities.js");

test("registry resolves exact context and vision capabilities", () => {
  const gpt = resolveModelCapabilities("gpt-4.1");
  assert.equal(gpt.contextWindow, 1_047_576);
  assert.equal(gpt.supportsVision, true);

  const coder = resolveModelCapabilities("Qwen3-Coder-Next");
  assert.equal(coder.contextWindow, 262_144);
  assert.equal(coder.supportsVision, false);
});

test("registry applies family heuristics and safe unknown defaults", () => {
  assert.equal(resolveModelCapabilities("vendor/gpt-5-mini").supportsVision, true);
  assert.equal(resolveModelCapabilities("custom-coder-7b").supportsVision, false);
  assert.equal(resolveModelCapabilities("unlisted-model").supportsVision, false);
});

test("explicit config overrides registry capabilities", () => {
  const resolved = resolveModelCapabilities("gpt-4.1", {
    contextWindow: 64_000,
    supportsVision: false,
  });
  assert.equal(resolved.contextWindow, 64_000);
  assert.equal(resolved.supportsVision, false);
});

test("context resolution uses config, registry, then fallback", () => {
  assert.equal(resolveModelContextWindow("gpt-4.1", 32_000, 8_000), 32_000);
  assert.equal(resolveModelContextWindow("gpt-4.1", undefined, 8_000), 1_047_576);
  assert.equal(resolveModelContextWindow("unknown", undefined, 8_000), 8_000);
});

test("Kimi request quirks come from the registry", () => {
  const kimi = resolveModelCapabilities("moonshot/kimi-k2.6");
  assert.equal(kimi.family, "kimi");
  assert.equal(kimi.omitTemperature, true);
  assert.equal(kimi.requiresReasoningContentForToolCalls, true);
  assert.equal(kimi.minimumOutputTokens, KIMI_MIN_MAX_TOKENS);

  assert.equal(resolveModelRequestMaxTokens("kimi-k2.6", 4096), 8192);
  assert.equal(resolveModelRequestMaxTokens("kimi-k2.6", 4096, 2048), 4096);
  assert.equal(resolveModelRequestMaxTokens("gpt-4.1", 4096, 8192), 4096);
});
