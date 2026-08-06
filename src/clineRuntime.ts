/**
 * Harbor turn runner backed by Cline Agent (@cline/sdk).
 * UI callbacks stay the Harbor AgentRunCallbacks contract.
 */
import * as path from "path";
import * as vscode from "vscode";
import {
  getConfig,
  resolveModelEndpoint,
} from "./config";
import { FileEditStat } from "./diffStats";
import { ChatMessage } from "./openaiClient";
import type { MessageAttachment } from "./attachments";
import { attachmentPreviewDataUrl } from "./attachments";
import type {
  AgentPhase,
  AgentRunCallbacks,
} from "./agentLoop";
import type { AgentStepEvent } from "./agentSteps";
import {
  loadHarborMcpToolsForCline,
  shouldNotifyFigmaNeedsConnect,
  type ClineCreateTool,
} from "./clineMcpTools";

type ClineMode = "act" | "plan";

type ClineBundle = {
  Agent: new (config: Record<string, unknown>) => {
    run: (input: string | ClineMessage) => Promise<{
      status: string;
      outputText: string;
      messages: readonly ClineMessage[];
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
      };
      error?: Error;
    }>;
    continue: (input?: string) => Promise<unknown>;
    abort: (reason?: unknown) => void;
    subscribe: (listener: (event: ClineRuntimeEvent) => void) => () => void;
    restore: (messages: readonly ClineMessage[]) => void;
  };
  createBuiltinTools: (options: Record<string, unknown>) => unknown[];
  createTool: ClineCreateTool;
  ToolPresets: {
    act: Record<string, unknown>;
    plan: Record<string, unknown>;
  };
  createToolPoliciesWithPreset: (
    preset: "default" | "yolo"
  ) => Record<string, unknown>;
  getClineDefaultSystemPrompt: (options: {
    overridePrompt?: string;
    ide?: string;
    mode?: ClineMode | "yolo" | "zen";
    workspaceRoot?: string;
    providerId?: string;
    workspaceName?: string;
    platform?: string;
    /** false = ask user to toggle Plan/Act (VS Code style) */
    planModeSwitchTool?: boolean;
  }) => string;
};

type ClineMessagePart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "image"; image: string; mediaType?: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: unknown;
      isError?: boolean;
    };

type ClineMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: ClineMessagePart[];
  createdAt: number;
};

type ClineRuntimeEvent =
  | {
      type: "assistant-text-delta";
      text: string;
      accumulatedText?: string;
    }
  | {
      type: "assistant-reasoning-delta";
      text: string;
      accumulatedText?: string;
    }
  | {
      type: "tool-started";
      toolCall: {
        toolCallId: string;
        toolName: string;
        input: unknown;
      };
    }
  | {
      type: "tool-finished";
      toolCall: {
        toolCallId: string;
        toolName: string;
        input: unknown;
      };
      message: ClineMessage;
    }
  | {
      type: "usage-updated";
      usage: {
        inputTokens?: number;
        outputTokens?: number;
      };
    }
  | {
      type: "run-failed";
      error: Error;
    }
  | {
      type: "status-notice";
      message: string;
    };

let cachedBundle: ClineBundle | undefined;

function loadClineBundle(): ClineBundle {
  if (cachedBundle) {
    return cachedBundle;
  }
  // Bundled next to compiled out/*.js (scripts/bundle-cline.js).
  // Path is relative to out/clineRuntime.js at runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cachedBundle = require("./clineBundle.js") as ClineBundle;
  return cachedBundle;
}

function mapHarborModeToCline(agentMode?: string): ClineMode {
  const id = String(agentMode || "agent").toLowerCase();
  if (id === "plan" || id === "ask") {
    return "plan";
  }
  return "act";
}

function workspaceCwd(): string {
  return (
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
  );
}

function previewJson(value: unknown, max = 180): string {
  try {
    const raw =
      typeof value === "string" ? value : JSON.stringify(value ?? {});
    return raw.length > max ? `${raw.slice(0, max)}…` : raw;
  } catch {
    return "";
  }
}

