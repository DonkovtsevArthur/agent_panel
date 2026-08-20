/**
 * Harbor-side Focus Chain (upstream Cline v3.25 feature lives in their VS
 * Code extension, not the SDK): the agent keeps a markdown task checklist
 * and Harbor re-injects the latest one into follow-up turns so long tasks
 * stay on track across tool rounds and context compaction.
 */
import type { ChatMessage } from "./openaiClient";

const CHECKBOX_RE = /^\s*[-*]\s+\[[ xX]\]\s*.+/;

function messageText(message: ChatMessage): string {
  const content = message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text?: unknown }).text || "")
          : ""
      )
      .join("\n");
  }
  return "";
}

/**
 * Latest markdown checkbox list (≥2 items) from assistant history.
 * Returns the contiguous block of `- [ ]` / `- [x]` lines.
 */
export function extractLatestChecklist(
  history: ReadonlyArray<ChatMessage>
): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const msg = history[i];
    if (!msg || msg.role !== "assistant") {
      continue;
    }
    const lines = messageText(msg).split(/\r?\n/);
    // Last contiguous checkbox block in this message.
    let block: string[] = [];
    for (let j = lines.length - 1; j >= 0; j -= 1) {
      if (CHECKBOX_RE.test(lines[j])) {
        block.unshift(lines[j]);
      } else if (block.length) {
        break;
      }
    }
    if (block.length >= 2) {
      return block.join("\n");
    }
  }
  return "";
}

/**
 * Re-inject the current task checklist into a follow-up turn. Empty on the
 * first turn or when the agent never wrote a checklist.
 */
export function buildFocusChainBlock(
  history: ReadonlyArray<ChatMessage>
): string {
  const checklist = extractLatestChecklist(history);
  if (!checklist) {
    return "";
  }
  return [
    "[Harbor focus chain — current task checklist from this chat]",
    checklist,
    "Continue from the first unchecked item. When an item is done, mention it briefly and keep the remaining list in mind; do not redo finished items.",
  ].join("\n");
}
