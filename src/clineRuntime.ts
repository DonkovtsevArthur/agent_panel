/**
 * Harbor turn runner backed by ClineCore local session host (@cline/sdk).
 * UI callbacks stay the Harbor AgentRunCallbacks contract.
 */
import * as path from "path";
import * as vscode from "vscode";
import {
  getConfig,
  getContextWindow,
  getModeById,
  resolveModelEndpoint,
  resolveModelReasoningEffort,
  resolveModelSupportsReasoningEffort,
  resolveModelSupportsVision,
} from "./config";
import {
  resolveModelCapabilities,
  resolveModelRequestMaxTokens,
} from "./modelCapabilities";
import {
  appendSubagentsRuntimeNudge,
  appendTodoRuntimeNudge,
  appendVisionInspectRuntimeNudge,
  harborAskModeRulesForLanguage,
  harborDefaultRulesForLanguage,
  harborSubagentsRulesForLanguage,
  harborTodoRulesForLanguage,
  harborVisionInspectRulesForLanguage,
  harborFocusChainRulesForLanguage,
  isBuiltinSystemPrompt,
  resolveUiLanguage,
} from "./i18n";
import { toClineReasoningOptions } from "./reasoningEffort";
import { FileEditStat } from "./diffStats";
import { ChatMessage } from "./openaiClient";
import type { MessageAttachment } from "./attachments";
import {
  attachmentPreviewDataUrl,
  buildInlinedAttachmentsPrompt,
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  stripAttachmentPayload,
} from "./attachments";
import {
  enabledSkillNames,
  resolveSkillDirectories,
} from "./harborSkills";
import type {
  AgentRunCallbacks,
} from "./agentLoop";
import type { AgentStepEvent, ToolStepMetrics } from "./agentSteps";
import {
  appendFigmaRuntimeNudge,
  harborMcpToolFingerprint,
  loadHarborMcpToolsForCline,
  messageHasFigmaUrl,
  shouldNotifyFigmaNeedsConnect,
  type ClineCreateMcpTools,
  type ClineCreateTool,
} from "./clineMcpTools";
import {
  activeFileAlreadyInlined,
  buildTurnContextBlock,
} from "./turnContext";
import {
  createHarborNoopTelemetry,
  HARBOR_CLINE_DISTINCT_ID,
} from "./clineNoopTelemetry";
import { HARBOR_PLAN_MODE_CARD_HINT } from "./planImplement";
import { applyHarborTlsPolicy, harborFetch } from "./tlsPolicy";
import { withTurnImages } from "./turnImageInject";
import { buildSpecialMentionsPrompt } from "./mentions";
import { buildFocusChainBlock } from "./focusChain";
import { describeChatImagesForMainModel } from "./figmaVisionHelper";
import { withInspectableImages } from "./inspectImagesContext";
import { createInspectImagesTool } from "./inspectImagesTool";
import { withTodoStepEmitter } from "./todoStepContext";
import { createTodoTool, TODO_STEP_ID, TODO_TOOL } from "./todoTool";
import {
  harborClineToolPolicies,
  harborToolApprovalsFingerprint,
  requestHarborToolApproval,
} from "./toolApproval";

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
  send: (input: {
    sessionId: string;
    prompt: string;
    userImages?: string[];
    userFiles?: string[];
    mode?: string;
  }) => Promise<ClineStartResult["result"] | undefined>;
  abort: (sessionId: string, reason?: unknown) => Promise<void>;
  stop: (sessionId: string) => Promise<void>;
  restore?: (input: {
    sessionId: string;
    checkpointRunCount: number;
    cwd?: string;
    restore?: { messages?: boolean; workspace?: boolean };
  }) => Promise<unknown>;
  compareCheckpoint?: (input: {
    sessionId: string;
    checkpointRunCount: number;
    cwd?: string;
  }) => Promise<{
    diffs: Array<{ filePath: string; leftContent: string; rightContent: string }>;
  }>;
  dispose?: () => Promise<void>;
  subscribe: (listener: (event: CoreSessionEvent) => void) => () => void;
};

type LiveClineChat = {
  sessionId: string;
  fingerprint: string;
  lastCheckpointRunCount?: number;
};

/** Harbor chatId → live interactive Cline session (in-memory; lost on reload). */
const liveClineByChatId = new Map<string, LiveClineChat>();

/**
 * Unused interactive sessions are stopped after this idle so RSS can drop.
 * Follow-up in that chat starts a new Cline session from Harbor history.
 * Checkpoint restore needs a live session — it fails until the next turn.
 */
export const CLINE_SESSION_IDLE_EVICT_MS = 10 * 60 * 1000;

const idleEvictTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearIdleEvictTimer(chatId: string): void {
  const timer = idleEvictTimers.get(chatId);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  idleEvictTimers.delete(chatId);
}

function clearAllIdleEvictTimers(): void {
  for (const timer of idleEvictTimers.values()) {
    clearTimeout(timer);
  }
  idleEvictTimers.clear();
}

/**
 * Subset of Cline's ModelInfo (vendor/.../shared/src/llms/model-info.ts) that
 * Harbor can supply from Settings + the capability registry. Lets Cline budget
 * auto-compact trigger/target tokens and cap output correctly per model.
 *
 * Must include `id`: Core only applies a catalog override when the entry is
 * keyed under `knownModels` (or `providerConfig.modelInfo.id === modelId`).
 * A top-level `modelInfo` on start config is not a CoreSessionConfig field and
 * is silently dropped by local-runtime-bootstrap.
 */
type ClineKnownModelInfo = {
  id: string;
  name?: string;
  maxTokens?: number;
  contextWindow?: number;
  maxInputTokens?: number;
  capabilities?: string[];
};

/**
 * Build knownModels + maxTokensPerTurn for Cline from Harbor's resolved model
 * capabilities so auto-compact / output caps match the real model, and so the
 * gateway does not invent Anthropic wire-format thinking for Claude-via-LiteLLM.
 */
