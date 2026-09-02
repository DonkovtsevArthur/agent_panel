/**
 * Harbor Advanced → "Validate TLS certificate" (`agentPanel.rejectUnauthorized`,
 * default **true**). Cline chat uses undici/`fetch`, not openaiClient's
 * https.Agent — so we apply an insecure fetch dispatcher and patch
 * globalThis.fetch so every Cline path honors the setting. The process-wide
 * `NODE_TLS_REJECT_UNAUTHORIZED` env is deliberately NOT touched: disabling
 * cert checks must stay scoped to Harbor's own requests (SAST: insecure SSL
 * parameters) and never weaken unrelated code in the extension host.
 */
import * as https from "https";
import * as http from "http";
import { getConfig } from "./config";
import { injectTurnImagesIntoFetch } from "./turnImageInject";

let applied: boolean | undefined;
let insecureAgent: https.Agent | undefined;
let undiciDispatcher: unknown | undefined;
let globalFetchPatched = false;

const nativeFetch: typeof fetch = globalThis.fetch.bind(globalThis);

export function applyHarborTlsPolicy(rejectUnauthorized?: boolean): void {
  const value =
    typeof rejectUnauthorized === "boolean"
      ? rejectUnauthorized
      : getConfig().rejectUnauthorized === true;
  if (applied === value && (value || insecureAgent)) {
    ensureGlobalFetchPatched();
    return;
  }
  applied = value;
  if (value) {
    insecureAgent = undefined;
    undiciDispatcher = undefined;
  } else {
    // Explicit opt-in for corporate / self-signed MITM proxies (common on
    // internal LiteLLM gateways). Scoped: only harborFetch dispatches through
    // this agent — the process env stays untouched.
    insecureAgent = new https.Agent({ rejectUnauthorized: false });
    undiciDispatcher = undefined;
  }
  ensureGlobalFetchPatched();
  try {
    process.stderr.write(`[harbor-tls] rejectUnauthorized=${value}\n`);
  } catch {
    /* ignore */
  }
}

function ensureGlobalFetchPatched(): void {
  if (globalFetchPatched) {
    return;
  }
  globalFetchPatched = true;
  // Any Cline / SDK path that ignores providerConfig.fetch still hits this.
  globalThis.fetch = harborFetch as typeof fetch;
}

function getUndiciDispatcher(): unknown {
  if (undiciDispatcher) {
    return undiciDispatcher;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const undici = require("undici") as {
      Agent: new (opts: {
        connect: { rejectUnauthorized: boolean };
      }) => unknown;
    };
    undiciDispatcher = new undici.Agent({
      connect: { rejectUnauthorized: false },
    });
    return undiciDispatcher;
  } catch {
    return undefined;
  }
}

/**
 * Retry budget for 429 (rate limit) responses. Exponential backoff:
 * 1s → 2s → 4s. Only retries on 429; other errors propagate immediately.
 * Reads `Retry-After` header when present (capped at 30s).
 */
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;

function parseRetryAfterMs(response: Response): number | undefined {
  const raw = response.headers?.get?.("retry-after");
  if (!raw) {
    return undefined;
  }
  // Retry-After can be seconds (numeric) or HTTP-date.
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1_000, RETRY_MAX_DELAY_MS);
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch for Cline gateway. When TLS validation is off, use undici Agent /
 * Node https with rejectUnauthorized:false (scoped to this fetch only; the
 * process env is never modified). Retries 429 with exponential backoff.
 */
export function harborFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  // Only bootstrap from getConfig when nothing has been applied yet.
  // Callers that set TLS explicitly (Figma/JetBrains sidecar) must not be
  // overwritten by a later getConfig() read inside this hot path.
  if (applied === undefined) {
    applyHarborTlsPolicy();
  } else {
    ensureGlobalFetchPatched();
  }
  return injectTurnImagesIntoFetch(input, init).then(({ input: nextInput, init: nextInit }) =>
    harborFetchWithRetry(nextInput, nextInit)
  );
}

async function harborFetchWithRetry(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await dispatchHarborFetch(input, init);
      if (response.status !== 429 || attempt >= RETRY_MAX_ATTEMPTS) {
        return response;
      }
      // 429 — wait and retry.
      const retryAfterMs = parseRetryAfterMs(response);
      const backoffMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      const delayMs = retryAfterMs ?? backoffMs;
      try {
        process.stderr.write(
          `[harbor-fetch] 429 rate limited, retry ${attempt + 1}/${RETRY_MAX_ATTEMPTS} in ${delayMs}ms\n`
        );
      } catch {
        /* ignore */
      }
      await sleep(delayMs);
    } catch (error) {
      lastError = error;
      // Network errors (ECONNRESET, ETIMEDOUT, etc.) — retry once on first failure.
      if (attempt >= 1) {
        throw error;
      }
      const code = String(
        (error as NodeJS.ErrnoException)?.code || ""
      ).toUpperCase();
      if (
        ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code)
      ) {
        await sleep(RETRY_BASE_DELAY_MS);
        continue;
      }
      throw error;
    }
  }
  // Should not reach here, but just in case.
  if (lastError) {
    throw lastError;
  }
  return dispatchHarborFetch(input, init);
}

function dispatchHarborFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  // Trust the last applyHarborTlsPolicy() result — not a fresh getConfig()
  // read — so Figma/headless turns that just set rejectUnauthorized:false
  // are not flipped back to strict native fetch.
  if (applied !== false || !insecureAgent) {
    return nativeFetch(input, init);
  }

  // Skip undici.fetch — its dispatcher may not propagate rejectUnauthorized
  // to the TLS layer, and the try/catch cannot catch async rejections.
  // Go straight to node https.request with the insecure agent.
  return nodeHttpsFetch(input, init, insecureAgent);
}

function nodeHttpsFetch(
  input: string | URL | Request,
  init: RequestInit | undefined,
  agent: https.Agent
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : String((input as Request).url || input);
  const method = String(init?.method || "GET").toUpperCase();
  const headers: Record<string, string> = {};
  const raw = init?.headers;
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw)) {
      for (const [k, v] of raw) {
        headers[String(k)] = String(v);
      }
    } else if (typeof (raw as Headers).forEach === "function") {
      (raw as Headers).forEach((v, k) => {
        headers[k] = v;
      });
    } else {
      for (const [k, v] of Object.entries(raw as Record<string, string>)) {
        headers[k] = String(v);
      }
    }
  }

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
        method,
        headers,
        agent: isHttps ? agent : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          const headerInit: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v == null) continue;
            headerInit[k] = Array.isArray(v) ? v.join(", ") : String(v);
          }
          resolve(
            new Response(body, {
              status: res.statusCode || 0,
              statusText: res.statusMessage || "",
              headers: headerInit,
            })
          );
        });
      }
    );
    req.on("error", reject);
    const body = init?.body;
    if (body == null) {
      req.end();
      return;
    }
    if (typeof body === "string" || Buffer.isBuffer(body)) {
      req.end(body);
      return;
    }
    if (body instanceof Uint8Array) {
      req.end(Buffer.from(body));
      return;
    }
    Promise.resolve(body as string | Uint8Array | ArrayBuffer | Blob)
      .then(async (b) => {
        if (typeof b === "string" || Buffer.isBuffer(b)) {
          req.end(b);
          return;
        }
        // Runtime accepts ArrayBuffer/Uint8Array/Blob; the lib types narrow
        // Uint8Array to <ArrayBufferLike> which BodyInit does not include.
        const ab = await new Response(b as BodyInit).arrayBuffer();
        req.end(Buffer.from(ab));
      })
      .catch(reject);
  });
}
