/**
 * VS Code in-process adapter for @harbor/core.
 *
 * Keeps the extension host path in-process (no sidecar process).
 * JetBrains uses the stdio sidecar with the same HarborCore surface.
 */
import * as vscode from "vscode";
import { runAgentTurn } from "./agentLoop";
import type { AgentRunCallbacks } from "./agentLoop";
import type { ChatMessage } from "./openaiClient";
import type { MessageAttachment } from "./attachments";

export const HARBOR_CORE_IN_PROCESS = true as const;

export interface InProcessTurnParams {
  model: string;
  text: string;
  history: ChatMessage[];
  attachments?: MessageAttachment[];
  agentMode?: string;
  reasoningEffort?: string;
  storageUri?: vscode.Uri;
  signal?: AbortSignal;
  lastAgentEditedPaths?: string[];
  callbacks: AgentRunCallbacks;
}

/**
 * Run a Harbor agent turn in-process (VS Code).
 * Returns the updated chat history (same contract as runAgentTurn).
 */
export async function runHarborTurnInProcess(
  params: InProcessTurnParams
): Promise<ChatMessage[]> {
  return runAgentTurn({
    model: params.model,
    history: params.history,
    userText: params.text,
    attachments: params.attachments,
    storageUri: params.storageUri,
    signal: params.signal,
    agentMode: params.agentMode,
    reasoningEffort: params.reasoningEffort,
    callbacks: params.callbacks,
    lastAgentEditedPaths: params.lastAgentEditedPaths,
  });
}
