const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyModelFallbackError,
  looksLikeHeavyModel,
  looksLikeUtilityModel,
  modelFallbackEligibility,
  resolveSpeedRouting,
  resolveVisionPreferenceIds,
  routeModel,
  selectFallbackModel,
  selectUtilityModel,
  shouldAbandonHelperModel,
  UTILITY_MODEL_PREFERENCE,
  VISION_MODEL_PREFERENCE,
} = require("../out/modelRouting.js");

test("manual eligible selection always wins", () => {
  const result = routeModel(
    [
      { id: "gpt-4.1", favorite: true },
      { id: "claude-sonnet-4-5" },
    ],
    {
      userSelectedModelId: "claude-sonnet-4-5",
      hints: { vision_required: true, min_context_window: 150_000 },
    }
  );

  assert.deepEqual(result, {
    modelId: "claude-sonnet-4-5",
    reason: "user_selected",
  });
});

test("ineligible, disabled, and excluded manual selections fall back", () => {
  const models = [
    { id: "custom-coder", favorite: true },
    { id: "gpt-4.1", enabled: false },
    { id: "claude-sonnet-4-5" },
    { id: "Gemini 2.5 Flash" },
  ];

  assert.deepEqual(
    routeModel(models, {
      userSelectedModelId: "custom-coder",
      hints: { vision_required: true },
    }),
    { modelId: "claude-sonnet-4-5", reason: "capability_match" }
  );
  assert.deepEqual(
    routeModel(models, {
      userSelectedModelId: "gpt-4.1",
      hints: { vision_required: true },
    }),
    { modelId: "claude-sonnet-4-5", reason: "capability_match" }
  );
  assert.deepEqual(
    routeModel(models, {
      userSelectedModelId: "claude-sonnet-4-5",
      hints: {
        vision_required: true,
        fallback_after_failure: true,
        excluded_model_ids: ["claude-sonnet-4-5"],
      },
    }),
    { modelId: "Gemini 2.5 Flash", reason: "fallback_after_failure" }
  );
});

test("vision preference picks under-the-hood model when selection lacks vision", () => {
  assert.deepEqual(resolveVisionPreferenceIds([]), [...VISION_MODEL_PREFERENCE]);
  assert.deepEqual(resolveVisionPreferenceIds(["gpt-4.1", "gpt-4.1"]), [
    "gpt-4.1",
  ]);

  const models = [
    { id: "Qwen3-Coder-Next" },
    { id: "claude-sonnet-4-5", supportsVision: true },
    { id: "gpt-4.1", supportsVision: true },
    { id: "Gemini 2.5 Flash", supportsVision: true },
  ];

  assert.deepEqual(
    routeModel(models, {
      userSelectedModelId: "Qwen3-Coder-Next",
      hints: { vision_required: true, vision_preference: [] },
    }),
    { modelId: "Gemini 2.5 Flash", reason: "vision_preference" }
  );
  assert.deepEqual(
    routeModel(models, {
      userSelectedModelId: "Qwen3-Coder-Next",
      hints: {
        vision_required: true,
        vision_preference: ["claude-sonnet-4-5", "gpt-4.1"],
      },
    }),
    { modelId: "claude-sonnet-4-5", reason: "vision_preference" }
  );
  assert.deepEqual(
    routeModel(models, {
      userSelectedModelId: "gpt-4.1",
      hints: {
        vision_required: true,
        vision_preference: ["claude-sonnet-4-5"],
      },
    }),
    { modelId: "gpt-4.1", reason: "user_selected" }
  );
});

test("capability overrides and minimum context are mandatory", () => {
  const models = [
    {
      id: "unknown-explicit",
      contextWindow: 180_000,
      supportsVision: true,
    },
    { id: "gpt-4.1", contextWindow: 100_000 },
    { id: "unknown-context", supportsVision: true },
  ];

  assert.deepEqual(
    routeModel(models, {
      hints: { vision_required: true, min_context_window: 150_000 },
    }),
    { modelId: "unknown-explicit", reason: "capability_match" }
  );
  assert.equal(
    routeModel([{ id: "unknown-context" }], {
      hints: { min_context_window: 1 },
    }),
    undefined
  );
});

test("favorite then explicit fast preference then source order break ties", () => {
  const models = [
    { id: "first" },
    { id: "preferred-fast" },
    { id: "favorite-first", favorite: true },
    { id: "favorite-fast", favorite: true },
  ];

  assert.deepEqual(
    routeModel(models, {
      hints: {
        fast_readonly: true,
        fast_readonly_preference: ["preferred-fast", "favorite-fast"],
      },
    }),
    { modelId: "favorite-fast", reason: "fast_readonly_preference" }
  );
  assert.deepEqual(routeModel(models), {
    modelId: "favorite-first",
    reason: "favorite",
  });
});

