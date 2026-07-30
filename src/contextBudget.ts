import type { ChatMessage, ContentPart, ToolCall } from "./openaiClient";

export const DEFAULT_CONTEXT_SAFETY_MARGIN_TOKENS = 2_048;

export interface ContextBudgetOptions {
  contextWindow: number;
  reservedOutputTokens: number;
  safetyMarginTokens?: number;
  /**
   * Soft target below the hard budget. When set, old rounds are compacted
   * until estimated tokens fit this target (proactive, before the hard limit).
   */
  softTargetTokens?: number;
}

export interface ContextBudgetResult {
  messages: ChatMessage[];
  budgetTokens: number;
  estimatedTokens: number;
  compacted: boolean;
  fits: boolean;
}

function contentCharLength(content: ChatMessage["content"]): number {
  if (!content) {
    return 0;
  }
  if (typeof content === "string") {
    return content.length;
  }
  return content.reduce((chars, part) => {
    if (part.type === "text") {
      return chars + part.text.length;
    }
    return chars + Math.ceil((part.image_url?.url?.length || 0) / 4);
  }, 0);
}

export function estimateTokens(messages: readonly ChatMessage[]): number {
  let chars = 0;
  for (const message of messages) {
    chars += 12 + message.role.length;
    chars += contentCharLength(message.content);
    chars += message.reasoning_content?.length || 0;
    chars += message.tool_call_id?.length || 0;
    chars += message.name?.length || 0;
    for (const call of message.tool_calls || []) {
      chars += 16;
      chars += call.id?.length || 0;
      chars += call.function?.name?.length || 0;
      chars += call.function?.arguments?.length || 0;
    }
  }
  return Math.max(1, Math.ceil(chars / 4));
}

export function calculateContextBudget(options: ContextBudgetOptions): number {
  const safetyMargin =
    options.safetyMarginTokens ?? DEFAULT_CONTEXT_SAFETY_MARGIN_TOKENS;
  return Math.max(
    1,
    Math.floor(options.contextWindow) -
      Math.max(0, Math.floor(options.reservedOutputTokens)) -
      Math.max(0, Math.floor(safetyMargin))
  );
}

function cloneContent(content: ChatMessage["content"]): ChatMessage["content"] {
  if (!Array.isArray(content)) {
    return content;
  }
  return content.map((part): ContentPart =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : { type: "image_url", image_url: { url: part.image_url.url } }
  );
}

function cloneToolCall(call: ToolCall): ToolCall {
  return {
    ...call,
    function: {
      ...call.function,
    },
  };
}

function cloneMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    content: cloneContent(message.content),
    ...(message.tool_calls
      ? { tool_calls: message.tool_calls.map(cloneToolCall) }
      : {}),
    ...(message.attachments
      ? { attachments: message.attachments.map((item) => ({ ...item })) }
      : {}),
  };
}

function completedToolRoundIndexes(
  messages: readonly ChatMessage[]
): Array<{ assistant: number; tools: number[] }> {
  const rounds: Array<{ assistant: number; tools: number[] }> = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role !== "assistant" || !message.tool_calls?.length) {
      continue;
    }
    const pending = new Set(message.tool_calls.map((call) => call.id));
    const tools: number[] = [];
    for (let cursor = index + 1; cursor < messages.length; cursor++) {
      const candidate = messages[cursor];
      if (candidate.role === "assistant" || candidate.role === "user") {
        break;
      }
      if (
        candidate.role === "tool" &&
        candidate.tool_call_id &&
        pending.delete(candidate.tool_call_id)
      ) {
        tools.push(cursor);
      }
    }
    if (pending.size === 0) {
      rounds.push({ assistant: index, tools });
    }
  }
  return rounds;
}

function shortenText(value: string, targetChars: number, label: string): string {
  if (value.length <= targetChars) {
    return value;
  }
  const minimum = Math.max(0, targetChars - label.length - 2);
  const head = Math.ceil(minimum * 0.7);
  const tail = minimum - head;
  return `${value.slice(0, head)}\n${label}\n${tail ? value.slice(-tail) : ""}`;
}

function compactToolResult(
  message: ChatMessage,
  targetChars: number
): ChatMessage {
  if (typeof message.content === "string") {
    return {
      ...message,
      content: shortenText(
        message.content,
        targetChars,
        "[older tool result compacted]"
      ),
    };
  }
  return {
    ...message,
    content: "[older tool result compacted]",
  };
}

