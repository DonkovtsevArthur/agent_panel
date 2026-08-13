/**
 * Cline's openai-compatible catalog lists `z-ai/glm-5.2` without `"images"`.
 * `modelSupportsImageInput` then fail-closes and replaces pixels with
 * "[Image attached — this model cannot view images]". Harbor knownModels
 * should override that, but on fork/new-session the catalog entry still
 * wins for GLM while Claude (catalog already has images) works.
 *
 * Re-attach data-URL images onto the last user message of chat/completions
 * bodies for the current turn, and keep them *before* text — GLM often
 * ignores image_url parts that come after a long text part.
 */
import { AsyncLocalStorage } from "async_hooks";

const turnImages = new AsyncLocalStorage<string[]>();
/** Fallback when Cline fetch runs outside the ALS context (event emitter). */
let fallbackTurnImages: string[] = [];

const IMAGE_PLACEHOLDER_RE =
  /\[Image attached — this model cannot view images\]|\[media omitted: invalid or exceeds size limit\]/g;

export function withTurnImages<T>(
  urls: string[],
  fn: () => Promise<T>
): Promise<T> {
  const clean = urls.filter(
    (url) => typeof url === "string" && url.startsWith("data:image/")
  );
  if (!clean.length) {
    return fn();
  }
  visionLog(`turn images=${clean.length}`);
  const previous = fallbackTurnImages;
  fallbackTurnImages = clean;
  return turnImages.run(clean, fn).finally(() => {
    fallbackTurnImages = previous;
  });
}

function currentTurnImages(): string[] {
  const fromAls = turnImages.getStore();
  if (fromAls?.length) {
    return fromAls;
  }
  return fallbackTurnImages;
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return String((input as Request).url || "");
}

function requestMethod(
  input: string | URL | Request,
  init?: RequestInit
): string {
  const fromInit = init?.method;
  if (fromInit) {
    return String(fromInit).toUpperCase();
  }
  if (typeof Request !== "undefined" && input instanceof Request) {
    return String(input.method || "GET").toUpperCase();
  }
  return "GET";
}

function looksLikeChatCompletions(url: string, body: string): boolean {
  if (/chat\/completions|\/v1\/messages\b|\/messages\b/i.test(url)) {
    return true;
  }
  return body.includes('"messages"') && body.includes('"role"');
}

function isImagePart(part: unknown): boolean {
  if (!part || typeof part !== "object") {
    return false;
  }
  const row = part as {
    type?: unknown;
    mediaType?: unknown;
    image_url?: unknown;
  };
  const type = String(row.type || "");
  if (type === "image_url" || type === "image") {
    return true;
  }
  if (type === "file") {
    return String(row.mediaType || "")
      .toLowerCase()
      .startsWith("image/");
  }
  return false;
}

function imageUrlParts(urls: string[]): Array<{
  type: "image_url";
  image_url: { url: string };
}> {
  return urls.map((url) => ({
    type: "image_url" as const,
    image_url: { url },
  }));
}

function stripImagePlaceholders(text: string): string {
  let next = text.replace(IMAGE_PLACEHOLDER_RE, "");
  const marker = "[Harbor turn context]";
  const idx = next.indexOf(marker);
  if (idx >= 0) {
    next = next.slice(0, idx);
  }
  return next.replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeUserParts(content: unknown): unknown[] {
  if (typeof content === "string") {
    const text = stripImagePlaceholders(content);
    return text ? [{ type: "text", text }] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  return content.map((part) => {
    if (
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      return {
        ...part,
        text: stripImagePlaceholders(String((part as { text: string }).text)),
      };
    }
    return part;
  });
}

function visionLog(message: string): void {
  try {
    process.stderr.write(`[harbor-vision] ${message}\n`);
  } catch {
    /* ignore */
  }
}

function imagePartPayloadChars(part: unknown): number {
  if (!part || typeof part !== "object") {
    return 0;
  }
  const row = part as {
    image_url?: unknown;
    image?: unknown;
    url?: unknown;
    data?: unknown;
  };
  if (typeof row.image_url === "string") {
    return row.image_url.length;
  }
  if (row.image_url && typeof row.image_url === "object") {
    const url = (row.image_url as { url?: unknown }).url;
    if (typeof url === "string") {
      return url.length;
    }
  }
  if (typeof row.image === "string") {
    return row.image.length;
  }
  if (typeof row.url === "string") {
    return row.url.length;
  }
  if (typeof row.data === "string") {
    return row.data.length;
  }
  if (row.data && typeof row.data === "object") {
    const inner = (row.data as { data?: unknown; url?: unknown }).data;
    if (typeof inner === "string") {
      return inner.length;
    }
    const url = (row.data as { url?: unknown }).url;
    if (typeof url === "string") {
      return url.length;
    }
  }
  return 0;
}

function isValidImagePart(part: unknown): boolean {
  return isImagePart(part) && imagePartPayloadChars(part) >= 32;
}

function summarizeParts(parts: unknown[]): string {
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") {
        return typeof part;
      }
      const type = String((part as { type?: unknown }).type || "?");
      if (isImagePart(part)) {
        return `${type}:${imagePartPayloadChars(part)}`;
      }
      if (typeof (part as { text?: unknown }).text === "string") {
        return `text:${String((part as { text: string }).text).length}`;
      }
      return type;
    })
    .join(",");
}