test("fast_readonly preserves source order without explicit preference", () => {
  assert.deepEqual(
    routeModel(
      [
        { id: "slow-looking-name" },
        { id: "flash-turbo-cheap-looking-name" },
      ],
      { hints: { fast_readonly: true } }
    ),
    { modelId: "slow-looking-name", reason: "original_order" }
  );
});

test("routing is deterministic and returns undefined without candidates", () => {
  const models = [{ id: "a" }, { id: "b" }, { id: "c" }];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.deepEqual(routeModel(models), {
      modelId: "a",
      reason: "original_order",
    });
  }

  assert.equal(
    routeModel(models, {
      hints: { excluded_ids: ["a", "b", "c"] },
    }),
    undefined
  );
});

test("fallback classification accepts only explicit transport, capability, and context errors", () => {
  const transport = Object.assign(new Error("service unavailable"), {
    status: 503,
  });
  assert.deepEqual(classifyModelFallbackError(transport), {
    kind: "transport",
    message: "service unavailable",
  });
  assert.deepEqual(
    classifyModelFallbackError(
      new Error("API 400: context_length_exceeded: prompt is too long")
    ),
    {
      kind: "context",
      message: "API 400: context_length_exceeded: prompt is too long",
    }
  );
  assert.deepEqual(
    classifyModelFallbackError(
      new Error("API 500: Internal Server Error")
    ),
    {
      kind: "transport",
      message: "API 500: Internal Server Error",
    }
  );
  assert.equal(
    shouldAbandonHelperModel(new Error("API 500: Internal Server Error")),
    true
  );
  assert.equal(
    shouldAbandonHelperModel(new Error("API 401: invalid API key")),
    false
  );
  assert.deepEqual(
    classifyModelFallbackError(
      new Error("This model does not support image inputs")
    ),
    {
      kind: "capability",
      message: "This model does not support image inputs",
    }
  );
  assert.equal(
    classifyModelFallbackError(new Error("API 401: invalid API key")),
    undefined
  );
  assert.equal(
    classifyModelFallbackError(new Error("API 400: malformed request")),
    undefined
  );
  assert.equal(
    classifyModelFallbackError(new Error("arbitrary model refusal")),
    undefined
  );
});

test("fallback eligibility allows transport before side effects", () => {
  const reset = Object.assign(new Error("connection reset"), {
    code: "ECONNRESET",
  });
  const interrupted = new Error("SSE stream interrupted after partial response");
  const serverError = Object.assign(new Error("service unavailable"), {
    status: 503,
  });
  assert.equal(modelFallbackEligibility({ error: reset })?.kind, "transport");
  assert.equal(
    modelFallbackEligibility({ error: interrupted })?.kind,
    "transport"
  );
  assert.equal(
    modelFallbackEligibility({ error: serverError })?.kind,
    "transport"
  );
  assert.equal(
    modelFallbackEligibility({ error: reset, hadToolSideEffects: true }),
    undefined
  );
});

test("fallback eligibility rejects retries after effects, abort, or prior fallback", () => {
  const error = Object.assign(new Error("connection reset"), {
    code: "ECONNRESET",
  });
  assert.equal(modelFallbackEligibility({ error })?.kind, "transport");
  assert.equal(
    modelFallbackEligibility({ error, fallbackAlreadyAttempted: true }),
    undefined
  );
  assert.equal(
    modelFallbackEligibility({ error, hadFileEdits: true }),
    undefined
  );
  assert.equal(
    modelFallbackEligibility({ error, hadToolSideEffects: true }),
    undefined
  );
  assert.equal(
    modelFallbackEligibility({ error, hadAssistantOutput: true }),
    undefined
  );
  assert.equal(
    modelFallbackEligibility({ error, aborted: true }),
    undefined
  );

  const context = new Error("API 400: context_length_exceeded: prompt is too long");
  assert.equal(modelFallbackEligibility({ error: context })?.kind, "context");
});

