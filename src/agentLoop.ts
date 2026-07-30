import {
  buildUserApiContent,
  MessageAttachment,
  stripAttachmentPayload,
  userContentForHistory,
} from "./attachments";
import {
  getConfig,
  getContextWindow,
  getModeById,
  resolveModelEndpoint,
} from "./config";
import { applyContextBudget, estimateTokens } from "./contextBudget";
import { compactHistoryWithSummary } from "./historySummary";
import { FileEditStat, formatEditTotals } from "./diffStats";
import {
  buildActiveFilePrefetchMessage,
  buildEditorContextMessage,
  getEditorWorkspaceContext,
} from "./editorContext";
import { buildPathAliasContextMessage } from "./pathAliasContext";
import {
  modeCollectLabel,
  modeDoneLabel,
  modeFinalNudge,
  modeThinkingLabel,
  isReadonlyPolicy,
  toolsForPolicy,
} from "./modes";
import {
  listDirtyPaths,
  mergeNewlyDirtyEdits,
} from "./turnFileChanges";
import {
  ChatCompletionUsage,
  ChatMessage,
  ContentPart,
  OpenAICompatibleClient,
  shouldContinueAfterLength,
  ToolCall,
  type ChatCompletionRequest,
} from "./openaiClient";
import { sanitizeAssistantText } from "./sanitize";
import { messageHasFigmaUrl } from "./mcp/figma";
import { getMcpManager } from "./mcpBundle";
import { parseTextToolCalls } from "./parseTextToolCalls";
import {
  decideHonestFinale,
  HEDGE_USER_NUDGE,
  HOLLOW_USER_NUDGE,
  IMPACT_USER_NUDGE,
  MISSING_WRITE_USER_NUDGE,
} from "./honestFinale";
import { runTool } from "./tools";
import { planToolWaves, isParallelSafeTool } from "./toolParallel";
import { filterToolsForContext, messageContainsUrl } from "./toolFilter";
import {
  looksLikeAmbiguousRestoreRequest,
  looksLikeDiscardAllChangesRequest,
} from "./discardChanges";
import {
  isGitMutationCommand,
  isGitPushCommand,
  isGitStatusCommand,
} from "./gitCommandPolicy";
import { resolveModelCapabilities } from "./modelCapabilities";
import { shouldAbandonHelperModel } from "./modelRouting";
import { loadWorkspaceRules } from "./workspaceRules";
import { IMAGE_UNTRUSTED_CONTENT_SYSTEM_HINT } from "./imagePromptPolicy";
import {
  decideVerificationStep,
  isProjectVerificationCommand,
  isTargetedTestCommand,
  MAX_PROJECT_COMMANDS_PER_TURN,
  MAX_TARGETED_TEST_COMMANDS_PER_TURN,
  selectProjectVerificationCommand,
} from "./verificationLoop";
import * as fs from "fs";
import * as path from "path";
import type * as vscode from "vscode";

function toApiMessage(message: ChatMessage): ChatMessage {
  const { attachments: _a, ...rest } = message;
  return rest;
}

export type AgentPhase =
  | "thinking"
  | "reading"
  | "listing"
  | "running"
  | "editing"
  | "verifying"
  | "done";

export interface ContextUsageInfo {
  /** Занято токенов в окне (обычно prompt + completion последнего запроса). */
  used: number;
  promptTokens: number;
  completionTokens: number;
}

export interface AgentRunCallbacks {
  onPhase: (phase: AgentPhase, detail?: string) => void;
  onTool: (text: string) => void;
  onFileEdit: (edit: FileEditStat) => void;
  /** Поток текста ассистента (SSE). */
  onAssistantDelta?: (text: string) => void;
  /** Сбросить незавершённый stream-бабл (tools / nudge). */
  onAssistantStreamClear?: () => void;
  onAssistant: (text: string) => void;
  /** Может быть async (SCM check) — ждём, иначе review теряется в finally. */
  onReview: (edits: FileEditStat[]) => void | Promise<void>;
  onUsage?: (usage: ContextUsageInfo) => void;
  /** User pasted a Figma URL but MCP is not connected. */
  onFigmaNeedsConnect?: () => void;
  /** Active completion model changed (e.g. helper 5xx → selected). */
  onActiveModel?: (modelId: string) => void;
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

function summarizeEditsFallback(edits: Map<string, FileEditStat>): string {
  const files = [...edits.keys()];
  if (!files.length) {
    return "";
  }
  const listed = files
    .slice(0, 8)
    .map((p) => `• ${p}`)
    .join("\n");
  const more =
    files.length > 8 ? `\n…и ещё ${files.length - 8} файл(ов)` : "";
  return `Готово. Изменения применены (${files.length}):\n${listed}${more}`;
}

function summarizeToolActivity(messages: ChatMessage[]): string {
  const names: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "assistant" || !msg.tool_calls?.length) {
      continue;
    }
    for (const call of msg.tool_calls) {
      const name = call.function?.name;
      if (name) {
        names.push(name);
      }
    }
  }
  if (!names.length) {
    return "";
  }
  const counts = new Map<string, number>();
  for (const name of names) {
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const lines = [...counts.entries()]
    .map(([name, count]) => (count > 1 ? `• ${name} ×${count}` : `• ${name}`))
    .join("\n");
  return `Модель выполнила инструменты, но не вернула итоговый текст.\n\nЧто было сделано:\n${lines}\n\nПопробуйте повторить запрос или сменить модель.`;
}

