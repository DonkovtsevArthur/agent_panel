/**
 * Agent turn один в один как на ветке main (для Qwen).
 * Tools / prompts / client payload / loop — снимок main, не list_agent.
 */
import { promises as fs } from "fs";
import * as path from "path";
import {
  buildUserApiContent,
  MessageAttachment,
  stripAttachmentPayload,
  userContentForHistory,
} from "./attachments";
import { getConfig, getContextWindow, getModeById, resolveModelEndpoint, resolveModelReasoningEffort } from "./config";
import { effectiveReasoningEffort } from "./reasoningEffort";
import { FileEditStat, formatEditTotals, lineDiffStats } from "./diffStats";
import {
  buildEditorContextMessage,
  getEditorWorkspaceContext,
} from "./editorContext";
import {
  modeCollectLabel,
  modeDoneLabel,
  modeFinalNudge,
  modeThinkingLabel,
  isReadonlyPolicy,
} from "./modes";
import {
  ChatCompletionUsage,
  ChatMessage,
  ChatTool,
  ContentPart,
  getOpenAICompatibleClient,
  isKimiFamilyModel,
  ToolCall,
} from "./openaiClient";
import {
  shouldAbandonHelperModel,
} from "./modelRouting";
import {
  isAllowedToolInReadonlyMainLike,
  isMainLikeWriteTool,
  mainLikeToolsForPolicy,
  runMainLikeTool,
} from "./mainLikeTools";
import {
  DENIED_WRITE_USER_NUDGE,
  HEDGE_USER_NUDGE,
  HOLLOW_USER_NUDGE,
  IMPACT_USER_NUDGE,
  MISSING_WRITE_USER_NUDGE,
  decideHonestFinale,
} from "./honestFinale";
import { resolveVersionBumpForPackageJson } from "./versionBump";
import {
  EMPTY_ASSISTANT_PLACEHOLDER,
  EMPTY_TEXT_USER_NUDGE_NO_EDITS,
  EMPTY_TEXT_USER_NUDGE_WITH_EDITS,
  EMPTY_WRITE_USER_NUDGE,
  finalizeAssistantText,
  looksLikeEmptyAssistantReply,
} from "./emptyFinale";
import { looksLikeAgentsMdRequest } from "./agentsMd";
import { isGitMutationCommand } from "./gitCommandPolicy";
import {
  ROUND_EXTENSION_SIZE,
  buildExploreHardNudge,
  buildExploreSoftNudge,
  buildKimiWorkspaceFollowHint,
  exploreRoundLimits,
  isExploreOnlyTool,
  roundWasExploreOnly,
  shouldExtendToolRounds,
} from "./toolRoundPolicy";
import { executeToolCallsInOrder } from "./runToolWaves";
import { getMcpManager } from "./mcpBundle";
import { messageHasFigmaUrl } from "./mcp/figma";
import { filterToolsForContext, messageContainsUrl } from "./toolFilter";
import {
  listDirtyPaths,
  mergeNewlyDirtyEdits,
} from "./turnFileChanges";
import {
  modelNeedsAggressiveToolBudget,
  prepareKimiEmptyFinaleMessages,
  prepareFragileGatewayMessages,
} from "./toolRecovery";
import { formatToolEvidenceFallbackAnswer } from "./toolRecovery";
import { prepareRoundMessages } from "./prepareRoundMessages";
import {
  ensureToolResultsIntentHint,
  nextStepId,
  previewText,
  toolStepId,
  FOCUSED_EDIT_HINT,
  VERIFY_REPO_FACTS_HINT,
  type CompletionIntent,
} from "./agentSteps";
import {
  appendReasoningDelta,
  finalizeRoundReasoning,
  mergeReasoningChunks,
  normalizeReasoningContent,
} from "./reasoningUi";
import {
  applyGetDiagnosticsToVerification,
  applyProjectCommandToVerification,
  applyWriteFileToVerification,
  buildVerificationNudge,
  bumpVerificationFixAttempt,
  createVerificationState,
  decideVerificationStep,
  projectCommandFailureTouchesScope,
  selectProjectVerificationCommand,
  type VerificationDiagnosticLike,
  type VerificationLoopState,
} from "./verificationLoop";
import {
  DEFAULT_WORKSPACE_RULE_CHAR_CAP,
  loadWorkspaceRules,
} from "./workspaceRules";
import type {
  AgentPhase,
  AgentRunCallbacks,
  ContextUsageInfo,
} from "./agentLoop";
import type * as vscode from "vscode";

function contentCharLength(content: ChatMessage["content"]): number {
  if (!content) {
    return 0;
  }
  if (typeof content === "string") {
    return content.length;
  }
  let chars = 0;
  for (const part of content) {
    if (part.type === "text") {
      chars += part.text.length;
    } else if (part.type === "image_url") {
      chars += Math.ceil((part.image_url?.url?.length || 0) / 4);
    }
  }
  return chars;
}

function toApiMessage(message: ChatMessage): ChatMessage {
  const { attachments: _a, ...rest } = message;
  return rest;
}

function toolSignature(call: ToolCall): string {
  return `${call.function.name}::${call.function.arguments}`;
}

function truncateStatus(value: string, max = 56): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

function formatEditingDetail(edits: FileEditStat[]): string {
  const { files, added, removed } = formatEditTotals(edits);
  if (files === 0) {
    return "Редактирует…";
  }
  const filesLabel =
    files === 1 ? "1 файл" : files < 5 ? `${files} файла` : `${files} файлов`;
  return `Редактирует · ${filesLabel} · +${added} −${removed}`;
}

function formatToolStatus(
  name: string,
  argsJson: string
): { phase: AgentPhase; detail: string } {
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    args = {};
  }

  switch (name) {
    case "read_file": {
      const path = String(args.relativePath || "").trim();
      return {
        phase: "reading",
        detail: path ? `Читает · ${truncateStatus(path)}` : "Читает…",
      };
    }
    case "list_files": {
      const path = String(args.relativePath || ".").trim() || ".";
      return {
        phase: "listing",
        detail: `Смотрит · ${truncateStatus(path)}`,
      };
    }
    case "run_command": {
      const command = String(args.command || "").trim();
      return {
        phase: "running",
        detail: command
          ? `Запускает · ${truncateStatus(command)}`
          : "Запускает…",
      };
    }
    case "write_file": {
      const path = String(args.relativePath || "").trim();
      return {
        phase: "editing",
        detail: path ? `Пишет · ${truncateStatus(path)}` : "Редактирует…",
      };
    }
    case "search_replace": {
      const path = String(args.relativePath || "").trim();
      return {
        phase: "editing",
        detail: path ? `Правит · ${truncateStatus(path)}` : "Редактирует…",
      };
    }
    case "get_diagnostics": {
      const paths = Array.isArray(args.paths)
        ? args.paths.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      return {
        phase: "running",
        detail: paths.length
          ? `Problems · ${truncateStatus(paths.join(", "))}`
          : "Problems…",
      };
    }
    case "fetch_url": {
      const url = String(args.url || "").trim();
      return {
        phase: "reading",
        detail: url ? `Читает URL · ${truncateStatus(url)}` : "Читает URL…",
      };
    }
    case "open_external": {
      const url = String(args.url || "").trim();
      return {
        phase: "running",
        detail: url ? `Открывает · ${truncateStatus(url)}` : "Открывает URL…",
      };
    }
    default: {
      if (name.startsWith("mcp__")) {
        const short = name.replace(/^mcp__[^_]+__/, "") || name;
        const label = name.startsWith("mcp__figma__") ? "Figma" : "MCP";
        return {
          phase: "reading",
          detail: `${label} · ${truncateStatus(short)}`,
        };
      }
      return {
        phase: "thinking",
        detail: name ? `Tool · ${truncateStatus(name)}` : "Думает…",
      };
    }
  }
}

