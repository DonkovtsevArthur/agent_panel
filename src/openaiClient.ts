import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import { URL } from "url";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
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

    const payload = JSON.stringify(body);
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