function compactOldAssistantRound(message: ChatMessage): ChatMessage {
  return {
    ...message,
    content:
      typeof message.content === "string" && message.content.length > 512
        ? shortenText(message.content, 512, "[older tool round compacted]")
        : message.content,
    tool_calls: message.tool_calls?.map((call) => ({
      ...call,
      function: {
        ...call.function,
        arguments:
          call.function.arguments.length > 256
            ? JSON.stringify({ compacted: "older tool call arguments" })
            : call.function.arguments,
      },
    })),
  };
}

function compactOldConversationMessage(
  message: ChatMessage,
  targetChars: number
): ChatMessage {
  if (typeof message.content === "string") {
    return {
      ...message,
      content: shortenText(
        message.content,
        targetChars,
        "[older conversation compacted]"
      ),
    };
  }
  if (Array.isArray(message.content)) {
    return {
      ...message,
      content: "[older multimodal message compacted]",
    };
  }
  return message;
}

/**
 * Fits a request by compacting only old, completed tool rounds. Messages that
 * establish policy/current intent and the newest tool round remain byte-for-byte
 * equivalent, while tool_call ids and matching tool results are always retained.
 */
export function applyContextBudget(
  input: readonly ChatMessage[],
  options: ContextBudgetOptions
): ContextBudgetResult {
  const budgetTokens = calculateContextBudget(options);
  const softTarget =
    typeof options.softTargetTokens === "number" &&
    Number.isFinite(options.softTargetTokens) &&
    options.softTargetTokens > 0
      ? Math.min(budgetTokens, Math.floor(options.softTargetTokens))
      : budgetTokens;
  const messages = input.map(cloneMessage);
  let estimatedTokens = estimateTokens(messages);
  if (estimatedTokens <= softTarget) {
    return {
      messages,
      budgetTokens,
      estimatedTokens,
      compacted: false,
      fits: estimatedTokens <= budgetTokens,
    };
  }

  const rounds = completedToolRoundIndexes(messages);
  const oldRounds = rounds.slice(0, -1);
  let compacted = false;

  // First preserve useful beginnings/endings and remove only as much as needed.
  for (const round of oldRounds) {
    for (const toolIndex of round.tools) {
      if (estimatedTokens <= softTarget) {
        break;
      }
      const message = messages[toolIndex];
      const chars =
        typeof message.content === "string"
          ? message.content.length
          : contentCharLength(message.content);
      const excessChars = (estimatedTokens - softTarget) * 4;
      const targetChars = Math.max(160, chars - excessChars);
      const shortened = compactToolResult(message, targetChars);
      if (estimateTokens([shortened]) < estimateTokens([message])) {
        messages[toolIndex] = shortened;
        compacted = true;
        estimatedTokens = estimateTokens(messages);
      }
    }
  }

  // If results alone are insufficient, compact metadata/content of old rounds.
  for (const round of oldRounds) {
    if (estimatedTokens <= softTarget) {
      break;
    }
    const shortened = compactOldAssistantRound(messages[round.assistant]);
    if (
      estimateTokens([shortened]) <
      estimateTokens([messages[round.assistant]])
    ) {
      messages[round.assistant] = shortened;
      compacted = true;
      estimatedTokens = estimateTokens(messages);
    }
  }

  // Long persisted conversations may contain no tool rounds. Compact only old
  // conversational text while preserving policy, current intent and newest
  // tool round byte-for-byte.
  if (estimatedTokens > softTarget) {
    const protectedIndexes = new Set<number>();
    messages.forEach((message, index) => {
      if (message.role === "system") {
        protectedIndexes.add(index);
      }
    });
    let latestUserIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "user") {
        latestUserIndex = index;
        break;
      }
    }
    if (latestUserIndex >= 0) {
      protectedIndexes.add(latestUserIndex);
    }
    const latestRound = rounds.at(-1);
    if (latestRound) {
      protectedIndexes.add(latestRound.assistant);
      latestRound.tools.forEach((index) => protectedIndexes.add(index));
    }

    for (let index = 0; index < messages.length; index += 1) {
      if (estimatedTokens <= softTarget || protectedIndexes.has(index)) {
        continue;
      }
      const message = messages[index];
      if (
        message.role !== "user" &&
        !(message.role === "assistant" && !message.tool_calls?.length)
      ) {
        continue;
      }
      const chars = contentCharLength(message.content);
      const excessChars = (estimatedTokens - softTarget) * 4;
      const targetChars = Math.max(160, chars - excessChars);
      const shortened = compactOldConversationMessage(message, targetChars);
      if (estimateTokens([shortened]) < estimateTokens([message])) {
        messages[index] = shortened;
        compacted = true;
        estimatedTokens = estimateTokens(messages);
      }
    }
  }

  return {
    messages,
    budgetTokens,
    estimatedTokens,
    compacted,
    fits: estimatedTokens <= budgetTokens,
  };
}
