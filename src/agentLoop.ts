import {
  buildUserApiContent,
  MessageAttachment,
  stripAttachmentPayload,
  userContentForHistory,
} from "./attachments";
import { getConfig, getModeById, resolveModelEndpoint } from "./config";
import { FileEditStat, formatEditTotals } from "./diffStats";
import { buildEditorContextMessage } from "./editorContext";
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
import { READONLY_TOOL_NAMES, runTool } from "./tools";
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
  onReview: (edits: FileEditStat[]) => void;
  onUsage?: (usage: ContextUsageInfo) => void;
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
    default:
      return {
        phase: "thinking",
        detail: name ? `Tool · ${truncateStatus(name)}` : "Думает…",
      };
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

  const client = new OpenAICompatibleClient(endpoint.baseUrl, endpoint.apiKey, {
    rejectUnauthorized: config.rejectUnauthorized,
    caBundlePath: config.caBundlePath,
  });

  const prior = compactHistory(options.history);
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
  const messages: ChatMessage[] = [
    { role: "system", content: config.systemPrompt },
    { role: "system", content: buildEditorContextMessage() },
    ...(modePrompt
      ? [{ role: "system" as const, content: modePrompt }]
      : []),
    ...priorApi,
    toApiMessage({ role: "user", content: userApiContent }),
  ];

  const activeTools = toolsForPolicy(mode.tools);
  const editsByPath = new Map<string, FileEditStat>();
  const toolRounds = Math.max(1, config.maxToolRounds);
  const seenToolCalls = new Set<string>();
  let answered = false;

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

  for (let round = 0; round < toolRounds; round++) {
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
        tool_choice: "auto",
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
      options.callbacks.onPhase("done", modeDoneLabel(mode));
      const text = sanitizeAssistantText(
        contentAsString(assistant.content).trim() || "(пустой ответ)",
        { maxChars: config.maxResponseChars }
      );
      messages[messages.length - 1] = { role: "assistant", content: text };
      options.callbacks.onAssistant(text);
      options.callbacks.onReview([...editsByPath.values()]);
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
      if (readonly && !READONLY_TOOL_NAMES.has(call.function.name)) {
        result = JSON.stringify({
          error:
            "В этом режиме инструмент недоступен. Используй list_files / read_file.",
        });
      } else {
        result = await runTool(call.function.name, call.function.arguments);
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

    if (repeatedOnly) {
      break;
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
    text = sanitizeAssistantText(text || "(пустой ответ)", {
      maxChars: config.maxResponseChars,
    });
    messages.push({ role: "assistant", content: text });
    options.callbacks.onPhase("done", modeDoneLabel(mode));
    options.callbacks.onAssistant(text);
    options.callbacks.onReview([...editsByPath.values()]);
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

  return compactHistory([
    ...prior,
    historyUser,
    { role: "assistant", content: finalAssistant || "(пустой ответ)" },
  ]);
}
