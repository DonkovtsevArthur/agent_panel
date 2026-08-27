import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import { URL } from "url";
import {
  KIMI_MIN_MAX_TOKENS,
  resolveModelCapabilities,
  resolveModelRequestMaxTokens,
} from "./modelCapabilities";
import { readModelTokenLimits } from "./modelTokenLimits";
import type {
  ChatCompletionDelta,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionResult,
  ChatCompletionsCallOptions,
  ChatCompletionUsage,
  ChatMessage,
  ChatTool,
  ClientTlsOptions,
  ContentPart,
  ToolCall,
  TransportRetryOptions,
} from "./openaiTypes";

export { KIMI_MIN_MAX_TOKENS } from "./modelCapabilities";
export type {
  ChatCompletionDelta,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionResult,
  ChatCompletionsCallOptions,
  ChatCompletionUsage,
  ChatMessage,
  ChatRole,
  ChatTool,
  ClientTlsOptions,
  ContentPart,
  ToolCall,
  TransportRetryOptions,
} from "./openaiTypes";

/**
 * Socket-level timeouts for HTTP requests to LLM providers.
 * These prevent indefinite hangs when a server accepts a connection but
 * never responds or stops sending data mid-stream.
 *
 * `SOCKET_TIMEOUT_MS` is an idle timeout on the TCP socket (Node resets it on
 * activity) — not a hard cap on total request wall-clock time.
 * `SSE_READ_TIMEOUT_MS` is a separate silence watchdog between SSE chunks.
 */
