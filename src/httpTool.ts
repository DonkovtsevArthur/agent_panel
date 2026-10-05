/**
 * Harbor extraTool: `http_request` — call local/dev HTTP APIs and read the
 * structured response (status + content-type + body). Unlike Cline's
 * fetch_web_content (reading web pages) this is for verifying JSON APIs the
 * agent just changed, closing the edit → request → observe loop.
 *
 * SSRF guard: localhost only by default; extra hosts must be allowlisted via
 * `agentPanel.http.allowedHosts` (entries like `.corp.example` cover
 * subdomains). Redirects are followed manually and re-validated per hop.
 * Uses harborFetch so corporate TLS policies apply.
 */
import { harborFetch } from "./tlsPolicy";

type CreateTool = (config: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown, context: unknown) => Promise<unknown>;
  timeoutMs?: number;
}) => unknown;

export const HTTP_REQUEST_TOOL = "http_request";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 20_000;
const MAX_REQUEST_BODY_CHARS = 32_000;
const MAX_RESPONSE_CHARS = 64_000;
const MAX_REDIRECTS = 3;

export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

/** Normalize an allowlist entry: `.corp.example` / `*.corp.example` → suffix. */
function normalizeHostEntry(raw: string): { host: string; suffix: boolean } {
  const trimmed = String(raw || "").trim().toLowerCase();
  if (trimmed.startsWith("*.")) {
    return { host: trimmed.slice(2), suffix: true };
  }
  if (trimmed.startsWith(".")) {
    return { host: trimmed.slice(1), suffix: true };
  }
  return { host: trimmed, suffix: false };
}

/** Host allowlist check — exported for tests. */
export function httpHostAllowed(
  url: string,
  allowedHosts: string[]
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (LOCAL_HOSTS.has(host)) {
    return true;
  }
  for (const entry of allowedHosts) {
    const { host: allowed, suffix } = normalizeHostEntry(entry);
    if (!allowed) {
      continue;
    }
    if (suffix ? host === allowed || host.endsWith(`.${allowed}`) : host === allowed) {
      return true;
    }
  }
  return false;
}

function headerRecord(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const k = String(key || "").trim();
      if (k && typeof value === "string" && k.length < 200) {
        out[k] = value;
      }
    }
  }
  return out;
}

async function readBodyCapped(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARS) {
      return `${text.slice(0, MAX_RESPONSE_CHARS)}\n… (response truncated at ${MAX_RESPONSE_CHARS} chars)`;
    }
    return text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `(body read failed: ${message})`;
  }
}

function networkErrorHint(message: string): string {
  if (/ECONNREFUSED/i.test(message)) {
    return "Hint: connection refused — the server is likely not running on that port yet (or the port is wrong).";
  }
  if (/ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return "Hint: host unreachable or unresolvable — check VPN/network, or use a host from agentPanel.http.allowedHosts.";
  }
  if (/SELF_SIGNED_CERT|CERT|TLS/i.test(message)) {
    return "Hint: TLS verification failed — the host needs a corporate CA (Settings → Advanced) or is not allowlisted.";
  }
  return "";
}

