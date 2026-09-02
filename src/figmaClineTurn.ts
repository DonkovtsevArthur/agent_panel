/**
 * Slim Cline turn for the Figma host (no IDE workspace tools).
 * Loads out/clineBundle.js and runs ClineCore with canvas extraTools.
 *
 * Like VS Code: one Harbor Figma chat → one interactive Cline session so
 * follow-ups ("delete that column") reuse prior tool results / node ids.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import {
  createHarborNoopTelemetry,
  HARBOR_CLINE_DISTINCT_ID,
} from "./clineNoopTelemetry";
import {
  buildSelectionContextText,
  createFigmaCanvasExtraTools,
  designSystemPrompt,
  designSystemPromptFollowUp,
  figmaClineToolPolicies,
  type FigmaToolRpc,
} from "./figmaCanvasTools";
import { buildFigmaUserInstructionService } from "./figmaSkills";
import { expandUserSlashCommand } from "./harborCommands";
import {
  resolveModelCapabilities,
  resolveModelContextWindow,
  resolveModelRequestMaxTokens,
} from "./modelCapabilities";
import { harborFetch } from "./tlsPolicy";
import { wrapFetchForMiMoCompat } from "./mimoOpenAiCompat";

type ClineMode = "act" | "plan";

type ClineAgentEvent = {
  type?: string;
  contentType?: string;
  text?: string;
  reasoning?: string;
  accumulated?: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  status?: string;
  error?: unknown;
  reason?: string;
};

type AgentTurnResult = {
  finishReason?: string;
  text?: string;
  toolCalls?: unknown[];
};

function countTurnToolCalls(turnResult: AgentTurnResult | undefined): number {
  return Array.isArray(turnResult?.toolCalls) ? turnResult.toolCalls.length : 0;
}

function agentEventErrorMessage(event: ClineAgentEvent): string {
  const err = event.error;
  if (typeof err === "string" && err.trim()) {
    return err.trim();
  }
  if (err instanceof Error && err.message.trim()) {
    return err.message.trim();
  }
  if (typeof event.text === "string" && event.text.trim()) {
    return event.text.trim();
  }
  return "Model turn failed";
}

function mergeAssistantFromTurnResult(
  assistantText: string,
  turnResult: AgentTurnResult | undefined
): string {
  const fromResult = String(turnResult?.text || "").trim();
  if (!fromResult) {
    return assistantText;
  }
  if (!assistantText.trim()) {
    return fromResult;
  }
  if (assistantText.includes(fromResult)) {
    return assistantText;
  }
  return assistantText;
}

/** Cline can finish with status failed and no streamed text — surface that to UI. */
function resolveSilentTurnFailure(input: {
  assistantText: string;
  lastStatus: string;
  turnError: string;
  turnResult?: AgentTurnResult;
  canvasToolSteps: number;
  clineToolSteps: number;
}): string | undefined {
  if (input.assistantText.trim()) {
    return undefined;
  }
  if (input.turnError.trim()) {
    return input.turnError.trim();
  }
  if (input.turnResult?.finishReason === "error") {
    const fromResult = String(input.turnResult.text || "").trim();
    return (
      fromResult ||
      "Model turn failed — check Settings → provider (base URL, API key, model)."
    );
  }
  if (input.lastStatus === "failed") {
    return (
      "Turn failed — check Settings → provider (base URL, API key, model). " +
      "If the host was updated: npm run figma:host:ensure, then reload the Figma plugin."
    );
  }
  const toolActivity =
    input.canvasToolSteps +
    input.clineToolSteps +
    countTurnToolCalls(input.turnResult);
  if (toolActivity === 0) {
    const finished =
      input.turnResult?.finishReason === "completed" ||
      input.lastStatus === "completed" ||
      input.lastStatus === "idle" ||
      !input.lastStatus;
    if (finished) {
      return (
        "Model returned an empty response (no text, no tools). " +
        "Try again, pick another model, or verify provider base URL and model id in Settings."
      );
    }
  }
  return undefined;
}

/** MiMo / Xiaomi APIs often reject Cline follow-up turns that carry tool-call history. */
function providerPrefersColdTurns(baseUrl: string, model: string): boolean {
  const blob = `${String(baseUrl || "")} ${String(model || "")}`.toLowerCase();
  return /xiaomi|mimo|xiaomimimo/.test(blob);
}

