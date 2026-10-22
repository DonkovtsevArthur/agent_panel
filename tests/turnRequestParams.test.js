const test = require("node:test");
const assert = require("node:assert/strict");
const { formatTurnRequestParams } = require("../out/turnTiming");

test("formats effective request params", () => {
  assert.equal(
    formatTurnRequestParams({
      model: "claude-sonnet-4-5",
      provider: "LiteLLM",
      protocol: "openai-compatible",
      contextWindow: 200000,
      maxInputTokens: 170000,
      maxTokens: 16000,
      reasoningEffort: "high",
      omitTemperature: true,
    }),
    "model=claude-sonnet-4-5 provider=LiteLLM protocol=openai-compatible contextWindow=200000 maxInputTokens=170000 maxTokens=16000 reasoning_effort=high temperature=not-sent (omitTemperature)"
  );
});

test("marks missing values as defaults", () => {
  assert.equal(
    formatTurnRequestParams({ model: "gpt-4.1", temperature: 0.2 }),
    "model=gpt-4.1 protocol=openai-compatible contextWindow=default maxInputTokens=default maxTokens=default reasoning_effort=off temperature=0.2"
  );
});
