import type { ChatMessage } from "./openaiClient";

/**
 * Claude extended thinking + tool use на OpenAI-compat Anthropic-гейтвее
 * нестабильно: assistant tool-call тур требует echoed thinking-блоков с
 * signature, которых у нас нет. На re-entry после tool-result гейтвей 500-ит.
 * Поэтому гасим reasoning_effort, как только в истории появился tool-раунд —
 * thinking остаётся виден на первом ходе (до любого tool-call).
 */
export function effectiveReasoningEffort(
  messages: ChatMessage[],
  base: string | undefined
): string | undefined {
  if (!base) {
    return undefined;
  }
  for (const message of messages) {
    if (message.role === "tool") {
      return undefined;
    }
    if (message.role === "assistant" && message.tool_calls?.length) {
      return undefined;
    }
  }
  return base;
}
