import type { ChatMessage } from "./openaiClient";
import {
  applyContextBudget,
  calculateContextBudget,
  estimateTokens,
} from "./contextBudget";
import { buildEarlierConversationSummary } from "./historySummary";
import {
  modelNeedsAggressiveToolBudget,
  prepareFragileGatewayMessages,
  prepareKimiGatewayMessages,
  resolveToolSoftTargetTokens,
} from "./toolRecovery";

const MID_TURN_COMPACTION_MARKER = "--- Context compacted ---";

export interface PrepareRoundMessagesOptions {
  messages: ChatMessage[];
  modelId: string;
  contextWindow: number;
  reservedOutputTokens: number;
  kimi: boolean;
  /** readonly (Plan/Ask): preserve Figma MCP payloads from aggressive
   * shrinking — they are the primary source for the plan. */
  readonly?: boolean;
}

export interface PrepareRoundMessagesResult {
  compacted: boolean;
  summarized: boolean;
  estimatedTokens: number;
  budgetTokens: number;
  fits: boolean;
}

/**
 * Gateway shrink (Kimi / fragile light models) + context budget + optional
 * extractive mid-turn summary. Mutates `messages` in place when applied.
 */
export function prepareRoundMessages(
  options: PrepareRoundMessagesOptions
): PrepareRoundMessagesResult {
  if (options.kimi) {
    prepareKimiGatewayMessages(options.messages, {
      readonly: options.readonly,
    });
  } else if (modelNeedsAggressiveToolBudget(options.modelId)) {
    prepareFragileGatewayMessages(options.messages);
  }

  const budgetTokens = calculateContextBudget({
    contextWindow: options.contextWindow,
    reservedOutputTokens: options.reservedOutputTokens,
  });
  const softTargetTokens = resolveToolSoftTargetTokens({
    hardBudget: budgetTokens,
    modelId: options.modelId,
  });

  const budgeted = applyContextBudget(options.messages, {
    contextWindow: options.contextWindow,
    reservedOutputTokens: options.reservedOutputTokens,
    softTargetTokens,
  });

  let compacted = budgeted.compacted;
  let summarized = false;
  let working = budgeted.messages;

  if (!budgeted.fits || budgeted.estimatedTokens > softTargetTokens) {
    const system: ChatMessage[] = [];
    const rest: ChatMessage[] = [];
    for (const message of working) {
      if (message.role === "system") {
        system.push(message);
      } else {
        rest.push(message);
      }
    }
    if (rest.length > 10) {
      const keepRecent = 8;
      const older = rest.slice(0, Math.max(0, rest.length - keepRecent));
      const recent = rest.slice(-keepRecent);
      if (older.length >= 4) {
        const alreadyHasMarker = working.some(
          (message) =>
            typeof message.content === "string" &&
            message.content.includes(MID_TURN_COMPACTION_MARKER)
        );
        if (!alreadyHasMarker) {
          const summary: ChatMessage = {
            role: "user",
            content: `${MID_TURN_COMPACTION_MARKER}\n${buildEarlierConversationSummary(older)}`,
          };
          working = [...system, summary, ...recent];
          summarized = true;
          compacted = true;
        }
      }
    }
  }

  if (compacted || summarized) {
    options.messages.length = 0;
    options.messages.push(...working);
  }

  const estimatedTokens = estimateTokens(options.messages);
  return {
    compacted,
    summarized,
    estimatedTokens,
    budgetTokens,
    fits: estimatedTokens <= budgetTokens,
  };
}
