/**
 * Per-model extra request fields (Settings → model JSON `options`, stored as
 * `agentPanel.models[].requestOptions`), e.g. vLLM
 * `chat_template_kwargs: {thinking: true}`. Merged into every
 * chat/completions body the Cline session sends for that model.
 *
 * The options are read per request, so a Settings change applies to the next
 * call without restarting the chat session.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Model options win over what the runtime sent; nested plain objects
 * (`chat_template_kwargs`, `extra_body`) are merged one level deep so a
 * runtime field the options do not mention survives.
 */
export function mergeModelRequestOptions(
  body: Record<string, unknown>,
  options: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!options || !Object.keys(options).length) {
    return body;
  }
  const next: Record<string, unknown> = { ...body };
  for (const [key, value] of Object.entries(options)) {
    const current = next[key];
    next[key] =
      isPlainObject(current) && isPlainObject(value)
        ? { ...current, ...value }
        : value;
  }
  return next;
}

function requestUrl(input: RequestInfo | URL): string {
  try {
    return input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : String(input);
  } catch {
    return "";
  }
}

/**
 * Wrap fetch so chat/completions POST bodies get the model's options.
 * `resolveOptions` is called per request (fresh Settings).
 */
export function wrapFetchWithModelRequestOptions(
  baseFetch: typeof fetch,
  resolveOptions: () => Record<string, unknown> | undefined
): typeof fetch {
  const wrapped = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    if (!/\/chat\/completions\b/i.test(requestUrl(input))) {
      return baseFetch(input, init);
    }
    let options: Record<string, unknown> | undefined;
    try {
      options = resolveOptions();
    } catch {
      options = undefined;
    }
    if (!options || !Object.keys(options).length) {
      return baseFetch(input, init);
    }
    let raw = "";
    if (typeof init?.body === "string") {
      raw = init.body;
    } else if (input instanceof Request && init?.body == null) {
      raw = await input.clone().text();
    } else {
      return baseFetch(input, init);
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return baseFetch(input, init);
    }
    if (!isPlainObject(json)) {
      return baseFetch(input, init);
    }
    const nextBody = JSON.stringify(mergeModelRequestOptions(json, options));
    if (input instanceof Request && init?.body == null) {
      const headers = new Headers(input.headers);
      headers.set("content-type", "application/json");
      return baseFetch(
        new Request(input.url, {
          method: input.method,
          headers,
          body: nextBody,
          signal: init?.signal ?? input.signal,
        })
      );
    }
    return baseFetch(input, { ...(init || {}), body: nextBody });
  };
  return wrapped as typeof fetch;
}