function resolveFigmaMaxParallelTools(baseUrl: string, model: string): number {
  if (providerPrefersColdTurns(baseUrl, model)) {
    return 1;
  }
  return FIGMA_MAX_PARALLEL_TOOLS;
}

function isLikelyProviderParamError(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (lower === "param incorrect" || lower.includes("param incorrect")) {
    return true;
  }
  if (/invalid parameter|invalid_request|upstream 400\b/.test(lower)) {
    return true;
  }
  return false;
}

function formatProviderParamErrorMessage(model: string, baseUrl: string): string {
  const cold = providerPrefersColdTurns(baseUrl, model);
  const modelHint = String(model || "").trim() || "(model id)";
  let msg =
    `Provider rejected the request ("Param Incorrect"). ` +
    `Check Settings → provider: base URL, API key, and model id (${modelHint}).`;
  if (cold) {
    msg +=
      " MiMo/Xiaomi often needs the exact model slug from the provider docs " +
      "(e.g. mimo-v2.5-pro on the matching token-plan base URL).";
  }
  return msg;
}

type CoreSessionEvent = {
  type?: string;
  payload?: {
    sessionId?: string;
    event?: ClineAgentEvent;
    status?: string;
  };
};

type ClineCoreInstance = {
  start: (input: Record<string, unknown>) => Promise<{
    sessionId?: string;
    result?: unknown;
  }>;
  send: (input: Record<string, unknown>) => Promise<unknown>;
  abort: (sessionId: string, reason?: string) => Promise<unknown>;
  stop: (sessionId: string) => Promise<unknown>;
  subscribe: (listener: (event: CoreSessionEvent) => void) => () => void;
};

type ClineBundle = {
  ClineCore: {
    create: (opts: Record<string, unknown>) => Promise<ClineCoreInstance>;
  };
  createTool: (config: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (input: unknown, context: unknown) => Promise<unknown>;
    timeoutMs?: number;
  }) => unknown;
  getClineDefaultSystemPrompt?: (options: Record<string, unknown>) => string;
  createUserInstructionConfigService?: (options: {
    skills?: { directories: string[]; includePluginSkills?: boolean };
    rules?: { workspacePath: string };
    workflows?: { workspacePath: string };
  }) => unknown;
};

type ClineKnownModelInfo = {
  id: string;
  name: string;
  contextWindow?: number;
  maxInputTokens?: number;
  maxTokens?: number;
  capabilities: string[];
};

export type FigmaTurnEvent =
  | { type: "assistantDelta"; text: string }
  | {
      type: "step";
      stepId: string;
      name: string;
      label?: string;
      status: "running" | "done" | "ok" | "error";
      error?: string;
      durationMs?: number;
    }
  | {
      type: "toolRequest";
      requestId: string;
      name: string;
      args: Record<string, unknown>;
    }
  | { type: "status"; text: string }
  | { type: "timing"; ttftMs?: number; durationMs?: number }
  | { type: "done"; text: string; ttftMs?: number; durationMs?: number }
  | { type: "error"; message: string };

export type FigmaTurnParams = {
  model: string;
  apiKey: string;
  baseUrl: string;
  agentMode?: string;
  userText: string;
  history?: Array<{ role: string; text?: string }>;
  selection?: unknown;
  previewPngDataUrl?: string;
  /** Harbor Figma agent/chat id — enables interactive session reuse. */
  chatId?: string;
  /** Drop the live session and start fresh (e.g. regenerate). */
  resetSession?: boolean;
  /** Model can consume images (userImages). */
  supportsVision?: boolean;
  /**
   * Emit Anthropic-style cache_control markers (LiteLLM / OpenRouter / Anthropic).
   * Off for strict OpenAI endpoints.
   */
  promptCache?: boolean;
  /** Optional context window override from Figma Settings. */
  contextWindow?: number;
  /** Optional max output tokens from Figma Settings. */
  maxOutputTokens?: number;
  /** UI language ("ru" | "en") — controls model response language. */
  language?: string;
  /** Internal: one auto-retry after empty turn or provider param error. */
  _retriedOnce?: boolean;
  signal?: AbortSignal;
  /** Called when Cline needs a canvas tool; must resolve with tool result. */
  invokeTool: FigmaToolRpc;
  onEvent: (event: FigmaTurnEvent) => void;
};

