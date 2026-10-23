/**
 * Harbor UI «уровень интеллекта» → Cline `reasoningEffort` / `thinking`.
 * Значения совпадают с OpenAI-style reasoning_effort (и Cline Core).
 * `none` — рассуждения выключены; доступен только моделям, которые явно
 * перечисляют его в `reasoningEffortLevels` (GLM, например, на `none` 400-ит).
 */

export const REASONING_EFFORT_LEVELS = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ReasoningEffortLevel = (typeof REASONING_EFFORT_LEVELS)[number];

const LEVEL_SET = new Set<string>(REASONING_EFFORT_LEVELS);

/** Нормализация id уровня; пустое / неизвестное → undefined. */
export function normalizeReasoningEffort(
  value: unknown
): ReasoningEffortLevel | undefined {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!id) {
    return undefined;
  }
  // Aliases from product UIs (zcode «Extra high», Cline Hub labels).
  if (id === "extra" || id === "extra-high" || id === "extrahigh" || id === "extra_high") {
    return "xhigh";
  }
  if (id === "max") {
    return "xhigh";
  }
  if (id === "off" || id === "disabled") {
    return "none";
  }
  return LEVEL_SET.has(id) ? (id as ReasoningEffortLevel) : undefined;
}

/**
 * Подгоняет уровень под список, который принимает модель: неподдерживаемый
 * уровень → ближайший допустимый не ниже (иначе самый высокий из допустимых).
 * Пустой список — без ограничений.
 */
export function clampReasoningEffortToLevels(
  level: string | undefined,
  allowed: readonly string[] | undefined
): ReasoningEffortLevel | undefined {
  const normalized = normalizeReasoningEffort(level);
  const levels = (allowed || [])
    .map((item) => normalizeReasoningEffort(item))
    .filter((item): item is ReasoningEffortLevel => Boolean(item));
  if (!levels.length) {
    // Без явного списка `none` не предлагается — ближайший допустимый `low`.
    return normalized === "none" ? "low" : normalized;
  }
  if (!normalized || levels.includes(normalized)) {
    return normalized;
  }
  const rank = (item: ReasoningEffortLevel) =>
    REASONING_EFFORT_LEVELS.indexOf(item);
  const sorted = [...levels].sort((a, b) => rank(a) - rank(b));
  return (
    sorted.find((item) => rank(item) >= rank(normalized)) ||
    sorted[sorted.length - 1]
  );
}

/** Опции для ClineCore `start` config. */
export function toClineReasoningOptions(
  level: string | undefined
): { thinking?: boolean; reasoningEffort?: ReasoningEffortLevel } {
  const normalized = normalizeReasoningEffort(level);
  // `none`: Cline выкидывает выключенный reasoning с openai-compatible wire,
  // поэтому `reasoning_effort: "none"` дописывает Harbor fetch
  // (reasoningOffRequestOptions).
  if (!normalized || normalized === "none") {
    return {};
  }
  return { thinking: true, reasoningEffort: normalized };
}

/**
 * Поля тела chat/completions для уровня `none` (LiteLLM / vLLM DeepSeek V4,
 * Qwen3: `reasoning_effort: "none"` → 0 reasoning-токенов).
 */
export function reasoningOffRequestOptions(
  level: string | undefined
): Record<string, unknown> | undefined {
  return normalizeReasoningEffort(level) === "none"
    ? { reasoning_effort: "none" }
    : undefined;
}