function textFromParts(parts: ClineMessagePart[] | undefined): string {
  if (!parts?.length) {
    return "";
  }
  return parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function harborHistoryToClineMessages(
  history: ChatMessage[]
): ClineMessage[] {
  const out: ClineMessage[] = [];
  let n = 0;
  for (const msg of history) {
    if (msg.role !== "user" && msg.role !== "assistant") {
      continue;
    }
    const text =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content
              .map((p) =>
                p && typeof p === "object" && "text" in p
                  ? String((p as { text?: string }).text || "")
                  : ""
              )
              .join("")
          : "";
    const trimmed = text.trim();
    if (!trimmed) {
      continue;
    }
    n += 1;
    out.push({
      id: `harbor-hist-${n}`,
      role: msg.role,
      content: [{ type: "text", text: trimmed }],
      createdAt: Date.now() - (history.length - n) * 1000,
    });
  }
  return out;
}

function clineMessagesToHarborHistory(
  messages: readonly ClineMessage[]
): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      const text = textFromParts(msg.content).trim();
      if (text) {
        out.push({ role: "user", content: text });
      }
      continue;
    }
    if (msg.role === "assistant") {
      const text = textFromParts(msg.content).trim();
      const reasoning = msg.content
        .filter(
          (p): p is { type: "reasoning"; text: string } =>
            p.type === "reasoning"
        )
        .map((p) => p.text)
        .join("");
      if (text || reasoning) {
        const row: ChatMessage = { role: "assistant", content: text || "" };
        if (reasoning) {
          row.reasoning_content = reasoning;
        }
        out.push(row);
      }
    }
  }
  return out;
}

function looksLikeEditTool(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === "editor" ||
    n === "apply_patch" ||
    n.includes("edit") ||
    n.includes("write") ||
    n.includes("patch")
  );
}

function pathFromToolInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const obj = input as Record<string, unknown>;
  for (const key of ["path", "file_path", "filePath", "target"]) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }
  return undefined;
}

function emitStep(
  callbacks: AgentRunCallbacks,
  event: AgentStepEvent
): void {
  callbacks.onStep?.(event);
}

/**
 * Run one Harbor chat turn via Cline Agent (plan/act).
 * Replaces runMainLikeAgentTurn.
 */