function buildClineModelInfo(modelId: string): {
  knownModels: Record<string, ClineKnownModelInfo>;
  maxTokensPerTurn?: number;
} {
  const config = getConfig();
  const stored = config.models.find((m) => m.id === modelId);
  const contextWindow = getContextWindow(modelId);
  const storedMax =
    typeof stored?.maxOutputTokens === "number" && stored.maxOutputTokens > 0
      ? stored.maxOutputTokens
      : undefined;
  // Claude extended thinking needs max_tokens above the thinking budget;
  // capability registry sets minimumOutputTokens (16k). Honor Settings max too.
  const maxOutputTokens = resolveModelRequestMaxTokens(modelId, storedMax);
  const caps = resolveModelCapabilities(modelId, {
    contextWindow: stored?.contextWindow,
    supportsVision: stored?.supportsVision,
  });
  const capabilities: string[] = ["tools"];
  if (
    resolveModelSupportsVision(modelId) ||
    caps.supportsVision ||
    resolveModelCapabilities(modelId).supportsVision
  ) {
    capabilities.push("images");
  }
  // NOTE: не объявляем capability "reasoning"/"reasoning-effort" в catalog.
  // Иначе Cline (vendor/cline) строит Anthropic-shaped reasoning на wire
  // (thinking: {type:"enabled", budgetTokens} + reasoning: {enabled,max_tokens})
  // через shouldEmitAnthropicReasoning → buildAnthropicCompatibleReasoningOptions.
  // Корпоративный LiteLLM/OpenRouter терминирует Claude как openai-форматный
  // upstream и 400-ит на этих полях (streaming_error / provider: "openai").
  // Сам reasoning при этом сохраняется: core.start получает thinking:true +
  // reasoningEffort из reasoningOptions (ниже в runClineAgentTurn), это течёт
  // в request.reasoning → portable path отдаёт на wire чистый
  // reasoning_effort: "high" (OpenAI-style), который LiteLLM понимает.
  // Thinking-карточка в UI рендерится из reasoning_content дельт, а не из
  // catalog-capability, поэтому визуально ничего не теряется.
  //
  // Without any knownModels entry, capabilities stay undefined and
  // shouldEmitAnthropicReasoning treats that as "emit Anthropic thinking" —
  // which is exactly the LiteLLM 400 path above. Passing capabilities:["tools"]
  // (no "reasoning") forces the portable OpenAI-style path instead.
  const modelEntry: ClineKnownModelInfo = {
    id: modelId,
    name: stored?.label || modelId,
    ...(Number.isFinite(contextWindow) && contextWindow > 0
      ? {
          contextWindow,
          maxInputTokens: contextWindow,
        }
      : {}),
    ...(maxOutputTokens ? { maxTokens: maxOutputTokens } : {}),
    capabilities,
  };
  return {
    knownModels: {
      [modelId]: modelEntry,
    },
    ...(maxOutputTokens ? { maxTokensPerTurn: maxOutputTokens } : {}),
  };
}