function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const message of messages) {
    chars += contentCharLength(message.content);
    if (message.tool_calls?.length) {
      for (const call of message.tool_calls) {
        chars += (call.function?.name || "").length;
        chars += (call.function?.arguments || "").length;
      }
    }
  }
  return Math.max(1, Math.ceil(chars / 4));
}

function resolveUsage(
  usage: ChatCompletionUsage | undefined,
  requestMessages: ChatMessage[]
): ContextUsageInfo {
  const promptTokens =
    typeof usage?.prompt_tokens === "number" && usage.prompt_tokens > 0
      ? usage.prompt_tokens
      : estimateTokens(requestMessages);
  const completionTokens =
    typeof usage?.completion_tokens === "number" && usage.completion_tokens > 0
      ? usage.completion_tokens
      : 0;
  const used =
    typeof usage?.total_tokens === "number" && usage.total_tokens > 0
      ? usage.total_tokens
      : promptTokens + completionTokens;
  return { used, promptTokens, completionTokens };
}

function hasUserContent(content: ChatMessage["content"]): boolean {
  if (!content) {
    return false;
  }
  if (typeof content === "string") {
    return Boolean(content.trim());
  }
  return content.length > 0;
}

function contentPartsToHistoryText(parts: ContentPart[]): string {
  const bits: string[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      bits.push(part.text);
    } else if (part.type === "image_url") {
      bits.push("[image]");
    }
  }
  return bits.join("\n").trim() || "[attachment]";
}

function compactHistoryMainLike(messages: ChatMessage[]): ChatMessage[] {
  const compact: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === "user" && hasUserContent(message.content)) {
      const entry: ChatMessage = {
        role: "user",
        content:
          typeof message.content === "string"
            ? message.content
            : contentPartsToHistoryText(message.content || []),
      };
      if (message.attachments?.length) {
        entry.attachments = message.attachments.map(stripAttachmentPayload);
      }
      compact.push(entry);
      continue;
    }
    if (
      message.role === "assistant" &&
      hasUserContent(message.content) &&
      !(message.tool_calls && message.tool_calls.length > 0)
    ) {
      compact.push({
        role: "assistant",
        content:
          typeof message.content === "string"
            ? message.content
            : contentPartsToHistoryText(message.content || []),
      });
    }
  }
  const maxMessages = 24;
  return compact.length > maxMessages
    ? compact.slice(compact.length - maxMessages)
    : compact;
}

function contentAsString(content: ChatMessage["content"]): string {
  if (!content) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  return contentPartsToHistoryText(content);
}

function assistantTurnFromApi(assistant: ChatMessage): ChatMessage {
  const toolCalls = (assistant.tool_calls ?? []).filter(
    (call) => call?.function?.name
  );
  const turn: ChatMessage = {
    role: "assistant",
    content: assistant.content ?? null,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  };
  if (typeof assistant.reasoning_content === "string") {
    turn.reasoning_content = assistant.reasoning_content;
  }
  return turn;
}

