import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import { URL } from "url";
import {
  KIMI_MIN_MAX_TOKENS,
  modelNeedsGatewayWorkarounds,
  modelUsesMainLikeApi,
  resolveModelCapabilities,
  resolveModelRequestMaxTokens,
} from "./modelCapabilities";

export { KIMI_MIN_MAX_TOKENS } from "./modelCapabilities";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: ChatRole;
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  /**
   * Thinking-модели (Kimi и др.) возвращают ход рассуждения отдельно от ответа.
   * При tool-call loop его нужно эхоить обратно в messages.
   */
  reasoning_content?: string;
  /**
   * Локальные вложения user-хода (пути/метаданные).
   * В JSON для API не отправляется — см. toApiMessages.
   */
  attachments?: import("./attachments").MessageAttachment[];
}

/** Kimi / Moonshot family — thinking on by default, special message rules. */
export function isKimiFamilyModel(model: string): boolean {
  return resolveModelCapabilities(model).family === "kimi";
}

function isEffectivelyEmptyContent(
  content: ChatMessage["content"]
): boolean {
  if (content == null) {
    return true;
  }
  if (typeof content === "string") {
    return content.trim().length === 0;
  }
  if (!Array.isArray(content) || content.length === 0) {
    return true;
  }
  return content.every((part) => {
    if (part.type === "text") {
      return !String(part.text || "").trim();
    }
    return false;
  });
}

/**
 * Готовит messages к chat/completions:
 * - не шлёт attachments;
 * - при tool_calls и пустом content — опускает content (иначе Kimi 400);
 * - сохраняет reasoning_content; для Kimi tool-call без него — placeholder.
 */
export function toApiMessages(
  messages: ChatMessage[],
  options?: { ensureReasoningForTools?: boolean }
): Record<string, unknown>[] {
  const ensureReasoning = Boolean(options?.ensureReasoningForTools);
  return messages.map((message) => {
    const { attachments: _a, ...rest } = message;
    const out: Record<string, unknown> = { role: rest.role };

    if (rest.tool_call_id) {
      out.tool_call_id = rest.tool_call_id;
    }
    if (rest.name) {
      out.name = rest.name;
    }
    if (rest.tool_calls?.length) {
      out.tool_calls = rest.tool_calls;
    }

    const reasoning =
      typeof rest.reasoning_content === "string"
        ? rest.reasoning_content
        : undefined;
    if (reasoning && reasoning.length > 0) {
      out.reasoning_content = reasoning;
    } else if (
      ensureReasoning &&
      rest.role === "assistant" &&
      rest.tool_calls?.length
    ) {
      // «thinking is enabled but reasoning_content is missing…»
      out.reasoning_content = " ";
    }

    const empty = isEffectivelyEmptyContent(rest.content ?? null);
    const omitContent =
      rest.role === "assistant" && Boolean(rest.tool_calls?.length) && empty;
    if (!omitContent) {
      if (rest.content !== undefined && rest.content !== null) {
        out.content = rest.content;
      } else if (!rest.tool_calls?.length) {
        out.content = "";
      }
    }

    return out;
  });
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatCompletionResponse {
  choices: Array<{
    message: ChatMessage;
    finish_reason?: string;
  }>;
  usage?: ChatCompletionUsage;
}

export interface ChatCompletionResult {
  message: ChatMessage;
  usage?: ChatCompletionUsage;
  finishReason?: string;
}

export interface ClientTlsOptions {
  rejectUnauthorized: boolean;
  caBundlePath?: string;
}

export interface TransportRetryOptions {
  /** Total attempts, including the first request. */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Jitter ratio in the range 0..1. */
  jitterRatio?: number;
}

const DEFAULT_RETRY_OPTIONS: Required<TransportRetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
  jitterRatio: 0.25,
};

class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpStatusError";
  }
}

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return (
    Boolean(signal?.aborted) ||
    (error instanceof Error &&
      (error.name === "AbortError" || /aborted/i.test(error.message)))
  );
}

