/**
 * Xiaomi MiMo OpenAI-compatible quirk: multi-turn requests with tool_calls
 * must replay assistant messages with `reasoning_content` (even "").
 * Without it the API returns 400 "Param Incorrect".
 */

export function isMiMoModelOrUrl(model: string, baseUrl?: string): boolean {
  const blob = `${String(model || "")} ${String(baseUrl || "")}`.toLowerCase();
  return /mimo|xiaomi|xiaomimimo/.test(blob);
}

function patchMiMoChatBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!isMiMoModelOrUrl(String(body.model || ""))) {
    return body;
  }
  const messages = body.messages;
  if (!Array.isArray(messages)) {
    return body;
  }
  let changed = false;
  const next = messages.map((msg) => {
    if (!msg || typeof msg !== "object") {
      return msg;
    }
    const row = msg as Record<string, unknown>;
    if (row.role !== "assistant") {
      return msg;
    }
    const toolCalls = row.tool_calls;
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return msg;
    }
    if (row.reasoning_content != null) {
      return msg;
    }
    changed = true;
    return { ...row, reasoning_content: "" };
  });
  return changed ? { ...body, messages: next } : body;
}

function isChatCompletionsUrl(input: RequestInfo | URL): boolean {
  try {
    const url =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : String(input);
    return /\/chat\/completions\b/i.test(url);
  } catch {
    return false;
  }
}

async function readJsonBody(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Record<string, unknown> | null> {
  let raw = "";
  if (typeof init?.body === "string") {
    raw = init.body;
  } else if (input instanceof Request) {
    raw = await input.clone().text();
  }
  if (!raw.trim()) {
    return null;
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Wrap fetch to inject MiMo reasoning_content passthrough on chat/completions POST bodies.
 */
export function wrapFetchForMiMoCompat(
  baseFetch: typeof fetch,
  hint?: { model?: string; baseUrl?: string }
): typeof fetch {
  const hintModel = String(hint?.model || "");
  const hintBase = String(hint?.baseUrl || "");
  if (!isMiMoModelOrUrl(hintModel, hintBase)) {
    return baseFetch;
  }

  const wrapped = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    if (!isChatCompletionsUrl(input)) {
      return baseFetch(input, init);
    }

    const json = await readJsonBody(input, init);
    if (!json) {
      return baseFetch(input, init);
    }
    if (!isMiMoModelOrUrl(String(json.model || hintModel), hintBase)) {
      return baseFetch(input, init);
    }

    const patched = patchMiMoChatBody(json);
    const nextBody = JSON.stringify(patched);

    if (input instanceof Request) {
      const headers = new Headers(input.headers);
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      return baseFetch(
        new Request(input.url, {
          method: input.method,
          headers,
          body: nextBody,
        })
      );
    }

    return baseFetch(input, {
      ...(init || {}),
      method: init?.method || "POST",
      body: nextBody,
      headers: {
        ...(init?.headers && typeof init.headers === "object"
          ? (init.headers as Record<string, string>)
          : {}),
        "content-type": "application/json",
      },
    });
  };

  return wrapped as typeof fetch;
}
