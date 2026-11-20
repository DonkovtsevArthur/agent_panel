/**
 * Runtime seam: the single place that decides which agent core executes a
 * Harbor turn. `cline` keeps today's behaviour; `pi` is the migrated adapter.
 *
 * Types are structural copies of the options `runClineAgentTurn` accepts, so
 * both runners stay drop-in compatible while the Cline adapter is retired.
 */
import type * as vscode from "vscode";
import type { AgentRunCallbacks } from "../agentLoop";
import type { MessageAttachment } from "../attachments";
import type { ChatMessage } from "../openaiTypes";
import type { UiMessage } from "../sessionStore";
import { getConfig } from "../config";

export interface AgentTurnOptions {
  model: string;
  history: ChatMessage[];
  userText: string;
  attachments?: MessageAttachment[];
  storageUri?: vscode.Uri;
  signal?: AbortSignal;
  agentMode?: string;
  reasoningEffort?: string;
  tddMode?: boolean;
  callbacks: AgentRunCallbacks;
  lastAgentEditedPaths?: string[];
  chatId?: string;
  resetSession?: boolean;
  priorUiMessages?: UiMessage[];
}

export type AgentTurnRunner = (options: AgentTurnOptions) => Promise<ChatMessage[]>;

export type AgentRuntimeKind = "cline" | "pi";

/**
 * `agentPanel.runtime` — Pi is the shipped default; `cline` stays available as
 * the rollback switch (see docs/pi-runtime-migration.md §13).
 */
export function agentRuntimeKind(): AgentRuntimeKind {
  try {
    return getConfig().runtime === "cline" ? "cline" : "pi";
  } catch {
    return "cline";
  }
}