test("fallback selection excludes failed model and preserves required capabilities", () => {
  const models = [
    {
      id: "failed-vision",
      favorite: true,
      supportsVision: true,
      contextWindow: 200_000,
    },
    {
      id: "small-vision",
      supportsVision: true,
      contextWindow: 128_000,
    },
    {
      id: "large-text",
      supportsVision: false,
      contextWindow: 300_000,
    },
    {
      id: "large-vision",
      supportsVision: true,
      contextWindow: 300_000,
    },
  ];

  assert.deepEqual(
    selectFallbackModel(models, {
      failedModelId: "failed-vision",
      visionRequired: true,
      minContextWindow: 200_000,
    }),
    { modelId: "large-vision", reason: "fallback_after_failure" }
  );
  assert.equal(
    selectFallbackModel(
      [
        { id: "failed", contextWindow: 200_000 },
        { id: "unknown-context" },
      ],
      {
        failedModelId: "failed",
        minContextWindow: 200_000,
      }
    ),
    undefined
  );
});

test("selectUtilityModel prefers lightweight models over favorites/main", () => {
  assert.ok(UTILITY_MODEL_PREFERENCE.includes("DeepSeek-V4-Flash"));
  assert.ok(UTILITY_MODEL_PREFERENCE.includes("Qwen3-Coder-Next"));

  assert.deepEqual(
    selectUtilityModel(
      [
        { id: "kimi-k2.6", favorite: true },
        { id: "Qwen3-Coder-Next" },
        { id: "DeepSeek-V4-Flash" },
      ],
      { fallbackModelId: "kimi-k2.6" }
    ),
    { modelId: "DeepSeek-V4-Flash", reason: "utility_preference" }
  );

  assert.deepEqual(
    selectUtilityModel(
      [
        { id: "kimi-k2.6", favorite: true },
        { id: "Qwen3-Coder-Next" },
      ],
      { fallbackModelId: "kimi-k2.6" }
    ),
    { modelId: "Qwen3-Coder-Next", reason: "utility_preference" }
  );

  assert.deepEqual(
    selectUtilityModel(
      [{ id: "kimi-k2.6", favorite: true }, { id: "claude-sonnet-4-5" }],
      { fallbackModelId: "kimi-k2.6" }
    ),
    { modelId: "kimi-k2.6", reason: "original_order" }
  );

  assert.deepEqual(
    selectUtilityModel(
      [{ id: "claude-sonnet-4-5" }, { id: "gpt-4.1" }],
      { fallbackModelId: "missing-main" }
    ),
    { modelId: "claude-sonnet-4-5", reason: "original_order" }
  );

  assert.equal(selectUtilityModel([]), undefined);
  assert.equal(
    selectUtilityModel([{ id: "DeepSeek-V4-Flash", enabled: false }], {
      fallbackModelId: "DeepSeek-V4-Flash",
    }),
    undefined
  );
});

test("selectUtilityModel picks custom flash/mini/haiku models by name", () => {
  assert.equal(looksLikeUtilityModel({ id: "gpt-4o-mini" }), true);
  assert.equal(looksLikeUtilityModel({ id: "claude-haiku-4-5" }), true);
  assert.equal(
    looksLikeUtilityModel({ id: "vendor/custom-flash-7b", label: "Custom Flash" }),
    true
  );
  assert.equal(looksLikeUtilityModel({ id: "kimi-k2.6" }), false);
  assert.equal(looksLikeUtilityModel({ id: "claude-sonnet-4-5" }), false);
  assert.equal(looksLikeUtilityModel({ id: "gpt-4.1" }), false);

  assert.deepEqual(
    selectUtilityModel(
      [
        { id: "kimi-k2.6", favorite: true },
        { id: "gpt-4.1" },
        { id: "gpt-4o-mini" },
      ],
      { fallbackModelId: "kimi-k2.6" }
    ),
    { modelId: "gpt-4o-mini", reason: "utility_preference" }
  );

  assert.deepEqual(
    selectUtilityModel(
      [
        { id: "claude-sonnet-4-5" },
        { id: "my-provider/haiku-fast", label: "Haiku Fast" },
      ],
      { fallbackModelId: "claude-sonnet-4-5" }
    ),
    { modelId: "my-provider/haiku-fast", reason: "utility_preference" }
  );

  // Exact builtin preference still wins over a generic flash.
  assert.deepEqual(
    selectUtilityModel(
      [
        { id: "vendor/custom-flash-7b" },
        { id: "Qwen3-Coder-Next" },
      ],
      { fallbackModelId: "vendor/custom-flash-7b" }
    ),
    { modelId: "Qwen3-Coder-Next", reason: "utility_preference" }
  );
});