type ClineBundle = {
  ClineCore: {
    create: (options: Record<string, unknown>) => Promise<ClineCoreInstance>;
  };
  createTool: ClineCreateTool;
  createMcpTools: ClineCreateMcpTools;
  createToolPoliciesWithPreset: (
    preset: "default" | "yolo"
  ) => Record<string, unknown>;
  createUserInstructionConfigService: (options: {
    skills?: {
      directories?: string[];
      workspacePath?: string;
      includePluginSkills?: boolean;
    };
    rules?: { directories?: string[]; workspacePath?: string };
    workflows?: { directories?: string[]; workspacePath?: string };
  }) => {
    start: () => Promise<void>;
    hasConfiguredSkills: (allowed?: ReadonlyArray<string>) => boolean;
  };
  getClineDefaultSystemPrompt: (options: {
    /** Host-specific rules injected into {{CLINE_RULES}} (keeps the base prompt). */
    rules?: string;
    /** Full override — replaces the entire base prompt. Avoid when possible. */
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
      // Cline's "default" preset is `{}` and treats missing autoApprove as
      // allow. Harbor always emits explicit policies so requestToolApproval
      // runs for groups the user wants to confirm.
      toolPolicies: harborClineToolPolicies(),
      capabilities: {
        requestToolApproval: async (request: {
          toolName?: string;
          input?: unknown;
        }) => requestHarborToolApproval(request),
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
          const inspectImages = createInspectImagesTool(
            bundle.createTool,
            plannerModelId
          );
          return {
            ...input,
            config: {
              ...input.config,
              systemPrompt,
              disableMcpSettingsTools: true,
              extraTools: [
                ...priorExtra,
                ...(inspectImages ? [inspectImages] : []),
                ...mcp.tools,
              ],
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
 * Cline's base prompt already renders `{{CWD}}` into a `<env>` block, so this
 * guard normally no-ops (it detects the existing Working Directory line).
 * Kept as a safety net: if a custom user `rules` value somehow lacks cwd, we
 * still stamp it so tools resolve under the open VS Code folder instead of
 * invented sandbox paths like `/home/cline/project`.
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

const MAX_HISTORY_IMAGES = MAX_ATTACHMENTS;
/** data: URL length for a MAX_IMAGE_BYTES payload (base64 + header). */
const MAX_HISTORY_IMAGE_CHARS = Math.ceil(MAX_IMAGE_BYTES * (4 / 3)) + 128;

function isUsableImageDataUrl(url: string | undefined): url is string {
  return Boolean(
    url &&
      url.startsWith("data:image/") &&
      url.length <= MAX_HISTORY_IMAGE_CHARS
  );
}

function imageDedupKey(att: MessageAttachment | undefined, url: string): string {
  return att?.storageKey || att?.id || url.slice(-96);
}

function isImageAttachmentLike(
  att: { kind?: string; mime?: string } | undefined
): boolean {
  if (!att) {
    return false;
  }
  if (att.kind === "image") {
    return true;
  }
  return String(att.mime || "")
    .toLowerCase()
    .startsWith("image/");
}

function harborTurnHasImages(
  history: ChatMessage[],
  current?: MessageAttachment[]
): boolean {
  if ((current || []).some((att) => isImageAttachmentLike(att))) {
    return true;
  }
  for (const msg of history) {
    if (msg.role !== "user") {
      continue;
    }
    if ((msg.attachments || []).some((att) => isImageAttachmentLike(att))) {
      return true;
    }
    if (!Array.isArray(msg.content)) {
      continue;
    }
    if (
      msg.content.some(
        (part) => part && typeof part === "object" && part.type === "image_url"
      )
    ) {
      return true;
    }
  }
  return false;
}

async function pushImageDataUrl(
  att: MessageAttachment | undefined,
  url: string | undefined,
  out: string[],
  seen: Set<string>
): Promise<void> {
  if (!isUsableImageDataUrl(url) || out.length >= MAX_HISTORY_IMAGES) {
    return;
  }
  const key = imageDedupKey(att, url);
  if (seen.has(key) || seen.has(url.slice(-96))) {
    return;
  }
  seen.add(key);
  seen.add(url.slice(-96));
  out.push(url);
}

/**
 * Current-turn images first, then earlier chat attachments.
 * OpenAI-compatible gateways (and Cline compact) often keep pixels only on
 * the latest user message — follow-ups like «что на картинке?» otherwise
 * get no image and the model invents a scene.
 */
async function collectTurnImageDataUrls(
  current: MessageAttachment[] | undefined,
  history: ChatMessage[],
  storageUri: vscode.Uri | undefined
): Promise<{ urls: string[]; fromCurrent: number; fromHistory: number }> {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const att of current || []) {
    if (!isImageAttachmentLike(att)) {
      continue;
    }
    await pushImageDataUrl(
      att,
      await attachmentPreviewDataUrl(att, storageUri),
      urls,
      seen
    );
  }
  const fromCurrent = urls.length;
  for (const msg of history) {
    if (msg.role !== "user") {
      continue;
    }
    for (const att of msg.attachments || []) {
      if (!isImageAttachmentLike(att)) {
        continue;
      }
      await pushImageDataUrl(
        att,
        await attachmentPreviewDataUrl(att, storageUri),
        urls,
        seen
      );
    }
    if (!Array.isArray(msg.content)) {
      continue;
    }
    for (const part of msg.content) {
      if (!part || typeof part !== "object" || part.type !== "image_url") {
        continue;
      }
      await pushImageDataUrl(
        undefined,
        String(part.image_url?.url || "").trim(),
        urls,
        seen
      );
    }
  }
  return {
    urls,
    fromCurrent,
    fromHistory: Math.max(0, urls.length - fromCurrent),
  };
}

function historyVisionNudge(lang: "en" | "ru"): string {
  return lang === "ru"
    ? "К этому сообщению снова приложены изображения из более ранних реплик чата. Если вопрос про картинку — смотри их, не выдумывай другую сцену."
    : "Images from earlier in this conversation are attached again. If the question refers to a picture, use those images; do not invent a different scene.";
}

/** Follow-up like «что на скрине слева?» — not «какая версия у проекта». */
function userQuestionRefersToPriorImages(text: string): boolean {
  return /картинк|изображен|скрин(?:шот)?|вложен|макет|на фото|это фото|аттач|attachments?|screenshots?|mockups?|\bimages?\b|\bpictures?\b|\bphotos?\b|\bdiagrams?\b/i.test(
    String(text || "")
  );
}

const HISTORY_VISION_NUDGE_PREFIX =
  /^(?:К этому сообщению снова приложены изображения[\s\S]*?\n\n|Images from earlier in this conversation are attached again\.[\s\S]*?\n\n)/;

/** Drop per-turn IDE dump from stored Cline user rows so a fork is not 50k+ tokens of app.tsx before the pixels. */
function harborUserTextForClineHistory(text: string): string {
  let s = String(text || "").trim();
  s = s.replace(HISTORY_VISION_NUDGE_PREFIX, "");
  const marker = "[Harbor turn context]";
  const idx = s.indexOf(marker);
  if (idx >= 0) {
    s = s.slice(0, idx).trim();
  }
  return s;
}

function harborUserHadImage(msg: ChatMessage): boolean {
  if ((msg.attachments || []).some((att) => isImageAttachmentLike(att))) {
    return true;
  }
  if (!Array.isArray(msg.content)) {
    return false;
  }
  return msg.content.some(
    (part) => part && typeof part === "object" && part.type === "image_url"
  );
}

function lastHistoryImageAttachments(
  history: ChatMessage[]
): MessageAttachment[] | undefined {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const msg = history[i];
    if (msg?.role !== "user") {
      continue;
    }
    const atts = (msg.attachments || []).filter((att) =>
      isImageAttachmentLike(att)
    );
    if (atts.length) {
      return atts;
    }
  }
  return undefined;
}

/** Cline ImageContent: `{ type:"image", data: rawBase64, mediaType }` — not `{ image: dataUrl }`. */
function clineImageFromDataUrl(
  url: string | undefined
): { type: "image"; mediaType: string; data: string } | undefined {
  const value = String(url || "").trim();
  const match = value.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match?.[1] || !match[2] || !isUsableImageDataUrl(value)) {
    return undefined;
  }
  return { type: "image", mediaType: match[1], data: match[2] };
}

async function clineImageBlocksForHarborUser(
  msg: ChatMessage,
  storageUri: vscode.Uri | undefined
): Promise<Array<{ type: "image"; mediaType: string; data: string }>> {
  const blocks: Array<{ type: "image"; mediaType: string; data: string }> = [];
  const seen = new Set<string>();
  const push = (url: string | undefined) => {
    const block = clineImageFromDataUrl(url);
    if (!block || seen.has(block.data) || blocks.length >= MAX_HISTORY_IMAGES) {
      return;
    }
    seen.add(block.data);
    blocks.push(block);
  };
  for (const att of msg.attachments || []) {
    if (!isImageAttachmentLike(att)) {
      continue;
    }
    push(await attachmentPreviewDataUrl(att, storageUri));
  }
  if (!Array.isArray(msg.content)) {
    return blocks;
  }
  for (const part of msg.content) {
    if (!part || typeof part !== "object" || part.type !== "image_url") {
      continue;
    }
    push(String(part.image_url?.url || "").trim());
  }
  return blocks;
}

async function harborHistoryToClineMessages(
  history: ChatMessage[],
  storageUri?: vscode.Uri
): Promise<ClineHistoryMessage[]> {
  // Put pixels on the original user rows in Cline's ImageContent shape.
  // A fork / model-switch starts a *new* Cline session; without this, GLM
  // only sees images on the latest prompt (often after a huge text dump).
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
    const images =
      msg.role === "user"
        ? await clineImageBlocksForHarborUser(msg, storageUri)
        : [];
    const textForHistory =
      msg.role === "user"
        ? harborUserTextForClineHistory(trimmed) ||
          (images.length || harborUserHadImage(msg) ? "(image)" : "")
        : trimmed;
    if (!textForHistory && !images.length) {
      continue;
    }
    n += 1;
    let content: ClineMessageContent;
    if (msg.role === "assistant" && msg.reasoning_content) {
      content = [
        { type: "thinking", thinking: String(msg.reasoning_content) },
        { type: "text", text: textForHistory },
      ];
    } else if (images.length) {
      content = [...images, { type: "text", text: textForHistory || "(image)" }];
    } else {
      content = textForHistory;
    }
    out.push({
      role: msg.role,
      content,
      id: `harbor-hist-${n}`,
      ts: Date.now() - (history.length - n) * 1000,
    });
  }
  return out;
}

function mergeUserAttachmentsOntoHistory(
  mapped: ChatMessage[],
  prior: ChatMessage[],
  current?: MessageAttachment[]
): ChatMessage[] {
  const priorUsers = prior.filter((m) => m.role === "user");
  const userIndexes = mapped
    .map((m, i) => (m.role === "user" ? i : -1))
    .filter((i) => i >= 0);
  const lastUserIndex = userIndexes[userIndexes.length - 1];
  let u = 0;
  return mapped.map((msg, index) => {
    if (msg.role !== "user") {
      return msg;
    }
    const fromPrior = priorUsers[u]?.attachments;
    u += 1;
    const atts =
      index === lastUserIndex && current?.length ? current : fromPrior;
    if (!atts?.length) {
      return msg;
    }
    return {
      ...msg,
      attachments: atts.map((a) => stripAttachmentPayload(a)),
    };
  });
}

function clineContentHasImages(content: ClineMessageContent | undefined): boolean {
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((part) => {
    if (!part || typeof part !== "object") {
      return false;
    }
    return part.type === "image" || part.type === "image_url";
  });
}

function clineMessagesToHarborHistory(
  messages: readonly ClineHistoryMessage[]
): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      const text = textFromMessageContent(msg.content).trim();
      if (text || clineContentHasImages(msg.content)) {
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
 * spawn_agent returns `{ finishReason: "error", text }` the same soft way.
 */
function toolOutputIsSoftFail(output: unknown): boolean {
  if (!output || typeof output !== "object") {
    return false;
  }
  const row = output as { success?: unknown; finishReason?: unknown };
  if (row.success === false) {
    return true;
  }
  return String(row.finishReason || "").trim() === "error";
}

function errorMessageFromToolOutput(output: unknown): string {
  if (!output || typeof output !== "object") {
    return "";
  }
  const row = output as { error?: unknown; text?: unknown; finishReason?: unknown };
  const err = row.error;
  if (typeof err === "string" && err.trim()) {
    return err.trim();
  }
  if (String(row.finishReason || "").trim() === "error") {
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (text) {
      return text;
    }
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
function shortSpawnErrorMessage(text: string): string {
  const raw = String(text || "").trim();
  if (!raw) {
    return "";
  }
  const msgMatch = raw.match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (msgMatch) {
    return msgMatch[1]
      .replace(/\\"/g, '"')
      .replace(/\\n/g, " ")
      .trim()
      .slice(0, 140);
  }
  const codeMatch = raw.match(/"code"\s*:\s*"([^"]+)"/);
  if (codeMatch) {
    return codeMatch[1].trim();
  }
  const first = raw
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  return String(first || raw)
    .replace(/^litellm\.\w+:\s*/i, "")
    .replace(/^APIError:\s*/i, "")
    .slice(0, 140);
}

function spawnAgentResultPreview(
  toolName: string,
  output: unknown,
  errMsg: string
): string {
  if (errMsg) {
    return shortSpawnErrorMessage(errMsg) || previewJson(errMsg, 240);
  }
  if (toolName === "spawn_agent" && output && typeof output === "object") {
    const row = output as {
      text?: unknown;
      finishReason?: unknown;
    };
    const finish = String(row.finishReason || "").trim();
    const text = String(row.text || "").trim();
    if (finish === "error" && text) {
      return shortSpawnErrorMessage(text) || text.slice(0, 140);
    }
    if (text) {
      return text.length > 240 ? `${text.slice(0, 237)}...` : text;
    }
  }
  return previewJson(output, 240);
}

type ToolResultRow = {
  query?: unknown;
  result?: unknown;
  error?: unknown;
  success?: unknown;
};

/** Normalize a Cline tool output into a row array (read_files/run_commands/…). */
function asToolResultRows(output: unknown): ToolResultRow[] {
  if (Array.isArray(output)) {
    return output.filter(
      (r): r is ToolResultRow => !!r && typeof r === "object"
    );
  }
  if (output && typeof output === "object") {
    return [output as ToolResultRow];
  }
  return [];
}

/** Extract a short tail (first ~3 non-empty lines) from a string. */
function firstLines(value: unknown, max = 3): string {
  const text = typeof value === "string" ? value : "";
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(0, max).join(" · ");
}

/**
 * Extract structured per-tool metrics from a Cline tool result + input so the
 * webview can render precise one-line labels (paths, match counts, exit codes)
 * without re-parsing opaque resultPreview JSON.
 *
 * Handles current Cline tool names: read_files, search_codebase, run_commands,
 * editor, apply_patch. Returns undefined for tools with no useful metrics.
 */
function parseToolMetrics(
  toolName: string,
  output: unknown,
  input: unknown
): ToolStepMetrics | undefined {
  const name = String(toolName || "").trim();
  const inputObj =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  if (name === "read_files") {
    const rows = asToolResultRows(output);
    const files: string[] = [];
    let lines = 0;
    for (const r of rows) {
      const q = String(r.query || "").trim();
      // query is "<path>" or "<path>:<start>-<end>"; strip the range suffix.
      const path = q.split(":")[0].trim();
      if (path) {
        files.push(path);
      }
      const resultText = typeof r.result === "string" ? r.result : "";
      if (resultText) {
        lines += resultText.split("\n").length;
      }
    }
    // Fallback to input file list when output rows have no query paths.
    if (!files.length) {
      const fromInput = collectInputPaths(inputObj);
      files.push(...fromInput);
    }
    return {
      ...(files.length ? { files } : {}),
      ...(lines > 0 ? { lines } : {}),
    };
  }

  if (name === "search_codebase") {
    const rows = asToolResultRows(output);
    let matches = 0;
    for (const r of rows) {
      const text = typeof r.result === "string" ? r.result : "";
      // Cline search formatter: "Found N results for pattern: <q>".
      const m = text.match(/Found\s+(\d+)\s+results?/i);
      if (m) {
        matches += Number(m[1] || 0);
      }
    }
    return matches > 0 ? { matches } : undefined;
  }

  if (name === "run_commands") {
    const rows = asToolResultRows(output);
    let exitCode: number | undefined;
    let errorOut = "";
    for (const r of rows) {
      if (r.success === false) {
        const errText = typeof r.error === "string" ? r.error : "";
        const codeMatch = errText.match(/code\s+(\d+)/i);
        if (codeMatch && exitCode === undefined) {
          exitCode = Number(codeMatch[1]);
        }
        if (!errorOut) {
          errorOut = firstLines(r.result, 2) || firstLines(errText, 2);
        }
      }
    }
    if (exitCode !== undefined || errorOut) {
      return {
        ...(exitCode !== undefined ? { exitCode } : {}),
        ...(errorOut ? { errorOut } : {}),
      };
    }
    return undefined;
  }

  if (name === "editor") {
    const filePath = pathFromToolInput(inputObj);
    // create vs replace: editor creates when there is no old_text and no insert_line.
    const hasOldText =
      typeof inputObj.old_text === "string" && inputObj.old_text.length > 0;
    const hasInsertLine = inputObj.insert_line !== undefined && inputObj.insert_line !== null;
    const created = !hasOldText && !hasInsertLine;
    return {
      ...(filePath ? { files: [filePath] } : {}),
      created,
    };
  }

  if (name === "apply_patch") {
    return undefined;
  }

  return undefined;
}

/** Collect file paths from common read_files input shapes. */
function collectInputPaths(input: Record<string, unknown>): string[] {
  const out: string[] = [];
  const pushPath = (v: unknown) => {
    if (typeof v === "string" && v.trim()) {
      out.push(v.trim());
    } else if (v && typeof v === "object") {
      const p = (v as Record<string, unknown>).path;
      if (typeof p === "string" && p.trim()) {
        out.push(p.trim());
      }
    }
  };
  for (const key of ["files", "paths", "file_paths"]) {
    const v = input[key];
    if (Array.isArray(v)) {
      v.forEach(pushPath);
    } else if (v !== undefined) {
      pushPath(v);
    }
  }
  return out;
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

function clineSessionFingerprint(parts: {
  mode: string;
  model: string;
  cwd: string;
  spawn: boolean;
  parallel: number;
  compact: boolean;
  reasoning: string;
  mcp: string;
  approvals: string;
  checkpoints: boolean;
}): string {
  return [
    parts.mode,
    parts.model,
    parts.cwd,
    parts.spawn ? "1" : "0",
    String(parts.parallel),
    parts.compact ? "1" : "0",
    parts.reasoning,
    parts.mcp,
    parts.approvals,
    parts.checkpoints ? "1" : "0",
  ].join("|");
}

function isUnusableClineSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /session_not_found|session_run_in_progress|Session not found/i.test(
    message
  );
}

async function stopLiveClineSession(live: LiveClineChat): Promise<void> {
  try {
    const bundle = loadClineBundle();
    const core = await getClineCore(bundle);
    await core.abort(live.sessionId, "harbor-discard").catch(() => {
      /* ignore */
    });
    await core.stop(live.sessionId);
  } catch {
    /* already gone */
  }
}

/** Drop the live Cline session for a Harbor chat (regenerate / edit / delete). */
export async function discardClineChatSession(
  chatId: string
): Promise<void> {
  const id = String(chatId || "").trim();
  if (!id) {
    return;
  }
  clearIdleEvictTimer(id);
  const live = liveClineByChatId.get(id);
  if (!live) {
    return;
  }
  liveClineByChatId.delete(id);
  await stopLiveClineSession(live);
}

export async function discardClineChatSessions(
  chatIds: readonly string[]
): Promise<void> {
  for (const chatId of chatIds) {
    await discardClineChatSession(chatId);
  }
}

export async function discardAllClineChatSessions(): Promise<void> {
  clearAllIdleEvictTimers();
  const ids = [...liveClineByChatId.keys()];
  await discardClineChatSessions(ids);
}

/** Keep the live session (chat is viewed or about to run). */
export function retainClineChatSession(chatId: string | undefined): void {
  const id = String(chatId || "").trim();
  if (!id) {
    return;
  }
  clearIdleEvictTimer(id);
}

/**
 * Stop the Cline session after idle if the chat is not retained again.
 * No-op when there is no live session.
 */
export function scheduleClineChatIdleEvict(
  chatId: string | undefined,
  delayMs: number = CLINE_SESSION_IDLE_EVICT_MS
): void {
  const id = String(chatId || "").trim();
  if (!id || !liveClineByChatId.has(id)) {
    return;
  }
  clearIdleEvictTimer(id);
  const wait = Math.max(0, Math.floor(delayMs));
  const timer = setTimeout(() => {
    idleEvictTimers.delete(id);
    void discardClineChatSession(id);
  }, wait);
  const nodeTimer = timer as NodeJS.Timeout;
  if (typeof nodeTimer.unref === "function") {
    nodeTimer.unref();
  }
  idleEvictTimers.set(id, timer);
}

/**
 * User left `previousChatId` for `nextChatId`. Idle-evict the previous
 * session unless a turn is still running there (host schedules after the run).
 */
export function onClineActiveChatChanged(input: {
  previousChatId?: string;
  nextChatId?: string;
  previousStillRunning?: boolean;
}): void {
  const prev = String(input.previousChatId || "").trim();
  const next = String(input.nextChatId || "").trim();
  if (prev && prev !== next) {
    if (!input.previousStillRunning) {
      scheduleClineChatIdleEvict(prev);
    }
  }
  if (next) {
    retainClineChatSession(next);
  }
}

/** Restore workspace files from a Cline checkpoint for this Harbor chat. */
export async function restoreClineChatCheckpoint(
  chatId: string,
  options?: { checkpointRunCount?: number }
): Promise<{ ok: boolean; error?: string }> {
  const id = String(chatId || "").trim();
  retainClineChatSession(id);
  const live = id ? liveClineByChatId.get(id) : undefined;
  if (!live?.sessionId) {
    return { ok: false, error: "No live session checkpoint" };
  }
  const runCount =
    Number(options?.checkpointRunCount) > 0
      ? Number(options?.checkpointRunCount)
      : live.lastCheckpointRunCount;
  if (!runCount) {
    return { ok: false, error: "No checkpoint yet in this chat" };
  }
  try {
    const bundle = loadClineBundle();
    const core = await getClineCore(bundle);
    if (typeof core.restore !== "function") {
      return { ok: false, error: "Checkpoints are not available in this runtime" };
    }
    await core.restore({
      sessionId: live.sessionId,
      checkpointRunCount: runCount,
      cwd: workspaceCwd(),
      restore: { messages: false, workspace: true },
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

/**
 * Compare a Cline checkpoint against the current workspace: returns per-file
 * content diffs (checkpoint snapshot on the left, worktree on the right).
 */
export async function compareClineChatCheckpoint(
  chatId: string,
  options?: { checkpointRunCount?: number }
): Promise<{
  ok: boolean;
  diffs?: Array<{ filePath: string; leftContent: string; rightContent: string }>;
  error?: string;
}> {
  const id = String(chatId || "").trim();
  retainClineChatSession(id);
  const live = id ? liveClineByChatId.get(id) : undefined;
  if (!live?.sessionId) {
    return { ok: false, error: "No live session checkpoint" };
  }
  const runCount =
    Number(options?.checkpointRunCount) > 0
      ? Number(options?.checkpointRunCount)
      : live.lastCheckpointRunCount;
  if (!runCount) {
    return { ok: false, error: "No checkpoint yet in this chat" };
  }
  try {
    const bundle = loadClineBundle();
    const core = await getClineCore(bundle);
    if (typeof core.compareCheckpoint !== "function") {
      return { ok: false, error: "Checkpoint compare is not available in this runtime" };
    }
    const result = await core.compareCheckpoint({
      sessionId: live.sessionId,
      checkpointRunCount: runCount,
      cwd: workspaceCwd(),
    });
    return { ok: true, diffs: result.diffs || [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

/** Extension shutdown: stop chats and dispose the shared ClineCore host. */
export async function disposeClineRuntime(): Promise<void> {
  await discardAllClineChatSessions();
  const pending = corePromise;
  corePromise = undefined;
  if (!pending) {
    return;
  }
  try {
    const core = await pending;
    await core.dispose?.();
  } catch {
    /* ignore */
  }
}

/**
 * Build a `providerConfig` for ClineCore `start` that surfaces upstream 4xx/5xx
 * bodies. Without this, openai-compatible / LiteLLM/OpenRouter rejections arrive
 * as bare "Request failed with status code 400" and the real cause is invisible —
 * especially painful for spawn_agent children.
 */
function buildHarborProviderConfig(modelInfo?: ClineKnownModelInfo): {
  providerId: string;
  fetch: typeof fetch;
  modelInfo?: ClineKnownModelInfo;
  knownModels?: Record<string, ClineKnownModelInfo>;
  options: {
    onResponseError: (response: {
      status: number;
      clone: () => { text: () => Promise<string> };
    }) => Promise<void>;
  };
} {
  return {
    providerId: "openai-compatible",
    fetch: harborFetch as typeof fetch,
    ...(modelInfo
      ? {
          modelInfo,
          knownModels: { [modelInfo.id]: modelInfo },
        }
      : {}),
    options: {
      onResponseError: async (response) => {
        if (response.status < 400) {
          return;
        }
        let body = "";
        try {
          body = await response.clone().text();
        } catch {
          /* body already consumed / unreadable — leave empty */
        }
        const trimmed = String(body || "").trim();
        const snippet =
          trimmed.length > 4000 ? `${trimmed.slice(0, 3997)}...` : trimmed;
        const suffix = snippet ? `: ${snippet}` : "";
        throw new Error(`upstream ${response.status}${suffix}`);
      },
    },
  };
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
  /** Stable Harbor chat id — keeps one Cline session across turns. */
  chatId?: string;
  /** Regenerate / edit: drop the live session and re-seed from history. */
  resetSession?: boolean;
}): Promise<ChatMessage[]> {
  const { callbacks } = options;
  const bundle = loadClineBundle();
  const config = getConfig();
  // Cline uses fetch — honor Advanced → Validate TLS (default off).
  applyHarborTlsPolicy(config.rejectUnauthorized);
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

  // Harbor-specific guidance rides in the rules slot so Cline's base prompt
  // (parallelism, plan/act tags, verify-after-edit, gather-context-first)
  // stays intact instead of being replaced wholesale.
  const uiLang = resolveUiLanguage(getConfig().language);
  const enableSpawnAgent = config.subagents.enabled !== false;
  /** update_todo plan card — Agent/Plan only (Ask is Q&A, not multi-step work). */
  const harborModeId = String(options.agentMode || "agent").toLowerCase();
  const enableTodoTool = harborModeId !== "ask";
  // built-in / legacy defaults are full prompts (with env block) that would
  // duplicate Cline's base — swap them for the compact rules-only form.
  const customRules = isBuiltinSystemPrompt(config.systemPrompt)
    ? harborDefaultRulesForLanguage(uiLang)
    : String(config.systemPrompt || "").trim();
  const modeDef = getModeById(options.agentMode);
  const modePrompt = String(modeDef.prompt || "").trim();
  const harborRules = [
    customRules,
    // When Parallel agents is on: tool + rules nudge to actually use spawn_agent.
    // When off: no tool (enableSpawnAgent false) and no rules below.
    enableSpawnAgent ? harborSubagentsRulesForLanguage(uiLang) : "",
    // update_todo plan card — registered only for Agent/Plan (see enableTodoTool).
    enableTodoTool ? harborTodoRulesForLanguage(uiLang) : "",
    resolveModelSupportsVision(options.model)
      ? ""
      : harborVisionInspectRulesForLanguage(uiLang),
    // Harbor Plan card: ask models to wrap finales in <proposed_plan> (Ask stays plain).
    String(options.agentMode || "").toLowerCase() === "plan"
      ? HARBOR_PLAN_MODE_CARD_HINT
      : "",
    // Focus chain: checklist rules for Agent/Plan when enabled (Ask is Q&A).
    config.focusChain.enabled !== false &&
    String(options.agentMode || "").toLowerCase() !== "ask"
      ? harborFocusChainRulesForLanguage(uiLang)
      : "",
    // Ask shares Cline's "plan" mode under the hood (see mapHarborModeToCline),
    // so Cline's base prompt always says "Plan mode" / "toggle to Act mode".
    // Override that framing so the model calls itself "Ask" to the user.
    String(options.agentMode || "").toLowerCase() === "ask"
      ? harborAskModeRulesForLanguage(uiLang)
      : "",
    modePrompt
      ? `# Mode: ${modeDef.label || modeDef.id}\n${modePrompt}`
      : "",
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n\n");

  const baseSystemPrompt = ensureHarborWorkspaceEnv(
    bundle.getClineDefaultSystemPrompt({
      rules: harborRules,
      ide: "VS Code",
      mode: clineMode,
      workspaceRoot: cwd,
      providerId: "openai-compatible",
      workspaceName: path.basename(cwd),
      platform: process.platform,
      planModeSwitchTool: false,
    }),
    cwd
  );

  const core = await getClineCore(bundle);
  const enableParallelToolCalls = config.parallelToolCalls.enabled !== false;
  const enableAutoCompact = config.autoCompact.enabled !== false;
  const enableCheckpoints = config.checkpoints.enabled !== false;
  /** Default matches Cline AgentConfigSchema (8 → parallel). */
  const maxParallelToolCalls = enableParallelToolCalls ? 8 : 1;
  const chatId = String(options.chatId || "").trim();
  const persistSession = Boolean(chatId);
  const reasoningKey = resolveModelSupportsReasoningEffort(options.model)
    ? String(
        options.reasoningEffort || resolveModelReasoningEffort(options.model) || ""
      )
    : "";
  const mcpFingerprint = await harborMcpToolFingerprint(clineMode === "plan");
  const fingerprint = clineSessionFingerprint({
    mode: String(options.agentMode || "agent").toLowerCase(),
    model: options.model,
    cwd,
    spawn: enableSpawnAgent,
    parallel: maxParallelToolCalls,
    compact: enableAutoCompact,
    reasoning: reasoningKey,
    mcp: mcpFingerprint,
    approvals: harborToolApprovalsFingerprint(),
    checkpoints: enableCheckpoints,
  });

  if (persistSession && options.resetSession) {
    await discardClineChatSession(chatId);
  }
  let live = persistSession ? liveClineByChatId.get(chatId) : undefined;
  if (live && live.fingerprint !== fingerprint) {
    liveClineByChatId.delete(chatId);
    await stopLiveClineSession(live);
    live = undefined;
  }
  let sessionId = live?.sessionId || newSessionId();
  let reusedSession = Boolean(live);

  const edits: FileEditStat[] = [];
  let assistantText = "";
  let reasoningText = "";
  let submitSummary = "";
  let stepSeq = 0;
  let turnCheckpointRunCount: number | undefined;
  const toolInputs = new Map<string, unknown>();
  /** Sum turn deltas so parent + forwarded child usage both count. */
  let usagePromptTokens = 0;
  let usageCompletionTokens = 0;

  /**
   * Surface non-lifecycle Cline notices as Harbor phase "cline".
   * Skip generic session lifecycle strings (running / completed / …) — the
   * webview timeline already shows busy progress; those labels only duplicated
   * «running (model)» under «Читаю…».
   */
  const setClineStatus = (status: string) => {
    const text = String(status || "").trim();
    if (!text) {
      return;
    }
    if (
      /^(running|completed|cancelled|canceled|aborted|failed|error|idle|success)$/i.test(
        text
      )
    ) {
      return;
    }
    callbacks.onPhase("cline", text);
  };

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
          // update_todo renders as the dedicated plan card (emitted by the
          // tool's execute) — skip the generic tool row to avoid duplicates.
          if (name === TODO_TOOL) {
            break;
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
          const metrics = parseToolMetrics(name, event.output, input);
          if (name === TODO_TOOL) {
            // Plan card is rendered from the execute-side event; on failure
            // surface the error there instead of a duplicate tool row.
            if (failed) {
              emitStep(callbacks, {
                stepId: TODO_STEP_ID,
                kind: "todo",
                name: TODO_TOOL,
                status: "error",
                resultPreview: errMsg.slice(0, 200),
              });
            }
            break;
          }
          emitStep(callbacks, {
            stepId: toolCallId,
            kind: "tool",
            toolCallId,
            name,
            argsPreview: previewJson(input),
            status: failed ? "error" : "done",
            resultPreview: spawnAgentResultPreview(name, event.output, errMsg),
            ...(metrics ? { metrics } : {}),
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
        // inputTokens/outputTokens are per-API-call deltas (just this
        // iteration's tokens).  totalInputTokens/totalOutputTokens are
        // cumulative sums across all iterations — useful for billing but
        // NOT for context-window fill (which is what the UI ring shows).
        // Use the latest delta to match what Cline native displays:
        // context-window occupancy of the last API call.
        usagePromptTokens = Number(event.inputTokens ?? 0);
        usageCompletionTokens = Number(event.outputTokens ?? 0);
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
        if (
          /checkpoint/i.test(noticeReason) ||
          /checkpoint/i.test(String(event.message || ""))
        ) {
          const metaCount = Number(
            event.metadata?.runCount ?? event.metadata?.checkpointRunCount ?? 0
          );
          turnCheckpointRunCount =
            Number.isFinite(metaCount) && metaCount > 0
              ? metaCount
              : (turnCheckpointRunCount || live?.lastCheckpointRunCount || 0) +
                1;
          if (persistSession) {
            const row = liveClineByChatId.get(chatId);
            if (row) {
              row.lastCheckpointRunCount = turnCheckpointRunCount;
            }
          }
          stepSeq += 1;
          emitStep(callbacks, {
            stepId: `checkpoint-${stepSeq}`,
            kind: "checkpoint",
            text: "Workspace checkpoint saved — click to restore files",
            checkpointRunCount: turnCheckpointRunCount,
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

  const imageBundle = await collectTurnImageDataUrls(
    options.attachments,
    options.history,
    options.storageUri
  );
  const currentImageUrls = imageBundle.urls.slice(0, imageBundle.fromCurrent);
  const currentHasImage = currentImageUrls.length > 0;
  let userImages = imageBundle.urls;
  const chatSeesImages = resolveModelSupportsVision(options.model);

  let userPrompt = String(options.userText || "").trim();
  const inlined = await buildInlinedAttachmentsPrompt(
    options.userText,
    options.attachments
  );
  if (inlined.text) {
    userPrompt = userPrompt
      ? `${userPrompt}\n\n${inlined.text}`
      : inlined.text;
  }
  // Special @problems / @terminal / @url mentions inject live snapshots.
  const specialMentions = await buildSpecialMentionsPrompt(
    String(options.userText || "")
  );
  if (specialMentions) {
    userPrompt = userPrompt
      ? `${userPrompt}\n\n${specialMentions}`
      : specialMentions;
  }
  // Do not skip IDE context just because an earlier turn had a screenshot.
  const turnContext =
    currentHasImage
      ? ""
      : await buildTurnContextBlock({
          skipActiveFilePrefetch: activeFileAlreadyInlined(inlined.paths),
          lastAgentEditedPaths: options.lastAgentEditedPaths,
        });
  if (turnContext) {
    userPrompt = userPrompt
      ? `${userPrompt}\n\n${turnContext}`
      : turnContext;
  }
  // Focus chain: re-inject the latest assistant checklist on follow-up turns.
  if (config.focusChain.enabled !== false && options.history?.length) {
    const focusChain = buildFocusChainBlock(options.history);
    if (focusChain) {
      userPrompt = userPrompt
        ? `${userPrompt}\n\n${focusChain}`
        : focusChain;
    }
  }
  if (!userPrompt) {
    userPrompt = "Look at the attached image(s) and answer.";
  }
  if (!chatSeesImages) {
    const describeHistoryFollowUp =
      !currentHasImage &&
      imageBundle.fromHistory > 0 &&
      userQuestionRefersToPriorImages(String(options.userText || ""));
    const describeUrls = currentHasImage
      ? currentImageUrls
      : describeHistoryFollowUp
        ? imageBundle.urls
        : [];
    if (describeUrls.length) {
      emitStep(callbacks, {
        stepId: "vision-helper",
        kind: "tool",
        name: "vision",
        status: "running",
        argsPreview: options.model,
      });
      try {
        const helper = await describeChatImagesForMainModel({
          imageDataUrls: describeUrls,
          userQuestion: String(options.userText || "").trim(),
          chatModelId: options.model,
          signal: options.signal,
        });
        emitStep(callbacks, {
          stepId: "vision-helper",
          kind: "tool",
          name: "vision",
          status: helper.text ? "done" : "error",
          argsPreview: helper.visionModelId || options.model,
          resultPreview: (helper.text || "").slice(0, 400),
        });
        if (helper.text) {
          userPrompt = `${helper.text}\n\n${userPrompt}`;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emitStep(callbacks, {
          stepId: "vision-helper",
          kind: "tool",
          name: "vision",
          status: "error",
          resultPreview: message.slice(0, 400),
        });
      }
    }
    // Text model cannot use pixels; sending them only makes it deny the image.
    userImages = [];
  }
  userPrompt = appendFigmaRuntimeNudge(userPrompt);
  // update_todo plan card — build it at the very start of every Agent/Plan turn.
  userPrompt = appendTodoRuntimeNudge(userPrompt, enableTodoTool, uiLang);
  userPrompt = appendSubagentsRuntimeNudge(
    userPrompt,
    enableSpawnAgent,
    uiLang
  );
  userPrompt = appendVisionInspectRuntimeNudge(
    userPrompt,
    !chatSeesImages && imageBundle.urls.length > 0,
    uiLang
  );
  if (
    chatSeesImages &&
    imageBundle.fromHistory > 0 &&
    !currentHasImage
  ) {
    userPrompt = `${historyVisionNudge(uiLang)}\n\n${userPrompt}`;
  }

  const initialMessages = await harborHistoryToClineMessages(
    options.history,
    options.storageUri
  );

  const reasoningOptions = resolveModelSupportsReasoningEffort(options.model)
    ? toClineReasoningOptions(
        options.reasoningEffort || resolveModelReasoningEffort(options.model)
      )
    : {};

  // Resolve real context window / max output so Cline budgets auto-compact and
  // output caps against the model's actual limits instead of a blind default.
  const modelInfoData = buildClineModelInfo(options.model);
  // Harbor always sends capabilities:["tools"] (so Cline does not emit
  // Anthropic-shaped thinking). Missing "images" then fail-closes: Cline
  // replaces pixels with "[Image attached — this model cannot view images]".
  // Advertise image input only when this chat model can actually view pixels.
  // GLM-5.2 is text-only: sending `"images"` makes Cline attach bytes the
  // model ignores, then it answers «не вижу картинку».
  if (
    chatSeesImages &&
    (userImages.length ||
      harborTurnHasImages(options.history, options.attachments))
  ) {
    const entry = modelInfoData.knownModels[options.model];
    if (entry && !entry.capabilities?.includes("images")) {
      entry.capabilities = [...(entry.capabilities || ["tools"]), "images"];
    }
  }

  const skillsConfig = config.skills;
  const hasSkillsFactory =
    typeof bundle.createUserInstructionConfigService === "function";
  // Without the factory we cannot pin directories to Harbor roots — keep skills
  // off rather than falling back to Cline's .agents/.cline auto-scan.
  const skillsMasterEnabled =
    skillsConfig.enabled !== false && hasSkillsFactory;
  const skillDirs = resolveSkillDirectories(cwd, skillsConfig);
  const skillAllowlist = skillsMasterEnabled
    ? enabledSkillNames(cwd, skillsConfig)
    : [];
  // Keep rules/workflows/plugins; drop skills when master toggle is off so
  // Cline does not register use_skill / scan default .agents/.cline paths.
  const configExtensions = skillsMasterEnabled
    ? (["rules", "skills", "workflows", "plugins"] as const)
    : (["rules", "workflows", "plugins"] as const);
  const userInstructionService = hasSkillsFactory
    ? bundle.createUserInstructionConfigService({
        skills: {
          directories: skillDirs,
          includePluginSkills: false,
        },
        rules: { workspacePath: cwd },
        workflows: { workspacePath: cwd },
      })
    : undefined;

  try {
    let result: ClineStartResult["result"];
    const runTurn = async (): Promise<void> => {
      if (reusedSession) {
        try {
          result = await core.send({
            sessionId,
            prompt: userPrompt,
            ...(userImages.length ? { userImages } : {}),
            mode: clineMode,
          });
        } catch (error) {
          if (options.signal?.aborted || !isUnusableClineSessionError(error)) {
            throw error;
          }
          liveClineByChatId.delete(chatId);
          reusedSession = false;
          sessionId = newSessionId();
        }
      }

      if (!reusedSession) {
        const startResult = await core.start({
          source: "vscode",
          interactive: persistSession,
          prompt: userPrompt,
          ...(userImages.length ? { userImages } : {}),
          ...(initialMessages.length ? { initialMessages } : {}),
        ...(userInstructionService
          ? {
              localRuntime: {
                userInstructionService,
                configExtensions: [...configExtensions],
              },
            }
          : {
              localRuntime: {
                configExtensions: [...configExtensions],
              },
            }),
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
          enableAgentTeams: true,
          disableMcpSettingsTools: true,
          maxParallelToolCalls,
          // Harbor plan card (Cline focus_chain analog) — Agent/Plan only.
          ...(enableTodoTool
            ? { extraTools: [createTodoTool(bundle.createTool)] }
            : {}),
          // TLS: pass Harbor fetch so corporate self-signed proxies work when
          // Advanced → Validate TLS is off (default).
          fetch: harborFetch as typeof fetch,
          ...(enableAutoCompact
            ? {
                compaction: {
                  enabled: true,
                  strategy: "agentic" as const,
                },
              }
            : {}),
          ...(enableCheckpoints ? { checkpoint: { enabled: true } } : {}),
          toolPolicies: harborClineToolPolicies(),
          // Iteration budget: leave unset so Cline treats it as unlimited
          // (Harbor maxToolRounds no longer caps the turn).
          systemPrompt: baseSystemPrompt,
          ...(skillsMasterEnabled && skillAllowlist.length
            ? { skills: skillAllowlist }
            : skillsMasterEnabled
              ? { skills: [] as string[] }
              : {}),
          ...reasoningOptions,
          ...modelInfoData,
          // Surface upstream 4xx/5xx bodies (LiteLLM/OpenRouter) instead of bare
          // "Request failed with status code N" — critical for spawn_agent children.
          providerConfig: buildHarborProviderConfig(
            modelInfoData.knownModels[options.model]
          ),
        },
      });
      sessionId = String(startResult.sessionId || sessionId);
      result = startResult.result;
    }
    };
    await withInspectableImages(imageBundle.urls, () =>
      // update_todo executes inside the Cline session; bridge its step events
      // to this turn's Harbor callbacks (ALS, same as inspect_images).
      withTodoStepEmitter(
        (step) => emitStep(callbacks, step),
        () => withTurnImages(userImages, runTurn)
      )
    );

    if (persistSession) {
      const prev = liveClineByChatId.get(chatId);
      liveClineByChatId.set(chatId, {
        sessionId,
        fingerprint,
        lastCheckpointRunCount:
          turnCheckpointRunCount ?? prev?.lastCheckpointRunCount,
      });
    }

    unsubscribe();
    options.signal?.removeEventListener("abort", onAbort);

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

    const attachmentsForHistory =
      options.attachments?.length
        ? options.attachments
        : lastHistoryImageAttachments(options.history);

    if (result?.messages?.length) {
      return mergeUserAttachmentsOntoHistory(
        clineMessagesToHarborHistory(result.messages),
        options.history,
        attachmentsForHistory
      );
    }
    return mergeUserAttachmentsOntoHistory(
      [
        ...options.history,
        { role: "user", content: userPrompt },
        {
          role: "assistant",
          content: finalText,
          ...(reasoningText ? { reasoning_content: reasoningText } : {}),
        },
      ],
      options.history,
      attachmentsForHistory
    );
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
    if (!persistSession) {
      try {
        await core.stop(sessionId);
      } catch {
        /* session may already be finalized */
      }
    }
  }
}
