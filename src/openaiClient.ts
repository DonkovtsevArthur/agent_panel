import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import { URL } from "url";

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
  const m = model.toLowerCase();
  return m.includes("kimi") || m.includes("moonshot");
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
}

export interface ClientTlsOptions {
  rejectUnauthorized: boolean;
  caBundlePath?: string;
}

function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function buildHttpsAgent(tls: ClientTlsOptions): https.Agent {
  const options: https.AgentOptions = {
    rejectUnauthorized: tls.rejectUnauthorized,
  };

  if (tls.caBundlePath) {
    const caPath = expandHome(tls.caBundlePath);
    if (fs.existsSync(caPath)) {
      options.ca = fs.readFileSync(caPath);
    }
  }

  return new https.Agent(options);
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
        agent: isHttps ? buildHttpsAgent(init.tls) : undefined,
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

    const onAbort = () => {
      req.destroy(new Error("aborted"));
    };
    if (init.signal) {
      if (init.signal.aborted) {
        onAbort();
        return;
      }
      init.signal.addEventListener("abort", onAbort, { once: true });
    }

    req.on("error", reject);
    if (init.body) {
      req.write(init.body);
    }
    req.end();
  });
}

export class OpenAICompatibleClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly tls: ClientTlsOptions
  ) {}

  async chatCompletions(
    body: {
      model: string;
      messages: ChatMessage[];
      tools?: ChatTool[];
      tool_choice?: "auto" | "none";
      temperature?: number;
      max_tokens?: number;
    },
    signal?: AbortSignal
  ): Promise<ChatCompletionResult> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const kimi = isKimiFamilyModel(body.model);
    const apiBody: Record<string, unknown> = {
      model: body.model,
      messages: toApiMessages(body.messages, {
        ensureReasoningForTools: kimi,
      }),
    };
    if (body.tools) {
      apiBody.tools = body.tools;
    }
    if (body.tool_choice) {
      apiBody.tool_choice = body.tool_choice;
    }
    // Kimi k2.6/k2.7: temperature не задаётся; reasoning+content делят max_tokens.
    if (!kimi && body.temperature !== undefined) {
      apiBody.temperature = body.temperature;
    }
    if (body.max_tokens !== undefined) {
      apiBody.max_tokens = kimi
        ? Math.max(body.max_tokens, 16384)
        : body.max_tokens;
    } else if (kimi) {
      apiBody.max_tokens = 16384;
    }

    const payload = JSON.stringify(apiBody);
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
    return { message, usage: data.usage };
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const response = await requestJson(`${this.baseUrl}/models`, {
      method: "GET",
      headers,
      signal,
      tls: this.tls,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `API ${response.status}: ${response.text.slice(0, 800)}`
      );
    }

    const data = JSON.parse(response.text) as {
      data?: Array<{ id?: string }>;
    };
    return (data.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id));
  }
}