function finalizeAssistantText(
  raw: string,
  edits: Map<string, FileEditStat>,
  maxChars: number,
  messages?: ChatMessage[]
): string {
  const trimmed = String(raw || "").trim();
  if (trimmed && trimmed !== "(пустой ответ)") {
    return sanitizeAssistantText(trimmed, { maxChars });
  }
  const fromEdits = summarizeEditsFallback(edits);
  if (fromEdits) {
    return sanitizeAssistantText(fromEdits, { maxChars });
  }
  const fromTools = messages ? summarizeToolActivity(messages) : "";
  if (fromTools) {
    return sanitizeAssistantText(fromTools, { maxChars });
  }
  return sanitizeAssistantText(
    "Не удалось получить текстовый ответ модели. Попробуйте повторить запрос или сменить модель.",
    { maxChars }
  );
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
    case "search_text": {
      const query = String(args.query || "").trim();
      return {
        phase: "reading",
        detail: query ? `Ищет · ${truncateStatus(query)}` : "Ищет…",
      };
    }
    case "get_diagnostics": {
      return {
        phase: "verifying",
        detail: "Проверяет Problems…",
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
        detail: path ? `Изменяет · ${truncateStatus(path)}` : "Редактирует…",
      };
    }
    case "open_external": {
      const url = String(args.url || "").trim();
      return {
        phase: "running",
        detail: url ? `Открывает · ${truncateStatus(url)}` : "Открывает URL…",
      };
    }
    case "fetch_url": {
      const url = String(args.url || "").trim();
      return {
        phase: "reading",
        detail: url ? `Читает URL · ${truncateStatus(url)}` : "Читает URL…",
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

/** Для следующего хода: user + финальные assistant, длинную историю сворачиваем. */
export function compactHistory(messages: ChatMessage[]): ChatMessage[] {
  return compactHistoryWithSummary(messages);
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

function contentAsString(content: ChatMessage["content"]): string {
  if (!content) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  const bits: string[] = [];
  for (const part of content as Array<Record<string, unknown>>) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const type = String(part.type || "");
    if (
      (type === "text" || type === "output_text" || type === "input_text") &&
      typeof part.text === "string"
    ) {
      bits.push(part.text);
      continue;
    }
    if (typeof part.text === "string" && part.text.trim()) {
      bits.push(part.text);
    }
  }
  return bits.join("\n").trim();
}

function extractAssistantText(message: ChatMessage): string {
  const direct = contentAsString(message.content).trim();
  if (direct) {
    return direct;
  }
  // Не берём reasoning_content как ответ пользователю — это thinking, не финал.
  const raw = message as ChatMessage & { output_text?: unknown };
  if (typeof raw.output_text === "string" && raw.output_text.trim()) {
    return raw.output_text.trim();
  }
  return "";
}

function readPackageScripts(
  workspaceRoot: string | undefined
): Record<string, unknown> | undefined {
  if (!workspaceRoot) {
    return undefined;
  }
  try {
    const raw = fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { scripts?: unknown };
    return parsed.scripts && typeof parsed.scripts === "object"
      ? (parsed.scripts as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function reasoningFromApi(message: ChatMessage): string | undefined {
  const value = message.reasoning_content;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Assistant-ход для history/API: с tool_calls и reasoning_content как у Kimi. */
function buildAssistantTurn(
  apiMessage: ChatMessage,
  visibleContent: string,
  toolCalls?: NonNullable<ChatMessage["tool_calls"]>
): ChatMessage {
  const hasTools = Boolean(toolCalls?.length);
  const trimmed = visibleContent.trim();
  const msg: ChatMessage = {
    role: "assistant",
    content: trimmed ? visibleContent : hasTools ? null : visibleContent,
  };
  if (hasTools && toolCalls) {
    msg.tool_calls = toolCalls;
  }
  const reasoning = reasoningFromApi(apiMessage);
  if (reasoning) {
    msg.reasoning_content = reasoning;
  }
  return msg;
}

async function hydrateHistoryForApi(
  history: ChatMessage[],
  storageUri: vscode.Uri | undefined,
  supportsVision: boolean
): Promise<ChatMessage[]> {
  const out: ChatMessage[] = [];
  for (const message of history) {
    if (message.role === "user" && message.attachments?.length) {
      const text =
        typeof message.content === "string"
          ? message.content
          : contentPartsToHistoryText(message.content || []);
      // В history текст уже с маркерами [image]/[file] — для API берём «чистый» текст
      // из первого маркера-свободного куска сложно; проще пересобрать из attachments,
      // передав текст без хвостовых маркеров.
      const cleanText = text
        .replace(/\n?\[image: [^\]]+\]/g, "")
        .replace(/\n?\[file: [^\]]+\]/g, "")
        .trim();
      const compatibleAttachments = supportsVision
        ? message.attachments
        : message.attachments.filter((attachment) => attachment.kind !== "image");
      const omittedImages =
        compatibleAttachments.length < message.attachments.length;
      const compatibleText = omittedImages
        ? [cleanText, "[image from an earlier turn omitted for this model]"]
            .filter(Boolean)
            .join("\n")
        : cleanText;
      const content = compatibleAttachments.length
        ? await buildUserApiContent(
            compatibleText,
            compatibleAttachments,
            storageUri
          )
        : compatibleText;
      out.push(toApiMessage({ role: "user", content }));
      continue;
    }
    out.push(toApiMessage(message));
  }
  return out;
}

export async function runAgentTurn(options: {
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
  const prior = compactHistory(options.history);
  const persistedAttachments = (options.attachments || []).map(
    stripAttachmentPayload
  );

  if (
    !isReadonlyPolicy(mode.tools) &&
    looksLikeAmbiguousRestoreRequest(options.userText)
  ) {
    const answer =
      "Что именно вернуть: конкретные файлы, последний коммит или все локальные изменения? Укажите объект отката — без этого я не буду запускать широкие restore/delete-команды.";
    options.callbacks.onPhase("done", modeDoneLabel(mode));
    options.callbacks.onAssistant(answer);
    const historyUser: ChatMessage = {
      role: "user",
      content: userContentForHistory(options.userText, persistedAttachments),
    };
    if (persistedAttachments.length) {
      historyUser.attachments = persistedAttachments;
    }
    return compactHistory([
      ...prior,
      historyUser,
      { role: "assistant", content: answer },
    ]);
  }

  // Для однозначного discard-all модель не нужна: иначе она начинает читать
  // файлы, делать git show и даже переписывать содержимое вместо простого отката.
  if (
    !isReadonlyPolicy(mode.tools) &&
    looksLikeDiscardAllChangesRequest(options.userText)
  ) {
    const runCommand = async (command: string): Promise<{
      ok?: boolean;
      stdout?: string;
      stderr?: string;
    }> => {
      options.callbacks.onPhase("running", `Запускает · ${command}`);
      options.callbacks.onTool(`⚙ run_command(${JSON.stringify({ command })})`);
      const raw = await runTool(
        "run_command",
        JSON.stringify({ command }),
        { signal: options.signal, userText: options.userText }
      );
      try {
        return JSON.parse(raw) as {
          ok?: boolean;
          stdout?: string;
          stderr?: string;
        };
      } catch {
        return { ok: false, stderr: raw };
      }
    };

    const status = await runCommand("git status --short");
    let answer: string;
    if (!status.ok) {
      answer = `Не удалось проверить изменения: ${(status.stderr || "неизвестная ошибка").trim()}`;
    } else if (!(status.stdout || "").trim()) {
      answer = "Локальных изменений нет — убирать нечего.";
    } else {
      const hasTracked = (status.stdout || "")
        .split(/\r?\n/)
        .some((line) => line && !line.startsWith("??"));
      const hasUntracked = (status.stdout || "")
        .split(/\r?\n/)
        .some((line) => line.startsWith("??"));

      let failed = "";
      if (hasTracked) {
        const restored = await runCommand("git restore --staged --worktree .");
        if (!restored.ok) {
          failed = (restored.stderr || "git restore завершился ошибкой").trim();
        }
      }
      if (!failed && hasUntracked) {
        const cleaned = await runCommand("git clean -fd");
        if (!cleaned.ok) {
          failed = (cleaned.stderr || "git clean завершился ошибкой").trim();
        }
      }

      if (failed) {
        answer = `Не удалось убрать все изменения: ${failed}`;
      } else {
        const verify = await runCommand("git status --short");
        answer =
          verify.ok && !(verify.stdout || "").trim()
            ? "Все локальные изменения убраны."
            : `Не все изменения удалось убрать:\n${(
                verify.stdout ||
                verify.stderr ||
                "неизвестная ошибка"
              ).trim()}`;
      }
    }

    options.callbacks.onPhase("done", modeDoneLabel(mode));
    options.callbacks.onAssistant(answer);
    const historyUser: ChatMessage = {
      role: "user",
      content: userContentForHistory(options.userText, persistedAttachments),
    };
    if (persistedAttachments.length) {
      historyUser.attachments = persistedAttachments;
    }
    return compactHistory([
      ...prior,
      historyUser,
      { role: "assistant", content: answer },
    ]);
  }

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

  const editClient = new OpenAICompatibleClient(endpoint.baseUrl, endpoint.apiKey, {
    rejectUnauthorized: config.rejectUnauthorized,
    caBundlePath: config.caBundlePath,
  });

  const exploreModelId = String(options.exploreModel || "").trim();
  const useExplore =
    Boolean(exploreModelId) &&
    exploreModelId !== options.model &&
    !isReadonlyPolicy(mode.tools);
  const helperFallbackModelId = String(
    options.helperFallbackModel || ""
  ).trim();
  const useHelperFallback =
    Boolean(helperFallbackModelId) &&
    helperFallbackModelId !== options.model &&
    !useExplore;

  const createClient = (modelId: string, label: string): OpenAICompatibleClient => {
    const modelEndpoint = resolveModelEndpoint(modelId);
    if (!modelEndpoint.baseUrl) {
      throw new Error(
        `Не задан baseUrl для «${modelEndpoint.providerName}»${label}. Укажите провайдера у модели.`
      );
    }
    if (!modelEndpoint.apiKey) {
      throw new Error(
        `Не задан API key для «${modelEndpoint.providerName}»${label}. Укажите ключ у провайдера.`
      );
    }
    return new OpenAICompatibleClient(
      modelEndpoint.baseUrl,
      modelEndpoint.apiKey,
      {
        rejectUnauthorized: config.rejectUnauthorized,
        caBundlePath: config.caBundlePath,
      }
    );
  };

  let exploreClient: OpenAICompatibleClient | undefined;
  if (useExplore) {
    exploreClient = createClient(exploreModelId, " (explore)");
  }
  let helperFallbackClient: OpenAICompatibleClient | undefined;
  if (useHelperFallback) {
    helperFallbackClient = createClient(
      helperFallbackModelId,
      " (helper fallback)"
    );
  }
  let speedPhase: "explore" | "edit" = useExplore ? "explore" : "edit";
  let exploreRoundsUsed = 0;
  const maxExploreRounds = 6;
  let helperAbandoned = false;
  let activeModelOverride: string | undefined;

  const clientForModel = (modelId: string): OpenAICompatibleClient => {
    if (useExplore && exploreClient && modelId === exploreModelId) {
      return exploreClient;
    }
    if (
      useHelperFallback &&
      helperFallbackClient &&
      modelId === helperFallbackModelId
    ) {
      return helperFallbackClient;
    }
    return editClient;
  };

  const priorApi = await hydrateHistoryForApi(
    prior,
    options.storageUri,
    resolveModelCapabilities(options.model).supportsVision
  );
  const hasImageAttachment = Boolean(
    options.attachments?.some((attachment) => attachment.kind === "image")
  );
  const userApiContent = await buildUserApiContent(
    options.userText,
    options.attachments,
    options.storageUri
  );
  const mcp = getMcpManager();
  const figmaEnabled = config.figma.enabled;
  const mcpTools = mcp
    ? await mcp.listOpenAiTools(isReadonlyPolicy(mode.tools))
    : [];
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

  const modePrompt = mode.prompt?.trim();
  const toolNames = mcpTools.map((t) => t.function.name);
  const mcpHint =
    mcp?.buildSystemHint(toolNames) ||
    [
      "No MCP tools are currently connected.",
      "You CAN access http(s) URLs via fetch_url / open_external — never claim you cannot open external URLs.",
    ].join(" ");
  const urlInMessage =
    messageContainsUrl(options.userText || "") ||
    Boolean(
      options.attachments?.some((attachment) =>
        messageContainsUrl(
          `${attachment.name || ""} ${attachment.mime || ""}`
        )
      )
    );
  const allTools = toolsForPolicy(mode.tools, mcpTools);
  const activeTools = filterToolsForContext(allTools, {
    hasUrl: urlInMessage,
  });
  const urlToolsHidden = activeTools.length !== allTools.length;
  const exploreTools = useExplore
    ? activeTools.filter((tool) => isParallelSafeTool(tool.function.name))
    : activeTools;
  const toolsCapabilityHint = [
    `Built-in tools available this turn: ${activeTools
      .filter((t) => !t.function.name.startsWith("mcp__"))
      .map((t) => t.function.name)
      .join(", ")}.`,
    urlToolsHidden
      ? "fetch_url/open_external are hidden this turn because the message has no URL; if the user pastes a link, they will be available."
      : "",
    useExplore
      ? "Speed routing: first gather context with read-only tools in batches (search_text to locate, then several read_file/list_files in one turn). When you have enough evidence, stop calling tools — a stronger model will implement edits and answer next."
      : "",
    hasImageAttachment ? IMAGE_UNTRUSTED_CONTENT_SYSTEM_HINT : "",
    !isReadonlyPolicy(mode.tools)
      ? [
          "Agent mode has search_replace and write_file available this turn — never claim that file-editing tools are unavailable. Prefer search_replace for focused edits to existing files; use write_file for new files or intentional full rewrites.",
          "To find where something is defined or used, call search_text instead of reading files blindly; for big files read a range with read_file startLine/endLine instead of the whole file.",
          "When gathering context, call several read_file / list_files / search_text in one turn — they run in parallel.",
          "A short ambiguous restore request such as «верни» / «откати» has no safe target: ask whether to restore specific files, a commit, or all local changes. Do not call tools, write_file, rm, or broad git restore until the target is explicit.",
          "When the user asks to discard/revert ALL local changes (убери/отмени все изменения / откатить всё / git restore / discard changes): do NOT read_file the changed files. Run git only: `git status --short`, then `git restore .` and `git clean -fd` if needed (or restore specific paths). Confirm with status. Never rewrite files via write_file to «undo».",
          "A successful git restore/revert/reset/clean is a real file change and does not require write_file. After verifying with git status, do not read the restored files. Final reply: one short sentence about the Git outcome only (e.g. «Все локальные изменения убраны.»). Never mention write_file, search_replace, or that editing tools were unused.",
          "For commit/push: NEVER run `git commit` or `git push` (or chains with them) via run_command — they are blocked. After file edits the panel shows a «Commit and push» tag; tell the user to use that tag. Do not stage-and-push yourself.",
          "Never use `git add --all`, `git add -A`, `git add .`, or `git commit -a` unless the user explicitly asks to include every local change.",
          "When the user asks to implement or change code, call search_replace or write_file yourself and apply the changes.",
          "When the user asks where something was BEFORE changes (до правок / до начала изменений / как было раньше / look again where X was), do NOT call write_file. Use run_command with git: `git show HEAD:path`, `git diff HEAD -- path`, or `git log -p -- path`, then answer from that output only. Never claim you rewrote the file after an inspect-only question.",
          "Never say «Готово» / «исправлено» for code edits unless you already called search_replace or write_file in this turn. After a successful git restore/revert/reset/clean, a short Git result is enough.",
          "Never invent import paths: use tsconfig aliases from context, copy imports from sibling files, and fix importWarnings from edit tools.",
          "After editing, the edit tool result already includes diagnostics for the changed file — fix reported errors before finishing; call get_diagnostics again only if you edited more files.",
          "Do not speculate about TypeScript/build errors. If you need to verify, call run_command (tsc/npm run build) or read_file; never say «возможно» / «если TS ругается» / «попробую пересобрать» without doing it.",
          "For TypeScript verification, run `npx tsc --project tsconfig.json --noEmit`; never combine --project with source files and never verify project code by passing files directly. Do not pipe tsc/vitest/jest/test output through head or tail because that hides the real exit code; run the command directly because tool output is already truncated.",
          "When a behavior or return value changes, inspect related tests before finishing. If an existing test asserts the old behavior, update that test in the same turn and run exactly that test file with `npx vitest run <path>` or `npx jest <path>`. Do not ask the user whether to update an obviously stale expectation.",
          "Before changing shared UI (shared/, components/, toast/notification/modal), search usages with run_command (rg) and update call sites or keep backwards-compatible props. Never unilaterally break consumers and never end with «скажи — верну/переделаю».",
          "Never ask the user to copy/paste code, never say «вставь вручную / apply manually», and never dump full file replacements for manual application.",
          "After editing, reply briefly with what you changed.",
        ].join(" ")
      : "",
    ...(urlToolsHidden
      ? []
      : [
          "Whenever the user shares an http(s) link and asks ANYTHING about that page (facts, summary, colors, price, author, version, features, text), IMMEDIATELY call fetch_url on the URL before answering.",
          "Answer only from the tool result (title, description, headings, content, colors, links, jsonLd). Never say you cannot open/load/access external URLs.",
          "Do not invent login/authorization requirements unless the tool result clearly shows HTTP 401/403 or an explicit auth page.",
          "If spaShell is true or content is sparse, report what was found and what is missing; do not refuse. Use open_external only if the user wants the browser opened.",
        ]),
    "Questions about Harbor Agents / this extension branding: also read package.json (galleryBanner) and media/icon-marketplace.png via read_file.",
    "Never print tool calls as XML/DSML/text. Use native function/tool calling only.",
    urlInMessage
      ? "This user message contains at least one URL — call fetch_url for it if the question refers to that link."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const pathAliasContext = await buildPathAliasContextMessage();
  const editorWorkspace = getEditorWorkspaceContext();
  const projectVerification = selectProjectVerificationCommand(
    readPackageScripts(editorWorkspace.rootPath)
  );
  const workspaceRules = editorWorkspace.rootPath
    ? await loadWorkspaceRules(editorWorkspace.rootPath, {
        targetPaths: editorWorkspace.targetPaths,
      })
    : undefined;
  const messages: ChatMessage[] = [
    // Сначала стабильные блоки — провайдерный prefix cache (Kimi/DeepSeek)
    // держит их между ходами; volatile-контекст уходит в хвост к user message.
    { role: "system", content: config.systemPrompt },
    { role: "system", content: pathAliasContext },
    ...(workspaceRules
      ? [
          {
            role: "system" as const,
            content: `Workspace rules (must follow):\n\n${workspaceRules}`,
          },
        ]
      : []),
    {
      role: "system",
      content: mcpHint,
    },
    ...(modePrompt
      ? [{ role: "system" as const, content: modePrompt }]
      : []),
    { role: "system", content: toolsCapabilityHint },
    ...priorApi,
    // Volatile: время, активный файл, выделение — меняется каждый ход.
    { role: "system", content: buildEditorContextMessage() },
    ...(() => {
      const prefetch = buildActiveFilePrefetchMessage();
      return prefetch ? [{ role: "system" as const, content: prefetch }] : [];
    })(),
    toApiMessage({ role: "user", content: userApiContent }),
  ];

  const allowedToolNames = new Set(activeTools.map((t) => t.function.name));
  const exploreAllowedToolNames = new Set(
    exploreTools.map((t) => t.function.name)
  );
  const editsByPath = new Map<string, FileEditStat>();
  // Dirty-файл на старте хода — чтобы в review/commit попали ещё и правки
  // через shell (vitest -u, sed, …), не только write_file/search_replace.
  const baselineDirtyPaths = await listDirtyPaths();
  const publishTurnReview = async () => {
    const edits = await mergeNewlyDirtyEdits(editsByPath, baselineDirtyPaths);
    await Promise.resolve(options.callbacks.onReview(edits));
  };
  let successfulGitPush = false;
  let successfulGitMutation = false;
  let gitMutationVerified = false;
  /** Base limit from settings; auto-extends by +10 while model still needs tools. */
  const isFastPlan = mode.id === "plan";
  const isFastAsk = mode.id === "ask";
  let roundLimit = isFastPlan
    ? Math.min(Math.max(1, config.maxToolRounds), 8)
    : isFastAsk
      ? Math.min(Math.max(1, config.maxToolRounds), 4)
      : Math.max(1, config.maxToolRounds);
  // Plan стартует с 8, но сложный анализ может автоматически продлиться до 12,
  // только если модель всё ещё вызывает tools. Ask остаётся жёстко коротким.
  const hardCap = isFastPlan
    ? config.maxToolRounds >= 8
      ? 12
      : roundLimit
    : isFastAsk
      ? roundLimit
      : Math.max(roundLimit, 60);
  const extendStep = 10;
  const seenToolCalls = new Set<string>();
  let answered = false;
  // Иногда модель завершает шаг без текстового assistant.content (только tool output),
  // и тогда UI показывает "(пустой ответ)". Дадим модели один дополнительный шанс.
  let emptyFinalAttempts = 0;
  const maxEmptyFinalAttempts = 3;
  // Модель иногда врёт «инструменты недоступны» / «Готово», не вызывая edit tool.
  let manualPatchAttempts = 0;
  const maxManualPatchAttempts = 3;
  let importFixAttempts = 0;
  const pendingImportWarnings: string[] = [];
  let noOpWriteAttempts = 0;
  const pendingNoOpWrites: string[] = [];
  let hedgeAttempts = 0;
  const maxHedgeAttempts = 2;
  let hollowAttempts = 0;
  const maxHollowAttempts = 2;
  let impactAttempts = 0;
  const maxImpactAttempts = 2;
  let diagnosticsChecks = 0;
  let diagnosticFixAttempts = 0;
  let diagnosticsCheckedAfterLastEdit = true;
  const pendingDiagnosticErrors: string[] = [];
  let projectCommandAttempts = 0;
  let targetedTestCommandAttempts = 0;
  let lengthContinuations = 0;
  const maxLengthContinuations = 2;
  const lengthSegments: string[] = [];

  const modelRow = config.models.find((m) => m.id === options.model);
  const configuredMaxTokens =
    modelRow?.maxOutputTokens && modelRow.maxOutputTokens > 0
      ? modelRow.maxOutputTokens
      : config.maxTokens;
  const editMaxTokens = isFastPlan
    ? Math.min(configuredMaxTokens, 4096)
    : isFastAsk
      ? Math.min(configuredMaxTokens, 2048)
    : configuredMaxTokens;
  const exploreModelRow = useExplore
    ? config.models.find((m) => m.id === exploreModelId)
    : undefined;
  const exploreConfiguredMaxTokens =
    exploreModelRow?.maxOutputTokens && exploreModelRow.maxOutputTokens > 0
      ? exploreModelRow.maxOutputTokens
      : config.maxTokens;
  const exploreMaxTokens = Math.min(exploreConfiguredMaxTokens, 4096);

  const resolveRoundModel = (): string => {
    if (activeModelOverride) {
      return activeModelOverride;
    }
    return speedPhase === "explore" && useExplore
      ? exploreModelId
      : options.model;
  };
  const resolveRoundMaxTokens = (): number => {
    const modelId = resolveRoundModel();
    if (modelId === exploreModelId && useExplore) {
      return exploreMaxTokens;
    }
    if (modelId === helperFallbackModelId && useHelperFallback) {
      const row = config.models.find((m) => m.id === helperFallbackModelId);
      const configured =
        row?.maxOutputTokens && row.maxOutputTokens > 0
          ? row.maxOutputTokens
          : config.maxTokens;
      return configured;
    }
    return editMaxTokens;
  };
  const resolveRoundMinimumOutputTokens = (): number | undefined => {
    const caps = resolveModelCapabilities(resolveRoundModel());
    if (!caps.minimumOutputTokens) {
      return undefined;
    }
    if (speedPhase === "explore" && useExplore && !activeModelOverride) {
      return Math.min(caps.minimumOutputTokens, 2048);
    }
    return isFastAsk ? 2048 : caps.minimumOutputTokens;
  };

  const abandonHelperToSelected = (failedModelId: string): void => {
    helperAbandoned = true;
    clearStreamUi();
    let nextModel = options.model;
    if (speedPhase === "explore" && useExplore) {
      speedPhase = "edit";
      nextModel = options.model;
    } else if (useHelperFallback) {
      activeModelOverride = helperFallbackModelId;
      nextModel = helperFallbackModelId;
    }
    options.callbacks.onActiveModel?.(nextModel);
    options.callbacks.onPhase(
      "thinking",
      `${failedModelId} недоступна — продолжаю на выбранной модели...`
    );
  };

  let streamUiActive = false;
  const clearStreamUi = () => {
    if (streamUiActive) {
      options.callbacks.onAssistantStreamClear?.();
      streamUiActive = false;
    }
  };
  const sealStreamUi = () => {
    streamUiActive = false;
  };
  const completeChat = async (body: ChatCompletionRequest) => {
    clearStreamUi();
    const modelId = body.model || resolveRoundModel();
    const reservedOutputTokens = Math.max(
      body.max_tokens || 0,
      body.minimum_output_tokens ||
        (modelId === resolveRoundModel()
          ? resolveRoundMinimumOutputTokens() || 0
          : 0)
    );
    const contextWindow = getContextWindow(modelId);
    const hardBudget = Math.max(
      1,
      contextWindow - reservedOutputTokens - 2_048
    );
    const budgeted = applyContextBudget(body.messages, {
      contextWindow,
      reservedOutputTokens,
      // Proactively shrink old tool rounds / chatter before hitting the wall.
      softTargetTokens: Math.max(2_048, Math.floor(hardBudget * 0.55)),
    });
    const requestBody: ChatCompletionRequest = {
      ...body,
      model: modelId,
      messages: budgeted.messages,
      ...(body.minimum_output_tokens ||
      (modelId === resolveRoundModel() && resolveRoundMinimumOutputTokens())
        ? {
            minimum_output_tokens:
              body.minimum_output_tokens ||
              resolveRoundMinimumOutputTokens(),
          }
        : {}),
    };
    const result = await clientForModel(modelId).chatCompletions(
      requestBody,
      options.signal,
      {
        onDelta: (delta) => {
          if (!delta.content) {
            return;
          }
          // Explore finals are discarded on handoff — avoid flashing text.
          if (speedPhase === "explore" && useExplore) {
            return;
          }
          streamUiActive = true;
          options.callbacks.onAssistantDelta?.(delta.content);
        },
      }
    );
    options.callbacks.onUsage?.(resolveUsage(result.usage, requestBody.messages));
    return result;
  };

  const handoffExploreToEdit = (): void => {
    if (!useExplore || speedPhase !== "explore") {
      return;
    }
    clearStreamUi();
    speedPhase = "edit";
    options.callbacks.onPhase("thinking", modeThinkingLabel(mode));
    messages.push({
      role: "user",
      content:
        "Context gathering is complete. Using the tool results above, implement the user's request now. Call search_replace or write_file for code changes when needed, verify with get_diagnostics when appropriate, then finish with a short summary.",
    });
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

  const invokeToolCall = async (call: ToolCall): Promise<string> => {
    const allowed =
      speedPhase === "explore" && useExplore
        ? exploreAllowedToolNames
        : allowedToolNames;
    if (!allowed.has(call.function.name)) {
      return JSON.stringify({
        error:
          "This tool is not available in the current mode. Use the allowed tools only.",
      });
    }
    if (call.function.name.startsWith("mcp__")) {
      return mcp
        ? await mcp.callTool(
            call.function.name,
            call.function.arguments || ""
          )
        : JSON.stringify({ error: "Figma MCP is not available" });
    }
    if (call.function.name === "run_command" && editsByPath.size > 0) {
      try {
        const args = JSON.parse(call.function.arguments || "{}") as {
          command?: unknown;
        };
        const command = String(args.command || "");
        if (isProjectVerificationCommand(command)) {
          const targetedTest = isTargetedTestCommand(command);
          if (
            targetedTest &&
            targetedTestCommandAttempts >= MAX_TARGETED_TEST_COMMANDS_PER_TURN
          ) {
            return JSON.stringify({
              ok: false,
              error:
                "Post-edit targeted testing is limited to one file-level command per turn. Use the existing result.",
            });
          }
          if (
            !targetedTest &&
            projectCommandAttempts >= MAX_PROJECT_COMMANDS_PER_TURN
          ) {
            return JSON.stringify({
              ok: false,
              error:
                "Post-edit project verification is limited to one project-wide command per turn. A single targeted vitest/jest file is still allowed when behavior or its expectation changed.",
            });
          }
          if (targetedTest) {
            targetedTestCommandAttempts += 1;
          } else {
            projectCommandAttempts += 1;
          }
        }
      } catch {
        // runTool will report malformed arguments normally.
      }
    }
    return runTool(call.function.name, call.function.arguments || "", {
      signal: options.signal,
      userText: options.userText,
    });
  };

  const applyEditToolSideEffects = (result: string) => {
    try {
      const parsed = JSON.parse(result) as {
        ok?: boolean;
        unchanged?: boolean;
        path?: string;
        created?: boolean;
        added?: number;
        removed?: number;
        importWarnings?: unknown;
      };
      if (parsed.unchanged) {
        if (parsed.path) {
          pendingNoOpWrites.push(String(parsed.path));
        }
      } else       if (parsed.ok && parsed.path && (Boolean(parsed.created) ||
          Number(parsed.added) > 0 ||
          Number(parsed.removed) > 0)
      ) {
        bumpEdit({
          path: parsed.path,
          created: Boolean(parsed.created),
          added: Number(parsed.added) || 0,
          removed: Number(parsed.removed) || 0,
        });
        // Edit-результат уже несёт diagnostics по изменённому файлу —
        // чистый результат считаем проверкой и не жжём отдельный раунд.
        const editDiagnostics = (
          parsed as {
            diagnostics?: Array<{
              severity?: unknown;
              path?: unknown;
              startLine?: unknown;
              message?: unknown;
            }>;
          }
        ).diagnostics;
        if (Array.isArray(editDiagnostics)) {
          diagnosticsCheckedAfterLastEdit = true;
          pendingDiagnosticErrors.length = 0;
          for (const diagnostic of editDiagnostics) {
            if (diagnostic.severity !== "error") {
              continue;
            }
            pendingDiagnosticErrors.push(
              `${String(diagnostic.path || parsed.path || "?")}:${Number(
                diagnostic.startLine
              ) || 1} ${String(diagnostic.message || "Unknown error")}`
            );
          }
        } else {
          diagnosticsCheckedAfterLastEdit = false;
          pendingDiagnosticErrors.length = 0;
        }
      }
      if (Array.isArray(parsed.importWarnings)) {
        for (const warning of parsed.importWarnings) {
          if (typeof warning === "string" && warning.trim()) {
            pendingImportWarnings.push(
              `${parsed.path || "?"}: ${warning.trim()}`
            );
          }
        }
      }
    } catch {
      // ignore
    }
  };

  /** Parallel-safe tools in waves; write/run stay serial. Returns repeatedOnly. */
  const executeToolBatch = async (batch: ToolCall[]): Promise<boolean> => {
    let repeatedOnly = true;
    for (const call of batch) {
      const signature = toolSignature(call);
      if (!seenToolCalls.has(signature)) {
        repeatedOnly = false;
      }
      seenToolCalls.add(signature);

      const toolStatus = formatToolStatus(
        call.function.name,
        call.function.arguments || ""
      );
      options.callbacks.onPhase(toolStatus.phase, toolStatus.detail);
      options.callbacks.onTool(
        `⚙ ${call.function.name}(${call.function.arguments})`
      );
    }

    const waves = planToolWaves(batch.map((c) => c.function.name));
    const results: string[] = new Array(batch.length);

    for (const wave of waves) {
      if (options.signal?.aborted) {
        throw new Error("aborted");
      }
      if (wave.length > 1) {
        options.callbacks.onPhase("reading", `Параллельно · ${wave.length}…`);
        const settled = await Promise.all(
          wave.map((idx) => invokeToolCall(batch[idx]))
        );
        for (let j = 0; j < wave.length; j++) {
          results[wave[j]] = settled[j];
        }
      } else {
        const idx = wave[0];
        const call = batch[idx];
        const toolStatus = formatToolStatus(
          call.function.name,
          call.function.arguments || ""
        );
        options.callbacks.onPhase(toolStatus.phase, toolStatus.detail);
        results[idx] = await invokeToolCall(call);
      }
    }

    for (let i = 0; i < batch.length; i++) {
      const call = batch[i];
      const result =
        results[i] ?? JSON.stringify({ error: "empty tool result" });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: result,
      });
      if (
        call.function.name === "write_file" ||
        call.function.name === "search_replace"
      ) {
        applyEditToolSideEffects(result);
      }
      if (call.function.name === "get_diagnostics") {
        diagnosticsChecks += 1;
        diagnosticsCheckedAfterLastEdit = true;
        pendingDiagnosticErrors.length = 0;
        try {
          const parsed = JSON.parse(result) as {
            diagnostics?: Array<{
              severity?: unknown;
              path?: unknown;
              startLine?: unknown;
              message?: unknown;
            }>;
          };
          for (const diagnostic of parsed.diagnostics || []) {
            if (diagnostic.severity !== "error") {
              continue;
            }
            pendingDiagnosticErrors.push(
              `${String(diagnostic.path || "?")}:${Number(
                diagnostic.startLine
              ) || 1} ${String(diagnostic.message || "Unknown error")}`
            );
          }
        } catch {
          diagnosticsCheckedAfterLastEdit = false;
        }
      }
      if (call.function.name === "run_command") {
        try {
          const args = JSON.parse(call.function.arguments || "{}") as {
            command?: unknown;
          };
          const parsed = JSON.parse(result) as { ok?: unknown };
          if (
            parsed.ok === true &&
            isGitPushCommand(String(args.command || ""))
          ) {
            successfulGitPush = true;
          }
          if (
            parsed.ok === true &&
            isGitMutationCommand(String(args.command || ""))
          ) {
            successfulGitMutation = true;
          }
          if (
            parsed.ok === true &&
            successfulGitMutation &&
            isGitStatusCommand(String(args.command || ""))
          ) {
            gitMutationVerified = true;
          }
        } catch {
          // Некорректный результат не подтверждает push.
        }
      }
    }

    return repeatedOnly;
  };

  for (let round = 0; round < roundLimit; round++) {
    if (options.signal?.aborted) {
      throw new Error("aborted");
    }

    if (
      speedPhase === "explore" &&
      useExplore &&
      exploreRoundsUsed >= maxExploreRounds
    ) {
      handoffExploreToEdit();
    }

    const roundModel = resolveRoundModel();
    const roundMaxTokens = resolveRoundMaxTokens();
    const roundTools =
      speedPhase === "explore" && useExplore ? exploreTools : activeTools;
    const roundMinimumOutput = resolveRoundMinimumOutputTokens();

    options.callbacks.onPhase(
      "thinking",
      speedPhase === "explore" && useExplore && !helperAbandoned
        ? modeThinkingLabel(mode).replace(/\.\.\.$/, "") +
            ` · ${exploreModelId}...`
        : modeThinkingLabel(mode)
    );

    let assistant;
    let finishReason: string | undefined;
    try {
      const completed = await completeChat({
        model: roundModel,
        messages,
        tools: roundTools,
        tool_choice:
          successfulGitPush || gitMutationVerified ? "none" : "auto",
        temperature: 0.2,
        max_tokens: roundMaxTokens,
        ...(roundMinimumOutput
          ? { minimum_output_tokens: roundMinimumOutput }
          : {}),
      });
      assistant = completed.message;
      finishReason = completed.finishReason;
    } catch (error) {
      const onExploreHelper =
        speedPhase === "explore" && useExplore && !helperAbandoned;
      const onReadonlyHelper =
        useHelperFallback &&
        !helperAbandoned &&
        resolveRoundModel() === options.model;
      if (
        (onExploreHelper || onReadonlyHelper) &&
        shouldAbandonHelperModel(error)
      ) {
        abandonHelperToSelected(roundModel);
        continue;
      }
      throw error;
    }

    if (speedPhase === "explore" && useExplore) {
      exploreRoundsUsed += 1;
    }

    let toolCalls = (assistant.tool_calls ?? []).filter(
      (call) => call?.function?.name
    );
    let assistantContent = extractAssistantText(assistant);

    if (toolCalls.length === 0 && assistantContent.trim()) {
      const recovered = parseTextToolCalls(assistantContent);
      if (recovered.calls.length > 0) {
        toolCalls = recovered.calls;
        assistantContent = recovered.cleanedContent;
      }
    }

    // Explore phase: drop non-readonly tool attempts (should be rare) and
    // hand off when the fast model tries to finish without tools.
    if (speedPhase === "explore" && useExplore) {
      const readonlyCalls = toolCalls.filter((call) =>
        exploreAllowedToolNames.has(call.function.name)
      );
      if (toolCalls.length > 0 && readonlyCalls.length === 0) {
        clearStreamUi();
        handoffExploreToEdit();
        continue;
      }
      toolCalls = readonlyCalls;
      if (toolCalls.length === 0) {
        clearStreamUi();
        handoffExploreToEdit();
        continue;
      }
    }

    messages.push(
      buildAssistantTurn(
        assistant,
        assistantContent,
        toolCalls.length > 0 ? toolCalls : undefined
      )
    );

    if (toolCalls.length === 0) {
      if (finishReason === "length") {
        if (assistantContent.trim()) {
          lengthSegments.push(assistantContent.trim());
        }
        if (
          shouldContinueAfterLength(
            finishReason,
            lengthContinuations,
            maxLengthContinuations
          )
        ) {
          lengthContinuations += 1;
          clearStreamUi();
          messages.push({
            role: "user",
            content:
              "Your response was truncated by the output-token limit. Continue exactly where you stopped, without repeating earlier text. Finish the answer concisely.",
          });
          continue;
        }
        // The continuation budget is exhausted: return the collected partial
        // answer instead of entering another unbounded completion cycle.
        assistantContent = lengthSegments.join("\n");
      } else if (lengthSegments.length > 0) {
        assistantContent = [...lengthSegments, assistantContent.trim()]
          .filter(Boolean)
          .join("\n");
        lengthSegments.length = 0;
      }
      const trimmed = assistantContent.trim();
      const canEdit = !isReadonlyPolicy(mode.tools);

      const verificationStep = decideVerificationStep({
        agentMode: canEdit,
        editedPaths: [...editsByPath.keys()],
        diagnosticsCheckedAfterLastEdit,
        diagnosticsChecks,
        diagnosticErrors: pendingDiagnosticErrors,
        diagnosticFixAttempts,
        importWarnings: pendingImportWarnings,
        importFixAttempts,
        noOpWrites: pendingNoOpWrites,
        noOpWriteAttempts,
        projectCommand: projectVerification?.command,
        projectCommandAttempts,
      });

      if (verificationStep.kind === "request_diagnostics") {
        clearStreamUi();
        messages.push({
          role: "user",
          content: `Before finishing, call get_diagnostics for these edited files and use the actual VS Code Problems result: ${JSON.stringify(
            verificationStep.paths
          )}. Fix new errors before claiming completion.`,
        });
        continue;
      }

      if (verificationStep.kind === "fix_diagnostics") {
        diagnosticFixAttempts += 1;
        clearStreamUi();
        pendingDiagnosticErrors.length = 0;
        messages.push({
          role: "user",
          content: `VS Code diagnostics still report errors in edited files:\n${verificationStep.errors.join(
            "\n"
          )}\nUse search_replace or write_file to fix them, then call get_diagnostics again before finishing.`,
        });
        continue;
      }

      if (verificationStep.kind === "fix_imports") {
        importFixAttempts += 1;
        clearStreamUi();
        pendingImportWarnings.length = 0;
        messages.push({
          role: "user",
          content: `An edit tool reported unresolved imports:\n${verificationStep.warnings.join(
            "\n"
          )}\nCall search_replace or write_file again with corrected import paths (use tsconfig aliases from context and copy style from sibling files). Do not claim the work is done yet.`,
        });
        continue;
      }

      if (verificationStep.kind === "handle_no_op_writes") {
        noOpWriteAttempts += 1;
        clearStreamUi();
        pendingNoOpWrites.length = 0;
        messages.push({
          role: "user",
          content: `An edit tool made NO changes for:\n${verificationStep.paths.join(
            "\n"
          )}\nDo not claim you rewrote/fixed the file. Either apply a real content change with search_replace or write_file, or reply honestly that the file was already correct and nothing was modified.`,
        });
        continue;
      }

      if (verificationStep.kind === "run_project_command") {
        clearStreamUi();
        const call: ToolCall = {
          id: `post_edit_verification_${projectCommandAttempts + 1}`,
          type: "function",
          function: {
            name: "run_command",
            arguments: JSON.stringify({
              command: verificationStep.command,
            }),
          },
        };
        messages[messages.length - 1] = buildAssistantTurn(
          assistant,
          "",
          [call]
        );
        await executeToolBatch([call]);
        continue;
      }

      const decision = decideHonestFinale({
        text: trimmed,
        canEdit,
        messages,
        userText: options.userText,
        hadSuccessfulWrite: editsByPath.size > 0,
        gitOperationCompleted: successfulGitPush || successfulGitMutation,
        allowNudgeWrite: manualPatchAttempts < maxManualPatchAttempts,
        allowNudgeHedge: hedgeAttempts < maxHedgeAttempts,
        allowNudgeHollow: hollowAttempts < maxHollowAttempts,
        allowNudgeImpact: impactAttempts < maxImpactAttempts,
      });

      if (decision.kind === "nudge_write") {
        manualPatchAttempts += 1;
        clearStreamUi();
        messages.push({
          role: "user",
          content: MISSING_WRITE_USER_NUDGE,
        });
        continue;
      }
      if (decision.kind === "nudge_hedge") {
        hedgeAttempts += 1;
        clearStreamUi();
        messages.push({
          role: "user",
          content: HEDGE_USER_NUDGE,
        });
        continue;
      }
      if (decision.kind === "nudge_hollow") {
        hollowAttempts += 1;
        clearStreamUi();
        messages.push({
          role: "user",
          content: HOLLOW_USER_NUDGE,
        });
        continue;
      }
      if (decision.kind === "nudge_impact") {
        impactAttempts += 1;
        clearStreamUi();
        messages.push({
          role: "user",
          content: IMPACT_USER_NUDGE,
        });
        continue;
      }
      if (decision.kind === "replace") {
        const text = decision.text;
        messages[messages.length - 1] = { role: "assistant", content: text };
        options.callbacks.onPhase("done", modeDoneLabel(mode));
        sealStreamUi();
        options.callbacks.onAssistant(text);
        await publishTurnReview();
        answered = true;
        break;
      }

      if (!trimmed && emptyFinalAttempts < maxEmptyFinalAttempts) {
        emptyFinalAttempts += 1;
        clearStreamUi();
        if (canEdit && editsByPath.size === 0 && emptyFinalAttempts <= 2) {
          messages.push({
            role: "user",
            content:
              "You gathered context but made no file edits. Call search_replace or write_file to apply the required changes now. Do not ask the user to paste code manually. After editing, reply with a short summary.",
          });
          continue;
        }

        // Последние попытки — только текст, без tools, иначе модель снова молчит.
        options.callbacks.onPhase("thinking", modeCollectLabel(mode));
        const forced = await completeChat({
          model: options.model,
          messages: [
            ...messages,
            {
              role: "user",
              content:
                editsByPath.size > 0
                  ? "Write a short Russian summary of the file changes you applied. Never return an empty message. Do not call tools."
                  : "Write a clear Russian reply for the user now: what you found and what still needs to be done. Never return an empty message. Do not call tools.",
            },
          ],
          tool_choice: "none",
          temperature: 0.3,
          max_tokens: Math.max(editMaxTokens, 1024),
        });
        const forcedText = extractAssistantText(forced.message).trim();
        if (forcedText) {
          let text = finalizeAssistantText(
            forcedText,
            editsByPath,
            config.maxResponseChars,
            messages
          );
          const forcedDecision = decideHonestFinale({
            text,
            canEdit: !isReadonlyPolicy(mode.tools),
            messages,
            userText: options.userText,
            hadSuccessfulWrite: editsByPath.size > 0,
            gitOperationCompleted: successfulGitPush || successfulGitMutation,
            allowNudgeWrite: false,
            allowNudgeHedge: false,
            allowNudgeHollow: false,
            allowNudgeImpact: false,
          });
          if (forcedDecision.kind === "replace") {
            text = forcedDecision.text;
          }
          messages.push({ role: "assistant", content: text });
          options.callbacks.onPhase("done", modeDoneLabel(mode));
          sealStreamUi();
          options.callbacks.onAssistant(text);
          await publishTurnReview();
          answered = true;
          break;
        }
        clearStreamUi();
        continue;
      }

      options.callbacks.onPhase("done", modeDoneLabel(mode));
      let text = finalizeAssistantText(
        parseTextToolCalls(trimmed || "").cleanedContent || trimmed,
        editsByPath,
        config.maxResponseChars,
        messages
      );
      const acceptDecision = decideHonestFinale({
        text,
        canEdit: !isReadonlyPolicy(mode.tools),
        messages,
        userText: options.userText,
        hadSuccessfulWrite: editsByPath.size > 0,
        gitOperationCompleted: successfulGitPush || successfulGitMutation,
        allowNudgeWrite: false,
        allowNudgeHedge: false,
        allowNudgeHollow: false,
        allowNudgeImpact: false,
      });
      if (acceptDecision.kind === "replace") {
        text = acceptDecision.text;
      }
      messages[messages.length - 1] = { role: "assistant", content: text };
      sealStreamUi();
      options.callbacks.onAssistant(text);
      await publishTurnReview();
      answered = true;
      break;
    }

    clearStreamUi();
    const repeatedOnly = await executeToolBatch(toolCalls);

    if (repeatedOnly) {
      if (speedPhase === "explore" && useExplore) {
        handoffExploreToEdit();
        continue;
      }
      break;
    }

    // Still needs tools and hit the current limit — extend by +10 up to hardCap.
    if (round >= roundLimit - 1 && roundLimit < hardCap) {
      const nextLimit = Math.min(hardCap, roundLimit + extendStep);
      if (nextLimit > roundLimit) {
        roundLimit = nextLimit;
        options.callbacks.onPhase(
          "thinking",
          `Продлеваю tools · до ${roundLimit}…`
        );
      }
    }
  }

  if (useExplore && speedPhase === "explore") {
    handoffExploreToEdit();
  }

  if (!answered) {
    if (options.signal?.aborted) {
      throw new Error("aborted");
    }

    options.callbacks.onPhase("thinking", modeCollectLabel(mode));

    const canEdit = !isReadonlyPolicy(mode.tools);
    const needsEdits = canEdit && editsByPath.size === 0;
    const finalRequest = [
      ...messages,
      {
        role: "user" as const,
        content: needsEdits
          ? "You still have not called an edit tool. search_replace and write_file are available. Apply the required file changes now. Do not claim tools are unavailable and do not ask the user to paste code manually."
          : modeFinalNudge(mode),
      },
    ];
    const { message: finalMessage } = await completeChat({
      model: options.model,
      messages: finalRequest,
      ...(needsEdits
        ? { tools: activeTools, tool_choice: "auto" as const }
        : { tool_choice: "none" as const }),
      temperature: 0.3,
      max_tokens: Math.max(editMaxTokens, 1024),
    });
    let toolCalls = (finalMessage.tool_calls ?? []).filter(
      (call) => call?.function?.name
    );
    let text = extractAssistantText(finalMessage).trim();
    if (toolCalls.length === 0 && text) {
      const recovered = parseTextToolCalls(text);
      if (recovered.calls.length > 0) {
        toolCalls = recovered.calls;
        text = recovered.cleanedContent;
      }
    }

    if (needsEdits && toolCalls.length > 0) {
      clearStreamUi();
      messages.push(buildAssistantTurn(finalMessage, text, toolCalls));
      await executeToolBatch(toolCalls);

      const summaryRequest = [
        ...messages,
        {
          role: "user" as const,
          content:
            "Briefly summarize the file changes you just applied in Russian. Do not ask the user to paste code. Never return an empty message.",
        },
      ];
      const { message: summaryMessage } = await completeChat({
        model: options.model,
        messages: summaryRequest,
        tool_choice: "none",
        temperature: 0.3,
        max_tokens: Math.max(editMaxTokens, 1024),
      });
      text = finalizeAssistantText(
        extractAssistantText(summaryMessage).trim(),
        editsByPath,
        config.maxResponseChars,
        messages
      );
      const summaryDecision = decideHonestFinale({
        text,
        canEdit,
        messages,
        userText: options.userText,
        hadSuccessfulWrite: editsByPath.size > 0,
        gitOperationCompleted: successfulGitPush || successfulGitMutation,
        allowNudgeWrite: false,
        allowNudgeHedge: false,
        allowNudgeHollow: false,
        allowNudgeImpact: false,
      });
      if (summaryDecision.kind === "replace") {
        text = summaryDecision.text;
      }
    } else {
      if (!text && toolCalls.length) {
        clearStreamUi();
        // Финал без needsEdits, но модель всё равно вернула tools — запросим текст отдельно.
        const forced = await completeChat({
          model: options.model,
          messages: [
            ...messages,
            buildAssistantTurn(finalMessage, text, toolCalls),
            {
              role: "user",
              content:
                "Stop calling tools. Write the final Russian reply for the user now. Never return an empty message.",
            },
          ],
          tool_choice: "none",
          temperature: 0.3,
          max_tokens: Math.max(editMaxTokens, 1024),
        });
        text = extractAssistantText(forced.message).trim();
      }
      if (!text) {
        clearStreamUi();
        const forced = await completeChat({
          model: options.model,
          messages: [
            ...messages,
            {
              role: "user",
              content:
                "Write a clear Russian reply for the user now based on the tool results already gathered. Never return an empty message. Do not call tools.",
            },
          ],
          tool_choice: "none",
          temperature: 0.3,
          max_tokens: Math.max(editMaxTokens, 1024),
        });
        text = extractAssistantText(forced.message).trim();
      }
      text = finalizeAssistantText(
        text,
        editsByPath,
        config.maxResponseChars,
        messages
      );
      const finalDecision = decideHonestFinale({
        text,
        canEdit,
        messages,
        userText: options.userText,
        hadSuccessfulWrite: editsByPath.size > 0,
        gitOperationCompleted: successfulGitPush || successfulGitMutation,
        allowNudgeWrite: false,
        allowNudgeHedge: false,
        allowNudgeHollow: false,
        allowNudgeImpact: false,
      });
      if (finalDecision.kind === "replace") {
        text = finalDecision.text;
      }
    }

    messages.push({ role: "assistant", content: text });
    options.callbacks.onPhase("done", modeDoneLabel(mode));
    sealStreamUi();
    options.callbacks.onAssistant(text);
    await publishTurnReview();
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
    !finalAssistant ||
    finalAssistant === "(пустой ответ)" ||
    finalAssistant.includes("Не удалось получить текстовый ответ модели")
  ) {
    finalAssistant =
      summarizeEditsFallback(editsByPath) ||
      summarizeToolActivity(messages) ||
      finalAssistant ||
      "Не удалось получить текстовый ответ модели. Попробуйте повторить запрос или сменить модель.";
  }

  const historyUser: ChatMessage = {
    role: "user",
    content: userContentForHistory(options.userText, persistedAttachments),
  };
  if (persistedAttachments.length) {
    historyUser.attachments = persistedAttachments;
  }

  return compactHistory([
    ...prior,
    historyUser,
    { role: "assistant", content: finalAssistant },
  ]);
}