async function readPackageScripts(
  rootPath: string | undefined
): Promise<Record<string, unknown> | undefined> {
  if (!rootPath) {
    return undefined;
  }
  try {
    const raw = await fs.readFile(path.join(rootPath, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    return pkg.scripts && typeof pkg.scripts === "object"
      ? pkg.scripts
      : undefined;
  } catch {
    return undefined;
  }
}

function parseToolJson(result: string): Record<string, unknown> {
  try {
    return JSON.parse(result) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function hydrateHistoryForApi(
  history: ChatMessage[],
  storageUri: vscode.Uri | undefined
): Promise<ChatMessage[]> {
  const out: ChatMessage[] = [];
  for (const message of history) {
    if (message.role === "user" && message.attachments?.length) {
      const text =
        typeof message.content === "string"
          ? message.content
          : contentPartsToHistoryText(message.content || []);
      const cleanText = text
        .replace(/\n?\[image: [^\]]+\]/g, "")
        .replace(/\n?\[file: [^\]]+\]/g, "")
        .trim();
      const content = await buildUserApiContent(
        cleanText,
        message.attachments,
        storageUri
      );
      out.push(toApiMessage({ role: "user", content }));
      continue;
    }
    out.push(toApiMessage(message));
  }
  return out;
}

export async function runMainLikeAgentTurn(options: {
  model: string;
  /**
   * Optional fast model for the Agent explore phase (read-only tools only).
   * After context is gathered, the loop switches to {@link model} for edits/answer.
   */
  exploreModel?: string;
  /**
   * When the under-the-hood helper (Plan/Ask fast override) fails with 5xx/transport,
   * continue the same turn on this user-selected model.
   */
  helperFallbackModel?: string;
  history: ChatMessage[];
  userText: string;
  attachments?: MessageAttachment[];
  storageUri?: vscode.Uri;
  signal?: AbortSignal;
  agentMode?: string;
  /** @deprecated используй agentMode */
  planMode?: boolean;
  callbacks: AgentRunCallbacks;
}): Promise<ChatMessage[]> {
  const config = getConfig();
  const mode = getModeById(
    options.agentMode ?? (options.planMode ? "plan" : "agent")
  );
  const readonly = isReadonlyPolicy(mode.tools);
  const endpoint = resolveModelEndpoint(options.model);
  if (!endpoint.baseUrl) {
    throw new Error(
      `Не задан baseUrl для «${endpoint.providerName}». Укажите провайдера у модели.`
    );
  }
  if (!endpoint.apiKey) {
    throw new Error(
      `Не задан API key для «${endpoint.providerName}». Укажите ключ у провайдера.`
    );
  }

  const client = getOpenAICompatibleClient(
    endpoint.baseUrl,
    endpoint.apiKey,
    {
      rejectUnauthorized: config.rejectUnauthorized,
      caBundlePath: config.caBundlePath,
    }
  );

  // Explore model: fast helper for read-only rounds, switch to main model on write.
  const exploreModelId = options.exploreModel?.trim() || "";
  let exploreClient = client;
  if (exploreModelId && exploreModelId !== options.model) {
    const exploreEp = resolveModelEndpoint(exploreModelId);
    if (exploreEp.baseUrl && exploreEp.apiKey) {
      exploreClient = getOpenAICompatibleClient(
        exploreEp.baseUrl,
        exploreEp.apiKey,
        {
          rejectUnauthorized: config.rejectUnauthorized,
          caBundlePath: config.caBundlePath,
        }
      );
    }
  }
  let explorePhase = Boolean(exploreModelId) && !readonly;
  let helperFallbackUsed = false;
  let activeTurnModel = options.model;

  const getClientForModel = (modelId: string): typeof client => {
    if (modelId === options.model) return client;
    if (modelId === exploreModelId) return exploreClient;
    const ep = resolveModelEndpoint(modelId);
    if (!ep.baseUrl || !ep.apiKey) return client;
    return getOpenAICompatibleClient(ep.baseUrl, ep.apiKey, {
      rejectUnauthorized: config.rejectUnauthorized,
      caBundlePath: config.caBundlePath,
    });
  };

  const mcp = getMcpManager();
  const figmaEnabled = config.figma.enabled;
  // MCP (включая Figma) — во всех режимах; Plan/Ask режут только write_file / run_command.
  const mcpTools = mcp ? await mcp.listOpenAiTools(false) : [];
  const figmaConnected = Boolean(
    figmaEnabled &&
      mcp?.getStatus().state === "connected" &&
      mcpTools.some((t) => t.function.name.startsWith("mcp__figma__"))
  );
  if (
    options.callbacks.onFigmaNeedsConnect &&
    messageHasFigmaUrl(options.userText) &&
    !figmaConnected
  ) {
    options.callbacks.onFigmaNeedsConnect();
  }

  const mcpToolNames = mcpTools.map((t) => t.function.name);
  const urlCapabilityHint = [
    mcp?.buildSystemHint(mcpToolNames) ||
      [
        "No MCP tools are currently connected.",
        "You CAN access http(s) URLs via fetch_url / open_external — never claim you cannot open external URLs.",
      ].join(" "),
    "Whenever the user shares an http(s) link and asks ANYTHING about that page, IMMEDIATELY call fetch_url before answering.",
    "For figma.com links use Figma MCP tools when connected; do not use fetch_url for Figma designs.",
    "Never say you cannot open external URLs, Figma, or websites when fetch_url / open_external / MCP tools are available.",
  ].join(" ");

  const urlInMessage =
    messageContainsUrl(options.userText || "") ||
    Boolean(
      options.attachments?.some((attachment) =>
        messageContainsUrl(`${attachment.name || ""} ${attachment.mime || ""}`)
      )
    );

  const prior = compactHistoryMainLike(options.history);
  const priorApi = await hydrateHistoryForApi(prior, options.storageUri);
  const persistedAttachments = (options.attachments || []).map(
    stripAttachmentPayload
  );
  const userApiContent = await buildUserApiContent(
    options.userText,
    options.attachments,
    options.storageUri
  );
  const modePrompt = mode.prompt?.trim();
  const editorWorkspace = getEditorWorkspaceContext();
  const agentsMdTurn = looksLikeAgentsMdRequest(options.userText);
  const kimiModel = isKimiFamilyModel(options.model);
  const exploreLimits = exploreRoundLimits({ kimi: kimiModel });
  // OpenAI-style reasoning_effort (Claude 3.5+/4 via gateway) — гейтвей
  // включит extended thinking и будет стримить reasoning_content. Для моделей
  // без capability — undefined (поле не отправляется).
  const turnReasoningEffort = resolveModelReasoningEffort(options.model);
  // Короткие workspace rules (AGENTS.md + .cursor/rules) — что можно/нельзя править.
  // Kimi: больший кап, чтобы .cursor/rules не отрезались после длинного AGENTS.md.
  const workspaceRules =
    editorWorkspace.rootPath && !agentsMdTurn
      ? await loadWorkspaceRules(editorWorkspace.rootPath, {
          targetPaths: editorWorkspace.targetPaths,
          charCap: kimiModel ? DEFAULT_WORKSPACE_RULE_CHAR_CAP : 8_000,
        })
      : undefined;
  const messages: ChatMessage[] = [
    { role: "system", content: config.systemPrompt },
    { role: "system", content: buildEditorContextMessage() },
    { role: "system", content: urlCapabilityHint },
    { role: "system", content: VERIFY_REPO_FACTS_HINT },
    { role: "system", content: FOCUSED_EDIT_HINT },
    ...(workspaceRules
      ? [
          {
            role: "system" as const,
            content: `Workspace rules (must follow):\n\n${workspaceRules}`,
          },
        ]
      : []),
    ...(kimiModel && !agentsMdTurn && !readonly
      ? [
          {
            role: "system" as const,
            content: buildKimiWorkspaceFollowHint(),
          },
        ]
      : []),
    ...(modePrompt
      ? [{ role: "system" as const, content: modePrompt }]
      : []),
    ...priorApi,
    toApiMessage({ role: "user", content: userApiContent }),
  ];

  // Post-edit verification (diagnostics + lint/typecheck) — только Kimi в Agent.
  const enablePostEditVerification =
    !readonly && kimiModel;
  const projectCommand = enablePostEditVerification
    ? selectProjectVerificationCommand(
        await readPackageScripts(editorWorkspace.rootPath)
      )?.command
    : undefined;
  const verification: VerificationLoopState = createVerificationState({
    agentMode: enablePostEditVerification,
    projectCommand,
  });
  if (enablePostEditVerification) {
    // Index: after the fixed system messages (systemPrompt, editor, url,
    // verify-facts, focused-edit) — before optional rules/mode prompts.
    messages.splice(5, 0, {
      role: "system",
      content: [
        "Post-edit verification is enabled for this model.",
        "After write_file / search_replace: fix diagnostics/importWarnings from the tool result for the files you edited.",
        "Before finishing, expect get_diagnostics on edited files.",
        "For non-metadata code edits, also one project command",
        projectCommand
          ? `(${projectCommand})`
          : "(typecheck/lint/build if present in package.json).",
        "Metadata-only edits (package.json / changelog / nls / readme) skip the project command.",
        "If a project command fails on files you did not edit this turn, finish briefly — do not fix unrelated repo debt.",
        "Do not claim done while verification reports errors on your edited files.",
      ].join(" "),
    });
  }

  let baseTools = mainLikeToolsForPolicy(mode.tools);
  if (!enablePostEditVerification) {
    baseTools = baseTools.filter(
      (tool) => tool.function.name !== "get_diagnostics"
    );
  }
  const allTools = [...baseTools, ...mcpTools];
  const activeTools = filterToolsForContext(allTools, {
    hasUrl: urlInMessage || messageHasFigmaUrl(options.userText),
  });
  const hardCutTools: ChatTool[] = activeTools.filter(
    (tool) =>
      isMainLikeWriteTool(tool.function.name) ||
      (enablePostEditVerification &&
        tool.function.name === "get_diagnostics")
  );
  const editsByPath = new Map<string, FileEditStat>();
  // Dirty до tools — в review попадут и shell-правки (run_command), не только write_file.
  const baselineDirty = readonly ? ([] as string[]) : await listDirtyPaths();
  let roundBudget = Math.max(1, config.maxToolRounds);
  const seenToolCalls = new Set<string>();
  let answered = false;
  let exploreStreak = 0;
  let softNudgeSent = false;
  let hardCut = false;
  let hadProductiveTool = false;
  let extensionsUsed = 0;
  let turnHadGitOperation = false;
  let writeNudgeAttempts = 0;
  let hedgeNudgeAttempts = 0;
  let hollowNudgeAttempts = 0;
  let impactNudgeAttempts = 0;
  let deniedWriteNudgeAttempts = 0;
  let emptyFinalAttempts = 0;
  let turnReasoning = "";
  let completionIntent: CompletionIntent = "user_prompt";
  let thinkingStepId = "";
  let textStepId = "";
  const maxWriteNudges = 3;
  const maxHedgeNudges = 2;
  const maxHollowNudges = 2;
  const maxImpactNudges = 2;
  const maxDeniedWriteNudges = 2;
  const maxEmptyFinalAttempts = 3;
  const contextWindow = getContextWindow(options.model);

  const emitStep = (
    event: Parameters<NonNullable<AgentRunCallbacks["onStep"]>>[0]
  ): void => {
    options.callbacks.onStep?.(event);
  };

  const emitToolLifecycle = (
    call: ToolCall,
    status: "queued" | "running" | "done" | "error",
    result?: string
  ): void => {
    const name = call.function.name || "tool";
    const argsPreview = previewText(call.function.arguments || "", 120);
    emitStep({
      stepId: toolStepId(call.id),
      kind: "tool",
      toolCallId: call.id,
      name,
      argsPreview,
      status,
      ...(result !== undefined
        ? { resultPreview: previewText(result, 160) }
        : {}),
    });
  };

  const prepareApiMessages = (): void => {
    const prep = prepareRoundMessages({
      messages,
      modelId: options.model,
      contextWindow,
      reservedOutputTokens: config.maxTokens,
      kimi: kimiModel,
    });
    if (prep.compacted || prep.summarized) {
      emitStep({
        stepId: nextStepId("compaction"),
        kind: "compaction",
        text: prep.summarized
          ? `Context compacted (summary) · ~${prep.estimatedTokens} tokens`
          : `Context compacted · ~${prep.estimatedTokens} tokens`,
      });
    }
  };

  const requestAssistant = async (request: {
    model: string;
    messages: ChatMessage[];
    tools?: ChatTool[];
    tool_choice?: "auto" | "none";
    temperature?: number;
    max_tokens?: number;
    reasoning_effort?: string;
  }): Promise<{
    message: ChatMessage;
    usage?: ChatCompletionUsage;
    finishReason?: string;
  }> => {
    thinkingStepId = nextStepId("thinking");
    textStepId = nextStepId("text");
    emitStep({
      stepId: thinkingStepId,
      kind: "thinking",
      text: completionIntent === "tool_results" ? "Continuing…" : "Thinking…",
    });

    const earlyToolIds = new Set<string>();
    /** Reasoning только этого completion — не дописывать в текст прошлых раундов. */
    let roundReasoning = "";
    const activeClient = getClientForModel(request.model);
    try {
    const result = await activeClient.chatCompletions(
      {
        model: request.model,
        messages: request.messages,
        ...(request.tools ? { tools: request.tools } : {}),
        ...(request.tool_choice ? { tool_choice: request.tool_choice } : {}),
        ...(request.temperature !== undefined
          ? { temperature: request.temperature }
          : {}),
        ...(request.max_tokens !== undefined
          ? { max_tokens: request.max_tokens }
          : {}),
        ...(request.reasoning_effort
          ? { reasoning_effort: request.reasoning_effort }
          : {}),
      },
      options.signal,
      {
      onDelta: (delta) => {
        if (delta.reasoning_content) {
          roundReasoning = appendReasoningDelta(
            roundReasoning,
            delta.reasoning_content
          );
          // Show this completion's reasoning only — do not accumulate prior
          // rounds into the live Thinking card (and do not also fire onReasoning).
          const thinkingText =
            normalizeReasoningContent(roundReasoning) ||
            roundReasoning ||
            "Thinking…";
          emitStep({
            stepId: thinkingStepId,
            kind: "thinking",
            text: thinkingText,
          });
        }
        if (delta.content) {
          options.callbacks.onAssistantDelta?.(delta.content);
          emitStep({
            stepId: textStepId,
            kind: "text",
            text: delta.content,
          });
        }
        if (delta.tool_call?.id || delta.tool_call?.name) {
          const id =
            delta.tool_call.id ||
            `stream_${delta.tool_call.index}_${delta.tool_call.name || "tool"}`;
          if (!earlyToolIds.has(id) && delta.tool_call.name) {
            earlyToolIds.add(id);
            emitStep({
              stepId: toolStepId(id),
              kind: "tool",
              toolCallId: id,
              name: delta.tool_call.name,
              argsPreview: previewText(delta.tool_call.argumentsDelta || "", 80),
              status: "queued",
            });
          }
        }
      },
      onRetry: ({ attempt, maxAttempts, error, delayMs }) => {
        emitStep({
          stepId: nextStepId("retry"),
          kind: "retry",
          attempt,
          maxAttempts,
          text: `Retry ${attempt}/${maxAttempts} in ${Math.round(delayMs)}ms: ${
            error instanceof Error ? error.message : String(error)
          }`.slice(0, 240),
        });
        options.callbacks.onPhase(
          "thinking",
          `Повтор ${attempt}/${maxAttempts}…`
        );
      },
    }
    );

    const roundFinal = finalizeRoundReasoning(
      roundReasoning,
      result.message.reasoning_content
    );
    if (roundFinal) {
      turnReasoning = mergeReasoningChunks(turnReasoning, roundFinal);
      emitStep({
        stepId: thinkingStepId,
        kind: "thinking",
        text: normalizeReasoningContent(roundFinal) || roundFinal,
      });
      // Intentionally no onReasoning here — it raced past sealToolGroups and
      // spawned a second identical Thinking card. Meta goes via onAssistant.
    }
    return result;
    } catch (error) {
      if (
        options.helperFallbackModel &&
        !helperFallbackUsed &&
        !explorePhase &&
        shouldAbandonHelperModel(error)
      ) {
        helperFallbackUsed = true;
        activeTurnModel = options.helperFallbackModel;
        explorePhase = false;
        const fallbackLabel = options.helperFallbackModel;
        options.callbacks.onStep?.({
          stepId: nextStepId("retry"),
          kind: "retry",
          text: `Switching to ${fallbackLabel} after helper failure`,
        });
        const fallbackClient = getClientForModel(activeTurnModel);
        const fallbackResult = await fallbackClient.chatCompletions(
          {
            model: activeTurnModel,
            messages: request.messages,
            ...(request.tools ? { tools: request.tools } : {}),
            ...(request.tool_choice ? { tool_choice: request.tool_choice } : {}),
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
            ...(request.max_tokens !== undefined ? { max_tokens: request.max_tokens } : {}),
            ...((() => {
              const eff = effectiveReasoningEffort(
                request.messages,
                resolveModelReasoningEffort(activeTurnModel)
              );
              return eff ? { reasoning_effort: eff } : {};
            })()),
          },
          options.signal,
          {
            onDelta: () => {},
          }
        );
        return fallbackResult;
      }
      throw error;
    }
  };

  const turnHadRealFileEdit = (): boolean => {
    for (const edit of editsByPath.values()) {
      if (edit.created || edit.added > 0 || edit.removed > 0) {
        return true;
      }
    }
    return false;
  };

  const collectReviewEdits = async (): Promise<FileEditStat[]> => {
    if (readonly) {
      return [...editsByPath.values()];
    }
    return mergeNewlyDirtyEdits(editsByPath, baselineDirty);
  };

  const noteToolResult = (name: string, result: string): void => {
    if (!enablePostEditVerification) {
      return;
    }
    const parsed = parseToolJson(result);
    if (isMainLikeWriteTool(name)) {
      applyWriteFileToVerification(verification, {
        ok: Boolean(parsed.ok),
        unchanged: Boolean(parsed.unchanged),
        path: String(parsed.path || ""),
        diagnostics: Array.isArray(parsed.diagnostics)
          ? (parsed.diagnostics as VerificationDiagnosticLike[])
          : undefined,
        importWarnings: Array.isArray(parsed.importWarnings)
          ? (parsed.importWarnings as string[])
          : undefined,
      });
      return;
    }
    if (name === "get_diagnostics") {
      applyGetDiagnosticsToVerification(verification, {
        diagnostics: Array.isArray(parsed.diagnostics)
          ? (parsed.diagnostics as VerificationDiagnosticLike[])
          : undefined,
      });
      return;
    }
    if (
      name === "run_command" &&
      projectCommand &&
      String(parsed.command || "").trim() === projectCommand
    ) {
      applyProjectCommandToVerification(verification, {
        ok: parsed.ok !== false,
        stdout: String(parsed.stdout || ""),
        stderr: String(parsed.stderr || ""),
      });
    }
    if (
      name === "run_command" &&
      parsed.ok !== false &&
      isGitMutationCommand(String(parsed.command || ""))
    ) {
      turnHadGitOperation = true;
    }
  };

  /**
   * Kimi-only quality gate before finale. Auto-runs diagnostics / project
   * command; nudges the model for fixes. Returns whether to keep looping.
   */
  const applyVerificationGate = async (
    round: number
  ): Promise<"continue" | "allow_finale"> => {
    if (!enablePostEditVerification) {
      return "allow_finale";
    }

    for (let guard = 0; guard < 6; guard++) {
      const step = decideVerificationStep(verification);
      if (step.kind === "none") {
        return "allow_finale";
      }

      if (step.kind === "request_diagnostics") {
        options.callbacks.onPhase("running", "Проверяет Problems…");
        const argsJson = JSON.stringify({ paths: step.paths });
        const verifyCall: ToolCall = {
          id: nextStepId("verify-diag"),
          type: "function",
          function: { name: "get_diagnostics", arguments: argsJson },
        };
        emitToolLifecycle(verifyCall, "running");
        const result = await runMainLikeTool("get_diagnostics", argsJson);
        emitToolLifecycle(verifyCall, "done", result);
        applyGetDiagnosticsToVerification(
          verification,
          parseToolJson(result) as {
            diagnostics?: VerificationDiagnosticLike[];
          }
        );
        messages.push({
          role: "user",
          content: [
            "Post-edit verification (auto get_diagnostics):",
            result,
            "If errorCount > 0, fix with write_file before finishing.",
          ].join("\n"),
        });
        continue;
      }

      if (step.kind === "run_project_command") {
        options.callbacks.onPhase(
          "running",
          `Проверяет · ${truncateStatus(step.command)}`
        );
        const argsJson = JSON.stringify({ command: step.command });
        const verifyCall: ToolCall = {
          id: nextStepId("verify-cmd"),
          type: "function",
          function: { name: "run_command", arguments: argsJson },
        };
        emitToolLifecycle(verifyCall, "running");
        const result = await runMainLikeTool("run_command", argsJson);
        emitToolLifecycle(verifyCall, "done", result);
        const parsed = parseToolJson(result);
        const { failed, output } = applyProjectCommandToVerification(
          verification,
          {
            ok: parsed.ok !== false,
            stdout: String(parsed.stdout || ""),
            stderr: String(parsed.stderr || ""),
          }
        );
        if (failed) {
          const touchesEdited = projectCommandFailureTouchesScope(
            output,
            verification.editedPaths
          );
          if (!touchesEdited) {
            messages.push({
              role: "user",
              content: [
                `Post-edit verification: \`${step.command}\` failed, but reported issues are outside this turn's edited files (${verification.editedPaths.join(", ") || "none"}).`,
                "Do NOT fix unrelated project-wide lint/typecheck debt.",
                "Finish briefly: summarize your edits. You may mention pre-existing failures in one short sentence.",
                output.slice(0, 800),
              ]
                .filter(Boolean)
                .join("\n"),
            });
            return "allow_finale";
          }
          messages.push({
            role: "user",
            content: [
              `Post-edit verification: \`${step.command}\` failed on files you edited this turn.`,
              output.slice(0, 3_000),
              `Fix only these edited paths with write_file: ${verification.editedPaths.join(", ")}.`,
              "Do not fix unrelated files. Then finish briefly.",
            ]
              .filter(Boolean)
              .join("\n"),
          });
          if (round >= roundBudget - 1) {
            roundBudget = round + 2;
          }
          return "continue";
        }
        messages.push({
          role: "user",
          content: [
            `Post-edit verification: \`${step.command}\` passed.`,
            output.slice(0, 1_500),
            "You may finish with a brief summary.",
          ]
            .filter(Boolean)
            .join("\n"),
        });
        continue;
      }

      bumpVerificationFixAttempt(verification, step);
      const nudge = buildVerificationNudge(step);
      if (!nudge) {
        return "allow_finale";
      }
      options.callbacks.onPhase("thinking", "Правит по проверке…");
      messages.push({ role: "user", content: nudge });
      if (round >= roundBudget - 1) {
        roundBudget = round + 2;
      }
      return "continue";
    }

    return "allow_finale";
  };

  const noteReasoning = (assistant: ChatMessage): void => {
    // requestAssistant already finalizes round → turnReasoning via steps.
    // Keep meta only — never push a parallel onReasoning UI event.
    const next = normalizeReasoningContent(assistant.reasoning_content);
    if (!next) {
      return;
    }
    if (turnReasoning.includes(next) || turnReasoning === next) {
      return;
    }
    turnReasoning = mergeReasoningChunks(turnReasoning, next);
  };

  const publishAssistantFinale = async (rawText: string): Promise<void> => {
    const text = finalizeAssistantText(
      rawText,
      editsByPath,
      config.maxResponseChars,
      messages
    );
    const last = messages[messages.length - 1];
    if (
      last?.role === "assistant" &&
      !(last.tool_calls && last.tool_calls.length > 0)
    ) {
      messages[messages.length - 1] = { role: "assistant", content: text };
      if (turnReasoning) {
        messages[messages.length - 1].reasoning_content = turnReasoning;
      }
    } else {
      const entry: ChatMessage = { role: "assistant", content: text };
      if (turnReasoning) {
        entry.reasoning_content = turnReasoning;
      }
      messages.push(entry);
    }
    options.callbacks.onPhase("done", modeDoneLabel(mode));
    options.callbacks.onAssistant(text, {
      ...(turnReasoning ? { reasoning: turnReasoning } : {}),
    });
    const reviewEdits = await collectReviewEdits();
    await Promise.resolve(options.callbacks.onReview(reviewEdits));
    answered = true;
  };

  const forceNonEmptyTextReply = async (): Promise<string> => {
    if (kimiModel || modelNeedsAggressiveToolBudget(options.model)) {
      prepareKimiEmptyFinaleMessages(messages);
    }
    options.callbacks.onPhase("thinking", modeCollectLabel(mode));
    const forcedRequest: ChatMessage[] = [
      ...messages,
      {
        role: "user",
        content: turnHadRealFileEdit()
          ? EMPTY_TEXT_USER_NUDGE_WITH_EDITS
          : EMPTY_TEXT_USER_NUDGE_NO_EDITS,
      },
    ];
      const { message: forced, usage } = await requestAssistant({
        model: options.model,
        messages: forcedRequest,
        tool_choice: "none",
        temperature: 0.3,
        max_tokens: config.maxTokens,
        reasoning_effort: effectiveReasoningEffort(forcedRequest, turnReasoningEffort),
      });
    reportUsage(usage, forcedRequest);
    noteReasoning(forced);
    return contentAsString(forced.content).trim();
  };

  /**
   * Гейт «готово без правок»: nudge → ещё раунд; replace/ok → финал.
   * @returns true если ход уже завершён (answered).
   */
  const applyHonestFinaleOrNudge = async (
    rawText: string,
    round: number
  ): Promise<boolean> => {
    const trimmed = String(rawText || "").trim();

    // Пустой финал (часто у thinking-моделей после длинного explore) —
    // один-два шанса: write_file, иначе принудительный текст без tools.
    if (
      looksLikeEmptyAssistantReply(trimmed) &&
      emptyFinalAttempts < maxEmptyFinalAttempts
    ) {
      emptyFinalAttempts += 1;
      if (
        !readonly &&
        !turnHadRealFileEdit() &&
        emptyFinalAttempts <= 2
      ) {
        messages.push({ role: "user", content: EMPTY_WRITE_USER_NUDGE });
        if (round >= roundBudget - 1) {
          roundBudget = round + 2;
        }
        return false;
      }
      const forcedText = await forceNonEmptyTextReply();
      if (!looksLikeEmptyAssistantReply(forcedText)) {
        const forcedDecision = decideHonestFinale({
          text: forcedText,
          canEdit: !readonly,
          messages,
          userText: options.userText,
          hadSuccessfulWrite: turnHadRealFileEdit(),
          kimi: kimiModel,
          gitOperationCompleted: kimiModel && turnHadGitOperation,
          allowNudgeWrite: false,
          allowNudgeHedge: false,
          allowNudgeHollow: false,
          allowNudgeImpact: false,
        });
        await publishAssistantFinale(
          forcedDecision.kind === "replace" || forcedDecision.kind === "ok"
            ? forcedDecision.text
            : forcedText
        );
        return true;
      }
      if (emptyFinalAttempts < maxEmptyFinalAttempts) {
        messages.push({
          role: "user",
          content: EMPTY_TEXT_USER_NUDGE_NO_EDITS,
        });
        if (round >= roundBudget - 1) {
          roundBudget = round + 2;
        }
        return false;
      }
    }

    const decision = decideHonestFinale({
      text: trimmed || EMPTY_ASSISTANT_PLACEHOLDER,
      canEdit: !readonly,
      messages,
      userText: options.userText,
      hadSuccessfulWrite: turnHadRealFileEdit(),
      kimi: kimiModel,
      gitOperationCompleted: kimiModel && turnHadGitOperation,
      allowNudgeWrite: writeNudgeAttempts < maxWriteNudges,
      allowNudgeHedge: hedgeNudgeAttempts < maxHedgeNudges,
      allowNudgeHollow:
        hollowNudgeAttempts < maxHollowNudges &&
        deniedWriteNudgeAttempts < maxDeniedWriteNudges,
      allowNudgeImpact: impactNudgeAttempts < maxImpactNudges,
    });

    if (decision.kind === "nudge_write") {
      writeNudgeAttempts += 1;
      messages.push({ role: "user", content: MISSING_WRITE_USER_NUDGE });
      if (round >= roundBudget - 1) {
        roundBudget = round + 2;
      }
      return false;
    }
    if (decision.kind === "nudge_hedge") {
      hedgeNudgeAttempts += 1;
      messages.push({ role: "user", content: HEDGE_USER_NUDGE });
      if (round >= roundBudget - 1) {
        roundBudget = round + 2;
      }
      return false;
    }
    if (decision.kind === "nudge_hollow") {
      hollowNudgeAttempts += 1;
      messages.push({ role: "user", content: HOLLOW_USER_NUDGE });
      if (round >= roundBudget - 1) {
        roundBudget = round + 2;
      }
      return false;
    }
    if (decision.kind === "nudge_denied_write") {
      deniedWriteNudgeAttempts += 1;
      messages.push({ role: "user", content: DENIED_WRITE_USER_NUDGE });
      if (round >= roundBudget - 1) {
        roundBudget = round + 2;
      }
      return false;
    }
    if (decision.kind === "nudge_impact") {
      impactNudgeAttempts += 1;
      messages.push({ role: "user", content: IMPACT_USER_NUDGE });
      if (round >= roundBudget - 1) {
        roundBudget = round + 2;
      }
      return false;
    }
    if (decision.kind === "replace") {
      await publishAssistantFinale(decision.text);
      return true;
    }
    await publishAssistantFinale(decision.text || trimmed);
    return true;
  };

  const invokeTool = async (name: string, argsJson: string): Promise<string> => {
    if (name.startsWith("mcp__")) {
      return mcp
        ? await mcp.callTool(name, argsJson || "")
        : JSON.stringify({ error: "MCP is not available" });
    }
    return runMainLikeTool(name, argsJson);
  };

  const reportUsage = (
    usage: ChatCompletionUsage | undefined,
    requestMessages: ChatMessage[]
  ) => {
    options.callbacks.onUsage?.(resolveUsage(usage, requestMessages));
  };

  const bumpEdit = (edit: FileEditStat) => {
    const prev = editsByPath.get(edit.path);
    if (!prev) {
      editsByPath.set(edit.path, { ...edit });
    } else {
      editsByPath.set(edit.path, {
        path: edit.path,
        created: prev.created || edit.created,
        added: prev.added + edit.added,
        removed: prev.removed + edit.removed,
      });
    }
    options.callbacks.onFileEdit(edit);
    options.callbacks.onPhase(
      "editing",
      formatEditingDetail([...editsByPath.values()])
    );
  };

  // Pre-LLM shortcut: «поменяй версию в package.json» — детерминированный regex
  // bump только top-level поля version. Без LLM → зависимости не трогаются,
  // не удаляются, не переформатируются. Только Agent mode (не Plan/Ask).
  if (!readonly && editorWorkspace.rootPath) {
    const pkgPath = path.join(editorWorkspace.rootPath, "package.json");
    try {
      const pkgContent = await fs.readFile(pkgPath, "utf8");
      const bump = resolveVersionBumpForPackageJson(
        options.userText,
        options.history,
        pkgContent
      );
      if (bump) {
        if (bump.kind === "already") {
          const alreadyText = `Версия в package.json уже ${bump.current} — менять нечего.`;
          options.callbacks.onPhase("done", modeDoneLabel(mode));
          options.callbacks.onAssistant(alreadyText);
          await Promise.resolve(
            options.callbacks.onReview(await collectReviewEdits())
          );
          const historyUserAlready: ChatMessage = {
            role: "user",
            content: userContentForHistory(options.userText, persistedAttachments),
          };
          if (persistedAttachments.length) {
            historyUserAlready.attachments = persistedAttachments;
          }
          return compactHistoryMainLike([
            ...prior,
            historyUserAlready,
            { role: "assistant", content: alreadyText },
          ]);
        }
        // kind === "bump"
        await fs.writeFile(pkgPath, bump.newContent, "utf8");
        const diff = lineDiffStats(pkgContent, bump.newContent);
        bumpEdit({
          path: pkgPath,
          added: diff.added,
          removed: diff.removed,
          created: false,
        });
        const bumpText = `Поменял версию в package.json: ${bump.previous} → ${bump.targetVersion}.`;
        options.callbacks.onPhase("done", modeDoneLabel(mode));
        options.callbacks.onAssistant(bumpText);
        await Promise.resolve(
          options.callbacks.onReview(await collectReviewEdits())
        );
        const historyUserBump: ChatMessage = {
          role: "user",
          content: userContentForHistory(options.userText, persistedAttachments),
        };
        if (persistedAttachments.length) {
          historyUserBump.attachments = persistedAttachments;
        }
        return compactHistoryMainLike([
          ...prior,
          historyUserBump,
          { role: "assistant", content: bumpText },
        ]);
      }
    } catch {
      // package.json не читается / нет rootPath — проваливаемся в обычный LLM-путь.
    }
  }

  for (let round = 0; round < roundBudget; round++) {
    if (options.signal?.aborted) {
      throw new Error("aborted");
    }

    // (3) hard-cut: explore закрыт — только write_file (agent) или сразу финал (readonly).
    if (hardCut) {
      if (readonly || hardCutTools.length === 0) {
        break;
      }
      prepareApiMessages();
      if (completionIntent === "tool_results") {
        ensureToolResultsIntentHint(messages);
      }
      options.callbacks.onPhase("thinking", "Пишу результат…");
      const hardRequest = messages.slice();
      const { message: assistant, usage } = await requestAssistant({
        model: options.model,
        messages,
        tools: hardCutTools,
        tool_choice: "auto",
        temperature: 0.2,
        max_tokens: config.maxTokens,
        reasoning_effort: effectiveReasoningEffort(messages, turnReasoningEffort),
      });
      reportUsage(usage, hardRequest);

      noteReasoning(assistant);
      options.callbacks.onAssistantStreamClear?.();
      const hardAssistant = assistantTurnFromApi(assistant);
      messages.push(hardAssistant);
      const toolCalls = hardAssistant.tool_calls ?? [];

      if (toolCalls.length === 0) {
        if ((await applyVerificationGate(round)) === "continue") {
          continue;
        }
        const finished = await applyHonestFinaleOrNudge(
          contentAsString(assistant.content),
          round
        );
        if (finished) {
          break;
        }
        continue;
      }

      const hardExecuted = await executeToolCallsInOrder({
        toolCalls,
        formatStatus: formatToolStatus,
        onStatus: (call, toolStatus) => {
          options.callbacks.onPhase(
            toolStatus.phase as AgentPhase,
            toolStatus.detail
          );
        },
        onToolLifecycle: emitToolLifecycle,
        invokeOne: async (call) => {
          const allowedHardCut =
            isMainLikeWriteTool(call.function.name) ||
            (enablePostEditVerification &&
              call.function.name === "get_diagnostics");
          if (!allowedHardCut) {
            return JSON.stringify({
              error: enablePostEditVerification
                ? "Exploration limit: only write_file / search_replace / get_diagnostics are allowed. Finish the file write now."
                : "Exploration limit: only write_file / search_replace are allowed. Finish the file write now.",
            });
          }
          return invokeTool(call.function.name, call.function.arguments);
        },
      });
      for (const { call, result } of hardExecuted) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: result,
        });
        noteToolResult(call.function.name, result);
        if (isMainLikeWriteTool(call.function.name)) {
          try {
            const parsed = JSON.parse(result) as {
              ok?: boolean;
              path?: string;
              created?: boolean;
              added?: number;
              removed?: number;
            };
            if (parsed.ok && parsed.path) {
              bumpEdit({
                path: parsed.path,
                created: Boolean(parsed.created),
                added: Number(parsed.added) || 0,
                removed: Number(parsed.removed) || 0,
              });
            }
          } catch {
            // ignore
          }
        }
      }
      completionIntent = "tool_results";
      if ((await applyVerificationGate(round)) === "continue") {
        continue;
      }
      // После hard-cut write-раунда — финальный текст без tools.
      break;
    }

    options.callbacks.onPhase("thinking", modeThinkingLabel(mode));

    // После soft-nudge убираем list/read; URL/MCP tools оставляем.
    const stripExplore =
      hardCut ||
      (exploreLimits.stripExploreOnSoftNudge &&
        exploreStreak >= exploreLimits.softNudgeRounds &&
        !readonly);
    const roundTools = stripExplore
      ? activeTools.filter((tool) => !isExploreOnlyTool(tool.function.name))
      : activeTools;

    prepareApiMessages();
    if (completionIntent === "tool_results") {
      ensureToolResultsIntentHint(messages);
    }
    const requestMessages = messages.slice();
    const roundModel = explorePhase ? exploreModelId || activeTurnModel : activeTurnModel;
    const { message: assistant, usage } = await requestAssistant({
      model: roundModel,
      messages,
      ...(roundTools.length
        ? { tools: roundTools, tool_choice: "auto" as const }
        : { tool_choice: "none" as const }),
      temperature: 0.2,
      max_tokens: config.maxTokens,
      reasoning_effort: effectiveReasoningEffort(messages, turnReasoningEffort),
    });
    reportUsage(usage, requestMessages);

    noteReasoning(assistant);
    options.callbacks.onAssistantStreamClear?.();
    const roundAssistant = assistantTurnFromApi(assistant);
    messages.push(roundAssistant);
    const toolCalls = roundAssistant.tool_calls ?? [];

    if (toolCalls.length === 0) {
      if ((await applyVerificationGate(round)) === "continue") {
        continue;
      }
      const finished = await applyHonestFinaleOrNudge(
        contentAsString(assistant.content),
        round
      );
      if (finished) {
        break;
      }
      continue;
    }

    let repeatedOnly = true;
    for (const call of toolCalls) {
      const signature = toolSignature(call);
      if (!seenToolCalls.has(signature)) {
        repeatedOnly = false;
      }
      seenToolCalls.add(signature);
    }

    const executed = await executeToolCallsInOrder({
      toolCalls,
      formatStatus: formatToolStatus,
      onStatus: (call, toolStatus) => {
        options.callbacks.onPhase(
          toolStatus.phase as AgentPhase,
          toolStatus.detail
        );
      },
      onToolLifecycle: emitToolLifecycle,
      invokeOne: async (call) => {
        if (
          readonly &&
          !isAllowedToolInReadonlyMainLike(call.function.name)
        ) {
          return JSON.stringify({
            error:
              "В этом режиме инструмент недоступен. Используй list_files / read_file / fetch_url / open_external или MCP (Figma).",
          });
        }
        if (hardCut && isExploreOnlyTool(call.function.name)) {
          return JSON.stringify({
            error:
              "Exploration limit: only write_file is allowed. Finish the file write now.",
          });
        }
        return invokeTool(call.function.name, call.function.arguments);
      },
    });

    for (const { call, result } of executed) {
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: result,
      });
      noteToolResult(call.function.name, result);

      if (isMainLikeWriteTool(call.function.name)) {
        hadProductiveTool = true;
        explorePhase = false;
        try {
          const parsed = JSON.parse(result) as {
            ok?: boolean;
            path?: string;
            created?: boolean;
            added?: number;
            removed?: number;
          };
          if (parsed.ok && parsed.path) {
            bumpEdit({
              path: parsed.path,
              created: Boolean(parsed.created),
              added: Number(parsed.added) || 0,
              removed: Number(parsed.removed) || 0,
            });
          }
        } catch {
          // ignore
        }
      } else if (call.function.name === "run_command") {
        hadProductiveTool = true;
        explorePhase = false;
      }
    }

    completionIntent = "tool_results";

    if (roundWasExploreOnly(toolCalls.map((c) => c.function.name))) {
      exploreStreak += 1;
    } else {
      exploreStreak = 0;
      softNudgeSent = false;
    }

    // (2) soft-nudge после N explore-only раундов (Kimi: позже + мягче).
    if (
      exploreStreak >= exploreLimits.softNudgeRounds &&
      !softNudgeSent &&
      !hardCut
    ) {
      softNudgeSent = true;
      options.callbacks.onPhase("thinking", "Сокращаю обзор…");
      messages.push({
        role: "user",
        content: buildExploreSoftNudge({
          agentsMd: agentsMdTurn,
          readonly,
          kimi: kimiModel,
        }),
      });
    }

    // (3) hard-cut после M explore-only раундов (Kimi: позже).
    if (exploreStreak >= exploreLimits.hardCutRounds) {
      hardCut = true;
      options.callbacks.onPhase("thinking", "Лимит обзора — пишу ответ…");
      messages.push({
        role: "user",
        content: buildExploreHardNudge({
          agentsMd: agentsMdTurn,
          readonly,
        }),
      });
      // Гарантируем ещё одну итерацию под write-only / финал.
      if (round >= roundBudget - 1) {
        roundBudget = round + 2;
      }
      continue;
    }

    if (repeatedOnly) {
      break;
    }

    // (1) автопродление бюджета, если ход продуктивный и лимит на исходе.
    if (
      round >= roundBudget - 1 &&
      shouldExtendToolRounds({
        extensionsUsed,
        hadProductiveTool,
        answered,
      })
    ) {
      extensionsUsed += 1;
      roundBudget += ROUND_EXTENSION_SIZE;
      options.callbacks.onPhase(
        "thinking",
        `Продлеваю раунды (+${ROUND_EXTENSION_SIZE})…`
      );
    }
  }

  if (!answered) {
    if (options.signal?.aborted) {
      throw new Error("aborted");
    }

    options.callbacks.onPhase("thinking", modeCollectLabel(mode));

    if (kimiModel || modelNeedsAggressiveToolBudget(options.model)) {
      prepareKimiEmptyFinaleMessages(messages);
    }
    const finalRequest = [
      ...messages,
      {
        role: "user" as const,
        content: modeFinalNudge(mode),
      },
    ];
    const { message: finalMessage, usage: finalUsage } =
      await requestAssistant({
        model: options.model,
        messages: finalRequest,
        temperature: 0.2,
        max_tokens: config.maxTokens,
        reasoning_effort: effectiveReasoningEffort(finalRequest, turnReasoningEffort),
      });
    reportUsage(finalUsage, finalRequest);

    noteReasoning(finalMessage);
    options.callbacks.onAssistantStreamClear?.();
    let text = contentAsString(finalMessage.content).trim();
    if (!text && finalMessage.tool_calls?.length) {
      text =
        "Модель продолжила вызывать инструменты. Попробуйте другую модель (например DeepSeek-V4-Flash) или уточните задачу.";
    }
    if (looksLikeEmptyAssistantReply(text)) {
      text = await forceNonEmptyTextReply();
    }
    const forcedDecision = decideHonestFinale({
      text: text || EMPTY_ASSISTANT_PLACEHOLDER,
      canEdit: !readonly,
      messages: [
        ...messages,
        { role: "assistant", content: text || EMPTY_ASSISTANT_PLACEHOLDER },
      ],
      userText: options.userText,
      hadSuccessfulWrite: turnHadRealFileEdit(),
      kimi: kimiModel,
      gitOperationCompleted: kimiModel && turnHadGitOperation,
      allowNudgeWrite: false,
      allowNudgeHedge: false,
      allowNudgeHollow: false,
      allowNudgeImpact: false,
    });
    if (forcedDecision.kind === "replace") {
      text = forcedDecision.text;
    } else if (forcedDecision.kind === "ok") {
      text = forcedDecision.text;
    }
    await publishAssistantFinale(text);
  }

  let finalAssistant = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (
      msg.role === "assistant" &&
      !(msg.tool_calls && msg.tool_calls.length > 0)
    ) {
      finalAssistant = contentAsString(msg.content).trim();
      break;
    }
  }
  if (
    looksLikeEmptyAssistantReply(finalAssistant) ||
    finalAssistant.includes("Не удалось получить текстовый ответ модели")
  ) {
    const evidenceAnswer = formatToolEvidenceFallbackAnswer(
      messages,
      options.userText
    );
    finalAssistant =
      evidenceAnswer ||
      finalizeAssistantText(
        "",
        editsByPath,
        config.maxResponseChars,
        messages
      );
  }

  const historyUser: ChatMessage = {
    role: "user",
    content: userContentForHistory(options.userText, persistedAttachments),
  };
  if (persistedAttachments.length) {
    historyUser.attachments = persistedAttachments;
  }

  return compactHistoryMainLike([
    ...prior,
    historyUser,
    { role: "assistant", content: finalAssistant },
  ]);
}
