import { getConfig, resolveModelEndpoint } from "./config";
import { FileEditStat, formatEditTotals } from "./diffStats";
import { buildEditorContextMessage } from "./editorContext";
import {
  ChatCompletionUsage,
  ChatMessage,
  OpenAICompatibleClient,
  ToolCall,
} from "./openaiClient";
import { sanitizeAssistantText } from "./sanitize";
import { agentTools, runTool } from "./tools";

export type AgentPhase = "thinking" | "editing" | "done";

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

function formatEditingDetail(edits: FileEditStat[]): string {
  const { files, added, removed } = formatEditTotals(edits);
  if (files === 0) {
    return "Редактирует…";
  }
  const filesLabel =
    files === 1 ? "1 файл" : files < 5 ? `${files} файла` : `${files} файлов`;
  return `Редактирует · ${filesLabel} · +${added} −${removed}`;
}

function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const message of messages) {
    if (message.content) {
      chars += message.content.length;
    }
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

/** Для следующего хода оставляем только user + финальные ответы assistant. */
export function compactHistory(messages: ChatMessage[]): ChatMessage[] {
  const compact: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === "user" && message.content) {
      compact.push({ role: "user", content: message.content });
      continue;
    }
    if (
      message.role === "assistant" &&
      message.content &&
      !(message.tool_calls && message.tool_calls.length > 0)
    ) {
      compact.push({ role: "assistant", content: message.content });
    }
  }
  const maxMessages = 24;
  return compact.length > maxMessages
    ? compact.slice(compact.length - maxMessages)
    : compact;
}

export async function runAgentTurn(options: {
  model: string;
  history: ChatMessage[];
  userText: string;
  signal?: AbortSignal;
  callbacks: AgentRunCallbacks;
}): Promise<ChatMessage[]> {
  const config = getConfig();
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
  const messages: ChatMessage[] = [
    { role: "system", content: config.systemPrompt },
    { role: "system", content: buildEditorContextMessage() },
    ...prior,
    { role: "user", content: options.userText },
  ];

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

    options.callbacks.onPhase(
      "thinking",
      editsByPath.size > 0 ? "Думает…" : "Думает…"
    );

    const requestMessages = messages.slice();
    const { message: assistant, usage } = await client.chatCompletions(
      {
        model: options.model,
        messages,
        tools: agentTools,
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
      options.callbacks.onPhase("done", "Надумал");
      const text = sanitizeAssistantText(
        assistant.content?.trim() || "(пустой ответ)",
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

      if (call.function.name === "write_file") {
        options.callbacks.onPhase(
          "editing",
          formatEditingDetail([...editsByPath.values()])
        );
      } else {
        options.callbacks.onPhase("thinking", "Думает…");
      }

      options.callbacks.onTool(
        `⚙ ${call.function.name}(${call.function.arguments})`
      );
      const result = await runTool(
        call.function.name,
        call.function.arguments
      );
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

    options.callbacks.onPhase("thinking", "Думает…");

    const finalRequest = [
      ...messages,
      {
        role: "user" as const,
        content:
          "Инструменты больше недоступны. Кратко ответь пользователю по уже полученным данным. Не вызывай инструменты.",
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

    let text = finalMessage.content?.trim() ?? "";
    if (!text && finalMessage.tool_calls?.length) {
      text =
        "Модель продолжила вызывать инструменты. Попробуйте другую модель (например DeepSeek-V4-Flash) или уточните задачу.";
    }
    if (!text) {
      text = "Не удалось получить финальный ответ.";
    }
    text = sanitizeAssistantText(text, { maxChars: config.maxResponseChars });

    options.callbacks.onPhase("done", "Надумал");
    messages.push({
      role: "assistant",
      content: text,
    });
    options.callbacks.onAssistant(text);
    options.callbacks.onReview([...editsByPath.values()]);
  }

  return compactHistory(messages.slice(1));
}
