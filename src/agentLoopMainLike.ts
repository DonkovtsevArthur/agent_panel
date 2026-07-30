/**
 * Agent turn один в один как на ветке main (для Qwen).
 * Tools / prompts / client payload / loop — снимок main, не list_agent.
 */
import {
  buildUserApiContent,
  MessageAttachment,
  stripAttachmentPayload,
  userContentForHistory,
} from "./attachments";
import { getConfig, getModeById, resolveModelEndpoint } from "./config";
import { FileEditStat, formatEditTotals } from "./diffStats";
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
  ToolCall,
} from "./openaiClient";
import { sanitizeAssistantText } from "./sanitize";
import {
  isAllowedToolInReadonlyMainLike,
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
import { looksLikeAgentsMdRequest } from "./agentsMd";
import {
  EXPLORE_HARD_CUT_ROUNDS,
  EXPLORE_SOFT_NUDGE_ROUNDS,
  ROUND_EXTENSION_SIZE,
  buildExploreHardNudge,
  buildExploreSoftNudge,
  isExploreOnlyTool,
  roundWasExploreOnly,
  shouldExtendToolRounds,
} from "./toolRoundPolicy";
import { executeToolCallsInOrder } from "./runToolWaves";
import { getMcpManager } from "./mcpBundle";
import { messageHasFigmaUrl } from "./mcp/figma";
import { filterToolsForContext, messageContainsUrl } from "./toolFilter";
import { loadWorkspaceRules } from "./workspaceRules";
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
  // Короткие workspace rules (AGENTS.md + .cursor/rules) — что можно/нельзя править.
  const workspaceRules =
    editorWorkspace.rootPath && !agentsMdTurn
      ? await loadWorkspaceRules(editorWorkspace.rootPath, {
          targetPaths: editorWorkspace.targetPaths,
          charCap: 8_000,
        })
      : undefined;
  const messages: ChatMessage[] = [
    { role: "system", content: config.systemPrompt },
    { role: "system", content: buildEditorContextMessage() },
    { role: "system", content: urlCapabilityHint },
    ...(workspaceRules
      ? [
          {
            role: "system" as const,
            content: `Workspace rules (must follow):\n\n${workspaceRules}`,
          },
        ]
      : []),
    ...(modePrompt
      ? [{ role: "system" as const, content: modePrompt }]
      : []),
    ...priorApi,
    toApiMessage({ role: "user", content: userApiContent }),
  ];

  const allTools = [...mainLikeToolsForPolicy(mode.tools), ...mcpTools];
  const activeTools = filterToolsForContext(allTools, {
    hasUrl: urlInMessage || messageHasFigmaUrl(options.userText),
  });
  const hardCutTools: ChatTool[] = activeTools.filter(
    (tool) => tool.function.name === "write_file"
  );
  const editsByPath = new Map<string, FileEditStat>();
  let roundBudget = Math.max(1, config.maxToolRounds);
  const seenToolCalls = new Set<string>();
  let answered = false;
  let exploreStreak = 0;
  let softNudgeSent = false;
  let hardCut = false;
  let hadProductiveTool = false;
  let extensionsUsed = 0;
  let writeNudgeAttempts = 0;
  let hedgeNudgeAttempts = 0;
  let hollowNudgeAttempts = 0;
  let impactNudgeAttempts = 0;
  let deniedWriteNudgeAttempts = 0;
  const maxWriteNudges = 3;
  const maxHedgeNudges = 2;
  const maxHollowNudges = 2;
  const maxImpactNudges = 2;
  const maxDeniedWriteNudges = 2;

  const turnHadRealFileEdit = (): boolean => {
    for (const edit of editsByPath.values()) {
      if (edit.created || edit.added > 0 || edit.removed > 0) {
        return true;
      }
    }
    return false;
  };

  const publishAssistantFinale = async (rawText: string): Promise<void> => {
    const text = sanitizeAssistantText(rawText.trim() || "(пустой ответ)", {
      maxChars: config.maxResponseChars,
    });
    const last = messages[messages.length - 1];
    if (
      last?.role === "assistant" &&
      !(last.tool_calls && last.tool_calls.length > 0)
    ) {
      messages[messages.length - 1] = { role: "assistant", content: text };
    } else {
      messages.push({ role: "assistant", content: text });
    }
    options.callbacks.onPhase("done", modeDoneLabel(mode));
    options.callbacks.onAssistant(text);
    await Promise.resolve(
      options.callbacks.onReview([...editsByPath.values()])
    );
    answered = true;
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
    const decision = decideHonestFinale({
      text: trimmed || "(пустой ответ)",
      canEdit: !readonly,
      messages,
      userText: options.userText,
      hadSuccessfulWrite: turnHadRealFileEdit(),
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

  for (let round = 0; round < roundBudget; round++) {
    if (options.signal?.aborted) {
      throw new Error("aborted");
    }

    // (3) hard-cut: explore закрыт — только write_file (agent) или сразу финал (readonly).
    if (hardCut) {
      if (readonly || hardCutTools.length === 0) {
        break;
      }
      options.callbacks.onPhase("thinking", "Пишу результат…");
      const hardRequest = messages.slice();
      const { message: assistant, usage } = await client.chatCompletions(
        {
          model: options.model,
          messages,
          tools: hardCutTools,
          tool_choice: "auto",
          temperature: 0.2,
          max_tokens: config.maxTokens,
        },
        options.signal
      );
      reportUsage(usage, hardRequest);

      const toolCalls = (assistant.tool_calls ?? []).filter(
        (call) => call?.function?.name
      );
      messages.push({
        role: "assistant",
        content: assistant.content ?? null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      });

      if (toolCalls.length === 0) {
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
          options.callbacks.onTool(
            `⚙ ${call.function.name}(${call.function.arguments})`
          );
        },
        invokeOne: async (call) => {
          if (call.function.name !== "write_file") {
            return JSON.stringify({
              error:
                "Exploration limit: only write_file is allowed. Finish the file write now.",
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
        if (call.function.name === "write_file") {
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
      // После hard-cut write-раунда — финальный текст без tools.
      break;
    }

    options.callbacks.onPhase("thinking", modeThinkingLabel(mode));

    // После soft-nudge убираем list/read; URL/MCP tools оставляем.
    const roundTools =
      exploreStreak >= EXPLORE_SOFT_NUDGE_ROUNDS && !readonly
        ? activeTools.filter((tool) => !isExploreOnlyTool(tool.function.name))
        : activeTools;

    const requestMessages = messages.slice();
    const { message: assistant, usage } = await client.chatCompletions(
      {
        model: options.model,
        messages,
        ...(roundTools.length
          ? { tools: roundTools, tool_choice: "auto" as const }
          : { tool_choice: "none" as const }),
        temperature: 0.2,
        max_tokens: config.maxTokens,
      },
      options.signal
    );
    reportUsage(usage, requestMessages);

    const toolCalls = (assistant.tool_calls ?? []).filter(
      (call) => call?.function?.name
    );

    messages.push({
      role: "assistant",
      content: assistant.content ?? null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    });

    if (toolCalls.length === 0) {
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
        options.callbacks.onTool(
          `⚙ ${call.function.name}(${call.function.arguments})`
        );
      },
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

      if (call.function.name === "write_file") {
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
      }
    }

    if (roundWasExploreOnly(toolCalls.map((c) => c.function.name))) {
      exploreStreak += 1;
    } else {
      exploreStreak = 0;
      softNudgeSent = false;
    }

    // (2) soft-nudge после 2 explore-only раундов.
    if (
      exploreStreak >= EXPLORE_SOFT_NUDGE_ROUNDS &&
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
        }),
      });
    }

    // (3) hard-cut после 4 explore-only раундов.
    if (exploreStreak >= EXPLORE_HARD_CUT_ROUNDS) {
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

    const finalRequest = [
      ...messages,
      {
        role: "user" as const,
        content: modeFinalNudge(mode),
      },
    ];
    const { message: finalMessage, usage: finalUsage } =
      await client.chatCompletions(
        {
          model: options.model,
          messages: finalRequest,
          temperature: 0.2,
          max_tokens: config.maxTokens,
        },
        options.signal
      );
    reportUsage(finalUsage, finalRequest);

    let text = contentAsString(finalMessage.content).trim();
    if (!text && finalMessage.tool_calls?.length) {
      text =
        "Модель продолжила вызывать инструменты. Попробуйте другую модель (например DeepSeek-V4-Flash) или уточните задачу.";
    }
    const forcedDecision = decideHonestFinale({
      text: text || "(пустой ответ)",
      canEdit: !readonly,
      messages: [
        ...messages,
        { role: "assistant", content: text || "(пустой ответ)" },
      ],
      userText: options.userText,
      hadSuccessfulWrite: turnHadRealFileEdit(),
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
    { role: "assistant", content: finalAssistant || "(пустой ответ)" },
  ]);
}
