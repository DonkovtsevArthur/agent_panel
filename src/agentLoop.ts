import {
  buildUserApiContent,
  MessageAttachment,
  stripAttachmentPayload,
  userContentForHistory,
} from "./attachments";
import { getConfig, getModeById, resolveModelEndpoint } from "./config";
import { FileEditStat, formatEditTotals } from "./diffStats";
import { buildEditorContextMessage } from "./editorContext";
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
  ChatCompletionUsage,
  ChatMessage,
  ContentPart,
  OpenAICompatibleClient,
  ToolCall,
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
import { looksLikeAmbiguousRestoreRequest } from "./discardChanges";
import {
  isGitMutationCommand,
  isGitPushCommand,
  isGitStatusCommand,
} from "./gitCommandPolicy";

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

export type AgentPhase =
  | "thinking"
  | "reading"
  | "listing"
  | "running"
  | "editing"
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
  onAssistant: (text: string) => void;
  /** Может быть async (SCM check) — ждём, иначе review теряется в finally. */
  onReview: (edits: FileEditStat[]) => void | Promise<void>;
  onUsage?: (usage: ContextUsageInfo) => void;
  /** User pasted a Figma URL but MCP is not connected. */
  onFigmaNeedsConnect?: () => void;
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

/** Для следующего хода оставляем только user + финальные ответы assistant. */
export function compactHistory(messages: ChatMessage[]): ChatMessage[] {
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
  storageUri: vscode.Uri | undefined
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

export async function runAgentTurn(options: {
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

  const client = new OpenAICompatibleClient(endpoint.baseUrl, endpoint.apiKey, {
    rejectUnauthorized: config.rejectUnauthorized,
    caBundlePath: config.caBundlePath,
  });

  const prior = compactHistory(options.history);
  const priorApi = await hydrateHistoryForApi(prior, options.storageUri);
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
  const activeTools = toolsForPolicy(mode.tools, mcpTools);
  const urlInMessage = /https?:\/\/[^\s)\]>'"]+/i.test(options.userText || "");
  const toolsCapabilityHint = [
    `Built-in tools available this turn: ${activeTools
      .filter((t) => !t.function.name.startsWith("mcp__"))
      .map((t) => t.function.name)
      .join(", ")}.`,
    !isReadonlyPolicy(mode.tools)
      ? [
          "Agent mode has write_file available this turn — never claim that file-editing tools are unavailable.",
          "A short ambiguous restore request such as «верни» / «откати» has no safe target: ask whether to restore specific files, a commit, or all local changes. Do not call tools, write_file, rm, or broad git restore until the target is explicit.",
          "When the user asks to discard/revert ALL local changes (убери все изменения / откатить всё / git restore / discard changes): do NOT read_file the changed files. Run git only: `git status --short`, then `git restore .` and `git clean -fd` if needed (or restore specific paths). Confirm with status. Never rewrite files via write_file to «undo».",
          "A successful git restore/revert/reset/clean is a real file change and does not require write_file. After verifying it with git status, do not read the restored files; report the Git result.",
          "For commit/push requests, inspect git status and stage only files related to the requested work. Never use `git add --all`, `git add -A`, `git add .`, or `git commit -a` unless the user explicitly asks to include every local change. After a successful `git push`, do not read/list files or run impact checks; reply with the push result.",
          "When the user asks to implement or change code, call write_file yourself and apply the changes.",
          "When the user asks where something was BEFORE changes (до правок / до начала изменений / как было раньше / look again where X was), do NOT call write_file. Use run_command with git: `git show HEAD:path`, `git diff HEAD -- path`, or `git log -p -- path`, then answer from that output only. Never claim you rewrote the file after an inspect-only question.",
          "Never say «Готово» / «исправлено» unless you already called write_file in this turn.",
          "Never invent import paths: use tsconfig aliases from context, copy imports from sibling files, and fix importWarnings from write_file.",
          "Do not speculate about TypeScript/build errors. If you need to verify, call run_command (tsc/npm run build) or read_file; never say «возможно» / «если TS ругается» / «попробую пересобрать» without doing it.",
          "Before changing shared UI (shared/, components/, toast/notification/modal), search usages with run_command (rg) and update call sites or keep backwards-compatible props. Never unilaterally break consumers and never end with «скажи — верну/переделаю».",
          "Never ask the user to copy/paste code, never say «вставь вручную / apply manually», and never dump full file replacements for manual application.",
          "After editing, reply briefly with what you changed.",
        ].join(" ")
      : "",
    "Whenever the user shares an http(s) link and asks ANYTHING about that page (facts, summary, colors, price, author, version, features, text), IMMEDIATELY call fetch_url on the URL before answering.",
    "Answer only from the tool result (title, description, headings, content, colors, links, jsonLd). Never say you cannot open/load/access external URLs.",
    "Do not invent login/authorization requirements unless the tool result clearly shows HTTP 401/403 or an explicit auth page.",
    "If spaShell is true or content is sparse, report what was found and what is missing; do not refuse. Use open_external only if the user wants the browser opened.",
    "Questions about Harbor Agents / this extension branding: also read package.json (galleryBanner) and media/icon-marketplace.png via read_file.",
    "Never print tool calls as XML/DSML/text. Use native function/tool calling only.",
    urlInMessage
      ? "This user message contains at least one URL — call fetch_url for it if the question refers to that link."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const pathAliasContext = await buildPathAliasContextMessage();
  const messages: ChatMessage[] = [
    { role: "system", content: config.systemPrompt },
    { role: "system", content: buildEditorContextMessage() },
    { role: "system", content: pathAliasContext },
    {
      role: "system",
      content: mcpHint,
    },
    ...(modePrompt
      ? [{ role: "system" as const, content: modePrompt }]
      : []),
    { role: "system", content: toolsCapabilityHint },
    ...priorApi,
    toApiMessage({ role: "user", content: userApiContent }),
  ];

  const allowedToolNames = new Set(activeTools.map((t) => t.function.name));
  const editsByPath = new Map<string, FileEditStat>();
  let successfulGitPush = false;
  let successfulGitMutation = false;
  let gitMutationVerified = false;
  /** Base limit from settings; auto-extends by +10 while model still needs tools. */
  let roundLimit = Math.max(1, config.maxToolRounds);
  const hardCap = Math.max(roundLimit, 60);
  const extendStep = 10;
  const seenToolCalls = new Set<string>();
  let answered = false;
  // Иногда модель завершает шаг без текстового assistant.content (только tool output),
  // и тогда UI показывает "(пустой ответ)". Дадим модели один дополнительный шанс.
  let emptyFinalAttempts = 0;
  const maxEmptyFinalAttempts = 3;
  // Модель иногда врёт «write_file недоступен» / «Готово», не вызывая write_file.
  let manualPatchAttempts = 0;
  const maxManualPatchAttempts = 3;
  let importFixAttempts = 0;
  const maxImportFixAttempts = 2;
  const pendingImportWarnings: string[] = [];
  let noOpWriteAttempts = 0;
  const maxNoOpWriteAttempts = 2;
  const pendingNoOpWrites: string[] = [];
  let hedgeAttempts = 0;
  const maxHedgeAttempts = 2;
  let hollowAttempts = 0;
  const maxHollowAttempts = 2;
  let impactAttempts = 0;
  const maxImpactAttempts = 2;

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
  const recordGitCommandResult = (call: ToolCall, result: string): void => {
    if (call.function.name !== "run_command") {
      return;
    }
    try {
      const args = JSON.parse(call.function.arguments || "{}") as {
        command?: unknown;
      };
      const parsed = JSON.parse(result) as { ok?: unknown };
      const command = String(args.command || "");
      if (parsed.ok === true && isGitPushCommand(command)) {
        successfulGitPush = true;
      }
      if (parsed.ok === true && isGitMutationCommand(command)) {
        successfulGitMutation = true;
      }
      if (
        parsed.ok === true &&
        successfulGitMutation &&
        isGitStatusCommand(command)
      ) {
        gitMutationVerified = true;
      }
    } catch {
      // Некорректный результат не подтверждает Git-операцию.
    }
  };


  for (let round = 0; round < roundLimit; round++) {
    if (options.signal?.aborted) {
      throw new Error("aborted");
    }

    options.callbacks.onPhase("thinking", modeThinkingLabel(mode));

    const requestMessages = messages.slice();
    const { message: assistant, usage } = await client.chatCompletions(
      {
        model: options.model,
        messages,
        tools: activeTools,
        tool_choice:
          successfulGitPush || gitMutationVerified ? "none" : "auto",
        temperature: 0.2,
        max_tokens: config.maxTokens,
      },
      options.signal
    );
    reportUsage(usage, requestMessages);

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

    messages.push(
      buildAssistantTurn(
        assistant,
        assistantContent,
        toolCalls.length > 0 ? toolCalls : undefined
      )
    );

    if (toolCalls.length === 0) {
      const trimmed = assistantContent.trim();
      const canEdit = !isReadonlyPolicy(mode.tools);

      if (
        canEdit &&
        pendingImportWarnings.length > 0 &&
        importFixAttempts < maxImportFixAttempts
      ) {
        importFixAttempts += 1;
        const listed = pendingImportWarnings.slice(0, 10).join("\n");
        pendingImportWarnings.length = 0;
        messages.push({
          role: "user",
          content: `write_file reported unresolved imports:\n${listed}\nCall write_file again with corrected import paths (use tsconfig aliases from context and copy style from sibling files). Do not claim the work is done yet.`,
        });
        continue;
      }

      if (
        canEdit &&
        pendingNoOpWrites.length > 0 &&
        noOpWriteAttempts < maxNoOpWriteAttempts
      ) {
        noOpWriteAttempts += 1;
        const listed = pendingNoOpWrites.slice(0, 8).join("\n");
        pendingNoOpWrites.length = 0;
        messages.push({
          role: "user",
          content: `write_file made NO changes (content identical) for:\n${listed}\nDo not claim you rewrote/fixed the file. Either apply a real content change with write_file, or reply honestly that the file was already correct and nothing was modified.`,
        });
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
        messages.push({
          role: "user",
          content: MISSING_WRITE_USER_NUDGE,
        });
        continue;
      }
      if (decision.kind === "nudge_hedge") {
        hedgeAttempts += 1;
        messages.push({
          role: "user",
          content: HEDGE_USER_NUDGE,
        });
        continue;
      }
      if (decision.kind === "nudge_hollow") {
        hollowAttempts += 1;
        messages.push({
          role: "user",
          content: HOLLOW_USER_NUDGE,
        });
        continue;
      }
      if (decision.kind === "nudge_impact") {
        impactAttempts += 1;
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
        options.callbacks.onAssistant(text);
        await Promise.resolve(
          options.callbacks.onReview([...editsByPath.values()])
        );
        answered = true;
        break;
      }

      if (!trimmed && emptyFinalAttempts < maxEmptyFinalAttempts) {
        emptyFinalAttempts += 1;
        if (canEdit && editsByPath.size === 0 && emptyFinalAttempts <= 2) {
          messages.push({
            role: "user",
            content:
              "You gathered context but made no file edits. Call write_file to apply the required changes now. Do not ask the user to paste code manually. After editing, reply with a short summary.",
          });
          continue;
        }

        // Последние попытки — только текст, без tools, иначе модель снова молчит.
        options.callbacks.onPhase("thinking", modeCollectLabel(mode));
        const forced = await client.chatCompletions(
          {
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
            max_tokens: Math.max(config.maxTokens, 1024),
          },
          options.signal
        );
        reportUsage(forced.usage, messages);
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
          options.callbacks.onAssistant(text);
          await Promise.resolve(
            options.callbacks.onReview([...editsByPath.values()])
          );
          answered = true;
          break;
        }
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
      options.callbacks.onAssistant(text);
      await Promise.resolve(
        options.callbacks.onReview([...editsByPath.values()])
      );
      answered = true;
      break;
    }

    let repeatedOnly = true;
    for (const call of toolCalls) {
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

      let result: string;
      if (!allowedToolNames.has(call.function.name)) {
        result = JSON.stringify({
          error:
            "This tool is not available in the current mode. Use the allowed tools only.",
        });
      } else if (call.function.name.startsWith("mcp__")) {
        result = mcp
          ? await mcp.callTool(
              call.function.name,
              call.function.arguments || ""
            )
          : JSON.stringify({ error: "Figma MCP is not available" });
      } else {
        result = await runTool(
          call.function.name,
          call.function.arguments || "",
          { signal: options.signal, userText: options.userText }
        );
      recordGitCommandResult(call, result);
      }
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
          } else if (
            parsed.ok &&
            parsed.path &&
            (Boolean(parsed.created) ||
              Number(parsed.added) > 0 ||
              Number(parsed.removed) > 0)
          ) {
            bumpEdit({
              path: parsed.path,
              created: Boolean(parsed.created),
              added: Number(parsed.added) || 0,
              removed: Number(parsed.removed) || 0,
            });
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
      }
    }

    if (repeatedOnly) {
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
          ? "You still have not called write_file. write_file is available. Apply the required file changes now. Do not claim tools are unavailable and do not ask the user to paste code manually."
          : modeFinalNudge(mode),
      },
    ];
    const { message: finalMessage, usage: finalUsage } =
      await client.chatCompletions(
        {
          model: options.model,
          messages: finalRequest,
          ...(needsEdits
            ? { tools: activeTools, tool_choice: "auto" as const }
            : { tool_choice: "none" as const }),
          temperature: 0.3,
          max_tokens: Math.max(config.maxTokens, 1024),
        },
        options.signal
      );
    reportUsage(finalUsage, finalRequest);

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
      messages.push(buildAssistantTurn(finalMessage, text, toolCalls));
      for (const call of toolCalls) {
        const toolStatus = formatToolStatus(
          call.function.name,
          call.function.arguments || ""
        );
        options.callbacks.onPhase(toolStatus.phase, toolStatus.detail);
        options.callbacks.onTool(
          `⚙ ${call.function.name}(${call.function.arguments})`
        );
        let result: string;
        if (!allowedToolNames.has(call.function.name)) {
          result = JSON.stringify({
            error:
              "This tool is not available in the current mode. Use the allowed tools only.",
          });
        } else if (call.function.name.startsWith("mcp__")) {
          result = mcp
            ? await mcp.callTool(
                call.function.name,
                call.function.arguments || ""
              )
            : JSON.stringify({ error: "Figma MCP is not available" });
        } else {
          result = await runTool(
            call.function.name,
            call.function.arguments || "",
            { signal: options.signal, userText: options.userText }
          );
        recordGitCommandResult(call, result);
        }
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
              unchanged?: boolean;
              path?: string;
              created?: boolean;
              added?: number;
              removed?: number;
            };
            if (
              parsed.ok &&
              parsed.path &&
              !parsed.unchanged &&
              (Boolean(parsed.created) ||
                Number(parsed.added) > 0 ||
                Number(parsed.removed) > 0)
            ) {
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

      const summaryRequest = [
        ...messages,
        {
          role: "user" as const,
          content:
            "Briefly summarize the file changes you just applied in Russian. Do not ask the user to paste code. Never return an empty message.",
        },
      ];
      const { message: summaryMessage, usage: summaryUsage } =
        await client.chatCompletions(
          {
            model: options.model,
            messages: summaryRequest,
            tool_choice: "none",
            temperature: 0.3,
            max_tokens: Math.max(config.maxTokens, 1024),
          },
          options.signal
        );
      reportUsage(summaryUsage, summaryRequest);
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
        hadSuccessfulWrite: editsByPath.size > 0,
        gitOperationCompleted: successfulGitPush || successfulGitMutation,
        userText: options.userText,
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
        // Финал без needsEdits, но модель всё равно вернула tools — запросим текст отдельно.
        const forced = await client.chatCompletions(
          {
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
            max_tokens: Math.max(config.maxTokens, 1024),
          },
          options.signal
        );
        reportUsage(forced.usage, messages);
        text = extractAssistantText(forced.message).trim();
      }
      if (!text) {
        const forced = await client.chatCompletions(
          {
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
            max_tokens: Math.max(config.maxTokens, 1024),
          },
          options.signal
        );
        reportUsage(forced.usage, messages);
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
        hadSuccessfulWrite: editsByPath.size > 0,
        gitOperationCompleted: successfulGitPush || successfulGitMutation,
        userText: options.userText,
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
    options.callbacks.onAssistant(text);
    await Promise.resolve(
      options.callbacks.onReview([...editsByPath.values()])
    );
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
