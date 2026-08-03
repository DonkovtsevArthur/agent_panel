import type { ChatMessage, ContentPart, ToolCall } from "./openaiClient";
import { HARBOR_VISION_HELPER_MARKER } from "./figmaVisionFormat";

export const DEFAULT_CONTEXT_SAFETY_MARGIN_TOKENS = 2_048;

/**
 * Figma MCP + under-the-hood vision-helper tool results are the authoritative
 * UI source in Plan. Do not shrink them when fitting the context budget —
 * otherwise the model drifts to a similar page found in the repo.
 */
export function shouldPreserveToolResultFromCompaction(
  message: ChatMessage
): boolean {
  if (message.role !== "tool") {
    return false;
  }
  const name = String(message.name || "");
  if (name.startsWith("mcp__figma__")) {
    return true;
  }
  const content =
    typeof message.content === "string" ? message.content : "";
  return content.includes(HARBOR_VISION_HELPER_MARKER);
}

/**
 * Plan grounding reads: paths / routes / shared UI / page entrypoints.
 * Keep these intact under Kimi Plan shrink so page-vs-tab decisions do not
 * flip after early explore is truncated.
 */
export function looksLikePlanGroundingToolResult(
  message: ChatMessage
): boolean {
  if (message.role !== "tool") {
    return false;
  }
  const name = String(message.name || "");
  if (name !== "read_file" && name !== "list_files") {
    return false;
  }
  const content =
    typeof message.content === "string" ? message.content : "";
  if (!content) {
    return false;
  }
  return (
    /"path"\s*:\s*"[^"]*(?:paths\.ts|app\/app\.tsx|pages\/index\.(?:ts|tsx)|shared\/modules\/routes\/|shared\/ui\/)/i.test(
      content
    ) ||
    /(?:^|[\s"`'/])(?:\.\/)?(?:src\/)?(?:shared\/paths\.ts|app\/app\.tsx|pages\/index\.(?:ts|tsx)|shared\/modules\/routes\/|shared\/ui\/)/i.test(
      content
    )
  );
}

/**
 * Pull completed tool rounds that contain preserved Figma/vision results out
 * of `messages` (order kept). Used by mid-turn summary so Figma is not replaced
 * by a one-line snippet while list/read rounds are summarized away.
 */
export function pullPreservedToolRounds(messages: readonly ChatMessage[]): {
  pinned: ChatMessage[];
  remainder: ChatMessage[];
} {
  const rounds = completedToolRoundIndexes(messages);
  const pinnedIndexes = new Set<number>();
  for (const round of rounds) {
    const preserve = round.tools.some((toolIndex) =>
      shouldPreserveToolResultFromCompaction(messages[toolIndex])
    );
    if (!preserve) {
      continue;
    }
    pinnedIndexes.add(round.assistant);
    for (const toolIndex of round.tools) {
      pinnedIndexes.add(toolIndex);
    }
  }
  if (!pinnedIndexes.size) {
    return { pinned: [], remainder: messages.map(cloneMessage) };
  }
  const pinned: ChatMessage[] = [];
  const remainder: ChatMessage[] = [];
  messages.forEach((message, index) => {
    const clone = cloneMessage(message);
    if (pinnedIndexes.has(index)) {
      pinned.push(clone);
    } else {
      remainder.push(clone);
    }
  });
  return { pinned, remainder };
}

export interface ContextBudgetOptions {
  contextWindow: number;
  reservedOutputTokens: number;
  safetyMarginTokens?: number;
  /**
   * Soft target below the hard budget. When set, old rounds are compacted
   * until estimated tokens fit this target (proactive, before the hard limit).
   */
  softTargetTokens?: number;
  /** Extra tool-result preservation (e.g. Plan grounding reads). */
  preserveToolResult?: (message: ChatMessage) => boolean;
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
 *
 * When already under the soft target, returns a shallow array copy that shares
 * message object references with `input` (no deep clone of tool/vision payloads).
 * Callers must not mutate the result unless `compacted` is true — then the
 * returned array is a deep clone safe to edit.
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
  // Estimate on the input first — deep-cloning Figma/vision base64 every round
  // doubles peak RAM on long Plan turns when no compaction is needed.
  const estimatedTokensIn = estimateTokens(input);
  if (estimatedTokensIn <= softTarget) {
    return {
      messages: input.slice() as ChatMessage[],
      budgetTokens,
      estimatedTokens: estimatedTokensIn,
      compacted: false,
      fits: estimatedTokensIn <= budgetTokens,
    };
  }

  const messages = input.map(cloneMessage);
  let estimatedTokens = estimatedTokensIn;

  const rounds = completedToolRoundIndexes(messages);
  const oldRounds = rounds.slice(0, -1);
  let compacted = false;
  const preserveExtra = options.preserveToolResult;
  const preserveTool = (message: ChatMessage): boolean =>
    shouldPreserveToolResultFromCompaction(message) ||
    Boolean(preserveExtra?.(message));

  // First preserve useful beginnings/endings and remove only as much as needed.
  // Skip Figma MCP / vision-helper payloads — they are the plan's UI source.
  for (const round of oldRounds) {
    for (const toolIndex of round.tools) {
      if (estimatedTokens <= softTarget) {
        break;
      }
      const message = messages[toolIndex];
      if (preserveTool(message)) {
        continue;
      }
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
  // Do not touch assistant turns that only exist to carry preserved Figma tools.
  for (const round of oldRounds) {
    if (estimatedTokens <= softTarget) {
      break;
    }
    if (round.tools.some((toolIndex) => preserveTool(messages[toolIndex]))) {
      continue;
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
