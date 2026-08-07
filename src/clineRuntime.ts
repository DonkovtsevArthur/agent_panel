/**
 * Harbor turn runner backed by ClineCore local session host (@cline/sdk).
 * UI callbacks stay the Harbor AgentRunCallbacks contract.
 */
import * as path from "path";
import * as vscode from "vscode";
import {
  getConfig,
  resolveModelEndpoint,
  resolveModelReasoningEffort,
  resolveModelSupportsReasoningEffort,
} from "./config";
import { toClineReasoningOptions } from "./reasoningEffort";
import { FileEditStat } from "./diffStats";
import { ChatMessage } from "./openaiClient";
import type { MessageAttachment } from "./attachments";
import { attachmentPreviewDataUrl } from "./attachments";
import type {
  AgentRunCallbacks,
} from "./agentLoop";
import type { AgentStepEvent } from "./agentSteps";
import {
  appendFigmaRuntimeNudge,
  loadHarborMcpToolsForCline,
  messageHasFigmaUrl,
  shouldNotifyFigmaNeedsConnect,
  type ClineCreateMcpTools,
  type ClineCreateTool,
} from "./clineMcpTools";
import {
  createHarborNoopTelemetry,
  HARBOR_CLINE_DISTINCT_ID,
} from "./clineNoopTelemetry";
import { HARBOR_PLAN_MODE_CARD_HINT } from "./planImplement";

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
  update?: unknown;
  output?: unknown;
  error?: string | Error;
  message?: string;
  reason?: string;
  noticeType?: string;
  metadata?: Record<string, unknown>;
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
    toolCalls?: readonly unknown[];
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
  createMcpTools: ClineCreateMcpTools;
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
      // Never wire PostHog / OTEL / live sinks; keep vendor telemetry trees intact for re-forks.
      telemetry: createHarborNoopTelemetry(),
      distinctId: HARBOR_CLINE_DISTINCT_ID,
      toolPolicies: bundle.createToolPoliciesWithPreset("yolo"),
      capabilities: {
        requestToolApproval: async () => ({ approved: true }),
      },
      prepare: async () => ({
        applyToStartSessionInput: async (input: {
          config: Record<string, unknown>;
        }) => {
          const mode = String(input.config.mode || "act");
          const plannerModelId = String(input.config.modelId || "");
          const turnPrompt = String(
            (input as { prompt?: unknown }).prompt ||
              (input.config as { prompt?: unknown }).prompt ||
              ""
          );
          const mcp = await loadHarborMcpToolsForCline({
            createMcpTools: bundle.createMcpTools,
            readonlyOnly: mode === "plan",
            plannerModelId,
            figmaUrlInTurn: messageHasFigmaUrl(turnPrompt),
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

/**
 * Harbor always passes a custom/builtin `overridePrompt`, which replaces
 * Cline's default template and drops the `<env>` Working Directory block.
 * Models then invent sandbox paths like `/home/cline/project`. Stamp cwd
 * explicitly so tools resolve under the open VS Code folder.
 */
function harborWorkspaceEnvBlock(cwd: string): string {
  const root = String(cwd || "").trim() || process.cwd();
  return [
    "Environment you are running in:",
    "<env>",
    `1. Platform: ${process.platform}`,
    `2. Date: ${new Date().toLocaleDateString()}`,
    "3. IDE: VS Code",
    `4. Working Directory: ${root}`,
    "</env>",
    "Use absolute paths under Working Directory (or paths relative to it).",
    "Do not invent sandbox paths such as /home/cline/project.",
  ].join("\n");
}

function ensureHarborWorkspaceEnv(
  systemPrompt: string,
  cwd: string
): string {
  const prompt = String(systemPrompt || "");
  const root = String(cwd || "").trim();
  if (
    root &&
    prompt.includes(root) &&
    /Working Directory:/i.test(prompt)
  ) {
    return prompt;
  }
  return [prompt, harborWorkspaceEnvBlock(root)]
    .filter((part) => String(part || "").trim())
    .join("\n\n");
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

/** Prefer the last assistant text part from a Cline result transcript. */
function lastAssistantTextFromMessages(
  messages: readonly ClineHistoryMessage[] | undefined
): string {
  if (!messages?.length) {
    return "";
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== "assistant") {
      continue;
    }
    const text = textFromMessageContent(msg.content).trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function summaryFromSubmitInput(input: unknown): string {
  let value: unknown = input;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      // Bare summary string (unusual, but usable as finale).
      return trimmed.length >= 10 ? trimmed : "";
    }
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  const row = value as {
    summary?: unknown;
    args?: unknown;
    input?: unknown;
  };
  const summary = row.summary;
  if (typeof summary === "string" && summary.trim()) {
    return summary.trim();
  }
  // Nested shapes from some adapters / partial updates.
  if (row.args !== undefined) {
    return summaryFromSubmitInput(row.args);
  }
  if (row.input !== undefined && row.input !== input) {
    return summaryFromSubmitInput(row.input);
  }
  return "";
}

function isSubmitAndExitToolName(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === "submit_and_exit" ||
    n === "attempt_completion" ||
    n.endsWith("submit_and_exit")
  );
}

/**
 * Cline often ends the turn with submit_and_exit({ summary }) and little/no
 * assistant text. Harbor's Plan card needs that summary as the finale.
 */
function submitSummaryFromMessages(
  messages: readonly ClineHistoryMessage[] | undefined
): string {
  if (!messages?.length) {
    return "";
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== "assistant" || !Array.isArray(msg.content)) {
      continue;
    }
    for (let j = msg.content.length - 1; j >= 0; j -= 1) {
      const part = msg.content[j];
      if (!part || typeof part !== "object") {
        continue;
      }
      const row = part as {
        type?: string;
        name?: string;
        toolName?: string;
        input?: unknown;
        arguments?: unknown;
      };
      const name = String(row.name || row.toolName || "");
      if (
        (row.type === "tool_use" ||
          row.type === "tool-call" ||
          row.type === "tool_call") &&
        isSubmitAndExitToolName(name)
      ) {
        const summary =
          summaryFromSubmitInput(row.input) ||
          summaryFromSubmitInput(row.arguments);
        if (summary) {
          return summary;
        }
      }
    }
  }
  return "";
}

function submitSummaryFromToolCalls(toolCalls: unknown): string {
  if (!Array.isArray(toolCalls)) {
    return "";
  }
  for (let i = toolCalls.length - 1; i >= 0; i -= 1) {
    const row = toolCalls[i];
    if (!row || typeof row !== "object") {
      continue;
    }
    const tc = row as {
      name?: unknown;
      toolName?: unknown;
      input?: unknown;
      args?: unknown;
    };
    const name = String(tc.toolName || tc.name || "");
    if (!isSubmitAndExitToolName(name)) {
      continue;
    }
    const summary =
      summaryFromSubmitInput(tc.input) || summaryFromSubmitInput(tc.args);
    if (summary) {
      return summary;
    }
  }
  return "";
}

/**
 * Prefer submit_and_exit.summary as the turn finale (Cline's completion
 * payload). Keep streamed/result text only when it already has a longer
 * tagged plan.
 */
function pickFinalAssistantText(options: {
  resultText: string;
  streamedText: string;
  submitSummary: string;
  messagesText: string;
  aborted: boolean;
}): string {
  const stream =
    options.resultText.trim() ||
    options.streamedText.trim() ||
    options.messagesText.trim();
  const submit = options.submitSummary.trim();
  if (submit) {
    const streamHasTags =
      /(?:<proposed_plan>|&lt;proposed_plan&gt;)/i.test(stream);
    const submitHasTags =
      /(?:<proposed_plan>|&lt;proposed_plan&gt;)/i.test(submit);
    if (streamHasTags && !submitHasTags && stream.length > submit.length) {
      return stream;
    }
    return submit;
  }
  return stream || (options.aborted ? "(остановлено)" : "");
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

/**
 * Cline editor/apply_patch catch failures and return `{ success: false, error }`
 * without throwing. Treat that as a real tool failure so the model retries
 * instead of narrating "done" while the disk is unchanged.
 */
function toolOutputIsSoftFail(output: unknown): boolean {
  if (!output || typeof output !== "object") {
    return false;
  }
  return (output as { success?: unknown }).success === false;
}

function errorMessageFromToolOutput(output: unknown): string {
  if (!output || typeof output !== "object") {
    return "";
  }
  const err = (output as { error?: unknown }).error;
  if (typeof err === "string" && err.trim()) {
    return err.trim();
  }
  try {
    return JSON.stringify(output);
  } catch {
    return "tool failed";
  }
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

/** Prefer spawn_agent text summary over raw JSON for step cards. */
function spawnAgentResultPreview(
  toolName: string,
  output: unknown,
  errMsg: string
): string {
  if (errMsg) {
    return previewJson(errMsg, 240);
  }
  if (toolName === "spawn_agent" && output && typeof output === "object") {
    const text = String((output as { text?: unknown }).text || "").trim();
    if (text) {
      return text.length > 240 ? `${text.slice(0, 237)}...` : text;
    }
  }
  return previewJson(output, 240);
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
  /** Harbor UI intelligence level (low|medium|high|xhigh). */
  reasoningEffort?: string;
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

  const baseSystemPrompt = [
    bundle.getClineDefaultSystemPrompt({
      overridePrompt: config.systemPrompt || undefined,
      ide: "VS Code",
      mode: clineMode,
      workspaceRoot: cwd,
      providerId: "openai-compatible",
      workspaceName: path.basename(cwd),
      platform: process.platform,
      planModeSwitchTool: false,
    }),
    // Harbor Plan card: ask models to wrap finales in <proposed_plan> (Ask stays plain).
    String(options.agentMode || "").toLowerCase() === "plan"
      ? HARBOR_PLAN_MODE_CARD_HINT
      : "",
  ]
    .filter((part) => String(part || "").trim())
    .join("\n\n");

  const core = await getClineCore(bundle);
  const sessionId = newSessionId();

  const edits: FileEditStat[] = [];
  let assistantText = "";
  let reasoningText = "";
  let submitSummary = "";
  let stepSeq = 0;
  const toolInputs = new Map<string, unknown>();
  /** Sum turn deltas so parent + forwarded child usage both count. */
  let usagePromptTokens = 0;
  let usageCompletionTokens = 0;
  const enableSpawnAgent = config.subagents.enabled !== false;
  const enableParallelToolCalls = config.parallelToolCalls.enabled !== false;
  const enableAutoCompact = config.autoCompact.enabled !== false;
  /** Default matches Cline AgentConfigSchema (8 → parallel). */
  const maxParallelToolCalls = enableParallelToolCalls ? 8 : 1;

  /** Show Cline session/run/finish status as-is (Harbor phase = "cline"). */
  const setClineStatus = (status: string) => {
    const text = String(status || "").trim();
    if (!text) {
      return;
    }
    callbacks.onPhase("cline", text);
  };

  setClineStatus("running");

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
          if (isSubmitAndExitToolName(name)) {
            const summary = summaryFromSubmitInput(event.input);
            if (summary) {
              submitSummary = summary;
            }
          }
          const argsPreview = previewJson(event.input);
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
          if (isSubmitAndExitToolName(name)) {
            const summary = summaryFromSubmitInput(input);
            if (summary) {
              submitSummary = summary;
            }
          }
          const errMsg =
            typeof event.error === "string"
              ? event.error
              : event.error instanceof Error
                ? event.error.message
                : toolOutputIsSoftFail(event.output)
                  ? errorMessageFromToolOutput(event.output)
                  : "";
          const failed = Boolean(errMsg) || toolOutputIsSoftFail(event.output);
          emitStep(callbacks, {
            stepId: toolCallId,
            kind: "tool",
            toolCallId,
            name,
            argsPreview: previewJson(input),
            status: failed ? "error" : "done",
            resultPreview: spawnAgentResultPreview(name, event.output, errMsg),
          });
          // Only seed review when the edit tool actually succeeded.
          if (!failed && looksLikeEditTool(name)) {
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
      case "content_update": {
        // Streaming / progress updates for in-flight tools — keep submit summary.
        if (event.contentType === "tool") {
          const toolCallId = event.toolCallId || "";
          const update = event.update;
          const merged =
            update !== undefined
              ? update
              : event.input !== undefined
                ? event.input
                : undefined;
          if (toolCallId && merged !== undefined) {
            const prev = toolInputs.get(toolCallId);
            const next =
              prev &&
              typeof prev === "object" &&
              merged &&
              typeof merged === "object"
                ? { ...(prev as object), ...(merged as object) }
                : merged;
            toolInputs.set(toolCallId, next);
            const name = event.toolName || "";
            if (isSubmitAndExitToolName(name)) {
              const summary = summaryFromSubmitInput(next);
              if (summary) {
                submitSummary = summary;
              }
            }
          }
        }
        break;
      }
      case "usage": {
        // Prefer per-turn deltas so parent + child (forwarded to root) sum.
        const inDelta = Number(event.inputTokens ?? 0);
        const outDelta = Number(event.outputTokens ?? 0);
        if (inDelta > 0 || outDelta > 0) {
          usagePromptTokens += inDelta;
          usageCompletionTokens += outDelta;
        } else {
          usagePromptTokens = Math.max(
            usagePromptTokens,
            Number(event.totalInputTokens ?? 0)
          );
          usageCompletionTokens = Math.max(
            usageCompletionTokens,
            Number(event.totalOutputTokens ?? 0)
          );
        }
        callbacks.onUsage?.({
          used: usagePromptTokens + usageCompletionTokens,
          promptTokens: usagePromptTokens,
          completionTokens: usageCompletionTokens,
        });
        break;
      }
      case "notice": {
        if (event.message) {
          setClineStatus(String(event.message));
        }
        const noticeReason = String(event.reason || "");
        if (
          noticeReason === "auto_compaction" ||
          noticeReason === "manual_compaction" ||
          noticeReason === "compaction_budget_emergency"
        ) {
          const phase = String(event.metadata?.phase || "");
          const label =
            phase === "started" || /compact(ing)?$/i.test(String(event.message || ""))
              ? "⚙ Compact context…"
              : "⚙ Context compacted";
          stepSeq += 1;
          emitStep(callbacks, {
            stepId: `compaction-${stepSeq}`,
            kind: "compaction",
            text: label,
          });
        }
        break;
      }
      case "done": {
        setClineStatus(String(event.reason || "completed"));
        break;
      }
      case "error": {
        const err = event.error;
        const message =
          typeof err === "string"
            ? err
            : err instanceof Error
              ? err.message
              : "error";
        setClineStatus(message);
        break;
      }
      default:
        break;
    }
  };

  const unsubscribe = core.subscribe((rawEvent) => {
    const event = rawEvent as CoreSessionEvent;
    const sid = String(event.payload?.sessionId || "");
    // Child subagent events are re-dispatched on the root sessionId by the
    // local host (onSubAgentEvent → dispatchAgentEvent(rootSessionId, …)).
    if (sid && sid !== sessionId) {
      return;
    }
    if (event.type === "agent_event" && event.payload?.event) {
      handleAgentEvent(event.payload.event);
      return;
    }
    if (event.type === "status" && event.payload?.status) {
      setClineStatus(String(event.payload.status));
    }
  });

  const onAbort = () => {
    // spawn_agent children share the parent tool AbortSignal; aborting the
    // root session cancels in-flight spawn work as well.
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
  userPrompt = appendFigmaRuntimeNudge(userPrompt);

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

  const reasoningOptions = resolveModelSupportsReasoningEffort(options.model)
    ? toClineReasoningOptions(
        options.reasoningEffort || resolveModelReasoningEffort(options.model)
      )
    : {};

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
        enableSpawnAgent,
        enableAgentTeams: false,
        disableMcpSettingsTools: true,
        maxParallelToolCalls,
        ...(enableAutoCompact
          ? {
              compaction: {
                enabled: true,
                strategy: "agentic" as const,
              },
            }
          : {}),
        // Iteration budget: leave unset so Cline treats it as unlimited
        // (Harbor maxToolRounds no longer caps the turn).
        systemPrompt: baseSystemPrompt,
        ...reasoningOptions,
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

    const finalText = pickFinalAssistantText({
      resultText: String(result?.text || ""),
      streamedText: assistantText,
      submitSummary:
        submitSummary ||
        submitSummaryFromToolCalls(result?.toolCalls) ||
        submitSummaryFromMessages(result?.messages),
      messagesText: lastAssistantTextFromMessages(result?.messages),
      aborted,
    });

    // Do not clear the stream bubble first: if finalText were empty we would
    // wipe a visible plan and never re-append. assistantDone updates in place.
    setClineStatus(
      aborted ? "aborted" : finishReason || "completed"
    );
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
      setClineStatus("aborted");
      const partial = assistantText.trim() || "(остановлено)";
      callbacks.onAssistant(partial);
      await callbacks.onReview(edits);
      return [
        ...options.history,
        { role: "user", content: userPrompt },
        { role: "assistant", content: partial },
      ];
    }
    const message = error instanceof Error ? error.message : String(error);
    setClineStatus(message || "failed");
    throw error;
  } finally {
    try {
      await core.stop(sessionId);
    } catch {
      /* session may already be finalized */
    }
  }
}
