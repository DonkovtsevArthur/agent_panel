/**
 * Structured agent-turn steps (Zed-like sequence) and ToolResults intent hints.
 */

export type AgentStepKind =
  | "thinking"
  | "text"
  | "tool"
  | "compaction"
  | "retry";

export type AgentToolStepStatus = "queued" | "running" | "done" | "error";

export interface AgentStepEvent {
  stepId: string;
  kind: AgentStepKind;
  toolCallId?: string;
  name?: string;
  argsPreview?: string;
  status?: AgentToolStepStatus;
  resultPreview?: string;
  text?: string;
  attempt?: number;
  maxAttempts?: number;
}

export type CompletionIntent = "user_prompt" | "tool_results";

/** Sticky marker so we do not stack duplicate ToolResults hints. */
export const TOOL_RESULTS_INTENT_MARKER = "[[harbor:tool_results_intent]]";

export const TOOL_RESULTS_INTENT_HINT = `${TOOL_RESULTS_INTENT_MARKER}
Continue from the tool results above. Do not restart the task from scratch.
Prefer the next concrete action (write_file / answer) over re-exploring files you already read.`;

/**
 * Universal (not task-specific): rules/context are guidance; verify repo facts with tools.
 */
export const VERIFY_REPO_FACTS_HINT = `Workspace guidance (AGENTS.md / rules / editor context) is helpful context, not a substitute for the repository.
When the user asks for factual claims about this project that can be checked in the workspace (versions, file contents, structure, configs, scripts, dependencies), verify with list_files / read_file / search_text before answering.
Do not invent paths or versions. Prefer a short tool-verified answer over restating rules alone.
If tools are unavailable or the question is purely conceptual, answer from knowledge and say when you did not read the repo.
When you already know several paths to inspect, call multiple read_file / list_files / search_text in the same assistant turn — they run in parallel. Do not serialize one read per round when the other paths are already clear.`;

/** Short marker used in tests / docs for the parallel-reads guidance. */
export const PARALLEL_READS_HINT_MARKER =
  "multiple read_file / list_files / search_text in the same assistant turn";

/**
 * Zed-style focused-edit guidance: prefer search_replace (surgical patch) over
 * write_file (full rewrite) for changes to existing files — protects the rest
 * of the file (dependencies, imports, neighboring code) from being rewritten.
 */
export const FOCUSED_EDIT_HINT = `When editing an EXISTING file, prefer search_replace (old_string → new_string) — it changes only the target fragment and leaves the rest of the file untouched (dependencies, imports, neighboring code are not rewritten or deleted). Add enough surrounding context to old_string so the match is unique. Use write_file ONLY to create a new file or to rewrite it entirely. For a version bump in package.json, call search_replace with the exact "version": "x.y.z" line.`;

let stepSeq = 0;

export function nextStepId(prefix = "step"): string {
  stepSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${stepSeq}`;
}

export function previewText(value: unknown, maxChars = 160): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function toolStepId(toolCallId: string): string {
  return `tool:${toolCallId || "unknown"}`;
}

export function hasToolResultsIntentHint(
  messages: ReadonlyArray<{ role?: string; content?: unknown }>
): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== "system" && msg?.role !== "user") {
      continue;
    }
    const content =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content
              .map((part) =>
                part && typeof part === "object" && "text" in part
                  ? String((part as { text?: string }).text || "")
                  : ""
              )
              .join("\n")
          : "";
    if (content.includes(TOOL_RESULTS_INTENT_MARKER)) {
      return true;
    }
  }
  return false;
}

/**
 * Ensures a single sticky ToolResults hint exists when continuing after tools.
 * Returns whether a hint was inserted.
 */
export function ensureToolResultsIntentHint(
  messages: Array<{ role: string; content?: unknown }>
): boolean {
  if (hasToolResultsIntentHint(messages)) {
    return false;
  }
  messages.push({
    role: "system",
    content: TOOL_RESULTS_INTENT_HINT,
  });
  return true;
}

export function looksLikeToolErrorResult(result: string): boolean {
  const trimmed = String(result || "").trim();
  if (!trimmed) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; ok?: unknown };
    if (parsed && typeof parsed === "object") {
      if (parsed.ok === false) {
        return true;
      }
      if (parsed.error != null && String(parsed.error).length > 0) {
        return true;
      }
    }
  } catch {
    // plain text
  }
  return /^\s*error\b/i.test(trimmed);
}
