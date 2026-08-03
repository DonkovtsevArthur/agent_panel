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
import { getConfig, getContextWindow, getModeById, resolveModelEndpoint, resolveModelReasoningEffort, resolveModelSupportsVision } from "./config";
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
  isAllowedToolInReadonlyMainLike,
  isMainLikeWriteTool,
  mainLikeToolsForPolicy,
  runMainLikeTool,
} from "./mainLikeTools";
import {
  ASK_USER_VIA_TOOL_NUDGE,
  DENIED_WRITE_USER_NUDGE,
  HEDGE_USER_NUDGE,
  HOLLOW_USER_NUDGE,
  IMPACT_USER_NUDGE,
  MISSING_WRITE_USER_NUDGE,
  PLAN_QUALITY_NUDGE,
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
import {
  isGitMutationCommand,
  isWorkspaceDiscardCommand,
} from "./gitCommandPolicy";
import {
  buildDiscardSystemHint,
  resolveDiscardScope,
} from "./discardChanges";
import {
  ROUND_EXTENSION_SIZE,
  buildExploreHardNudge,
  buildExploreSoftNudge,
  buildKimiWorkspaceFollowHint,
  exploreRoundLimits,
  isExploreOrDelegatedTool,
  roundAdvancesExploreStreak,
  shouldExtendToolRounds,
} from "./toolRoundPolicy";
import { executeToolCallsInOrder } from "./runToolWaves";
import { getMcpManager } from "./mcpBundle";
import { figmaPlanAntiDriftHint, messageHasFigmaUrl } from "./mcp/figma";
import { describeMcpImagesForMainModel } from "./figmaVisionHelper";
import { shouldDeliverRawScreenshotToPlanner } from "./visionDelivery";
import type { SplitMcpToolResult } from "./mcp/resultFormat";
import { captureUrlScreenshot } from "./screenshotUrl";
import {
  buildEditCorrectionSystemHint,
  buildPlanImplementSystemHint,
  looksLikeEditCorrectionRequest,
  looksLikePlanImplementRequest,
} from "./planImplement";
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
  createThinkTagStreamFilter,
  stripThinkTagBlock,
} from "./thinkTagFilter";
import {
  applyGetDiagnosticsToVerification,
  applyProjectCommandToVerification,
  applyWriteFileToVerification,
  buildVerificationNudge,
  bumpVerificationFixAttempt,
  createVerificationState,
  decideVerificationStep,
  missingModuleSpecifiersFromOutput,
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
    case "screenshot_url": {
      const url = String(args.url || "").trim();
      return {
        phase: "reading",
        detail: url
          ? `Скриншот страницы · ${truncateStatus(url)}`
          : "Скриншот страницы…",
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
      continue;
    }
    // Сохраняем request_user_input tool-results: это ответы пользователя
    // на clarifying questions. Короткие, но критичные для decision-complete
    // плана — без них модель после compaction может пере-ask'нуть те же
    // вопросы или построить план, противоречащий ответам.
    if (
      message.role === "tool" &&
      message.name === "request_user_input"
    ) {
      try {
        const parsed = JSON.parse(String(message.content || "")) as {
          ok?: boolean;
          answer?: string;
          cancelled?: boolean;
        };
        if (parsed && parsed.ok === true && typeof parsed.answer === "string") {
          compact.push({
            role: "user",
            content: `[user's answer to a clarifying question: ${parsed.answer}]`,
          });
        }
      } catch {
        // ignore
      }
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
  let content = assistant.content ?? null;
  let reasoning: string | undefined;
  if (typeof content === "string") {
    // DeepSeek-R1 стиль: платформа может отдать `</welcome>…</welcome>` инлайн
    // в content (не через reasoning_content). Срезаем ведущий блок и при
    // наличии reasoning — прокидываем в reasoning_content (Thinking-карточка).
    const stripped = stripThinkTagBlock(content);
    content = stripped.text;
    if (stripped.reasoning) {
      reasoning = stripped.reasoning;
    }
  }
  const turn: ChatMessage = {
    role: "assistant",
    content,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  };
  if (typeof assistant.reasoning_content === "string") {
    turn.reasoning_content = assistant.reasoning_content;
  } else if (reasoning) {
    turn.reasoning_content = reasoning;
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
  history: ChatMessage[];
  userText: string;
  attachments?: MessageAttachment[];
  storageUri?: vscode.Uri;
  signal?: AbortSignal;
  agentMode?: string;
  /** @deprecated используй agentMode */
  planMode?: boolean;
  callbacks: AgentRunCallbacks;
  /** Exclude these tool names from the available tool list (recursion guard for delegate_task). */
  excludeToolNames?: Set<string>;
  /** Override config.maxToolRounds for this turn (e.g. bounded sub-agent delegation). */
  maxToolRounds?: number;
  /**
   * Paths from the previous agent edit turn (chat.lastAgentEditedPaths).
   * Used when the user asks to discard «свои» changes.
   */
  lastAgentEditedPaths?: string[];
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

  let activeTurnModel = options.model;

  // MCP screenshots arrive in tool results, which are text-only. When the
  // planner supports vision, we additionally deliver the raw screenshot as a
  // user image message after the tool results, so the planner sees pixels
  // (not just the lossy text description). Drained in the tool-result loop.
  const pendingVisionImageUrls: string[] = [];

  const getClientForModel = (modelId: string): typeof client => {
    if (modelId === options.model) return client;
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
        "You CAN access http(s) URLs via fetch_url / screenshot_url / open_external — never claim you cannot open external URLs.",
      ].join(" "),
    "Whenever the user shares an http(s) link and asks ANYTHING about that page: call fetch_url AND screenshot_url in the same tool round (they run in parallel) — fetch_url for HTML/metadata, screenshot_url for the rendered PNG + visible text after JS.",
    "Use both the screenshot (vision) and the page text to answer. Prefer screenshot_url when the question is about layout, UI, colors, or a JS SPA; prefer fetch_url alone for APIs/JSON/raw HTML facts.",
    "For figma.com links use Figma MCP tools when connected; do not use fetch_url or screenshot_url for Figma designs.",
    "Never say you cannot open external URLs, Figma, or websites when fetch_url / screenshot_url / open_external / MCP tools are available.",
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
  // Build → Agent / UI correction: bind to plan + project patterns; skip Kimi's
  // "read analogous UI and invent" hint; tighter explore limits.
  const implementPlan =
    !readonly && looksLikePlanImplementRequest(options.userText);
  const editCorrection =
    !readonly &&
    !implementPlan &&
    looksLikeEditCorrectionRequest(options.userText);
  const focusedPlanEdit = implementPlan || editCorrection;
  const planQuality = readonly && mode.id === "plan";
  const discardScope =
    !readonly && !implementPlan && !editCorrection
      ? resolveDiscardScope(options.userText)
      : null;
  const discardHint =
    discardScope != null
      ? buildDiscardSystemHint({
          scope: discardScope,
          agentEditedPaths: options.lastAgentEditedPaths || [],
        })
      : "";
  const exploreLimits = exploreRoundLimits({
    kimi: kimiModel,
    implementPlan: focusedPlanEdit,
    planQuality,
  });
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
  const figmaAntiDrift =
    readonly && messageHasFigmaUrl(options.userText)
      ? figmaPlanAntiDriftHint()
      : "";
  const messages: ChatMessage[] = [
    { role: "system", content: config.systemPrompt },
    { role: "system", content: buildEditorContextMessage() },
    { role: "system", content: urlCapabilityHint },
    { role: "system", content: VERIFY_REPO_FACTS_HINT },
    // Focused-edit guidance толкает к search_replace/write_file — в Plan/Ask
    // оба запрещены, не инъектируем, чтобы не конфликтовать с mode-prompt.
    ...(readonly
      ? []
      : [{ role: "system" as const, content: FOCUSED_EDIT_HINT }]),
    ...(figmaAntiDrift
      ? [{ role: "system" as const, content: figmaAntiDrift }]
      : []),
    ...(implementPlan
      ? [{ role: "system" as const, content: buildPlanImplementSystemHint() }]
      : []),
    ...(editCorrection
      ? [{ role: "system" as const, content: buildEditCorrectionSystemHint() }]
      : []),
    ...(discardHint
      ? [{ role: "system" as const, content: discardHint }]
      : []),
    ...(workspaceRules
      ? [
          {
            role: "system" as const,
            content: `Workspace rules (must follow):\n\n${workspaceRules}`,
          },
        ]
      : []),
    // Kimi «read analogous UI» conflicts with Build/correction/discard.
    ...(kimiModel &&
    !agentsMdTurn &&
    !readonly &&
    !focusedPlanEdit &&
    !discardScope
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
  if (options.excludeToolNames?.size) {
    baseTools = baseTools.filter(
      (tool) => !options.excludeToolNames!.has(tool.function.name)
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
  let roundBudget = Math.max(1, options.maxToolRounds ?? config.maxToolRounds);
  // Plan/Ask: планы и объяснения длиннее правок — даём больше выходных токенов,
  // чтобы <proposed_plan> не обрезался посередине (обрезанный тег не матчится
  // парсером карточки в panel.js и план вываливается как raw text без Build).
  const effectiveMaxTokens = readonly
    ? Math.max(config.maxTokens, 8192)
    : config.maxTokens;
  const seenToolCalls = new Set<string>();
  let answered = false;
  let exploreStreak = 0;
  let softNudgeSent = false;
  /** Plan quality: allow soft reminders every softNudgeRounds, not only once. */
  let lastSoftNudgeAtStreak = 0;
  let hardCut = false;
  let hadProductiveTool = false;
  // readonly (Plan/Ask): delegate_task ok / request_user_input ok считаются
  // productive для продления бюджета раундов (правок-то нет).
  let hadReadonlyProductiveTool = false;
  let extensionsUsed = 0;
  let turnHadGitOperation = false;
  let writeNudgeAttempts = 0;
  let hedgeNudgeAttempts = 0;
  let hollowNudgeAttempts = 0;
  let impactNudgeAttempts = 0;
  let deniedWriteNudgeAttempts = 0;
  let askUserNudgeAttempts = 0;
  let planQualityNudgeAttempts = 0;
  let requestUserInputCalls = 0;
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
  const maxAskUserNudges = 2;
  const maxPlanQualityNudges = 2;
  const maxEmptyFinalAttempts = 3;
  const MAX_REQUEST_USER_INPUT_CALLS = 5;
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
      readonly,
    });
    // Kimi Plan/Ask: hard-trim may still run under a tight ceiling, but do not
    // spam the timeline with «Context compacted» every round — it distracts
    // and the soft/summary paths are already disabled for this mode.
    const showCompactionCard =
      (prep.compacted || prep.summarized) &&
      !(kimiModel && readonly && !prep.summarized);
    if (showCompactionCard) {
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
    // No eager placeholder for any model — the Thinking card is created on
    // demand when real reasoning_content or inline think-tags arrive during
    // streaming (onDelta / think-tag filter below). This avoids showing an
    // empty "Thinking…" card while the model has not produced any reasoning.


    const earlyToolIds = new Set<string>();
    /** Reasoning только этого completion — не дописывать в текст прошлых раундов. */
    let roundReasoning = "";
    /**
     * Streaming-фильтр `</welcome>…</welcome>` (DeepSeek-R1 стиль): платформа
     * «ДаВинчи» отдаёт thinking инлайн в `content`. Фильтр режет блок по чанкам
     * и направляет reasoning в Thinking-карточку, а видимый текст — в ответ.
     */
    const thinkFilter = createThinkTagStreamFilter();
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
          const { visible, reasoning } = thinkFilter.consume(delta.content);
          if (reasoning) {
            roundReasoning = appendReasoningDelta(roundReasoning, reasoning);
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
          if (visible) {
            options.callbacks.onAssistantDelta?.(visible);
            emitStep({
              stepId: textStepId,
              kind: "text",
              text: visible,
            });
          }
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
      (isGitMutationCommand(String(parsed.command || "")) ||
        isWorkspaceDiscardCommand(String(parsed.command || "")))
    ) {
      // Successful git restore/clean/checkout OR rm -rf discard — do not
      // demand write_file in honestFinale («Готово, отменил»).
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
          // Failure touches edited files — но если это только «missing module»
          // для ещё не созданных файлов, правильное действие — создать недостающий
          // файл, а не переписывать уже корректный. Иначе Kimi ломает импорты
          // вместо того, чтобы продолжить создавать фичу по плану.
          const missingModules = missingModuleSpecifiersFromOutput(output);
          if (missingModules.length > 0) {
            messages.push({
              role: "user",
              content: [
                `Post-edit verification: \`${step.command}\` failed because some imports in your edited files reference modules that are not created yet:`,
                missingModules.map((m) => `- ${m}`).join("\n"),
                "If these are part of your task, create the missing files with write_file now. Do NOT comment out or remove the imports from the files you already wrote correctly.",
                "If they are pre-existing / unrelated, finish briefly and mention them.",
                output.slice(0, 1_500),
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
      prepareKimiEmptyFinaleMessages(messages, { readonly });
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
        max_tokens: effectiveMaxTokens,
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
          gitOperationCompleted: turnHadGitOperation,
          allowNudgeWrite: false,
          allowNudgeHedge: false,
          allowNudgeHollow: false,
          allowNudgeImpact: false,
          allowNudgeAskUser: false,
          allowNudgePlanQuality: false,
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
      gitOperationCompleted: turnHadGitOperation,
      allowNudgeWrite: writeNudgeAttempts < maxWriteNudges,
      allowNudgeHedge: hedgeNudgeAttempts < maxHedgeNudges,
      allowNudgeHollow:
        hollowNudgeAttempts < maxHollowNudges &&
        deniedWriteNudgeAttempts < maxDeniedWriteNudges,
      allowNudgeImpact: impactNudgeAttempts < maxImpactNudges,
      allowNudgeAskUser: askUserNudgeAttempts < maxAskUserNudges,
      allowNudgePlanQuality:
        planQuality && planQualityNudgeAttempts < maxPlanQualityNudges,
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
    if (decision.kind === "nudge_ask_user") {
      askUserNudgeAttempts += 1;
      messages.push({ role: "user", content: ASK_USER_VIA_TOOL_NUDGE });
      if (round >= roundBudget - 1) {
        roundBudget = round + 2;
      }
      return false;
    }
    if (decision.kind === "nudge_plan_quality") {
      planQualityNudgeAttempts += 1;
      messages.push({ role: "user", content: PLAN_QUALITY_NUDGE });
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

  /**
   * Deliver screenshot media from MCP get_screenshot / screenshot_url.
   * Tool-role messages are text-only. When Settings lists preferred vision
   * models and the chat planner is not among them, Harbor always runs the
   * under-the-hood helper (preferred model looks at the PNG → text labels).
   * Raw image messages go to the planner only when it is itself a preferred
   * vision model (or preferred list is empty and the planner supports vision).
   */
  const deliverVisionMedia = async (
    split: SplitMcpToolResult,
    optionsForMedia: {
      sourceName: string;
      phaseLabel: string;
      stepName: string;
      pointerHint: string;
    }
  ): Promise<string> => {
    if (!split.imageDataUrls.length) {
      return split.text;
    }
    const deliverRaw = shouldDeliverRawScreenshotToPlanner(
      activeTurnModel,
      resolveModelSupportsVision(activeTurnModel),
      config.visionRouting.preferredModelIds
    );
    if (deliverRaw) {
      for (const url of split.imageDataUrls) {
        const value = String(url || "").trim();
        if (value) {
          pendingVisionImageUrls.push(value);
        }
      }
      const pointer = split.text
        ? `${split.text}\n\n[Harbor vision: ${optionsForMedia.pointerHint}]`
        : `[Harbor vision: ${optionsForMedia.pointerHint}]`;
      return pointer;
    }
    const visionStepId = nextStepId("vision");
    options.callbacks.onPhase("reading", optionsForMedia.phaseLabel);
    emitStep({
      stepId: visionStepId,
      kind: "tool",
      name: optionsForMedia.stepName,
      status: "running",
      argsPreview: previewText(optionsForMedia.sourceName, 80),
    });
    try {
      const described = await describeMcpImagesForMainModel({
        imageDataUrls: split.imageDataUrls,
        accompanyingText: split.text,
        visionPreferenceIds: config.visionRouting.preferredModelIds,
        signal: options.signal,
      });
      emitStep({
        stepId: visionStepId,
        kind: "tool",
        name: optionsForMedia.stepName,
        status: "done",
        resultPreview: previewText(described, 160),
      });
      return described;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitStep({
        stepId: visionStepId,
        kind: "tool",
        name: optionsForMedia.stepName,
        status: "error",
        resultPreview: previewText(message, 160),
      });
      return [
        split.text,
        `[Harbor vision helper failed: ${message}. Call request_user_input if concrete labels are still missing.]`,
      ]
        .filter(Boolean)
        .join("\n\n");
    }
  };

  const invokeTool = async (name: string, argsJson: string): Promise<string> => {
    if (name.startsWith("mcp__")) {
      if (!mcp) {
        return JSON.stringify({ error: "MCP is not available" });
      }
      const split = await mcp.callToolWithMedia(name, argsJson || "");
      return deliverVisionMedia(split, {
        sourceName: name,
        phaseLabel: "Vision · Figma screenshot",
        stepName: "vision_figma_screenshot",
        pointerHint:
          "raw screenshot delivered as an image message — use it directly for exact layout, spacing, colors, and labels. Do not re-request get_screenshot.",
      });
    }
    if (name === "screenshot_url") {
      let url = "";
      try {
        const args = argsJson
          ? (JSON.parse(argsJson) as { url?: unknown })
          : {};
        url = String(args.url ?? "");
      } catch {
        return JSON.stringify({ error: "Некорректный JSON аргументов" });
      }
      options.callbacks.onPhase("reading", "Screenshot · page");
      const split = await captureUrlScreenshot({
        url,
        signal: options.signal,
      });
      return deliverVisionMedia(split, {
        sourceName: "screenshot_url",
        phaseLabel: "Vision · page screenshot",
        stepName: "vision_page_screenshot",
        pointerHint:
          "raw page screenshot delivered as an image message — use it together with the visible page text above for layout, colors, and labels. Do not re-request screenshot_url for the same URL.",
      });
    }
    return runMainLikeTool(name, argsJson, {
      readonly,
      model: activeTurnModel,
      signal: options.signal,
    });
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
        max_tokens: effectiveMaxTokens,
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
          contentAsString(hardAssistant.content),
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

    // После soft-nudge убираем list/read (+ delegate в readonly — под-агент ask
    // это тоже исследование); URL/MCP tools оставляем. Применяется и в readonly,
    // чтобы gateway (особенно Kimi) не падал на раздутом tool-контексте.
    const stripExplore =
      hardCut ||
      (exploreLimits.stripExploreOnSoftNudge &&
        exploreStreak >= exploreLimits.softNudgeRounds);
    const roundTools = stripExplore
      ? activeTools.filter(
          (tool) => !isExploreOrDelegatedTool(tool.function.name, readonly)
        )
      : activeTools;

    prepareApiMessages();
    if (completionIntent === "tool_results") {
      ensureToolResultsIntentHint(messages);
    }
    const requestMessages = messages.slice();
    const { message: assistant, usage } = await requestAssistant({
      model: activeTurnModel,
      messages,
      ...(roundTools.length
        ? { tools: roundTools, tool_choice: "auto" as const }
        : { tool_choice: "none" as const }),
      temperature: 0.2,
      max_tokens: effectiveMaxTokens,
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
        contentAsString(roundAssistant.content),
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
              "В этом режиме инструмент недоступен (write_file / search_replace / run_command запрещены). " +
              "План пиши в <proposed_plan>…</proposed_plan>, не в PLAN.md. " +
              "Доступны: list_files / read_file / search_text / fetch_url / screenshot_url / open_external / request_user_input / delegate_task или MCP Figma (get_design_context + get_screenshot, либо get_figma_data на PAT).",
          });
        }
        if (hardCut && isExploreOrDelegatedTool(call.function.name, readonly)) {
          return JSON.stringify({
            error: readonly
              ? "Exploration limit: explore tools are blocked. Write the final <proposed_plan> or answer from gathered context."
              : "Exploration limit: only write_file / search_replace is allowed. Finish the file write now.",
          });
        }
        if (call.function.name === "request_user_input") {
          requestUserInputCalls += 1;
          if (requestUserInputCalls > MAX_REQUEST_USER_INPUT_CALLS) {
            return JSON.stringify({
              ok: false,
              error:
                "Too many request_user_input calls this turn. Stop asking and write the final answer / <proposed_plan> now.",
            });
          }
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
      } else if (
        readonly &&
        (call.function.name === "delegate_task" ||
          call.function.name === "request_user_input")
      ) {
        try {
          const parsed = JSON.parse(result) as { ok?: boolean };
          if (parsed && parsed.ok === true) {
            hadReadonlyProductiveTool = true;
          }
        } catch {
          // ignore
        }
      }
    }

    // Drain MCP screenshots collected this round into a user image message so
    // a vision-capable planner sees the raw pixels (not just the text pointer
    // in the tool result). Keep the HARBOR_VISION_HELPER marker so the
    // context budget does not compact these payloads mid-turn.
    if (pendingVisionImageUrls.length) {
      const urls = pendingVisionImageUrls.splice(0, pendingVisionImageUrls.length);
      const parts: ContentPart[] = [
        {
          type: "text",
          text:
            "[Harbor vision helper · raw screenshot] Figma/MCP screenshot for the tool call(s) above. " +
            "Use this image directly for exact layout, spacing, colors, and visible labels. " +
            "Do not re-request get_screenshot for the same node.",
        },
        ...urls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
      ];
      messages.push({ role: "user", content: parts });
    }

    completionIntent = "tool_results";

    if (roundAdvancesExploreStreak(
      toolCalls.map((c) => c.function.name),
      readonly
    )) {
      exploreStreak += 1;
    } else {
      exploreStreak = 0;
      softNudgeSent = false;
      lastSoftNudgeAtStreak = 0;
    }

    // (2) soft-nudge после N explore-only раундов (Kimi: позже + мягче).
    // Plan quality: напоминание можно повторять — hard-cut explore выключен,
    // иначе незакрытые пункты инвентаря остаются без grounding.
    const softDue =
      exploreStreak >= exploreLimits.softNudgeRounds &&
      !hardCut &&
      (planQuality
        ? exploreStreak - lastSoftNudgeAtStreak >=
          exploreLimits.softNudgeRounds
        : !softNudgeSent);
    if (softDue) {
      softNudgeSent = true;
      lastSoftNudgeAtStreak = exploreStreak;
      options.callbacks.onPhase(
        "thinking",
        planQuality ? "Сверяю пункты с репо…" : "Сокращаю обзор…"
      );
      messages.push({
        role: "user",
        content: buildExploreSoftNudge({
          agentsMd: agentsMdTurn,
          readonly,
          plan: mode.id === "plan",
          kimi: kimiModel,
          implementPlan: focusedPlanEdit,
        }),
      });
    }

    // (3) hard-cut после M explore-only раундов — не в Plan quality
    // (там потолок maxToolRounds + incomplete-plan gate).
    if (
      exploreLimits.hardCutExplore &&
      exploreStreak >= exploreLimits.hardCutRounds
    ) {
      hardCut = true;
      options.callbacks.onPhase("thinking", "Лимит обзора — пишу ответ…");
      messages.push({
        role: "user",
        content: buildExploreHardNudge({
          agentsMd: agentsMdTurn,
          readonly,
          plan: mode.id === "plan",
          implementPlan: focusedPlanEdit,
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
        readonlyProductive: hadReadonlyProductiveTool,
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
      prepareKimiEmptyFinaleMessages(messages, { readonly });
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
        max_tokens: effectiveMaxTokens,
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
      gitOperationCompleted: turnHadGitOperation,
      allowNudgeWrite: false,
      allowNudgeHedge: false,
      allowNudgeHollow: false,
      allowNudgeImpact: false,
      allowNudgeAskUser: false,
      allowNudgePlanQuality: false,
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
