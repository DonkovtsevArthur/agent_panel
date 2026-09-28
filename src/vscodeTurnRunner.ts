/**
 * TurnRunner adapter: bridges HarborCore's turn execution contract to
 * the existing `runClineAgentTurn` in clineRuntime.ts.
 *
 * This allows HarborCore (packages/harbor-core) to start turns
 * through the same ClineCore-backed pipeline that the VS Code panel
 * and JetBrains sidecar already use, without duplicating turn logic.
 *
 * Types are defined locally (not imported from packages/harbor-core)
 * because tsconfig rootDir is `src/` and cannot reach `packages/`.
 */
import { runClineAgentTurn } from "./clineRuntime";
import type { AgentRunCallbacks } from "./agentLoop";
import type { ChatMessage } from "./openaiTypes";
import type { MessageAttachment } from "./attachments";
import type { UiMessage } from "./sessionStore";

// ─── Turn types (mirror packages/harbor-core/src/harborCore.ts) ──────────────

export type CoreEventHandler = (
  event: string,
  params: unknown
) => void;

export interface TurnStartParams {
  model: string;
  text: string;
  agentMode?: string;
  reasoningEffort?: string;
  history?: unknown[];
  attachments?: unknown[];
  workspaceRoot?: string;
  chatId?: string;
}

export type TurnRunner = (
  params: TurnStartParams,
  emit: CoreEventHandler,
  signal: AbortSignal
) => Promise<{ ok: true } | { ok: false; error: string }>;

// ─── Adapter ────────────────────────────────────────────────────────────────

/**
 * Create a `TurnRunner` that delegates to `runClineAgentTurn`.
 *
 * `emit` is wired to HarborCore event notifications (turn.step, turn.delta,
 * etc.) so the core can forward them to the webview / IDE host.
 *
 * `getHistory` / `setHistory` let the caller manage the per-chat
 * conversation history (the runner itself is stateless).
 */
export function createVsCodeTurnRunner(options: {
  /** Retrieve the current chat history for a given chat id. */
  getHistory: (chatId: string) => ChatMessage[];
  /** Persist updated history after a successful turn. */
  setHistory: (chatId: string, history: ChatMessage[]) => void;
  /** Retrieve prior UI messages for session seeding. */
  getPriorUiMessages?: (chatId: string) => UiMessage[];
  /** Retrieve last agent-edited paths for a chat. */
  getLastAgentEditedPaths?: (chatId: string) => string[];
}): TurnRunner {
  return async (
    params: TurnStartParams,
    emit: CoreEventHandler,
    signal: AbortSignal
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    const chatId = params.chatId || "default";
    const history = options.getHistory(chatId);

    // Adapt HarborCore's CoreEventHandler to Harbor's AgentRunCallbacks.
    const callbacks: AgentRunCallbacks = {
      onPhase: (phase, detail) => {
        emit("turn.step", { phase, detail });
      },
      onTool: (text) => {
        emit("turn.step", { kind: "tool", text });
      },
      onStep: (event) => {
        emit("turn.step", event);
      },
      onFileEdit: (_edit) => {
        // File edits are tracked by the turn, not forwarded individually.
      },
      onAssistantDelta: (text) => {
        emit("turn.delta", { text });
      },
      onAssistantStreamClear: () => {
        // Stream reset — no-op at the core level.
      },
      onAssistant: (text, meta) => {
        emit("turn.delta", { text, reasoning: meta?.reasoning, final: true });
      },
      onReasoning: (text) => {
        emit("turn.reasoning", { text });
      },
      onReview: (edits) => {
        emit("turn.review", { edits });
      },
      onUsage: (usage) => {
        emit("turn.step", { kind: "usage", usage });
      },
      onTiming: (info) => {
        emit("turn.step", { kind: "timing", ...info });
      },
    };

    try {
      const result = await runClineAgentTurn({
        model: params.model,
        history,
        userText: params.text,
        attachments: params.attachments as MessageAttachment[] | undefined,
        signal,
        agentMode: params.agentMode,
        reasoningEffort: params.reasoningEffort,
        chatId,
        lastAgentEditedPaths: options.getLastAgentEditedPaths?.(chatId),
        priorUiMessages: options.getPriorUiMessages?.(chatId),
        callbacks,
      });

      options.setHistory(chatId, result);
      emit("turn.idle", { reason: "completed" });
      return { ok: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/abort/i.test(msg)) {
        emit("turn.idle", { reason: "abort" });
        return { ok: true };
      }
      return { ok: false, error: msg };
    }
  };
}
