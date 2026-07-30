import type { ChatMessage, ContentPart } from "./openaiClient";
import { estimateTokens } from "./contextBudget";

/** Keep this many recent user/assistant turns verbatim. */
export const DEFAULT_KEEP_RECENT_MESSAGES = 6;

/** Soft budget for retained history after summarization (approx tokens). */
export const DEFAULT_MAX_HISTORY_TOKENS = 4_500;

/** Per-message char cap for retained turns. */
export const DEFAULT_MAX_CHARS_PER_MESSAGE = 4_000;

/** Summarize when history exceeds this many messages. */
export const DEFAULT_SUMMARIZE_MESSAGE_THRESHOLD = 8;

export interface HistorySummaryOptions {
  keepRecentMessages?: number;
  maxHistoryTokens?: number;
  maxCharsPerMessage?: number;
  summarizeMessageThreshold?: number;
}

function contentAsText(content: ChatMessage["content"]): string {
  if (!content) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  return content
    .map((part: ContentPart) =>
      part.type === "text" ? part.text : part.type === "image_url" ? "[image]" : ""
    )
    .join("\n")
    .trim();
}

function trimText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

function firstLineSnippet(value: string, maxChars: number): string {
  const flat = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) {
    return "";
  }
  if (flat.length <= maxChars) {
    return flat;
  }
  return `${flat.slice(0, Math.max(0, maxChars - 1))}…`;
}

const PATH_LIKE =
  /(?:^|[\s`"'(])([A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|html|py|go|rs|java|kt|swift|yml|yaml|toml|sql|sh|vue|svelte))(?=$|[\s`"''),:;])/g;

/** Collect likely file paths mentioned in older turns. */
export function extractMentionedPaths(text: string, limit = 12): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const value = String(text || "");
  for (const match of value.matchAll(PATH_LIKE)) {
    const path = String(match[1] || "").trim();
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    found.push(path);
    if (found.length >= limit) {
      break;
    }
  }
  return found;
}

/**
 * Build a short deterministic summary of older user/assistant turns.
 * No LLM call — cheap and safe for every turn.
 */
export function buildEarlierConversationSummary(
  older: readonly ChatMessage[],
  maxChars = 2_400
): string {
  const goals: string[] = [];
  const answers: string[] = [];
  const paths = new Set<string>();

  for (const message of older) {
    const text = contentAsText(message.content);
    if (!text.trim()) {
      continue;
    }
    for (const path of extractMentionedPaths(text)) {
      paths.add(path);
    }
    const snippet = firstLineSnippet(text, 180);
    if (!snippet) {
      continue;
    }
    if (message.role === "user" && goals.length < 6) {
      goals.push(snippet);
    } else if (message.role === "assistant" && answers.length < 6) {
      answers.push(snippet);
    }
  }

  const lines: string[] = [
    "[Earlier conversation summary — continue from here]",
  ];
  if (goals.length) {
    lines.push("User asks / goals:");
    for (const item of goals) {
      lines.push(`- ${item}`);
    }
  }
  if (answers.length) {
    lines.push("Assistant already covered:");
    for (const item of answers) {
      lines.push(`- ${item}`);
    }
  }
  if (paths.size) {
    lines.push(`Key files: ${[...paths].slice(0, 12).join(", ")}`);
  }
  if (lines.length === 1) {
    lines.push("- Prior turns compacted to save context.");
  }

  return trimText(lines.join("\n"), maxChars);
}

function hasUserContent(content: ChatMessage["content"]): boolean {
  if (!content) {
    return false;
  }
  if (typeof content === "string") {
    return Boolean(content.trim());
  }
  return content.length > 0;
}

/**
 * Reduce persisted chat history for the next agent turn:
 * keep only user + final assistant replies, trim long texts, and when the
 * history is long fold older turns into one deterministic summary message.
 */
export function compactHistoryWithSummary(
  messages: readonly ChatMessage[],
  options: HistorySummaryOptions = {}
): ChatMessage[] {
  const keepRecent = Math.max(
    2,
    options.keepRecentMessages ?? DEFAULT_KEEP_RECENT_MESSAGES
  );
  const maxHistoryTokens =
    options.maxHistoryTokens ?? DEFAULT_MAX_HISTORY_TOKENS;
  const maxChars =
    options.maxCharsPerMessage ?? DEFAULT_MAX_CHARS_PER_MESSAGE;
  const summarizeThreshold =
    options.summarizeMessageThreshold ?? DEFAULT_SUMMARIZE_MESSAGE_THRESHOLD;

  const turns: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === "user" && hasUserContent(message.content)) {
      const raw = contentAsText(message.content);
      const entry: ChatMessage = {
        role: "user",
        content: trimText(raw, maxChars),
      };
      if (message.attachments?.length) {
        entry.attachments = message.attachments.map((item) => ({ ...item }));
      }
      turns.push(entry);
      continue;
    }
    if (
      message.role === "assistant" &&
      hasUserContent(message.content) &&
      !(message.tool_calls && message.tool_calls.length > 0)
    ) {
      turns.push({
        role: "assistant",
        content: trimText(contentAsText(message.content), maxChars),
      });
    }
  }

  const needsSummary =
    turns.length > summarizeThreshold ||
    estimateTokens(turns) > maxHistoryTokens;

  if (!needsSummary) {
    return turns.length > keepRecent * 2
      ? turns.slice(-(keepRecent * 2))
      : turns;
  }

  const keepCount = Math.min(turns.length, keepRecent);
  const recent = turns.slice(-keepCount);
  const older = turns.slice(0, Math.max(0, turns.length - keepCount));
  if (!older.length) {
    return recent;
  }

  const summary: ChatMessage = {
    role: "user",
    content: buildEarlierConversationSummary(older),
  };
  const combined = [summary, ...recent];
  if (estimateTokens(combined) <= maxHistoryTokens) {
    return combined;
  }

  // Still oversized: keep summary + fewer recent turns.
  const tighterRecent = recent.slice(-Math.max(2, Math.floor(keepRecent / 2)));
  return [summary, ...tighterRecent];
}