type LiveFigmaChat = {
  sessionId: string;
  fingerprint: string;
  /** Mutable so each HTTP turn can rebind canvas RPC without recreating tools. */
  rpcHolder: { rpc: FigmaToolRpc };
  lastUsedAt: number;
};

const LIVE_SESSION_CAP = 16;
const FIGMA_MAX_PARALLEL_TOOLS = 8;
const DEFAULT_CONTEXT_WINDOW = 128_000;
const liveByChatId = new Map<string, LiveFigmaChat>();

let cachedBundle: ClineBundle | undefined;
let sharedCore: ClineCoreInstance | undefined;
let sharedCorePromise: Promise<ClineCoreInstance> | undefined;

function loadClineBundle(): ClineBundle {
  if (cachedBundle) {
    return cachedBundle;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cachedBundle = require("./clineBundle.js") as ClineBundle;
  return cachedBundle;
}

async function getSharedCore(bundle: ClineBundle): Promise<ClineCoreInstance> {
  if (sharedCore) {
    return sharedCore;
  }
  if (!sharedCorePromise) {
    sharedCorePromise = bundle.ClineCore.create({
      clientName: "harbor-agents-figma",
      backendMode: "local",
      telemetry: createHarborNoopTelemetry(),
      distinctId: HARBOR_CLINE_DISTINCT_ID,
      toolPolicies: figmaClineToolPolicies("agent"),
      capabilities: {
        requestToolApproval: async () => true,
      },
    }).then((core) => {
      sharedCore = core;
      return core;
    });
  }
  return sharedCorePromise;
}

function mapMode(agentMode?: string): ClineMode {
  const id = String(agentMode || "ask").toLowerCase();
  return id === "agent" ? "act" : "plan";
}

function modelIdForApi(modelId: string): string {
  const id = String(modelId || "");
  if (id.indexOf("/") === -1) {
    return id;
  }
  return id.slice(id.lastIndexOf("/") + 1);
}

function figmaWorkspaceRoot(): string {
  return (
    process.env.HARBOR_FIGMA_WORKSPACE ||
    path.join(os.homedir(), ".harbor", "figma", "workspace")
  );
}

/** Expand `/figma-*` commands from workspace, repo, or bundled out/figma-commands. */
async function resolveFigmaUserText(text: string, cwd: string): Promise<string> {
  const trimmed = String(text || "").trim();
  const fromWorkspace = await expandUserSlashCommand(trimmed, cwd);
  if (fromWorkspace) {
    return fromWorkspace.prompt;
  }
  const fromRepo = await expandUserSlashCommand(
    trimmed,
    path.join(__dirname, "..")
  );
  if (fromRepo) {
    return fromRepo.prompt;
  }
  const match = trimmed.match(/^\/([a-z0-9_-]+)(?:\s+([\s\S]*))?$/i);
  if (!match || !String(match[1] || "").toLowerCase().startsWith("figma-")) {
    return trimmed;
  }
  const name = String(match[1] || "").toLowerCase();
  const args = String(match[2] || "").trim();
  const bundledDir = path.join(__dirname, "figma-commands");
  const bundledPath = path.join(bundledDir, `${name}.md`);
  try {
    const raw = await fs.promises.readFile(bundledPath, "utf8");
    const template = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
    if (!template) {
      return trimmed;
    }
    return template.includes("$ARGUMENTS")
      ? template.replace(/\$ARGUMENTS/g, args)
      : args
        ? `${template}\n\n${args}`
        : template;
  } catch {
    return trimmed;
  }
}

function sessionFingerprint(params: {
  mode: string;
  model: string;
  baseUrl: string;
  promptCache: boolean;
}): string {
  return [
    String(params.mode || "").toLowerCase(),
    String(params.model || ""),
    String(params.baseUrl || "").replace(/\/+$/, ""),
    params.promptCache ? "pc1" : "pc0",
  ].join("|");
}

function isUnusableSessionError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error || "");
  return /session_not_found|session_run_in_progress|not found|unknown session/i.test(
    msg
  );
}