function attachImagesToLastUser(
  payload: { messages?: unknown },
  urls: string[]
): boolean {
  const messages = payload.messages;
  if (!Array.isArray(messages) || !messages.length) {
    return false;
  }
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const row = messages[i] as { role?: unknown } | undefined;
    if (row && String(row.role || "") === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0) {
    return false;
  }
  const msg = messages[lastUser] as { content?: unknown };
  const parts = normalizeUserParts(msg.content);
  const before = summarizeParts(parts);
  const keptImages = parts.filter(isValidImagePart);
  const otherParts = parts.filter((part) => !isImagePart(part));
  // Keep Cline's own image/file parts when they already have pixels — rewriting
  // them as Harbor image_url broke GLM first-turn vision. Only splice Harbor
  // data-URLs when the last user message has no usable image payload.
  let source = "keep";
  const imageParts =
    keptImages.length > 0
      ? keptImages
      : urls.length
        ? imageUrlParts(urls)
        : [];
  if (!keptImages.length && urls.length) {
    source = "harbor";
  }
  if (!imageParts.length) {
    visionLog(`skip no pixels lastUser=${lastUser} before=${before}`);
    return false;
  }
  msg.content = [...imageParts, ...otherParts];
  const urlLen = urls[0]?.length || imagePartPayloadChars(imageParts[0]);
  const textChars = otherParts.reduce((sum: number, part) => {
    if (
      part &&
      typeof part === "object" &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      return sum + String((part as { text: string }).text).length;
    }
    return sum;
  }, 0);
  visionLog(
    `inject lastUser=${lastUser}/${messages.length} source=${source} before=${before} images=${imageParts.length} textChars=${textChars} urlLen=${urlLen}`
  );
  return true;
}

function headersWithBody(
  headers: RequestInit["headers"] | undefined,
  body: string
): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = headers;
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw)) {
      for (const [k, v] of raw) {
        out[String(k)] = String(v);
      }
    } else if (typeof (raw as { forEach?: unknown }).forEach === "function") {
      (raw as { forEach: (cb: (v: string, k: string) => void) => void }).forEach(
        (v, k) => {
          out[k] = v;
        }
      );
    } else {
      for (const [k, v] of Object.entries(raw as Record<string, string>)) {
        out[k] = String(v);
      }
    }
  }
  out["content-type"] = out["content-type"] || out["Content-Type"] || "application/json";
  out["content-length"] = String(Buffer.byteLength(body));
  return out;
}

async function readBodyText(
  input: string | URL | Request,
  init?: RequestInit
): Promise<string | undefined> {
  const fromInit = init?.body;
  if (typeof fromInit === "string") {
    return fromInit;
  }
  if (fromInit == null) {
    if (typeof Request !== "undefined" && input instanceof Request) {
      try {
        return await input.clone().text();
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
  if (Buffer.isBuffer(fromInit)) {
    return fromInit.toString("utf8");
  }
  if (fromInit instanceof Uint8Array) {
    return Buffer.from(fromInit).toString("utf8");
  }
  if (typeof ArrayBuffer !== "undefined" && fromInit instanceof ArrayBuffer) {
    return Buffer.from(fromInit).toString("utf8");
  }
  return undefined;
}

/**
 * Put Harbor data-URL images first on the last user message of chat/completions
 * bodies. GLM often ignores image_url after a long text part; skipping when
 * images already exist left them at the end of the array.
 */
export async function injectTurnImagesIntoFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<{ input: string | URL | Request; init?: RequestInit }> {
  const urls = currentTurnImages();
  if (!urls.length) {
    return { input, init };
  }
  if (requestMethod(input, init) !== "POST") {
    return { input, init };
  }
  const bodyText = await readBodyText(input, init);
  const jsonText = bodyText?.trimStart();
  if (!jsonText || jsonText[0] !== "{") {
    visionLog(`skip body kind=${typeof init?.body} url=${requestUrl(input)}`);
    return { input, init };
  }
  if (!looksLikeChatCompletions(requestUrl(input), jsonText)) {
    return { input, init };
  }
  let payload: { messages?: unknown };
  try {
    payload = JSON.parse(jsonText) as { messages?: unknown };
  } catch {
    visionLog("skip json parse");
    return { input, init };
  }
  if (!attachImagesToLastUser(payload, urls)) {
    visionLog("skip no last user message");
    return { input, init };
  }
  const nextBody = JSON.stringify(payload);
  if (typeof Request !== "undefined" && input instanceof Request && !init?.body) {
    return {
      input: new Request(input, {
        body: nextBody,
        headers: headersWithBody(input.headers, nextBody),
      }),
      init,
    };
  }
  return {
    input,
    init: {
      ...(init || {}),
      body: nextBody,
      headers: headersWithBody(init?.headers, nextBody),
    },
  };
}
