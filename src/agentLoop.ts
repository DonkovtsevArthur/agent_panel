import {
  MessageAttachment,
} from "./attachments";
import { FileEditStat } from "./diffStats";
import {
  ChatMessage,
} from "./openaiClient";
import { runClineAgentTurn } from "./clineRuntime";
import type * as vscode from "vscode";
import type { AgentStepEvent } from "./agentSteps";

export type AgentPhase =
  | "thinking"
  | "reading"
  | "listing"
  | "running"
  | "editing"
  | "verifying"
  | "done";

export type {
  AgentStepEvent,
  AgentStepKind,
  AgentToolStepStatus,
  CompletionIntent,
} from "./agentSteps";

export interface ContextUsageInfo {
  /** Занято токенов в окне (обычно prompt + completion последнего запроса). */
  used: number;
  promptTokens: number;
  completionTokens: number;
}

export interface AgentRunCallbacks {
  onPhase: (phase: AgentPhase, detail?: string) => void;
  onTool: (text: string) => void;
  /** Structured turn step (thinking / text / tool lifecycle / compaction / retry). */
  onStep?: (event: AgentStepEvent) => void;
  onFileEdit: (edit: FileEditStat) => void;
  /** Поток текста ассистента (SSE). */
  onAssistantDelta?: (text: string) => void;
  /** Сбросить незавершённый stream-бабл (tools / nudge). */
  onAssistantStreamClear?: () => void;
  onAssistant: (
    text: string,
    meta?: { reasoning?: string }
  ) => void;
  /** Накопительный текст размышления модели (thinking / reasoning_content). */
  onReasoning?: (text: string) => void;
  /** Может быть async (SCM check) — ждём, иначе review теряется в finally. */
  onReview: (edits: FileEditStat[]) => void | Promise<void>;
  onUsage?: (usage: ContextUsageInfo) => void;
  /** User pasted a Figma URL but MCP is not connected. */
  onFigmaNeedsConnect?: () => void;
  /** Active completion model changed (e.g. helper 5xx → selected). */
  onActiveModel?: (modelId: string) => void;
}

/**
 * Все модели: ClineCore local session host (vendor/cline fork / @cline/sdk).
 * Harbor UI callbacks unchanged.
 */
export async function runAgentTurn(options: {
  model: string;
  history: ChatMessage[];
  userText: string;
  attachments?: MessageAttachment[];
  storageUri?: vscode.Uri;
  signal?: AbortSignal;
  agentMode?: string;
  /** @deprecated используй agentMode */
  planMode?: boolean;
  callbacks: AgentRunCallbacks;
  /** Paths from the previous agent edit turn — discard «свои». */
  lastAgentEditedPaths?: string[];
}): Promise<ChatMessage[]> {
  return runClineAgentTurn(options);
}
