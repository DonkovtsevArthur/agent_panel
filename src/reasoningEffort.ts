/**
 * Harbor UI «уровень интеллекта» → Cline `reasoningEffort` / `thinking`.
 * Значения совпадают с OpenAI-style reasoning_effort (и Cline Core).
 */

export const REASONING_EFFORT_LEVELS = [
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
  return LEVEL_SET.has(id) ? (id as ReasoningEffortLevel) : undefined;
}

/** Опции для ClineCore `start` config. */
export function toClineReasoningOptions(
  level: string | undefined
): { thinking?: boolean; reasoningEffort?: ReasoningEffortLevel } {
  const normalized = normalizeReasoningEffort(level);
  if (!normalized) {
    return {};
  }
  return { thinking: true, reasoningEffort: normalized };
}
