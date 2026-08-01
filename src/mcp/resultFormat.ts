/**
 * Split MCP tool results into plain text + image data URLs.
 * Tool-role messages are text-only in our OpenAI-compat path, so images must
 * be described by a vision helper before the main model sees them.
 */

export interface SplitMcpToolResult {
  text: string;
  imageDataUrls: string[];
}

function asDataUrl(mime: string, data: string): string {
  const cleanMime = String(mime || "image/png").trim() || "image/png";
  const cleanData = String(data || "").replace(/\s+/g, "");
  if (!cleanData) {
    return "";
  }
  if (cleanData.startsWith("data:")) {
    return cleanData;
  }
  return `data:${cleanMime};base64,${cleanData}`;
}

function pushUnique(urls: string[], url: string): void {
  const trimmed = String(url || "").trim();
  if (!trimmed || urls.includes(trimmed)) {
    return;
  }
  urls.push(trimmed);
}

function collectFromPart(
  part: unknown,
  textParts: string[],
  imageDataUrls: string[]
): void {
  if (part == null) {
    return;
  }
  if (typeof part === "string") {
    textParts.push(part);
    return;
  }
  if (typeof part !== "object") {
    textParts.push(String(part));
    return;
  }
  const row = part as {
    type?: string;
    text?: string;
    data?: string;
    mimeType?: string;
    mime_type?: string;
    image?: string | { data?: string; mimeType?: string };
    source?: { type?: string; data?: string; media_type?: string };
    image_url?: string | { url?: string };
  };
  const type = String(row.type || "").toLowerCase();

  if (type === "text" && typeof row.text === "string") {
    textParts.push(row.text);
    return;
  }

  if (type === "image" || type === "image_url") {
    let url = "";
    if (typeof row.data === "string" && row.data) {
      url = asDataUrl(row.mimeType || row.mime_type || "image/png", row.data);
    } else if (typeof row.image_url === "string") {
      url = row.image_url;
    } else if (row.image_url && typeof row.image_url.url === "string") {
      url = row.image_url.url;
    } else if (typeof row.image === "string") {
      url = asDataUrl("image/png", row.image);
    } else if (row.image && typeof row.image.data === "string") {
      url = asDataUrl(row.image.mimeType || "image/png", row.image.data);
    } else if (row.source?.type === "base64" && typeof row.source.data === "string") {
      url = asDataUrl(row.source.media_type || "image/png", row.source.data);
    }
    if (url) {
      pushUnique(imageDataUrls, url);
      textParts.push(`[screenshot image ${imageDataUrls.length}]`);
      return;
    }
  }

  // Fallback: keep a short JSON stub (never dump huge unknown blobs).
  try {
    const stub = JSON.stringify(part);
    if (stub.length > 400) {
      textParts.push(`${stub.slice(0, 400)}…`);
    } else {
      textParts.push(stub);
    }
  } catch {
    textParts.push(String(part));
  }
}

/**
 * Parse an MCP CallToolResult-like value into text + image data URLs.
 */
export function splitMcpToolResult(result: unknown): SplitMcpToolResult {
  const imageDataUrls: string[] = [];
  if (result == null) {
    return { text: "", imageDataUrls };
  }
  if (typeof result === "string") {
    return { text: result, imageDataUrls };
  }

  try {
    const row = result as {
      content?: unknown;
      structuredContent?: unknown;
    };
    const textParts: string[] = [];
    if (Array.isArray(row.content)) {
      for (const part of row.content) {
        collectFromPart(part, textParts, imageDataUrls);
      }
    } else if (typeof row.content === "string") {
      textParts.push(row.content);
    }

    const text = textParts.join("\n").trim();
    if (text || imageDataUrls.length) {
      return { text, imageDataUrls };
    }
    return { text: JSON.stringify(result), imageDataUrls };
  } catch {
    return { text: String(result), imageDataUrls };
  }
}

/** Flatten split result to a single string (legacy callTool). */
export function joinMcpToolResult(split: SplitMcpToolResult): string {
  const text = String(split.text || "").trim();
  if (!split.imageDataUrls.length) {
    return text;
  }
  const note = `[${split.imageDataUrls.length} image(s) in tool result — use vision helper path]`;
  return text ? `${text}\n${note}` : note;
}