export function createHttpTool(
  createTool: CreateTool,
  options: { allowedHosts?: string[] } = {}
): unknown {
  const allowedHosts = (Array.isArray(options.allowedHosts)
    ? options.allowedHosts
    : []
  )
    .map((h) => String(h || "").trim())
    .filter(Boolean);
  return createTool({
    name: HTTP_REQUEST_TOOL,
    description: [
      "Perform an HTTP request to a local/dev API and return status, content-type, and body (text/JSON).",
      "Allowlist: localhost/127.0.0.1 plus hosts from agentPanel.http.allowedHosts; other hosts are rejected.",
      "Use it to verify endpoints you just changed (then fix and re-check) instead of asking the user to curl.",
      "fetch_web_content is for reading web pages; this tool is for calling APIs with method/headers/body.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        method: {
          type: "string",
          enum: [...HTTP_METHODS],
          description: "HTTP method (default GET)",
        },
        url: {
          type: "string",
          description:
            "Absolute http(s) URL, e.g. http://127.0.0.1:8080/api/health",
        },
        headers: {
          type: "object",
          description:
            "Request headers (string values). Never put secrets here — they end up in the conversation.",
          additionalProperties: { type: "string" },
        },
        body: {
          type: "string",
          description: `Request body (raw text/JSON), max ${MAX_REQUEST_BODY_CHARS} chars.`,
        },
        timeoutMs: {
          type: "number",
          description: `Timeout in ms, max ${MAX_TIMEOUT_MS} (default ${DEFAULT_TIMEOUT_MS}).`,
        },
      },
      required: ["url"],
    },
    execute: async (input: unknown) => {
      const args = (input && typeof input === "object"
        ? input
        : {}) as Record<string, unknown>;
      const rawUrl = String(args.url || "").trim();
      const method = String(args.method || "GET")
        .trim()
        .toUpperCase();
      if (!(HTTP_METHODS as readonly string[]).includes(method)) {
        return `http_request: invalid method "${method}". Allowed: ${HTTP_METHODS.join(", ")}.`;
      }
      if (!httpHostAllowed(rawUrl, allowedHosts)) {
        return [
          `http_request: host not allowed for ${rawUrl}.`,
          "Allowed: localhost/127.0.0.1 and agentPanel.http.allowedHosts entries. Ask the user before trying to reach anything else.",
        ].join(" ");
      }
      let currentUrl: string;
      try {
        currentUrl = new URL(rawUrl).toString();
      } catch {
        return `http_request: invalid URL "${rawUrl}".`;
      }
      const headers = headerRecord(args.headers);
      let body: string | undefined;
      if (typeof args.body === "string" && args.body.length) {
        if (args.body.length > MAX_REQUEST_BODY_CHARS) {
          return `http_request: body exceeds ${MAX_REQUEST_BODY_CHARS} chars — send a smaller payload.`;
        }
        body = args.body;
      }
      const timeoutMs = Math.min(
        Math.max(Number(args.timeoutMs) || DEFAULT_TIMEOUT_MS, 1_000),
        MAX_TIMEOUT_MS
      );

      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response: Response;
        try {
          response = await harborFetch(currentUrl, {
            method,
            headers,
            ...(body !== undefined &&
            method !== "GET" &&
            method !== "HEAD"
              ? { body }
              : {}),
            redirect: "manual",
            signal: controller.signal,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const hint = networkErrorHint(message);
          return [
            `http_request ${method} ${currentUrl}`,
            `Network error: ${message}`,
            ...(hint ? [hint] : []),
          ].join("\n");
        } finally {
          clearTimeout(timer);
        }
        const status = response.status;
        if (status >= 300 && status < 400) {
          const location = response.headers?.get("location") || "";
          if (!location || hop === MAX_REDIRECTS) {
            return `http_request ${method} ${currentUrl}\nHTTP ${status} (redirect not followed)`;
          }
          let next: URL;
          try {
            next = new URL(location, currentUrl);
          } catch {
            return `http_request ${method} ${currentUrl}\nHTTP ${status} invalid redirect target: ${location}`;
          }
          if (!httpHostAllowed(next.toString(), allowedHosts)) {
            return `http_request ${method} ${currentUrl}\nHTTP ${status} → redirect to non-allowlisted host ${next.host} — blocked.`;
          }
          currentUrl = next.toString();
          continue;
        }
        const contentType = String(
          response.headers?.get("content-type") || ""
        ).trim();
        const bodyText =
          method === "HEAD" ? "" : await readBodyCapped(response);
        return [
          `http_request ${method} ${currentUrl}`,
          `HTTP ${status} ${response.statusText || ""}`.trim(),
          ...(contentType ? [`content-type: ${contentType}`] : []),
          "",
          bodyText,
        ].join("\n");
      }
      return `http_request ${method} ${currentUrl}\nToo many redirects (>${MAX_REDIRECTS}).`;
    },
    timeoutMs: MAX_TIMEOUT_MS + 5_000,
  });
}
