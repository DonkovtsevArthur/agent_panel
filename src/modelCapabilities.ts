export interface ModelCapabilities {
  contextWindow?: number;
  supportsVision: boolean;
  family?: "kimi";
  omitTemperature: boolean;
  requiresReasoningContentForToolCalls: boolean;
  minimumOutputTokens?: number;
}

export interface ModelCapabilityOverrides {
  contextWindow?: number;
  supportsVision?: boolean;
}

interface ModelCapabilityRule {
  exactId?: string;
  pattern?: RegExp;
  capabilities: Partial<ModelCapabilities>;
}

export const KIMI_MIN_MAX_TOKENS = 8192;

/**
 * Backend source of truth for model-specific behavior.
 * Exact model entries precede family heuristics; each capability is filled by
 * the first matching rule that defines it.
 */
export const MODEL_CAPABILITY_REGISTRY: readonly ModelCapabilityRule[] = [
  {
    exactId: "DeepSeek-V4-Flash",
    capabilities: { contextWindow: 128_000, supportsVision: false },
  },
  {
    exactId: "Qwen3-Coder-Next",
    capabilities: { contextWindow: 262_144, supportsVision: false },
  },
  {
    exactId: "Gemma-4-31b",
    capabilities: { contextWindow: 128_000, supportsVision: false },
  },
  {
    exactId: "claude-sonnet-4-5",
    capabilities: { contextWindow: 200_000, supportsVision: true },
  },
  {
    exactId: "gpt-4.1",
    capabilities: { contextWindow: 1_047_576, supportsVision: true },
  },
  {
    exactId: "Gemini 2.5 Flash",
    capabilities: { contextWindow: 1_048_576, supportsVision: true },
  },
  {
    pattern: /kimi|moonshot/i,
    capabilities: {
      family: "kimi",
      omitTemperature: true,
      requiresReasoningContentForToolCalls: true,
      minimumOutputTokens: KIMI_MIN_MAX_TOKENS,
    },
  },
  {
    pattern:
      /deepseek|coder|codestral|codellama|code-llama|starcoder|qwen3-coder/i,
    capabilities: { supportsVision: false },
  },
  {
    pattern:
      /gpt-4o|gpt-4\.1|gpt-5|o[1-9]|claude|gemini|llava|vision|pixtral|gpt-image/i,
    capabilities: { supportsVision: true },
  },
  {
    pattern: /gemma-3|gemma3/i,
    capabilities: { supportsVision: true },
  },
];

function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    Math.floor(value) === value
  );
}

function ruleMatches(rule: ModelCapabilityRule, modelId: string): boolean {
  return rule.exactId === modelId || Boolean(rule.pattern?.test(modelId));
}

export function resolveModelCapabilities(
  modelId: string,
  overrides: ModelCapabilityOverrides = {}
): ModelCapabilities {
  const id = String(modelId || "").trim();
  const resolved: Partial<ModelCapabilities> = {};

  for (const rule of MODEL_CAPABILITY_REGISTRY) {
    if (!ruleMatches(rule, id)) {
      continue;
    }
    for (const [key, value] of Object.entries(rule.capabilities)) {
      const capability = key as keyof ModelCapabilities;
      if (resolved[capability] === undefined) {
        (resolved as Record<string, unknown>)[capability] = value;
      }
    }
  }

  if (isPositiveInteger(overrides.contextWindow)) {
    resolved.contextWindow = overrides.contextWindow;
  }
  if (typeof overrides.supportsVision === "boolean") {
    resolved.supportsVision = overrides.supportsVision;
  }

  return {
    ...(isPositiveInteger(resolved.contextWindow)
      ? { contextWindow: resolved.contextWindow }
      : {}),
    ...(resolved.family ? { family: resolved.family } : {}),
    ...(isPositiveInteger(resolved.minimumOutputTokens)
      ? { minimumOutputTokens: resolved.minimumOutputTokens }
      : {}),
    supportsVision: resolved.supportsVision === true,
    omitTemperature: resolved.omitTemperature === true,
    requiresReasoningContentForToolCalls:
      resolved.requiresReasoningContentForToolCalls === true,
  };
}

export function resolveModelContextWindow(
  modelId: string,
  configured: number | undefined,
  fallback: number
): number {
  const capabilities = resolveModelCapabilities(modelId, {
    contextWindow: configured,
  });
  return capabilities.contextWindow ?? fallback;
}

export function resolveModelRequestMaxTokens(
  modelId: string,
  requested?: number,
  minimumOverride?: number
): number | undefined {
  const registeredMinimum =
    resolveModelCapabilities(modelId).minimumOutputTokens;
  const minimum =
    registeredMinimum && isPositiveInteger(minimumOverride)
      ? minimumOverride
      : registeredMinimum;
  if (!isPositiveInteger(requested)) {
    return minimum;
  }
  return minimum ? Math.max(requested, minimum) : requested;
}

/**
 * Все модели: запрос как на ветке main — простой non-stream JSON без SSE.
 */
export function modelUsesMainLikeApi(_modelId?: string): boolean {
  return true;
}

/**
 * @deprecated Больше не используется: все модели идут через {@link modelUsesMainLikeApi}.
 */
export function modelNeedsGatewayWorkarounds(_modelId?: string): boolean {
  return false;
}
