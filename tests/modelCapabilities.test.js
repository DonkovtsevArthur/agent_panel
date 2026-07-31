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

test("Claude 3.5+/4 supports reasoning_effort, Claude 3.0 does not", () => {
  const haiku4 = resolveModelCapabilities("claude-haiku-4-5");
  assert.equal(haiku4.supportsReasoningEffort, true);
  assert.equal(haiku4.reasoningEffortDefault, "high");
  // Extended thinking требует default temperature — поле опускаем.
  assert.equal(haiku4.omitTemperature, true);
  // max_tokens должен превышать thinking-бюджет.
  assert.equal(haiku4.minimumOutputTokens, 16_000);

  const sonnet35 = resolveModelCapabilities("claude-3-5-sonnet");
  assert.equal(sonnet35.supportsReasoningEffort, true);
  assert.equal(sonnet35.omitTemperature, true);

  const opus4 = resolveModelCapabilities("claude-opus-4-1");
  assert.equal(opus4.supportsReasoningEffort, true);

  // Claude 3.0 family — без thinking, temperature не опускаем.
  assert.equal(
    resolveModelCapabilities("claude-3-haiku").supportsReasoningEffort,
    false
  );
  assert.equal(
    resolveModelCapabilities("claude-3-haiku").omitTemperature,
    false
  );
  assert.equal(
    resolveModelCapabilities("claude-3-opus").supportsReasoningEffort,
    false
  );
  assert.equal(
    resolveModelCapabilities("claude-3-sonnet").supportsReasoningEffort,
    false
  );

  // Non-Claude models — no reasoning_effort capability by default.
  assert.equal(
    resolveModelCapabilities("gpt-4.1").supportsReasoningEffort,
    false
  );
  assert.equal(
    resolveModelCapabilities("DeepSeek-V4-Flash").supportsReasoningEffort,
    false
  );
});

test("Claude reasoning max_tokens is lifted above config default for thinking budget", () => {
  // config.maxTokens default 4096 → Math.max(4096, 16000) = 16000.
  assert.equal(
    resolveModelRequestMaxTokens("claude-haiku-4-5", 4096),
    16_000
  );
  // Явно заданный крупный max_tokens не урезается.
  assert.equal(
    resolveModelRequestMaxTokens("claude-sonnet-4-5", 32_000),
    32_000
  );
  // Без запрошенного — отдаём минимум.
  assert.equal(
    resolveModelRequestMaxTokens("claude-opus-4-1", undefined),
    16_000
  );
});

test("Claude reasoning strips reasoning_content on echo (no signature)", () => {
  const haiku4 = resolveModelCapabilities("claude-haiku-4-5");
  assert.equal(haiku4.stripReasoningOnEcho, true);
  // Kimi — наоборот, reasoning нужен в эхе.
  assert.equal(
    resolveModelCapabilities("Kimi-K2.5").stripReasoningOnEcho,
    false
  );
});

test("reasoningEffort override replaces the default", () => {
  const resolved = resolveModelCapabilities("claude-haiku-4-5", {
    reasoningEffort: "medium",
  });
  assert.equal(resolved.supportsReasoningEffort, true);
  assert.equal(resolved.reasoningEffortDefault, "medium");
});