const SOCKET_TIMEOUT_MS = 120_000; // 2 min idle with no socket activity
const SSE_READ_TIMEOUT_MS = 90_000; // 90s — max silence between SSE chunks

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
  options?: {
    ensureReasoningForTools?: boolean;
    stripReasoningOnEcho?: boolean;
    /**
     * Kimi: assistant tool-call turn должен идти без поля `content` вообще
     * (гейтвей 400-ит на `content: null`). Для всех остальных моделей
     * `content: null` обязателен — без него строгие гейтвеи (DeepSeek/DaVinci)
     * 500-ят на re-entry после tool-result.
     */
    omitContentForToolCalls?: boolean;
  }
): Record<string, unknown>[] {
  const ensureReasoning = Boolean(options?.ensureReasoningForTools);
  const stripReasoning = Boolean(options?.stripReasoningOnEcho);
  const omitContentForTools = Boolean(options?.omitContentForToolCalls);
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
    if (stripReasoning && rest.role === "assistant") {
      // Claude extended thinking: reasoning_content не несёт signature,
      // поэтому не эхается на assistant tool-call turn (гейтвей регенерирует).
    } else if (reasoning && reasoning.length > 0) {
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
    } else if (omitContentForTools) {
      // Kimi: гейтвей 400-ит на `content: null` — опускаем поле полностью.
    } else {
      // DeepSeek/OpenAI/Anthropic-compat: assistant tool-call turn must carry
      // an explicit `content: null`; omitting it makes strict gateways 500
      // on re-entry after a tool result.
      out.content = null;
    }

    return out;
  });
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
  options: Required<TransportRetryOptions>,
  onRetry?: ChatCompletionsCallOptions["onRetry"]
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
      const delayMs = Math.max(0, exponential + jitter);
      onRetry?.({
        attempt: attempt + 1,
        maxAttempts: options.maxAttempts,
        error,
        delayMs,
      });
      await sleepWithSignal(delayMs, signal);
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
  const trimmed = String(p || "").trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed === "~") {
    return os.homedir();
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
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

    // Socket timeout — prevents hanging when server accepts connection but never responds
    req.setTimeout(SOCKET_TIMEOUT_MS, () => {
      req.destroy(new Error(`socket timeout: no response for ${SOCKET_TIMEOUT_MS / 1000}s`));
    });

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

        // Read timeout — resets on every SSE chunk; fires if stream goes silent
        let readTimer: ReturnType<typeof setTimeout> | undefined;
        const resetReadTimer = () => {
          if (readTimer) clearTimeout(readTimer);
          readTimer = setTimeout(() => {
            req.destroy(new Error(`stream read timeout: no SSE data for ${SSE_READ_TIMEOUT_MS / 1000}s`));
          }, SSE_READ_TIMEOUT_MS);
        };
        resetReadTimer();

        res.on("data", (chunk: string) => {
          resetReadTimer();
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
        res.on("end", () => {
          if (readTimer) clearTimeout(readTimer);
          resolve({ status });
        });
        res.on("error", (err) => {
          if (readTimer) clearTimeout(readTimer);
          reject(err);
        });
      }
    );

    // Socket timeout — prevents hanging when server accepts connection but never responds
    req.setTimeout(SOCKET_TIMEOUT_MS, () => {
      req.destroy(new Error(`socket timeout: no response for ${SOCKET_TIMEOUT_MS / 1000}s`));
    });

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
  }>,
  onDelta?: (delta: ChatCompletionDelta) => void
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
    if (
      onDelta &&
      (part.id || part.function?.name || typeof part.function?.arguments === "string")
    ) {
      onDelta({
        tool_call: {
          index,
          id: row.id,
          name: row.function.name,
          argumentsDelta:
            typeof part.function?.arguments === "string"
              ? part.function.arguments
              : undefined,
        },
      });
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

/** Модель из GET /models провайдера (id + лимиты токенов, если API их отдал). */
export interface ListedProviderModel {
  id: string;
  label?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function listedModelsArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  const root = asPlainRecord(payload);
  if (!root) {
    return [];
  }
  for (const key of ["data", "models", "items", "results", "list"]) {
    const value = root[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

/** Разбирает ответ GET /models: id + универсальные лимиты токенов. */
export function parseListedProviderModels(
  payload: unknown
): ListedProviderModel[] {
  const seen = new Set<string>();
  const models: ListedProviderModel[] = [];
  for (const item of listedModelsArray(payload)) {
    const row = asPlainRecord(item);
    if (!row) {
      continue;
    }
    const id = String(row.id || "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const label = String(row.name || row.label || "").trim();
    const limits = readModelTokenLimits(row);
    const model: ListedProviderModel = { id };
    if (label && label !== id) {
      model.label = label;
    }
    if (limits.contextWindow) {
      model.contextWindow = limits.contextWindow;
    }
    if (limits.maxOutputTokens) {
      model.maxOutputTokens = limits.maxOutputTokens;
    }
    models.push(model);
  }
  models.sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { sensitivity: "base", numeric: true })
  );
  return models;
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
        stripReasoningOnEcho: capabilities.stripReasoningOnEcho,
        omitContentForToolCalls: capabilities.omitContentForToolCalls,
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
    if (body.reasoning_effort) {
      apiBody.reasoning_effort = body.reasoning_effort;
    }
    return apiBody;
  }

  async chatCompletions(
    body: ChatCompletionRequest,
    signal?: AbortSignal,
    options?: ChatCompletionsCallOptions
  ): Promise<ChatCompletionResult> {
    try {
      const streamed = await this.chatCompletionsStreaming(
        body,
        signal,
        options
      );
      const text =
        typeof streamed.message.content === "string"
          ? streamed.message.content
          : "";
      const hasTools = Boolean(streamed.message.tool_calls?.length);
      const hasReasoning = Boolean(
        typeof streamed.message.reasoning_content === "string" &&
          streamed.message.reasoning_content.trim() &&
          streamed.message.reasoning_content.trim() !== " "
      );
      if (!text && !hasTools) {
        // Reasoning-only SSE already drove onDelta → Thinking UI. Re-fetching
        // JSON would fire the same reasoning again and duplicate cards.
        if (hasReasoning) {
          return streamed;
        }
        // Empty SSE — fall back to non-stream JSON (corporate gateways).
        return this.chatCompletionsMainLike(body, signal, options);
      }
      // Some Kimi gateways stream content/tools via SSE but omit
      // reasoning_content from the deltas, so the Thinking card stalls on
      // "Thinking…". Re-fetch via JSON to recover reasoning, forwarding only
      // reasoning deltas so already-streamed content/tools are not duplicated.
      if (!hasReasoning && isKimiFamilyModel(body.model)) {
        try {
          const jsonResult = await this.chatCompletionsMainLike(body, signal, {
            ...options,
            onDelta: (delta) => {
              if (delta.reasoning_content) {
                options?.onDelta?.({ reasoning_content: delta.reasoning_content });
              }
            },
          });
          if (
            typeof jsonResult.message.reasoning_content === "string" &&
            jsonResult.message.reasoning_content.trim()
          ) {
            return {
              ...streamed,
              message: {
                ...streamed.message,
                reasoning_content: jsonResult.message.reasoning_content,
              },
            };
          }
        } catch {
          // Reasoning recovery failed — keep the streamed result as-is.
        }
      }
      return streamed;
    } catch (error) {
      if (isAbortError(error, signal)) {
        throw error;
      }
      if (
        error instanceof Error &&
        /SSE stream interrupted after partial/i.test(error.message)
      ) {
        throw error;
      }
      // Do not JSON-fallback after exhausted HTTP retries (429/5xx) — surface the error.
      if (
        error instanceof HttpStatusError ||
        (error instanceof Error && /^API \d{3}:/.test(error.message))
      ) {
        throw error;
      }
      // Stream transport/parse failure before useful output — JSON fallback.
      return this.chatCompletionsMainLike(body, signal, options);
    }
  }

  /**
   * Non-stream JSON chat/completions (gateway-stable fallback).
   * Kimi: toApiMessages + reasoning placeholder, без temperature, min max_tokens.
   */
  private async chatCompletionsMainLike(
    body: ChatCompletionRequest,
    signal?: AbortSignal,
    options?: ChatCompletionsCallOptions
  ): Promise<ChatCompletionResult> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const capabilities = resolveModelCapabilities(body.model);
    const requestBody: Record<string, unknown> = {
      model: body.model,
      messages: toApiMessages(body.messages, {
        ensureReasoningForTools:
          capabilities.requiresReasoningContentForToolCalls,
        stripReasoningOnEcho: capabilities.stripReasoningOnEcho,
        omitContentForToolCalls: capabilities.omitContentForToolCalls,
      }),
    };
    if (body.tools) {
      requestBody.tools = body.tools;
    }
    if (body.tool_choice) {
      requestBody.tool_choice = body.tool_choice;
    }
    if (!capabilities.omitTemperature && body.temperature !== undefined) {
      requestBody.temperature = body.temperature;
    }
    const maxTokens = resolveModelRequestMaxTokens(
      body.model,
      body.max_tokens,
      body.minimum_output_tokens
    );
    if (maxTokens !== undefined) {
      requestBody.max_tokens = maxTokens;
    }
    if (body.reasoning_effort) {
      requestBody.reasoning_effort = body.reasoning_effort;
    }

    const payload = JSON.stringify(requestBody);
    headers["Content-Length"] = Buffer.byteLength(payload).toString();

    const response = await withTransportRetry(
      async () => {
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
      },
      signal,
      this.retry,
      options?.onRetry
    );

    const data = JSON.parse(response.text) as ChatCompletionResponse & {
      choices?: Array<{
        message?: ChatMessage & { reasoning_content?: unknown; reasoning?: unknown };
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
    // Алиас `reasoning` (без _content) — некоторые гейтвеи отдают thinking
    // только через это поле. Не перетираем `reasoning_content`, если он есть.
    if (
      typeof raw.reasoning === "string" &&
      raw.reasoning &&
      !message.reasoning_content
    ) {
      message.reasoning_content = raw.reasoning;
    }
    const text =
      typeof message.content === "string" ? message.content : "";
    if (text && options?.onDelta) {
      options.onDelta({ content: text });
    }
    if (message.reasoning_content && options?.onDelta) {
      options.onDelta({ reasoning_content: message.reasoning_content });
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
    options?: ChatCompletionsCallOptions
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
                      reasoning?: string | null;
                      tool_calls?: Array<{
                        index?: number;
                        id?: string;
                        type?: string;
                        function?: { name?: string; arguments?: string };
                      }>;
                    };
                    message?: ChatMessage & {
                      reasoning_content?: unknown;
                      reasoning?: unknown;
                    };
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
                  // Алиас `reasoning` (без _content) — OpenRouter / Anthropic-прокси
                  // / корпоративные гейтвеи отдают Claude thinking через это поле.
                  // Не дублируем, если гейтвей шлёт оба.
                  if (
                    typeof delta.reasoning === "string" &&
                    delta.reasoning &&
                    !(typeof delta.reasoning_content === "string" && delta.reasoning_content)
                  ) {
                    reasoning += delta.reasoning;
                    options?.onDelta?.({
                      reasoning_content: delta.reasoning,
                    });
                  }
                  if (
                    Array.isArray(delta.tool_calls) &&
                    delta.tool_calls.length
                  ) {
                    applyToolCallDelta(
                      toolAcc,
                      delta.tool_calls,
                      options?.onDelta
                    );
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
                  if (
                    typeof msg.reasoning === "string" &&
                    msg.reasoning &&
                    !(typeof msg.reasoning_content === "string" && msg.reasoning_content)
                  ) {
                    reasoning = msg.reasoning;
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
      this.retry,
      options?.onRetry
    );

    if (!sawChoice && !content && toolAcc.size === 0) {
      return this.chatCompletionsMainLike(body, signal, options);
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

  async listModels(signal?: AbortSignal): Promise<ListedProviderModel[]> {
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

    return parseListedProviderModels(JSON.parse(response.text) as unknown);
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