export function isRetryableTransportError(error: unknown): boolean {
  if (error instanceof HttpStatusError) {
    return (
      error.status === 429 ||
      error.status === 500 ||
      error.status === 502 ||
      error.status === 503 ||
      error.status === 504
    );
  }
  if (!(error instanceof Error) || error.name === "AbortError") {
    return false;
  }
  const code = String(
    (error as Error & { code?: unknown }).code || ""
  ).toUpperCase();
  return [
    "ECONNRESET",
    "ECONNREFUSED",
    "EPIPE",
    "EAI_AGAIN",
    "ENETDOWN",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
  ].includes(code);
}

/** Короткий фрагмент тела API-ошибки для UI (после 500 и т.п.). */
export function formatApiErrorDetail(error: unknown, max = 280): string {
  const message =
    error instanceof Error ? error.message : String(error || "").trim();
  if (!message) {
    return "";
  }
  if (/SSE stream interrupted after partial/i.test(message)) {
    return "";
  }
  const api = message.match(/API\s+(\d+)\s*:\s*([\s\S]*)/i);
  if (api) {
    const body = api[2].replace(/\s+/g, " ").trim();
    return `API ${api[1]}: ${body.slice(0, max)}${body.length > max ? "…" : ""}`;
  }
  if (/API\s*5\d\d\b|internal server error/i.test(message)) {
    return message.replace(/\s+/g, " ").trim().slice(0, max);
  }
  return "";
}

function shouldFallbackToNonStream(
  modelId: string | undefined,
  error: unknown
): boolean {
  if (!modelNeedsGatewayWorkarounds(String(modelId || ""))) {
    return false;
  }
  if (
    error instanceof Error &&
    /SSE stream interrupted after partial/i.test(error.message)
  ) {
    return false;
  }
  return isRetryableTransportError(error);
}

function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function withTransportRetry<T>(
  operation: () => Promise<T>,
  signal: AbortSignal | undefined,
  options: Required<TransportRetryOptions>
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) {
      throw abortError();
    }
    try {
      return await operation();
    } catch (error) {
      if (
        isAbortError(error, signal) ||
        attempt >= options.maxAttempts ||
        !isRetryableTransportError(error)
      ) {
        throw error;
      }
      const exponential = Math.min(
        options.maxDelayMs,
        options.baseDelayMs * 2 ** (attempt - 1)
      );
      const jitter =
        exponential * options.jitterRatio * (Math.random() * 2 - 1);
      await sleepWithSignal(Math.max(0, exponential + jitter), signal);
    }
  }
}

export function shouldContinueAfterLength(
  finishReason: string | undefined,
  continuations: number,
  maxContinuations = 2
): boolean {
  return finishReason === "length" && continuations < maxContinuations;
}

function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function tlsPoolKey(tls: ClientTlsOptions): string {
  return `${tls.rejectUnauthorized ? "1" : "0"}|${String(tls.caBundlePath || "").trim()}`;
}

function agentPoolKey(
  protocol: string,
  hostname: string,
  port: string,
  tls: ClientTlsOptions
): string {
  return `${protocol}|${hostname}|${port}|${tlsPoolKey(tls)}`;
}

const KEEP_ALIVE_MSECS = 30_000;
const MAX_SOCKETS = 16;
const MAX_FREE_SOCKETS = 8;

const httpAgentPool = new Map<string, http.Agent | https.Agent>();
// Populated after OpenAICompatibleClient is defined; typed loosely to avoid TDZ.
const openAIClientPool = new Map<string, unknown>();

function buildKeepAliveAgentOptions(
  tls: ClientTlsOptions,
  forHttps: boolean
): http.AgentOptions | https.AgentOptions {
  const options: http.AgentOptions & https.AgentOptions = {
    keepAlive: true,
    keepAliveMsecs: KEEP_ALIVE_MSECS,
    maxSockets: MAX_SOCKETS,
    maxFreeSockets: MAX_FREE_SOCKETS,
  };
  if (forHttps) {
    (options as https.AgentOptions).rejectUnauthorized = tls.rejectUnauthorized;
    if (tls.caBundlePath) {
      const caPath = expandHome(tls.caBundlePath);
      if (fs.existsSync(caPath)) {
        (options as https.AgentOptions).ca = fs.readFileSync(caPath);
      }
    }
  }
  return options;
}

