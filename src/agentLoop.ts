import {
  MessageAttachment,
} from "./attachments";
import { compactHistoryWithSummary } from "./historySummary";
import { FileEditStat } from "./diffStats";
import {
  ChatMessage,
} from "./openaiClient";
import { runMainLikeAgentTurn } from "./agentLoopMainLike";
import type * as vscode from "vscode";

export type AgentPhase =
  | "thinking"
  | "reading"
  | "listing"
  | "running"
  | "editing"
  | "verifying"
  | "done";

export interface ContextUsageInfo {
  /** Занято токенов в окне (обычно prompt + completion последнего запроса). */
  used: number;
  promptTokens: number;
  completionTokens: number;
}

export interface AgentRunCallbacks {
  onPhase: (phase: AgentPhase, detail?: string) => void;
  onTool: (text: string) => void;
  onFileEdit: (edit: FileEditStat) => void;
  /** Поток текста ассистента (SSE). */
  onAssistantDelta?: (text: string) => void;
  /** Сбросить незавершённый stream-бабл (tools / nudge). */
  onAssistantStreamClear?: () => void;
  onAssistant: (text: string) => void;
  /** Может быть async (SCM check) — ждём, иначе review теряется в finally. */
  onReview: (edits: FileEditStat[]) => void | Promise<void>;
  onUsage?: (usage: ContextUsageInfo) => void;
  /** User pasted a Figma URL but MCP is not connected. */
  onFigmaNeedsConnect?: () => void;
  /** Active completion model changed (e.g. helper 5xx → selected). */
  onActiveModel?: (modelId: string) => void;
}

export function compactHistory(messages: ChatMessage[]): ChatMessage[] {
  return compactHistoryWithSummary(messages);
}

/**
 * Все модели: turn один в один как на ветке main
 * (короткий контекст, 4 tools, non-stream JSON).
 */
export async function runAgentTurn(options: {
  model: string;
  /**
   * Optional fast model for the Agent explore phase (read-only tools only).
   * After context is gathered, the loop switches to {@link model} for edits/answer.
   */
  exploreModel?: string;
  /**
   * When the under-the-hood helper (Plan/Ask fast override) fails with 5xx/transport,
   * continue the same turn on this user-selected model.
   */
  helperFallbackModel?: string;
  history: ChatMessage[];
  userText: string;
  attachments?: MessageAttachment[];
  storageUri?: vscode.Uri;
  signal?: AbortSignal;
  agentMode?: string;
  /** @deprecated используй agentMode */
  planMode?: boolean;
  callbacks: AgentRunCallbacks;
}): Promise<ChatMessage[]> {
  return runMainLikeAgentTurn(options);
}
