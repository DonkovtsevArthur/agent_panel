export interface ModelCapabilities {
  contextWindow?: number;
  supportsVision: boolean;
  family?: "kimi";
  omitTemperature: boolean;
  requiresReasoningContentForToolCalls: boolean;
  minimumOutputTokens?: number;
  /**
   * Модель принимает OpenAI-style `reasoning_effort` на chat/completions
   * (Claude 3.5+/4 через корпоративный гейтвей). Гейтвей включает extended
   * thinking и стримит `reasoning_content` в дельтах.
   */
  supportsReasoningEffort: boolean;
  /** Значение reasoning_effort по умолчанию, если не задано в конфиге. */
  reasoningEffortDefault?: string;
  /**
   * Anthropic extended thinking: thinking-блоки несут криптографическую
   * signature, которую OpenAI-style `reasoning_content` не передаёт. Эхо
   * reasoning_content на assistant tool-call turn гейтвей переводит в
   * thinking без signature → Anthropic 400/500 на re-entry. Поэтому для
   * Claude reasoning-моделей reasoning_content с assistant-сообщений
   * при возврате истории снимается (гейтвей сам регенерирует thinking).
   * Противоположность Kimi (где thinking нужен в эхе).
   */
  stripReasoningOnEcho: boolean;
  /**
   * Kimi-гейтвей возвращает 400, если у assistant tool-call turn-а есть
   * поле `content` (даже null). Для Kimi content опускается полностью.
   * Все прочие модели (DeepSeek, OpenAI, Anthropic-compat) требуют
   * `content: null` на assistant tool-call turn — без него строгие
   * гейтвеи отвечают 500 на re-entry после tool-result.
   */
  omitContentForToolCalls: boolean;
}

export interface ModelCapabilityOverrides {
  contextWindow?: number;
  supportsVision?: boolean;
  reasoningEffort?: string;
}

interface ModelCapabilityRule {
  exactId?: string;
  pattern?: RegExp;
  capabilities: Partial<ModelCapabilities>;
}

// Kimi gateway default max_tokens (4096) truncates large write_file tool calls
// mid-stream → "Некорректный JSON аргументов" → модель дробит файл по кускам.
// 16000 (~64 КБ) покрывает целую страницу и сравнимо с thinking-бюджетом Claude.
export const KIMI_MIN_MAX_TOKENS = 16_000;

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
      // Plan+Figma+explore needs headroom; 32k configured windows cause
      // hard-budget «Context compacted · ~25856» every round.
      contextWindow: 128_000,
      omitTemperature: true,
      requiresReasoningContentForToolCalls: true,
      minimumOutputTokens: KIMI_MIN_MAX_TOKENS,
      omitContentForToolCalls: true,
    },
  },
  {
    // Claude 3.5+ / 4.x (и новее) поддерживают extended thinking через
    // OpenAI-style `reasoning_effort` на корпоративном гейтвее. Исключаем
    // Claude 3.0 (opus/sonnet/haiku) — там thinking нет.
    // Extended thinking требует default temperature (1) — опускаем поле,
    // иначе гейтвей возвращает 500 на re-entry после tool results.
    // max_tokens должен превышать thinking-бюджет: при reasoning_effort "high"
    // дефолт config.maxTokens (4096) слишком мал → Anthropic 400 → гейтвей 500.
    // Ставим минимум 16000, поверх которого берётся max из конфига/модели.
    pattern: /claude.*(?:3[-.][5-9]|[4-9])/i,
    capabilities: {
      supportsReasoningEffort: true,
      reasoningEffortDefault: "high",
      omitTemperature: true,
      minimumOutputTokens: 16_000,
      stripReasoningOnEcho: true,
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
  if (
    typeof overrides.reasoningEffort === "string" &&
    overrides.reasoningEffort.trim()
  ) {
    // Explicit Settings override both sets the default and opts the model in.
    resolved.reasoningEffortDefault = overrides.reasoningEffort.trim();
    resolved.supportsReasoningEffort = true;
  }

  return {
    ...(isPositiveInteger(resolved.contextWindow)
      ? { contextWindow: resolved.contextWindow }
      : {}),
    ...(resolved.family ? { family: resolved.family } : {}),
    ...(isPositiveInteger(resolved.minimumOutputTokens)
      ? { minimumOutputTokens: resolved.minimumOutputTokens }
      : {}),
    ...(typeof resolved.reasoningEffortDefault === "string"
      ? { reasoningEffortDefault: resolved.reasoningEffortDefault }
      : {}),
    supportsVision: resolved.supportsVision === true,
    omitTemperature: resolved.omitTemperature === true,
    requiresReasoningContentForToolCalls:
      resolved.requiresReasoningContentForToolCalls === true,
    supportsReasoningEffort: resolved.supportsReasoningEffort === true,
    stripReasoningOnEcho: resolved.stripReasoningOnEcho === true,
    omitContentForToolCalls: resolved.omitContentForToolCalls === true,
  };
}

export function resolveModelContextWindow(
  modelId: string,
  configured: number | undefined,
  fallback: number
): number {
  const registered = resolveModelCapabilities(modelId);
  const registryWindow = registered.contextWindow;
  // Kimi: honor larger explicit windows, but never shrink below the registry
  // floor (128k). Undersized Settings values (e.g. 32k) make Plan unusable.
  if (registered.family === "kimi" && isPositiveInteger(registryWindow)) {
    if (isPositiveInteger(configured)) {
      return Math.max(configured, registryWindow);
    }
    return registryWindow;
  }
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
