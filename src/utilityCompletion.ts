import { getConfig, resolveModelEndpoint } from "./config";
import { getOpenAICompatibleClient } from "./openaiClient";

export interface UtilityCompletionRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
}

export interface UtilityCompletionOptions {
  /**
   * Ordered candidate model ids — tried as-is until one answers, so an
   * unavailable lightweight model degrades to the next candidate (down to
   * the first available model). See orderedUtilityModelIds.
   */
  modelIds: readonly string[];
  signal?: AbortSignal;
}

export interface UtilityCompletionResult {
  modelId: string;
  text: string;
}

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) {
    return true;
  }
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /(?:^|\b)aborted\b/i.test(error.message))
  );
}

function contentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text?: string }).text || "")
        : ""
    )
    .join("");
}

/**
 * Одна короткая генерация для служебных задач (сообщения коммитов, названия
 * чатов/табов). Кандидаты пробуются по порядку: первая ответившая модель
 * выигрывает, поэтому недоступная лёгкая модель деградирует до следующей —
 * вплоть до первой доступной. Бросает последнюю ошибку, если не ответил
 * никто; аборт пробрасывается сразу.
 */
export async function completeWithModelFallback(
  request: UtilityCompletionRequest,
  options: UtilityCompletionOptions
): Promise<UtilityCompletionResult> {
  const config = getConfig();
  const candidates: string[] = [];
  for (const raw of options.modelIds) {
    const id = String(raw || "").trim();
    if (id && !candidates.includes(id)) {
      candidates.push(id);
    }
  }

  let lastError: unknown;
  for (const modelId of candidates) {
    if (options.signal?.aborted) {
      throw abortError();
    }
    const endpoint = resolveModelEndpoint(modelId);
    if (!endpoint.baseUrl || !endpoint.apiKey) {
      continue;
    }
    const client = getOpenAICompatibleClient(
      endpoint.baseUrl,
      endpoint.apiKey,
      {
        rejectUnauthorized: config.rejectUnauthorized,
        caBundlePath: config.caBundlePath,
      }
    );
    try {
      const result = await client.chatCompletions(
        {
          model: modelId,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxTokens,
        },
        options.signal
      );
      return { modelId, text: contentText(result.message.content) };
    } catch (error) {
      if (isAbortError(error, options.signal)) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError ?? new Error("No available model for utility completion");
}