async function discardLiveChat(chatId: string): Promise<void> {
  const id = String(chatId || "").trim();
  if (!id) return;
  const live = liveByChatId.get(id);
  if (!live) return;
  liveByChatId.delete(id);
  try {
    const bundle = loadClineBundle();
    const core = await getSharedCore(bundle);
    await core.abort(live.sessionId, "harbor-discard").catch(() => undefined);
    await core.stop(live.sessionId).catch(() => undefined);
  } catch {
    /* already gone */
  }
}

function enforceLiveCap(keepChatId: string): void {
  if (liveByChatId.size <= LIVE_SESSION_CAP) return;
  const entries = [...liveByChatId.entries()]
    .filter(([id]) => id !== keepChatId)
    .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
  const overflow = liveByChatId.size - LIVE_SESSION_CAP;
  for (let i = 0; i < overflow && i < entries.length; i++) {
    void discardLiveChat(entries[i][0]);
  }
}

function resolveFigmaVision(params: FigmaTurnParams): boolean {
  if (params.supportsVision === true) return true;
  if (params.supportsVision === false) {
    // Still honor id heuristics when Settings left the flag off for a known
    // vision model (same rationale as IDE resolveModelSupportsVision).
    return resolveModelCapabilities(params.model).supportsVision;
  }
  return resolveModelCapabilities(params.model).supportsVision;
}

function buildFigmaModelInfo(params: FigmaTurnParams): {
  knownModels: Record<string, ClineKnownModelInfo>;
  maxTokensPerTurn?: number;
  modelInfo: ClineKnownModelInfo;
  apiModelId: string;
} {
  const apiModelId = modelIdForApi(params.model);
  const caps = resolveModelCapabilities(params.model, {
    contextWindow: params.contextWindow,
    supportsVision: params.supportsVision,
  });
  const contextWindow = resolveModelContextWindow(
    params.model,
    params.contextWindow,
    DEFAULT_CONTEXT_WINDOW
  );
  const maxOutputTokens = resolveModelRequestMaxTokens(
    params.model,
    params.maxOutputTokens
  );
  const capabilities: string[] = ["tools"];
  if (resolveFigmaVision(params)) {
    capabilities.push("images");
  }
  // Do not advertise "reasoning" — Anthropic-shaped thinking breaks LiteLLM.
  if (params.promptCache) {
    capabilities.push("prompt-cache");
  }
  const modelInfo: ClineKnownModelInfo = {
    id: apiModelId,
    name: params.model || apiModelId,
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
    knownModels: { [apiModelId]: modelInfo },
    ...(maxOutputTokens ? { maxTokensPerTurn: maxOutputTokens } : {}),
    modelInfo,
    apiModelId,
  };
}