/** Shared keep-alive agent for a host (tests may call {@link resetTransportPools}). */
export function getOrCreateHttpAgent(
  url: string | URL,
  tls: ClientTlsOptions
): http.Agent | https.Agent {
  const parsed = typeof url === "string" ? new URL(url) : url;
  const isHttps = parsed.protocol === "https:";
  const port = parsed.port || (isHttps ? "443" : "80");
  const key = agentPoolKey(parsed.protocol, parsed.hostname, port, tls);
  const existing = httpAgentPool.get(key);
  if (existing) {
    return existing;
  }
  const agent = isHttps
    ? new https.Agent(buildKeepAliveAgentOptions(tls, true))
    : new http.Agent(buildKeepAliveAgentOptions(tls, false));
  httpAgentPool.set(key, agent);
  return agent;
}

export function resolveRequestMaxTokens(
  model: string,
  requested?: number,
  kimiMinTokens = KIMI_MIN_MAX_TOKENS
): number | undefined {
  return resolveModelRequestMaxTokens(model, requested, kimiMinTokens);
}

export interface ChatCompletionDelta {
  content?: string;
  reasoning_content?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  tool_choice?: "auto" | "none";
  temperature?: number;
  max_tokens?: number;
  /** Internal client option; not sent to the API. */
  minimum_output_tokens?: number;
}

function requestJson(
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    tls: ClientTlsOptions;
  }
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;

    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: init.method,
        headers: init.headers,
        agent: getOrCreateHttpAgent(parsed, init.tls),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );

    const cleanup = () => init.signal?.removeEventListener("abort", onAbort);
    const onAbort = () => req.destroy(abortError());
    if (init.signal) {
      if (init.signal.aborted) {
        onAbort();
        return;
      }
      init.signal.addEventListener("abort", onAbort, { once: true });
    }

    req.on("close", cleanup);
    req.on("error", reject);
    if (init.body) {
      req.write(init.body);
    }
    req.end();
  });
}

function requestSse(
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    tls: ClientTlsOptions;
    onEvent: (data: string) => void;
  }
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;

    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: init.method,
        headers: init.headers,
        agent: getOrCreateHttpAgent(parsed, init.tls),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            reject(
              new HttpStatusError(
                status,
                `API ${status}: ${Buffer.concat(chunks)
                  .toString("utf8")
                  .slice(0, 800)}`
              )
            );
          });
          return;
        }

        let buffer = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          let sep: number;
          while ((sep = buffer.indexOf("\n")) >= 0) {
            let line = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 1);
            if (line.endsWith("\r")) {
              line = line.slice(0, -1);
            }
            if (!line.startsWith("data:")) {
              continue;
            }
            const data = line.slice(5).trimStart();
            if (!data || data === "[DONE]") {
              continue;
            }
            try {
              init.onEvent(data);
            } catch (err) {
              reject(err);
              req.destroy();
              return;
            }
          }
        });
        res.on("end", () => resolve({ status }));
        res.on("error", reject);
      }
    );

    const cleanup = () => init.signal?.removeEventListener("abort", onAbort);
    const onAbort = () => req.destroy(abortError());
    if (init.signal) {
      if (init.signal.aborted) {
        onAbort();
        return;
      }
      init.signal.addEventListener("abort", onAbort, { once: true });
    }

    req.on("close", cleanup);
    req.on("error", reject);
    if (init.body) {
      req.write(init.body);
    }
    req.end();
  });
}

type ToolCallAcc = {
  id?: string;
  type?: "function";
  function: { name?: string; arguments: string };
};

