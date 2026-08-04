/**
 * Sequential sub-task delegation: run a mini agent turn for a self-contained
 * sub-task in the same workspace. Returns the sub-agent's final answer.
 *
 * Recursion guard: the sub-agent does NOT see the delegate_task tool
 * (excludeToolNames), so only one level of delegation is possible.
 * Silent run: no-op callbacks — the sub-agent does not post step/phase/
 * assistant events to the parent's UI.
 * In ask mode the sub-agent also does NOT see request_user_input — it must
 * not block the parent turn with a QuickPick.
 */
import type * as vscode from "vscode";
import type { ChatMessage } from "./openaiClient";
import type { AgentRunCallbacks } from "./agentLoop";
import { decideHonestFinale } from "./honestFinale";

const DELEGATE_MAX_TOOL_ROUNDS = 8;

export interface DelegateTaskOptions {
  task: string;
  mode: "agent" | "ask";
  model: string;
  storageUri?: vscode.Uri;
  signal?: AbortSignal;
  /** Override default sub-agent tool-round budget (default 8). */
  maxToolRounds?: number;
}

export async function runDelegateTask(
  options: DelegateTaskOptions
): Promise<{ ok: boolean; result: string; error?: string }> {
  const { runMainLikeAgentTurn } = await import("./agentLoopMainLike");
  let collectedText = "";
  const silentCallbacks: AgentRunCallbacks = {
    onPhase: () => {},
    onTool: () => {},
    onStep: () => {},
    onFileEdit: () => {},
    onAssistantStreamClear: () => {},
    onAssistant: (text) => {
      collectedText = text;
    },
    onReview: () => {},
    onUsage: () => {},
  };
  const excludeToolNames = new Set<string>(["delegate_task"]);
  if (options.mode === "ask") {
    excludeToolNames.add("request_user_input");
  }
  try {
    await runMainLikeAgentTurn({
      model: options.model,
      history: [],
      userText: options.task,
      storageUri: options.storageUri,
      signal: options.signal,
      agentMode: options.mode,
      callbacks: silentCallbacks,
      excludeToolNames,
      maxToolRounds: options.maxToolRounds ?? DELEGATE_MAX_TOOL_ROUNDS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "aborted") {
      return { ok: false, result: "", error: "aborted" };
    }
    return { ok: false, result: "", error: message };
  }
  const rawText = collectedText.trim();
  // Sub-agent не должен оборачивать ответ в <proposed_plan> — это артефакт
  // верхнеуровневого Plan-цикла. Если под-агент всё же выдал тег — стрипаем,
  // чтобы родитель не получил double-wrap и не запутался в двух планах.
  const text = rawText.replace(/<\/?proposed_plan>/gi, "").trim();
  // Gate: если под-агент завершился hedge/пустышкой/ложью о правках —
  // не отдавать родителю мусор как качественный результат.
  const gate = decideHonestFinale({
    text: text || "",
    canEdit: options.mode === "agent",
    messages: [],
    userText: options.task,
    allowNudgeWrite: false,
    allowNudgeHedge: false,
    allowNudgeHollow: false,
    allowNudgeImpact: false,
    allowNudgeAskUser: false,
  });
  if (gate.kind === "replace") {
    return { ok: false, result: gate.text, error: gate.text };
  }
  return { ok: true, result: text };
}