function buildFigmaProviderConfig(
  modelInfo: ClineKnownModelInfo,
  promptCache: boolean,
  opts?: { model?: string; baseUrl?: string }
): Record<string, unknown> {
  const fetchImpl = wrapFetchForMiMoCompat(harborFetch as typeof fetch, {
    model: opts?.model || modelInfo.id,
    baseUrl: opts?.baseUrl,
  });
  return {
    providerId: "openai-compatible",
    fetch: fetchImpl,
    modelInfo,
    knownModels: { [modelInfo.id]: modelInfo },
    ...(promptCache
      ? {
          metadata: {
            routing: {
              promptCache: {
                format: "anthropic-cache-control",
                routes: [
                  {
                    matcher: "model-id",
                    modelId: modelInfo.id,
                    requiredCapability: "prompt-cache",
                  },
                ],
              },
            },
          },
        }
      : {}),
    options: {
      onResponseError: async (response: {
        status: number;
        clone: () => { text: () => Promise<string> };
      }) => {
        if (response.status < 400) {
          return;
        }
        let body = "";
        try {
          body = await response.clone().text();
        } catch {
          /* ignore */
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

function toolLabel(name: string, args: Record<string, unknown>): string {
  if (name === "figma_set_prototype_flow" && args.links) {
    const n = Array.isArray(args.links) ? args.links.length : 0;
    if (n > 0) {
      return `Prototype flow (${n})`;
    }
  }
  if (name === "figma_apply_edits" && Array.isArray(args.edits)) {
    const n = args.edits.length;
    if (n > 0) {
      return `Apply edits (${n})`;
    }
  }
  const map: Record<string, string> = {
    figma_list_children: "List children",
    figma_apply_to_children: "Edit children batch",
    figma_nudge_nodes: "Nudge nodes",
    figma_inspect_node: "Inspect node",
    figma_focus_node: "Focus node",
    figma_list_frames: "List frames",
    figma_get_reactions: "Get reactions",
    figma_set_name: "Rename",
    figma_set_text: "Set text",
    figma_set_fills: "Set fills",
    figma_set_auto_layout: "Auto layout",
    figma_set_prototype_link: "Prototype link",
    figma_set_prototype_flow: "Prototype flow",
    figma_clear_reactions: "Clear reactions",
    figma_create_node: "Create node",
    figma_duplicate_node: "Duplicate",
    figma_delete_node: "Delete",
    figma_set_geometry: "Set geometry",
    figma_reparent_node: "Reparent",
    figma_set_opacity: "Set opacity",
    figma_set_corner_radius: "Corner radius",
    figma_copy_styles: "Copy styles",
    figma_set_stroke: "Set stroke",
    figma_set_font: "Set font",
    figma_apply_edits: "Apply edits",
    figma_list_components: "List components",
    figma_list_variables: "List variables",
    figma_list_fonts: "List fonts",
    figma_swap_component: "Swap component",
    figma_bind_variable: "Bind variable",
    skills: "Load skill",
  };
  const base = map[name] || name;
  const bits: string[] = [];
  const push = (value: unknown, max = 40) => {
    const s = String(value ?? "").trim();
    if (!s) return;
    bits.push(s.length > max ? s.slice(0, max - 1) + "…" : s);
  };
  if (args.type != null) push(args.type, 16);
  if (args.name != null) push(args.name, 28);
  if (args.styleFromId != null) push("style←" + String(args.styleFromId), 28);
  if (args.fromNodeId != null && args.toNodeId != null) {
    push(String(args.fromNodeId) + "→" + String(args.toNodeId), 36);
  }
  if (args.characters != null) push(`“${String(args.characters)}”`, 32);
  if (args.nodeId != null) push(args.nodeId, 24);
  if (Array.isArray(args.nodeIds) && args.nodeIds.length) {
    push(`${args.nodeIds.length} nodes`, 16);
  }
  if (args.parentId != null) push(`in ${String(args.parentId)}`, 28);
  if (args.destinationId != null) push(`→ ${String(args.destinationId)}`, 28);
  if (args.width != null || args.height != null) {
    push(`${args.width ?? "?"}×${args.height ?? "?"}`, 16);
  }
  return bits.length ? `${base}: ${bits.join(" · ")}` : base;
}

function buildUserPrompt(
  params: FigmaTurnParams,
  opts: { includeHistory: boolean; fullSelection?: boolean }
): string {
  const userPrompt = String(params.userText || "").trim() || "(empty)";
  // For follow-up turns on a reused session, skip the full selection JSON —
  // the model already has it from the prior turn. Send only a brief ref.
  if (opts.fullSelection === false && params.selection) {
    const sel = params.selection as {
      primaryNodeId?: string;
      selectedCount?: number;
      fileName?: string;
    };
    const ref = sel.primaryNodeId
      ? `[Selection: node ${sel.primaryNodeId}${sel.selectedCount ? `, ${sel.selectedCount} root(s)` : ""}]`
      : "";
    return ref ? `${userPrompt}\n\n${ref}` : userPrompt;
  }
  const selectionBlock = buildSelectionContextText(params.selection);
  let full = `${userPrompt}\n\n${selectionBlock}`;
  if (opts.includeHistory) {
    const historyBlock =
      Array.isArray(params.history) && params.history.length
        ? params.history
            .slice(-12)
            .map((m) => `${m.role}: ${String(m.text || "").slice(0, 2000)}`)
            .join("\n")
        : "";
    if (historyBlock) {
      full = `Recent chat (for context):\n${historyBlock}\n\n---\n\n${full}`;
    }
  }
  return full;
}

/**
 * Run one Figma chat turn through ClineCore (local).
 * With chatId: interactive session — follow-ups keep prior tool memory.
 */
export async function runFigmaClineTurn(
  params: FigmaTurnParams
): Promise<string> {
  const bundle = loadClineBundle();
  const mode = String(params.agentMode || "ask").toLowerCase();
  const clineMode = mapMode(mode);
  const cwd = figmaWorkspaceRoot();
  const chatId = String(params.chatId || "").trim();
  const persistSession = Boolean(chatId);
  const promptCache = params.promptCache === true;
  const fingerprint = sessionFingerprint({
    mode,
    model: params.model,
    baseUrl: params.baseUrl || "",
    promptCache,
  });
  const coldTurnProvider = providerPrefersColdTurns(
    params.baseUrl || "",
    params.model
  );
  const maxParallelTools = resolveFigmaMaxParallelTools(
    params.baseUrl || "",
    params.model
  );
  const modelInfoData = buildFigmaModelInfo(params);
  const seesImages = resolveFigmaVision(params);

  const maybeRetryTurn = (): Promise<string> | undefined => {
    if (params._retriedOnce || params.signal?.aborted) {
      return undefined;
    }
    return runFigmaClineTurn({
      ...params,
      resetSession: true,
      _retriedOnce: true,
    });
  };

  let assistantText = "";
  let stepSeq = 0;
  const turnStartedAt = Date.now();
  let ttftMs: number | undefined;
  let ttftReported = false;
  let lastStatus = "";
  let turnError = "";
  let turnResult: AgentTurnResult | undefined;
  let clineToolSteps = 0;
  const clineToolStartedAt = new Map<string, number>();

  const argsFromInput = (input: unknown): Record<string, unknown> => {
    if (input && typeof input === "object" && !Array.isArray(input)) {
      return input as Record<string, unknown>;
    }
    return {};
  };
  const emit = (event: FigmaTurnEvent) => {
    try {
      params.onEvent(event);
    } catch {
      /* ignore UI handler errors */
    }
  };

  const noteTtft = () => {
    if (ttftReported) return;
    ttftMs = Date.now() - turnStartedAt;
    ttftReported = true;
    emit({ type: "timing", ttftMs });
  };

  const wrapRpc = (rpc: FigmaToolRpc): FigmaToolRpc => {
    return async (name, args) => {
      stepSeq += 1;
      const stepId = `figma-tool-${stepSeq}`;
      const label = toolLabel(name, args);
      const toolStartedAt = Date.now();
      emit({
        type: "step",
        stepId,
        name,
        label,
        status: "running",
      });
      try {
        const result = await rpc(name, args);
        emit({
          type: "step",
          stepId,
          name,
          label,
          status: "ok",
          durationMs: Date.now() - toolStartedAt,
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({
          type: "step",
          stepId,
          name,
          label,
          status: "error",
          error: message,
          durationMs: Date.now() - toolStartedAt,
        });
        throw error;
      }
    };
  };

  if (persistSession && (params.resetSession || params._retriedOnce)) {
    await discardLiveChat(chatId);
  }

  let live =
    persistSession && !params._retriedOnce ? liveByChatId.get(chatId) : undefined;
  if (live && live.fingerprint !== fingerprint) {
    await discardLiveChat(chatId);
    live = undefined;
  }
  if (coldTurnProvider && live) {
    await discardLiveChat(chatId);
    live = undefined;
  }

  const rpcHolder = live?.rpcHolder || { rpc: wrapRpc(params.invokeTool) };
  rpcHolder.rpc = wrapRpc(params.invokeTool);

  const core = await getSharedCore(bundle);
  let sessionId = live?.sessionId || randomUUID();
  let reusedSession = Boolean(live) && !coldTurnProvider;

  // For reused sessions, use condensed prompt (not sent to API, but used
  // for getClineDefaultSystemPrompt which may inject rules).
  // For cold starts, use the full prompt.
  let systemPrompt = reusedSession
    ? designSystemPromptFollowUp(mode, params.language)
    : designSystemPrompt(mode, params.language);
  if (!reusedSession && typeof bundle.getClineDefaultSystemPrompt === "function") {
    try {
      systemPrompt = bundle.getClineDefaultSystemPrompt({
        rules: designSystemPrompt(mode, params.language),
        ide: "figma",
        mode: clineMode,
        workspaceRoot: cwd,
      });
    } catch {
      /* keep designSystemPrompt */
    }
  }

  const userImages: string[] = [];
  if (seesImages) {
    const preview = String(params.previewPngDataUrl || "").trim();
    if (preview.startsWith("data:image/")) {
      userImages.push(preview);
    }
  }

  // Expand user slash commands (~/.harbor/commands, repo .harbor/commands).
  let userText = String(params.userText || "").trim();
  try {
    userText = await resolveFigmaUserText(userText, cwd);
  } catch {
    /* ignore missing commands dir */
  }

  // Follow-up on a live session: only new user text + brief selection ref.
  // Cold start: include full selection JSON + truncated text history.
  const userPrompt = buildUserPrompt(
    { ...params, userText },
    {
      includeHistory: !reusedSession,
      fullSelection: !reusedSession,
    }
  );

  const unsubscribe = core.subscribe((rawEvent) => {
    const event = rawEvent as CoreSessionEvent;
    const sid = String(event.payload?.sessionId || "");
    if (sid && sid !== sessionId) {
      return;
    }
    if (event.type === "status" && event.payload?.status) {
      lastStatus = String(event.payload.status);
      emit({ type: "status", text: lastStatus });
      return;
    }
    if (event.type !== "agent_event" || !event.payload?.event) {
      return;
    }
    const ae = event.payload.event;
    if (ae.type === "content_start" && ae.contentType === "text") {
      const chunk = String(ae.text || "");
      if (chunk) {
        noteTtft();
        assistantText += chunk;
        emit({ type: "assistantDelta", text: chunk });
      }
      return;
    }
    if (ae.type === "content_end" && ae.contentType === "text") {
      const finalText = String(ae.text || "").trim();
      if (finalText && !assistantText.trim()) {
        noteTtft();
        assistantText = finalText;
        emit({ type: "assistantDelta", text: finalText });
      }
      return;
    }
    if (ae.type === "content_start" && ae.contentType === "tool") {
      const name = String(ae.toolName || "tool");
      if (name.startsWith("figma_")) {
        return;
      }
      clineToolSteps += 1;
      const stepId = String(ae.toolCallId || `cline-tool-${clineToolSteps}`);
      clineToolStartedAt.set(stepId, Date.now());
      const args = argsFromInput(ae.input);
      emit({
        type: "step",
        stepId,
        name,
        label: toolLabel(name, args),
        status: "running",
      });
      return;
    }
    if (ae.type === "content_end" && ae.contentType === "tool") {
      const name = String(ae.toolName || "tool");
      if (name.startsWith("figma_")) {
        return;
      }
      const stepId = String(ae.toolCallId || `cline-tool-${clineToolSteps}`);
      const startedAt = clineToolStartedAt.get(stepId) ?? Date.now();
      const args = argsFromInput(ae.input);
      const errRaw = ae.error;
      const errMsg =
        typeof errRaw === "string"
          ? errRaw
          : errRaw instanceof Error
            ? errRaw.message
            : "";
      emit({
        type: "step",
        stepId,
        name,
        label: toolLabel(name, args),
        status: errMsg ? "error" : "ok",
        error: errMsg || undefined,
        durationMs: Date.now() - startedAt,
      });
      return;
    }
    if (ae.type === "error") {
      turnError = agentEventErrorMessage(ae);
      return;
    }
    if (ae.type === "done") {
      const reason = String(ae.reason || "").toLowerCase();
      if (reason === "error" || reason === "failed") {
        turnError = turnError || agentEventErrorMessage(ae);
      }
    }
  });

  const onAbort = () => {
    void core.abort(sessionId, "user-stop").catch(() => undefined);
  };
  if (params.signal) {
    if (params.signal.aborted) {
      onAbort();
    } else {
      params.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  try {
    emit({ type: "status", text: reusedSession ? "cline-continue" : "cline" });

    if (reusedSession) {
      try {
        const sendResult = (await core.send({
          sessionId,
          prompt: userPrompt,
          ...(userImages.length ? { userImages } : {}),
          mode: clineMode,
        })) as AgentTurnResult | undefined;
        if (sendResult === undefined) {
          // Queued on a busy/stuck session — discard and cold-start.
          await discardLiveChat(chatId);
          reusedSession = false;
          sessionId = randomUUID();
        } else {
          turnResult = sendResult;
          assistantText = mergeAssistantFromTurnResult(assistantText, turnResult);
        }
      } catch (error) {
        if (params.signal?.aborted) {
          const durationMs = Date.now() - turnStartedAt;
          emit({ type: "done", text: assistantText, ttftMs, durationMs });
          return assistantText;
        }
        if (!isUnusableSessionError(error)) {
          throw error;
        }
        await discardLiveChat(chatId);
        reusedSession = false;
        sessionId = randomUUID();
      }
    }

    if (!reusedSession) {
      const extraTools = createFigmaCanvasExtraTools(
        bundle.createTool,
        (name, args) => rpcHolder.rpc(name, args),
        mode
      );
      const userInstructionService = buildFigmaUserInstructionService(
        bundle,
        cwd
      );
      const startResult = await core.start({
        source: "figma",
        interactive: persistSession,
        prompt: userPrompt,
        ...(userImages.length ? { userImages } : {}),
        ...(userInstructionService
          ? {
              localRuntime: {
                userInstructionService,
                configExtensions: ["rules", "skills", "workflows"] as const,
              },
            }
          : {}),
        config: {
          sessionId,
          providerId: "openai-compatible",
          modelId: modelInfoData.apiModelId,
          apiKey: params.apiKey || "no-key",
          baseUrl: String(params.baseUrl || "").replace(/\/+$/, ""),
          cwd,
          workspaceRoot: cwd,
          mode: clineMode,
          enableTools: true,
          enableSpawnAgent: false,
          enableAgentTeams: false,
          disableMcpSettingsTools: true,
          maxParallelToolCalls: maxParallelTools,
          toolPolicies: figmaClineToolPolicies(mode),
          systemPrompt,
          extraTools,
          ...(userInstructionService ? { skills: [] as string[] } : {}),
          knownModels: modelInfoData.knownModels,
          ...(modelInfoData.maxTokensPerTurn
            ? { maxTokensPerTurn: modelInfoData.maxTokensPerTurn }
            : {}),
          providerConfig: buildFigmaProviderConfig(
            modelInfoData.modelInfo,
            promptCache,
            { model: params.model, baseUrl: params.baseUrl || "" }
          ),
        },
      });
      sessionId = String(startResult.sessionId || sessionId);
      turnResult = startResult.result as AgentTurnResult | undefined;
      assistantText = mergeAssistantFromTurnResult(assistantText, turnResult);
    }

    const failureMessage = resolveSilentTurnFailure({
      assistantText,
      lastStatus,
      turnError,
      turnResult,
      canvasToolSteps: stepSeq,
      clineToolSteps,
    });
    if (failureMessage) {
      const retry = maybeRetryTurn();
      if (retry) {
        return retry;
      }
      throw new Error(failureMessage);
    }

    if (isLikelyProviderParamError(assistantText)) {
      const retry = maybeRetryTurn();
      if (retry) {
        return retry;
      }
      throw new Error(
        formatProviderParamErrorMessage(params.model, params.baseUrl || "")
      );
    }

    if (persistSession) {
      liveByChatId.set(chatId, {
        sessionId,
        fingerprint,
        rpcHolder,
        lastUsedAt: Date.now(),
      });
      enforceLiveCap(chatId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (params.signal?.aborted) {
      const durationMs = Date.now() - turnStartedAt;
      emit({ type: "done", text: assistantText, ttftMs, durationMs });
      return assistantText;
    }
    if (isLikelyProviderParamError(message)) {
      const retry = maybeRetryTurn();
      if (retry) {
        return retry;
      }
      throw new Error(
        formatProviderParamErrorMessage(params.model, params.baseUrl || "")
      );
    }
    throw new Error(message);
  } finally {
    unsubscribe();
  }

  const durationMs = Date.now() - turnStartedAt;
  emit({ type: "timing", ttftMs, durationMs });
  emit({ type: "done", text: assistantText, ttftMs, durationMs });
  return assistantText;
}

/** Drop a Figma chat's live Cline session (agent deleted / regenerate). */
export async function discardFigmaClineChatSession(
  chatId: string
): Promise<void> {
  await discardLiveChat(chatId);
}
