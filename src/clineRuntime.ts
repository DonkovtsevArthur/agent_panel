/**
 * Harbor turn runner backed by ClineCore local session host (@cline/sdk).
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

type ClineMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "thinking"; thinking: string }
      | { type: string; [key: string]: unknown }
    >;

type ClineHistoryMessage = {
  role: "user" | "assistant";
  content: ClineMessageContent;
  id?: string;
  ts?: number;
};

type ClineAgentEvent = {
  type: string;
  contentType?: string;
  text?: string;
  accumulated?: string;
  reasoning?: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  error?: string | Error;
  message?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  recoverable?: boolean;
};

type CoreSessionEvent = {
  type: string;
  payload?: {
    sessionId?: string;
    event?: ClineAgentEvent;
    status?: string;
    reason?: string;
  };
};

type ClineStartResult = {
  sessionId: string;
  result?: {
    text?: string;
    messages?: readonly ClineHistoryMessage[];
    finishReason?: string;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
    };
  };
};

type ClineCoreInstance = {
  start: (input: Record<string, unknown>) => Promise<ClineStartResult>;
  abort: (sessionId: string, reason?: unknown) => Promise<void>;
  stop: (sessionId: string) => Promise<void>;
  subscribe: (listener: (event: CoreSessionEvent) => void) => () => void;
};

type ClineBundle = {
  ClineCore: {
    create: (options: Record<string, unknown>) => Promise<ClineCoreInstance>;
  };
  createTool: ClineCreateTool;
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

let cachedBundle: ClineBundle | undefined;
let corePromise: Promise<ClineCoreInstance> | undefined;

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

function getClineCore(bundle: ClineBundle): Promise<ClineCoreInstance> {
  if (!corePromise) {
    corePromise = bundle.ClineCore.create({
      clientName: "harbor-agents",
      backendMode: "local",
      toolPolicies: bundle.createToolPoliciesWithPreset("yolo"),
      capabilities: {
        requestToolApproval: async () => ({ approved: true }),
      },
      prepare: async () => ({
        applyToStartSessionInput: async (input: {
          config: Record<string, unknown>;
        }) => {
          const mode = String(input.config.mode || "act");
          const mcp = await loadHarborMcpToolsForCline({
            createTool: bundle.createTool,
            readonlyOnly: mode === "plan",
          });
          const basePrompt = String(input.config.systemPrompt || "");
          const systemPrompt = [basePrompt, mcp.systemHint]
            .filter((part) => String(part || "").trim())
            .join("\n\n");
          const priorExtra = Array.isArray(input.config.extraTools)
            ? (input.config.extraTools as unknown[])
            : [];
          return {
            ...input,
            config: {
              ...input.config,
              systemPrompt,
              disableMcpSettingsTools: true,
              extraTools: [...priorExtra, ...mcp.tools],
            },
          };
        },
      }),
    });
  }
  return corePromise;
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

function textFromMessageContent(content: ClineMessageContent | undefined): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter(
      (p): p is { type: "text"; text: string } =>
        !!p && typeof p === "object" && p.type === "text"
    )
    .map((p) => p.text)
    .join("");
}

function reasoningFromMessageContent(
  content: ClineMessageContent | undefined
): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter(
      (p): p is { type: "thinking"; thinking: string } =>
        !!p && typeof p === "object" && p.type === "thinking"
    )
    .map((p) => p.thinking)
    .join("");
}

function harborHistoryToClineMessages(
  history: ChatMessage[]
): ClineHistoryMessage[] {
  const out: ClineHistoryMessage[] = [];
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
    const content: ClineMessageContent =
      msg.role === "assistant" && msg.reasoning_content
        ? [
            { type: "thinking", thinking: String(msg.reasoning_content) },
            { type: "text", text: trimmed },
          ]
        : trimmed;
    out.push({
      role: msg.role,
      content,
      id: `harbor-hist-${n}`,
      ts: Date.now() - (history.length - n) * 1000,
    });
  }
  return out;
}

function clineMessagesToHarborHistory(
  messages: readonly ClineHistoryMessage[]
): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      const text = textFromMessageContent(msg.content).trim();
      if (text) {
        out.push({ role: "user", content: text });
      }
      continue;
    }
    if (msg.role === "assistant") {
      const text = textFromMessageContent(msg.content).trim();
      const reasoning = reasoningFromMessageContent(msg.content);
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

function newSessionId(): string {
  return `harbor-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Run one Harbor chat turn via ClineCore local session host (plan/act).
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

  if (shouldNotifyFigmaNeedsConnect(options.userText)) {
    callbacks.onFigmaNeedsConnect?.();
  }

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

  const core = await getClineCore(bundle);
  const sessionId = newSessionId();

  const edits: FileEditStat[] = [];
  let assistantText = "";
  let reasoningText = "";
  let stepSeq = 0;
  const toolInputs = new Map<string, unknown>();

  const setPhase = (phase: AgentPhase, detail?: string) => {
    callbacks.onPhase(phase, detail);
  };

  setPhase("thinking");

  const handleAgentEvent = (event: ClineAgentEvent) => {
    switch (event.type) {
      case "content_start": {
        if (event.contentType === "text") {
          const chunk = String(event.text || "");
          if (chunk) {
            assistantText += chunk;
            callbacks.onAssistantDelta?.(chunk);
          }
          break;
        }
        if (event.contentType === "reasoning") {
          const chunk = String(event.reasoning || event.text || "");
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
        if (event.contentType === "tool") {
          stepSeq += 1;
          const name = event.toolName || "tool";
          const toolCallId = event.toolCallId || `tool-${stepSeq}`;
          if (event.input !== undefined) {
            toolInputs.set(toolCallId, event.input);
          }
          const argsPreview = previewJson(event.input);
          setPhase(
            looksLikeEditTool(name)
              ? "editing"
              : name.includes("search") || name.includes("read")
                ? "reading"
                : "running",
            name
          );
          emitStep(callbacks, {
            stepId: toolCallId,
            kind: "tool",
            toolCallId,
            name,
            argsPreview,
            status: "running",
          });
          callbacks.onTool(`⚙ ${name}(${argsPreview})`);
        }
        break;
      }
      case "content_end": {
        if (event.contentType === "text") {
          const finalText = String(event.text || "").trim();
          if (finalText && !assistantText.trim()) {
            assistantText = finalText;
          }
          break;
        }
        if (event.contentType === "reasoning") {
          const finalReasoning = String(
            event.reasoning || event.text || ""
          ).trim();
          if (finalReasoning && !reasoningText.trim()) {
            reasoningText = finalReasoning;
            callbacks.onReasoning?.(reasoningText);
          }
          break;
        }
        if (event.contentType === "tool") {
          const name = event.toolName || "tool";
          const toolCallId = event.toolCallId || `tool-${stepSeq}`;
          const input = toolInputs.get(toolCallId) ?? event.input;
          const errMsg =
            typeof event.error === "string"
              ? event.error
              : event.error instanceof Error
                ? event.error.message
                : "";
          emitStep(callbacks, {
            stepId: toolCallId,
            kind: "tool",
            toolCallId,
            name,
            argsPreview: previewJson(input),
            status: errMsg ? "error" : "done",
            resultPreview: previewJson(event.output ?? errMsg, 240),
          });
          if (looksLikeEditTool(name)) {
            const filePath = pathFromToolInput(input);
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
        }
        break;
      }
      case "usage": {
        const promptTokens = Number(
          event.totalInputTokens ?? event.inputTokens ?? 0
        );
        const completionTokens = Number(
          event.totalOutputTokens ?? event.outputTokens ?? 0
        );
        callbacks.onUsage?.({
          used: promptTokens + completionTokens,
          promptTokens,
          completionTokens,
        });
        break;
      }
      case "notice": {
        if (event.message) {
          setPhase("thinking", String(event.message));
        }
        break;
      }
      case "error": {
        break;
      }
      default:
        break;
    }
  };

  const unsubscribe = core.subscribe((rawEvent) => {
    const event = rawEvent as CoreSessionEvent;
    const sid = String(event.payload?.sessionId || "");
    if (sid && sid !== sessionId) {
      return;
    }
    if (event.type === "agent_event" && event.payload?.event) {
      handleAgentEvent(event.payload.event);
      return;
    }
    if (event.type === "status" && event.payload?.status) {
      setPhase("thinking", String(event.payload.status));
    }
  });

  const onAbort = () => {
    void core.abort(sessionId, "user-abort").catch(() => {
      /* ignore */
    });
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

  const userImages: string[] = [];
  for (const att of options.attachments || []) {
    if (att.kind !== "image") {
      continue;
    }
    const dataUrl = await attachmentPreviewDataUrl(att, options.storageUri);
    if (dataUrl) {
      userImages.push(dataUrl);
    }
  }

  const initialMessages = harborHistoryToClineMessages(options.history);

  try {
    const startResult = await core.start({
      source: "vscode",
      interactive: false,
      prompt: userPrompt,
      ...(userImages.length ? { userImages } : {}),
      ...(initialMessages.length ? { initialMessages } : {}),
      config: {
        sessionId,
        providerId: "openai-compatible",
        modelId: options.model,
        apiKey: endpoint.apiKey || "no-key",
        baseUrl: endpoint.baseUrl,
        cwd,
        workspaceRoot: cwd,
        mode: clineMode,
        enableTools: true,
        enableSpawnAgent: false,
        enableAgentTeams: false,
        disableMcpSettingsTools: true,
        // Iteration budget: leave unset so Cline treats it as unlimited
        // (Harbor maxToolRounds no longer caps the turn).
        systemPrompt: baseSystemPrompt,
      },
    });

    unsubscribe();
    options.signal?.removeEventListener("abort", onAbort);

    const result = startResult.result;
    const finishReason = String(result?.finishReason || "");
    const aborted =
      options.signal?.aborted ||
      finishReason === "aborted" ||
      finishReason === "cancelled";

    const finalText =
      String(result?.text || "").trim() ||
      assistantText.trim() ||
      (aborted ? "(остановлено)" : "");

    callbacks.onAssistantStreamClear?.();
    setPhase("done");
    callbacks.onAssistant(finalText, {
      ...(reasoningText ? { reasoning: reasoningText } : {}),
    });
    await callbacks.onReview(edits);

    if (result?.messages?.length) {
      return clineMessagesToHarborHistory(result.messages);
    }
    return [
      ...options.history,
      { role: "user", content: userPrompt },
      {
        role: "assistant",
        content: finalText,
        ...(reasoningText ? { reasoning_content: reasoningText } : {}),
      },
    ];
  } catch (error) {
    unsubscribe();
    options.signal?.removeEventListener("abort", onAbort);
    if (options.signal?.aborted) {
      const partial = assistantText.trim() || "(остановлено)";
      callbacks.onAssistant(partial);
      await callbacks.onReview(edits);
      return [
        ...options.history,
        { role: "user", content: userPrompt },
        { role: "assistant", content: partial },
      ];
    }
    throw error;
  } finally {
    try {
      await core.stop(sessionId);
    } catch {
      /* session may already be finalized */
    }
  }
}