function applyToolCallDelta(
  acc: Map<number, ToolCallAcc>,
  deltas: Array<{
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>
): void {
  for (const part of deltas) {
    const index = typeof part.index === "number" ? part.index : 0;
    let row = acc.get(index);
    if (!row) {
      row = { function: { arguments: "" } };
      acc.set(index, row);
    }
    if (part.id) {
      row.id = part.id;
    }
    if (part.type === "function") {
      row.type = "function";
    }
    if (part.function?.name) {
      row.function.name = (row.function.name || "") + part.function.name;
    }
    if (typeof part.function?.arguments === "string") {
      row.function.arguments += part.function.arguments;
    }
  }
}

function finalizeToolCalls(acc: Map<number, ToolCallAcc>): ToolCall[] {
  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row], i) => ({
      id: row.id || `call_${i}`,
      type: "function" as const,
      function: {
        name: row.function.name || "",
        arguments: row.function.arguments || "",
      },
    }))
    .filter((call) => Boolean(call.function.name));
}

export class OpenAICompatibleClient {
  private readonly retry: Required<TransportRetryOptions>;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly tls: ClientTlsOptions,
    retry?: TransportRetryOptions
  ) {
    this.retry = {
      maxAttempts: Math.max(
        1,
        Math.floor(retry?.maxAttempts ?? DEFAULT_RETRY_OPTIONS.maxAttempts)
      ),
      baseDelayMs: Math.max(
        0,
        retry?.baseDelayMs ?? DEFAULT_RETRY_OPTIONS.baseDelayMs
      ),
      maxDelayMs: Math.max(
        0,
        retry?.maxDelayMs ?? DEFAULT_RETRY_OPTIONS.maxDelayMs
      ),
      jitterRatio: Math.min(
        1,
        Math.max(0, retry?.jitterRatio ?? DEFAULT_RETRY_OPTIONS.jitterRatio)
      ),
    };
  }

  private buildApiBody(
    body: ChatCompletionRequest,
    stream: boolean
  ): Record<string, unknown> {
    const capabilities = resolveModelCapabilities(body.model);
    const apiBody: Record<string, unknown> = {
      model: body.model,
      messages: toApiMessages(body.messages, {
        ensureReasoningForTools:
          capabilities.requiresReasoningContentForToolCalls,
      }),
      stream,
    };
    if (body.tools) {
      apiBody.tools = body.tools;
    }
    if (body.tool_choice) {
      apiBody.tool_choice = body.tool_choice;
    }
    if (!capabilities.omitTemperature && body.temperature !== undefined) {
      apiBody.temperature = body.temperature;
    }
    const maxTokens = resolveModelRequestMaxTokens(
      body.model,
      body.max_tokens,
      body.minimum_output_tokens
    );
    if (maxTokens !== undefined) {
      apiBody.max_tokens = maxTokens;
    }
    return apiBody;
  }

  async chatCompletions(
    body: ChatCompletionRequest,
    signal?: AbortSignal,
    options?: { onDelta?: (delta: ChatCompletionDelta) => void }
  ): Promise<ChatCompletionResult> {
    // Все модели: как на main — простой non-stream JSON.
    const result = await this.chatCompletionsMainLike(body, signal);
    const text =
      typeof result.message.content === "string"
        ? result.message.content
        : "";
    if (text && options?.onDelta) {
      options.onDelta({ content: text });
    }
    return result;
  }

  /**
   * Транспорт один в один как на main: JSON.stringify(body), без stream/retry/toApiMessages.
   */
  private async chatCompletionsMainLike(
    body: ChatCompletionRequest,
    signal?: AbortSignal
  ): Promise<ChatCompletionResult> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    // Как на main: тело = model/messages[/tools]/tool_choice]/temperature]/max_tokens].
    const requestBody: {
      model: string;
      messages: ChatMessage[];
      tools?: ChatTool[];
      tool_choice?: "auto" | "none";
      temperature?: number;
      max_tokens?: number;
    } = {
      model: body.model,
      messages: body.messages.map((message) => {
        const { attachments: _a, ...rest } = message;
        return rest;
      }),
    };
    if (body.tools) {
      requestBody.tools = body.tools;
    }
    if (body.tool_choice) {
      requestBody.tool_choice = body.tool_choice;
    }
    if (body.temperature !== undefined) {
      requestBody.temperature = body.temperature;
    }
    if (body.max_tokens !== undefined) {
      requestBody.max_tokens = body.max_tokens;
    }

    const payload = JSON.stringify(requestBody);
    headers["Content-Length"] = Buffer.byteLength(payload).toString();

    const response = await requestJson(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: payload,
      signal,
      tls: this.tls,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `API ${response.status}: ${response.text.slice(0, 800)}`
      );
    }

    const data = JSON.parse(response.text) as ChatCompletionResponse;
    const message = data.choices?.[0]?.message;
    if (!message) {
      throw new Error("Пустой ответ от API");
    }
    return {
      message,
      usage: data.usage,
      finishReason: data.choices?.[0]?.finish_reason,
    };
  }

  private async chatCompletionsStreaming(
    body: ChatCompletionRequest,
    signal?: AbortSignal,
    options?: { onDelta?: (delta: ChatCompletionDelta) => void }
  ): Promise<ChatCompletionResult> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const apiBody = this.buildApiBody(body, true);
    const payload = JSON.stringify(apiBody);
    headers["Content-Length"] = Buffer.byteLength(payload).toString();

    let content = "";
    let reasoning = "";
    const toolAcc = new Map<number, ToolCallAcc>();
    let usage: ChatCompletionUsage | undefined;
    let sawChoice = false;
    let finishReason: string | undefined;

    await withTransportRetry(
      async () => {
          // A failed attempt is retried only if it emitted no SSE choice, so
          // callers never receive duplicate deltas or partial tool calls.
          if (!sawChoice) {
            content = "";
            reasoning = "";
            toolAcc.clear();
            usage = undefined;
            finishReason = undefined;
          }
          try {
            await requestSse(`${this.baseUrl}/chat/completions`, {
              method: "POST",
              headers,
              body: payload,
              signal,
              tls: this.tls,
              onEvent: (data) => {
                const parsed = JSON.parse(data) as {
                  choices?: Array<{
                    delta?: {
                      content?: string | null;
                      reasoning_content?: string | null;
                      tool_calls?: Array<{
                        index?: number;
                        id?: string;
                        type?: string;
                        function?: { name?: string; arguments?: string };
                      }>;
                    };
                    message?: ChatMessage & { reasoning_content?: unknown };
                    finish_reason?: string | null;
                  }>;
                  usage?: ChatCompletionUsage;
                };
                if (parsed.usage) {
                  usage = parsed.usage;
                }
                const choice = parsed.choices?.[0];
                if (!choice) {
                  return;
                }
                sawChoice = true;
                if (typeof choice.finish_reason === "string") {
                  finishReason = choice.finish_reason;
                }
                const delta = choice.delta;
                if (delta) {
                  if (typeof delta.content === "string" && delta.content) {
                    content += delta.content;
                    options?.onDelta?.({ content: delta.content });
                  }
                  if (
                    typeof delta.reasoning_content === "string" &&
                    delta.reasoning_content
                  ) {
                    reasoning += delta.reasoning_content;
                    options?.onDelta?.({
                      reasoning_content: delta.reasoning_content,
                    });
                  }
                  if (
                    Array.isArray(delta.tool_calls) &&
                    delta.tool_calls.length
                  ) {
                    applyToolCallDelta(toolAcc, delta.tool_calls);
                  }
                }
                // Редкий non-delta chunk в stream.
                if (choice.message) {
                  const msg = choice.message;
                  if (typeof msg.content === "string" && msg.content) {
                    content = msg.content;
                  }
                  if (typeof msg.reasoning_content === "string") {
                    reasoning = msg.reasoning_content;
                  }
                  if (msg.tool_calls?.length) {
                    toolAcc.clear();
                    msg.tool_calls.forEach((call, index) => {
                      toolAcc.set(index, {
                        id: call.id,
                        type: "function",
                        function: {
                          name: call.function?.name,
                          arguments: call.function?.arguments || "",
                        },
                      });
                    });
                  }
                }
              },
            });
          } catch (error) {
            if (sawChoice && isRetryableTransportError(error)) {
              // Retrying a partially consumed stream would duplicate output.
              throw new Error(
                `SSE stream interrupted after partial response: ${
                  error instanceof Error ? error.message : String(error)
                }`
              );
            }
            throw error;
          }
      },
      signal,
      this.retry
    );

    if (!sawChoice && !content && toolAcc.size === 0) {
      return this.chatCompletionsNonStream(body, signal);
    }

    const toolCalls = finalizeToolCalls(toolAcc);
    const message: ChatMessage = {
      role: "assistant",
      content: content || (toolCalls.length ? null : ""),
    };
    if (toolCalls.length) {
      message.tool_calls = toolCalls;
    }
    if (reasoning) {
      message.reasoning_content = reasoning;
    }
    return { message, usage, finishReason };
  }

  private async chatCompletionsNonStream(
    body: ChatCompletionRequest,
    signal?: AbortSignal
  ): Promise<ChatCompletionResult> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const apiBody = this.buildApiBody(body, false);
    const payload = JSON.stringify(apiBody);
    headers["Content-Length"] = Buffer.byteLength(payload).toString();

    const response = await withTransportRetry(async () => {
      const current = await requestJson(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: payload,
        signal,
        tls: this.tls,
      });
      if (current.status < 200 || current.status >= 300) {
        throw new HttpStatusError(
          current.status,
          `API ${current.status}: ${current.text.slice(0, 800)}`
        );
      }
      return current;
    }, signal, this.retry);

    const data = JSON.parse(response.text) as ChatCompletionResponse & {
      choices?: Array<{
        message?: ChatMessage & { reasoning_content?: unknown };
      }>;
    };
    const raw = data.choices?.[0]?.message;
    if (!raw) {
      throw new Error("Пустой ответ от API");
    }
    const message: ChatMessage = { ...raw };
    if (typeof raw.reasoning_content === "string") {
      message.reasoning_content = raw.reasoning_content;
    }
    return {
      message,
      usage: data.usage,
      finishReason: data.choices?.[0]?.finish_reason,
    };
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const response = await withTransportRetry(async () => {
      const current = await requestJson(`${this.baseUrl}/models`, {
        method: "GET",
        headers,
        signal,
        tls: this.tls,
      });
      if (current.status < 200 || current.status >= 300) {
        throw new HttpStatusError(
          current.status,
          `API ${current.status}: ${current.text.slice(0, 800)}`
        );
      }
      return current;
    }, signal, this.retry);

    const data = JSON.parse(response.text) as {
      data?: Array<{ id?: string }>;
    };
    return (data.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id));
  }

  /** GET произвольного URL (health / status). 2xx = ok. */
  async probeGet(url: string, signal?: AbortSignal): Promise<void> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    await withTransportRetry(async () => {
      const current = await requestJson(url, {
        method: "GET",
        headers,
        signal,
        tls: this.tls,
      });
      if (current.status < 200 || current.status >= 300) {
        throw new HttpStatusError(
          current.status,
          `API ${current.status}: ${current.text.slice(0, 800)}`
        );
      }
      return current;
    }, signal, this.retry);
  }
}

