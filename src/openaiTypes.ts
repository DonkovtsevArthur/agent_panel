/**
 * Shared OpenAI-compatible message / tool types used by Harbor chat storage,
 * turn runners, and the HTTP client. Keep transport logic in `openaiClient.ts`.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

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
  jitterRatio?: number;
}

export interface ChatCompletionDelta {
  content?: string;
  reasoning_content?: string;
  /** Partial tool call as it streams (name/id may appear before args finish). */
  tool_call?: {
    index: number;
    id?: string;
    name?: string;
    argumentsDelta?: string;
  };
}

export interface ChatCompletionsCallOptions {
  onDelta?: (delta: ChatCompletionDelta) => void;
  /** Fired before each transport retry (attempt is 1-based after the first failure). */
  onRetry?: (info: {
    attempt: number;
    maxAttempts: number;
    error: unknown;
    delayMs: number;
  }) => void;
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
  /** OpenAI-style reasoning effort (Claude 3.5+/4 via gateway). */
  reasoning_effort?: string;
}
