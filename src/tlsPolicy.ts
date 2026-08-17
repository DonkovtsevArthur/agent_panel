/**
 * Harbor Advanced → "Validate TLS certificate" (`agentPanel.rejectUnauthorized`,
 * default **false**). Cline chat uses undici/`fetch`, not openaiClient's
 * https.Agent — so we apply NODE_TLS env, an insecure fetch dispatcher, and
 * patch globalThis.fetch so every Cline path honors the setting.
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
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    insecureAgent = undefined;
    undiciDispatcher = undefined;
  } else {
    // Corporate / self-signed MITM proxies (common on internal LiteLLM gateways).
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    insecureAgent = new https.Agent({ rejectUnauthorized: false });
    undiciDispatcher = undefined;
  }
  ensureGlobalFetchPatched();
  try {
    process.stderr.write(
      `[harbor-tls] rejectUnauthorized=${value} NODE_TLS_REJECT_UNAUTHORIZED=${process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? "(unset)"}\n`
    );
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
 * Fetch for Cline gateway. When TLS validation is off, use undici Agent /
 * Node https with rejectUnauthorized:false (env alone is not enough on some
 * Node builds).
 */
export function harborFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  applyHarborTlsPolicy();
  return injectTurnImagesIntoFetch(input, init).then(({ input: nextInput, init: nextInit }) =>
    dispatchHarborFetch(nextInput, nextInit)
  );
}

function dispatchHarborFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  if (getConfig().rejectUnauthorized === true || !insecureAgent) {
    return nativeFetch(input, init);
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const undici = require("undici") as { fetch: typeof fetch };
    const dispatcher = getUndiciDispatcher();
    if (dispatcher) {
      return undici.fetch(input, {
        ...(init || {}),
        // @ts-expect-error undici dispatcher
        dispatcher,
      }) as Promise<Response>;
    }
  } catch {
    /* fall through to https.request bridge */
  }

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