function clientPoolKey(
  baseUrl: string,
  apiKey: string,
  tls: ClientTlsOptions
): string {
  return `${baseUrl.trim()}|${apiKey}|${tlsPoolKey(tls)}`;
}

/**
 * Reuse OpenAI-compatible clients across turns / probes for the same endpoint.
 * Tests may still construct {@link OpenAICompatibleClient} directly.
 */
export function getOpenAICompatibleClient(
  baseUrl: string,
  apiKey: string,
  tls: ClientTlsOptions,
  retry?: TransportRetryOptions
): OpenAICompatibleClient {
  // Custom retry options are for tests / one-offs — do not pool those instances.
  if (retry) {
    return new OpenAICompatibleClient(baseUrl, apiKey, tls, retry);
  }
  const key = clientPoolKey(baseUrl, apiKey, tls);
  const existing = openAIClientPool.get(key) as
    | OpenAICompatibleClient
    | undefined;
  if (existing) {
    return existing;
  }
  const client = new OpenAICompatibleClient(baseUrl, apiKey, tls);
  openAIClientPool.set(key, client);
  return client;
}

/** Destroy pooled agents and clear client cache (unit tests). */
export function resetTransportPools(): void {
  for (const agent of httpAgentPool.values()) {
    agent.destroy();
  }
  httpAgentPool.clear();
  openAIClientPool.clear();
}