export async function runClineAgentTurn(options: {
  model: string;
  history: ChatMessage[];
  userText: string;
  attachments?: MessageAttachment[];
  storageUri?: vscode.Uri;
  signal?: AbortSignal;
  agentMode?: string;
  planMode?: boolean;
  callbacks: AgentRunCallbacks;
  lastAgentEditedPaths?: string[];
}): Promise<ChatMessage[]> {
  const { callbacks } = options;
  const bundle = loadClineBundle();
  const config = getConfig();
  const endpoint = resolveModelEndpoint(options.model);
  if (!endpoint.baseUrl) {
    throw new Error(
      "Нет провайдера для модели. Откройте Settings → Providers."
    );
  }

  const cwd = workspaceCwd();
  const clineMode = mapHarborModeToCline(
    options.planMode ? "plan" : options.agentMode
  );
  const preset = clineMode === "plan" ? "plan" : "act";
  const builtinTools = bundle.createBuiltinTools({
    cwd,
    ...bundle.ToolPresets[preset],
    // Harbor UX: no per-tool approve prompts for now.
    enableSpawnAgent: false,
    enableAgentTeams: false,
  });

  if (shouldNotifyFigmaNeedsConnect(options.userText)) {
    callbacks.onFigmaNeedsConnect?.();
  }

  const mcp = await loadHarborMcpToolsForCline({
    createTool: bundle.createTool,
    readonlyOnly: clineMode === "plan",
  });
  const tools = [...builtinTools, ...mcp.tools];

  const baseSystemPrompt = bundle.getClineDefaultSystemPrompt({
    overridePrompt: config.systemPrompt || undefined,
    ide: "VS Code",
    mode: clineMode,
    workspaceRoot: cwd,
    providerId: "openai-compatible",
    workspaceName: path.basename(cwd),
    platform: process.platform,
    planModeSwitchTool: false,
  });
  const systemPrompt = [baseSystemPrompt, mcp.systemHint]
    .filter((part) => String(part || "").trim())
    .join("\n\n");

  const toolPolicies = bundle.createToolPoliciesWithPreset("yolo");

  const agent = new bundle.Agent({
    providerId: "openai-compatible",
    modelId: options.model,
    apiKey: endpoint.apiKey || "no-key",
    baseUrl: endpoint.baseUrl,
    systemPrompt,
    tools,
    maxIterations: Math.max(8, Number(config.maxToolRounds) || 40),
    toolPolicies,
    toolExecution: "parallel",
    requestToolApproval: async () => ({ approved: true }),
  });

  const prior = harborHistoryToClineMessages(options.history);
  if (prior.length) {
    agent.restore(prior);
  }

  const edits: FileEditStat[] = [];
  let assistantText = "";
  let reasoningText = "";
  let stepSeq = 0;

  const setPhase = (phase: AgentPhase, detail?: string) => {
    callbacks.onPhase(phase, detail);
  };

  setPhase("thinking");

  const unsubscribe = agent.subscribe((rawEvent) => {
    const event = rawEvent as ClineRuntimeEvent;
    switch (event.type) {
      case "assistant-text-delta": {
        const chunk = String(event.text || "");
        if (chunk) {
          assistantText += chunk;
          callbacks.onAssistantDelta?.(chunk);
        }
        break;
      }
      case "assistant-reasoning-delta": {
        const chunk = String(event.text || "");
        if (chunk) {
          reasoningText += chunk;
          callbacks.onReasoning?.(reasoningText);
          emitStep(callbacks, {
            stepId: `thinking-${stepSeq}`,
            kind: "thinking",
            text: reasoningText,
          });
        }
        break;
      }
      case "tool-started": {
        stepSeq += 1;
        const name = event.toolCall.toolName || "tool";
        const argsPreview = previewJson(event.toolCall.input);
        setPhase(
          looksLikeEditTool(name)
            ? "editing"
            : name.includes("search") || name.includes("read")
              ? "reading"
              : "running",
          name
        );
        emitStep(callbacks, {
          stepId: event.toolCall.toolCallId || `tool-${stepSeq}`,
          kind: "tool",
          toolCallId: event.toolCall.toolCallId,
          name,
          argsPreview,
          status: "running",
        });
        callbacks.onTool(`⚙ ${name}(${argsPreview})`);
        break;
      }
      case "tool-finished": {
        const name = event.toolCall.toolName || "tool";
        const resultPart = event.message.content.find(
          (p: ClineMessagePart) => p.type === "tool-result"
        ) as
          | {
              type: "tool-result";
              output: unknown;
              isError?: boolean;
            }
          | undefined;
        emitStep(callbacks, {
          stepId: event.toolCall.toolCallId || `tool-${stepSeq}`,
          kind: "tool",
          toolCallId: event.toolCall.toolCallId,
          name,
          argsPreview: previewJson(event.toolCall.input),
          status: resultPart?.isError ? "error" : "done",
          resultPreview: previewJson(resultPart?.output, 240),
        });
        if (looksLikeEditTool(name)) {
          const filePath = pathFromToolInput(event.toolCall.input);
          if (filePath) {
            const edit: FileEditStat = {
              path: filePath,
              added: 1,
              removed: 0,
              created: false,
            };
            edits.push(edit);
            callbacks.onFileEdit(edit);
          }
        }
        break;
      }
      case "usage-updated": {
        const promptTokens = Number(event.usage.inputTokens || 0);
        const completionTokens = Number(event.usage.outputTokens || 0);
        callbacks.onUsage?.({
          used: promptTokens + completionTokens,
          promptTokens,
          completionTokens,
        });
        break;
      }
      case "status-notice": {
        if (event.message) {
          setPhase("thinking", String(event.message));
        }
        break;
      }
      case "run-failed": {
        break;
      }
      default:
        break;
    }
  });

  const onAbort = () => {
    try {
      agent.abort("user-abort");
    } catch {
      /* ignore */
    }
  };
  if (options.signal) {
    if (options.signal.aborted) {
      onAbort();
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  let userPrompt = String(options.userText || "").trim();
  const fileNames = (options.attachments || [])
    .filter((a) => a.kind !== "image")
    .map((a) => a.name || a.path || "file");
  if (fileNames.length) {
    userPrompt = `${userPrompt}\n\n[attachments: ${fileNames.join(", ")}]`.trim();
  }
  if (!userPrompt) {
    userPrompt = "Look at the attached image(s) and answer.";
  }

  const contentParts: ClineMessagePart[] = [
    { type: "text", text: userPrompt },
  ];
  for (const att of options.attachments || []) {
    if (att.kind !== "image") {
      continue;
    }
    const dataUrl = await attachmentPreviewDataUrl(att, options.storageUri);
    if (!dataUrl) {
      continue;
    }
    contentParts.push({
      type: "image",
      image: dataUrl,
      mediaType: att.mime || "image/png",
    });
  }

  const runInput: string | ClineMessage =
    contentParts.length > 1
      ? {
          id: `harbor-user-${Date.now()}`,
          role: "user",
          content: contentParts,
          createdAt: Date.now(),
        }
      : userPrompt;

  try {
    const result = await agent.run(runInput);
    unsubscribe();
    options.signal?.removeEventListener("abort", onAbort);

    if (result.status === "failed") {
      const err = result.error || new Error("Cline run failed");
      throw err;
    }

    const finalText =
      String(result.outputText || "").trim() ||
      assistantText.trim() ||
      (result.status === "aborted" ? "(остановлено)" : "");

    callbacks.onAssistantStreamClear?.();
    setPhase("done");
    callbacks.onAssistant(finalText, {
      ...(reasoningText ? { reasoning: reasoningText } : {}),
    });
    await callbacks.onReview(edits);

    return clineMessagesToHarborHistory(result.messages);
  } catch (error) {
    unsubscribe();
    options.signal?.removeEventListener("abort", onAbort);
    if (options.signal?.aborted) {
      const partial =
        assistantText.trim() || "(остановлено)";
      callbacks.onAssistant(partial);
      await callbacks.onReview(edits);
      return [
        ...options.history,
        { role: "user", content: userPrompt },
        { role: "assistant", content: partial },
      ];
    }
    throw error;
  }
}