test("resolveSpeedRouting uses fast helper for Plan/Ask and Agent explore", () => {
  const models = [
    { id: "kimi-k2.6", favorite: true },
    { id: "DeepSeek-V4-Flash" },
    { id: "Qwen3-Coder-Next" },
    { id: "claude-sonnet-4-5" },
  ];

  assert.equal(looksLikeHeavyModel({ id: "kimi-k2.6" }), true);
  assert.equal(looksLikeHeavyModel({ id: "DeepSeek-V4-Flash" }), false);

  assert.deepEqual(
    resolveSpeedRouting({
      models,
      userSelectedModelId: "kimi-k2.6",
      toolsPolicy: "readonly",
    }),
    {
      kind: "readonly_fast",
      primaryModelId: "DeepSeek-V4-Flash",
      fastModelId: "DeepSeek-V4-Flash",
    }
  );

  assert.deepEqual(
    resolveSpeedRouting({
      models,
      userSelectedModelId: "kimi-k2.6",
      toolsPolicy: "agent",
    }),
    {
      kind: "explore_then_edit",
      primaryModelId: "kimi-k2.6",
      fastModelId: "DeepSeek-V4-Flash",
    }
  );

  assert.deepEqual(
    resolveSpeedRouting({
      models,
      userSelectedModelId: "DeepSeek-V4-Flash",
      toolsPolicy: "agent",
    }),
    { kind: "none", primaryModelId: "DeepSeek-V4-Flash" }
  );

  assert.deepEqual(
    resolveSpeedRouting({
      models,
      userSelectedModelId: "kimi-k2.6",
      toolsPolicy: "agent",
      enabled: false,
    }),
    { kind: "none", primaryModelId: "kimi-k2.6" }
  );

  assert.deepEqual(
    resolveSpeedRouting({
      models: [
        { id: "kimi-k2.6" },
        { id: "DeepSeek-V4-Flash", supportsVision: false },
        { id: "Gemini 2.5 Flash" },
      ],
      userSelectedModelId: "kimi-k2.6",
      toolsPolicy: "readonly",
      visionRequired: true,
    }),
    {
      kind: "readonly_fast",
      primaryModelId: "Gemini 2.5 Flash",
      fastModelId: "Gemini 2.5 Flash",
    }
  );

  assert.deepEqual(
    resolveSpeedRouting({
      models: [{ id: "kimi-k2.6" }, { id: "claude-sonnet-4-5" }],
      userSelectedModelId: "kimi-k2.6",
      toolsPolicy: "agent",
    }),
    { kind: "none", primaryModelId: "kimi-k2.6" }
  );

  assert.deepEqual(
    resolveSpeedRouting({
      models,
      userSelectedModelId: "kimi-k2.6",
      toolsPolicy: "agent",
      fastModelIds: ["Qwen3-Coder-Next", "DeepSeek-V4-Flash"],
    }),
    {
      kind: "explore_then_edit",
      primaryModelId: "kimi-k2.6",
      fastModelId: "Qwen3-Coder-Next",
    }
  );

  assert.deepEqual(
    resolveSpeedRouting({
      models,
      userSelectedModelId: "kimi-k2.6",
      toolsPolicy: "readonly",
      readonlyOverride: false,
    }),
    { kind: "none", primaryModelId: "kimi-k2.6" }
  );

  assert.deepEqual(
    resolveSpeedRouting({
      models,
      userSelectedModelId: "kimi-k2.6",
      toolsPolicy: "agent",
      agentExplore: false,
    }),
    { kind: "none", primaryModelId: "kimi-k2.6" }
  );

  // Explicit heavy model as fast helper is allowed when user enables it.
  assert.deepEqual(
    resolveSpeedRouting({
      models,
      userSelectedModelId: "kimi-k2.6",
      toolsPolicy: "agent",
      fastModelIds: ["claude-sonnet-4-5"],
    }),
    {
      kind: "explore_then_edit",
      primaryModelId: "kimi-k2.6",
      fastModelId: "claude-sonnet-4-5",
    }
  );

  // Legacy fastModel string still works.
  assert.deepEqual(
    resolveSpeedRouting({
      models,
      userSelectedModelId: "kimi-k2.6",
      toolsPolicy: "agent",
      fastModel: "Qwen3-Coder-Next",
    }),
    {
      kind: "explore_then_edit",
      primaryModelId: "kimi-k2.6",
      fastModelId: "Qwen3-Coder-Next",
    }
  );

  // Non-empty preference that cannot be used → no auto fallback.
  assert.deepEqual(
    resolveSpeedRouting({
      models,
      userSelectedModelId: "kimi-k2.6",
      toolsPolicy: "agent",
      fastModelIds: ["kimi-k2.6"],
    }),
    { kind: "none", primaryModelId: "kimi-k2.6" }
  );
});
