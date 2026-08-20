/**
 * Универсальное чтение лимитов токенов модели.
 * Одинаково разбирает Harbor-поля, OpenAI-compatible /models и вложенные
 * объекты вроде `openai`, `limit`, `top_provider`.
 */

export const MIN_MODEL_CONTEXT_WINDOW = 1024;

/** Вход / контекстное окно (max input). */
const INPUT_KEYS = [
  "max_input_tokens",
  "maxInputTokens",
  "max_input",
  "maxInput",
  "input_tokens",
  "inputTokens",
  "context_window",
  "contextWindow",
  "context_length",
  "contextLength",
  "max_context_tokens",
  "maxContextTokens",
  "max_context",
  "maxContext",
  "context",
];

/** Выход (max output). */
const OUTPUT_KEYS = [
  "max_output_tokens",
  "maxOutputTokens",
  "max_output",
  "maxOutput",
  "max_completion_tokens",
  "maxCompletionTokens",
  "output_tokens",
  "outputTokens",
  "completion_tokens",
  "completionTokens",
  "output",
];

/** OpenAI-стиль: max_tokens обычно про выход, не про контекст. */
const AMBIGUOUS_OUTPUT_KEYS = ["max_tokens", "maxTokens"];

export type ModelTokenLimits = {
  contextWindow?: number;
  maxOutputTokens?: number;
};

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickPositiveInt(
  raw: Record<string, unknown>,
  keys: string[]
): number | undefined {
  const lower = new Map(
    Object.entries(raw).map(([key, value]) => [key.toLowerCase(), value])
  );
  for (const key of keys) {
    const value = Object.prototype.hasOwnProperty.call(raw, key)
      ? raw[key]
      : lower.get(key.toLowerCase());
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) {
      return Math.floor(n);
    }
  }
  return undefined;
}

function collectSources(root: Record<string, unknown>): Record<string, unknown>[] {
  const sources = [root];
  for (const value of Object.values(root)) {
    const nested = asPlainRecord(value);
    if (nested) {
      sources.push(nested);
    }
  }
  return sources;
}

function pickFromSources(
  sources: Record<string, unknown>[],
  keys: string[]
): number | undefined {
  for (const source of sources) {
    const value = pickPositiveInt(source, keys);
    if (value != null) {
      return value;
    }
  }
  return undefined;
}

export function readModelTokenLimits(raw: unknown): ModelTokenLimits {
  const root = asPlainRecord(raw);
  if (!root) {
    return {};
  }
  const sources = collectSources(root);
  const contextWindow = pickFromSources(sources, INPUT_KEYS);
  const maxOutputTokens =
    pickFromSources(sources, OUTPUT_KEYS) ??
    pickFromSources(sources, AMBIGUOUS_OUTPUT_KEYS);
  const limits: ModelTokenLimits = {};
  if (contextWindow != null && contextWindow >= MIN_MODEL_CONTEXT_WINDOW) {
    limits.contextWindow = contextWindow;
  }
  if (maxOutputTokens != null) {
    limits.maxOutputTokens = maxOutputTokens;
  }
  return limits;
}
