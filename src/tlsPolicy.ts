/**
 * Harbor Advanced → "Validate TLS certificate" (`agentPanel.rejectUnauthorized`,
 * default **true**). Cline chat uses undici/`fetch`, not openaiClient's
 * https.Agent — so we apply an insecure fetch dispatcher and patch
 * globalThis.fetch so every Cline path honors the setting. The process-wide
 * `NODE_TLS_REJECT_UNAUTHORIZED` env is deliberately NOT touched: disabling
 * cert checks must stay scoped to Harbor's own requests (SAST: insecure SSL
 * parameters) and never weaken unrelated code in the extension host.
 *
 * Trust-on-first-use (see HarborTlsTrustRequest below) keeps strict
 * verification on: an untrusted internal CA chain is probed, confirmed by
 * the user once, pinned per host under ~/.harbor/certs/pinned/, and every
 * later request validates against that pinned chain.
 */
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as tls from "tls";
import { execFile, spawn } from "child_process";
import * as crypto from "crypto";
import { getConfig } from "./config";
import { injectTurnImagesIntoFetch } from "./turnImageInject";
import {
  getPinnedCaForHost,
  pinnedDir,
  safeHostname,
  savePinnedCaForHost,
} from "./pinnedCa";

let applied: boolean | undefined;
let insecureAgent: https.Agent | undefined;
let undiciDispatcher: unknown | undefined;
let globalFetchPatched = false;

const nativeFetch: typeof fetch = globalThis.fetch.bind(globalThis);

/**
 * Trust-on-first-use for internal CAs (`agentPanel.tls.autoTrustInternalCa`,
 * default on). When strict verification fails with a chain-of-trust error for
 * an HTTPS host (corporate CA not in Node's root set), the certificate chain
 * is read from a probe TLS connection and — after user consent via the
 * registered prompt — pinned to ~/.harbor/certs/pinned/<host>.pem. Subsequent
 * requests to that host validate strictly against the pinned chain. Hostname
 * mismatches and expired certs are never offered for trust (possible MITM).
 */
export interface HarborTlsTrustRequest {
  host: string;
  /** CN of the server certificate (leaf). */
  leafCn: string;
  /** CN of the CA that signed the leaf. */
  issuerCn: string;
  /** CN of the self-signed root at the top of the chain. */
  rootCn: string;
  /** SHA-256 fingerprint of the root (stable identity for logs). */
  rootFingerprint: string;
  /** A pinned chain already exists for the host but no longer verifies. */
  changed: boolean;
}

export type HarborTlsTrustPrompt = (req: HarborTlsTrustRequest) => Promise<boolean>;

let trustPrompt: HarborTlsTrustPrompt | undefined;

/** VS Code registers a modal dialog; headless shells keep the file store only. */
export function setHarborTlsTrustPrompt(prompt: HarborTlsTrustPrompt | undefined): void {
  trustPrompt = prompt;
}

interface ProbedChain {
  pem: string;
  leafCn: string;
  issuerCn: string;
  rootCn: string;
  rootFingerprint: string;
}

const declinedHosts = new Set<string>();
const inflightTrust = new Map<string, Promise<boolean>>();

const TRUST_ERROR_CODES = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

function logTls(message: string): void {
  try {
    process.stderr.write(`[harbor-tls] ${message}\n`);
  } catch {
    /* ignore */
  }
}

function isAutoTrustEnabled(): boolean {
  try {
    const cfg = getConfig() as { tls?: { autoTrustInternalCa?: boolean } };
    return cfg?.tls?.autoTrustInternalCa !== false;
  } catch {
    return true;
  }
}

function cnOf(name: unknown): string {
  const cn = (name as { CN?: string | string[] } | undefined)?.CN;
  return (Array.isArray(cn) ? cn[0] : cn) || "";
}

function certPem(cert: tls.PeerCertificate): string {
  const b64 = Buffer.isBuffer(cert.raw) ? cert.raw.toString("base64") : "";
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}

/**
 * Connect without verification purely to READ the chain the server presents.
 * The chain is only offered for trust when the leaf still matches the
 * hostname (checked locally) — a mismatching cert is never trustable.
 *
 * Chain sources: Node's issuerCertificate walk first; recent Node versions
 * leave issuerCertificate undefined when rejectUnauthorized is off, so the
 * walk may yield only the leaf — then fall back to `openssl s_client
 * -showcerts` (present on macOS/Linux dev machines) for the full chain.
 */
interface NodeProbe {
  leaf: tls.DetailedPeerCertificate;
  pems: string[];
  root: tls.DetailedPeerCertificate;
}

function nodeChainProbe(
  host: string,
  port: number
): Promise<NodeProbe | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (probe: NodeProbe | undefined) => {
      if (!settled) {
        settled = true;
        resolve(probe);
      }
    };
    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: false, timeout: 10_000 },
      () => {
        try {
          const leaf = socket.getPeerCertificate() as tls.DetailedPeerCertificate;
          if (!leaf || !Buffer.isBuffer(leaf.raw)) {
            socket.destroy();
            finish(undefined);
            return;
          }
          if (tls.checkServerIdentity(host, leaf)) {
            // Hostname mismatch — likely MITM, never auto-trust.
            socket.destroy();
            finish(undefined);
            return;
          }
          const pems: string[] = [];
          const seen = new Set<string>();
          let cert:
            | tls.DetailedPeerCertificate
            | undefined = leaf;
          let root: tls.DetailedPeerCertificate = leaf;
          while (cert && Buffer.isBuffer(cert.raw)) {
            const fp = cert.fingerprint256 || cert.fingerprint || "";
            if (!fp || seen.has(fp)) {
              break;
            }
            seen.add(fp);
            pems.push(certPem(cert));
            root = cert;
            const issuer = cert.issuerCertificate as
              | tls.DetailedPeerCertificate
              | undefined;
            if (!issuer || issuer === cert) {
              break;
            }
            cert = issuer;
          }
          if (pems.length === 0) {
            socket.destroy();
            finish(undefined);
            return;
          }
          socket.destroy();
          finish({ leaf, pems, root });
        } catch (error) {
          socket.destroy();
          logTls(`chain probe failed for ${host}: ${String(error)}`);
          finish(undefined);
        }
      }
    );
    socket.on("error", (error) => {
      logTls(`chain probe error for ${host}: ${error.message}`);
      finish(undefined);
    });
    socket.on("timeout", () => {
      socket.destroy();
      finish(undefined);
    });
  });
}

function splitPemCerts(pem: string): string[] {
  const blocks = pem.match(
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g
  );
  return (blocks || []).map((b) => `${b}\n`);
}

function derOfPem(pemCert: string): Buffer {
  const body = pemCert
    .replace(/-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----/, "")
    .replace(/\s+/g, "");
  return Buffer.from(body, "base64");
}

function sha256Fingerprint(der: Buffer): string {
  return crypto
    .createHash("sha256")
    .update(der)
    .digest("hex")
    .toUpperCase()
    .replace(/(..)(?=.)/g, "$1:");
}

/** Full chain via `openssl s_client -showcerts` (best-effort, may fail). */
function opensslChainPem(host: string, port: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      execFile(
        "openssl",
        ["s_client", "-showcerts", "-connect", `${host}:${port}`, "-servername", host],
        { timeout: 10_000, maxBuffer: 256 * 1024 },
        (error, stdout) => {
          if (error && !stdout) {
            resolve(undefined);
            return;
          }
          const certs = splitPemCerts(String(stdout));
          resolve(certs.length ? certs.join("") : undefined);
        }
      );
    } catch {
      resolve(undefined);
    }
  });
}

/** Best-effort CN of a PEM cert via `openssl x509 -noout -subject`. */
function opensslCertSubjectCn(pemCert: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      const child = spawn("openssl", ["x509", "-noout", "-subject"], {
        stdio: ["pipe", "pipe", "ignore"],
      });
      let out = "";
      const timer = setTimeout(() => child.kill(), 5_000);
      child.on("error", () => {
        clearTimeout(timer);
        resolve("");
      });
      child.stdout.on("data", (chunk) => {
        out += String(chunk);
      });
      child.on("close", () => {
        clearTimeout(timer);
        const match = out.match(/CN\s*=\s*([^,\n/]+)/i);
        resolve(match ? match[1].trim() : "");
      });
      child.stdin.on("error", () => {
        /* EPIPE — resolve on close */
      });
      child.stdin.end(pemCert);
    } catch {
      resolve("");
    }
  });
}

async function probeServerChain(
  host: string,
  port: number
): Promise<ProbedChain | undefined> {
  const probed = await nodeChainProbe(host, port);
  if (!probed) {
    return undefined;
  }
  const base = {
    leafCn: cnOf(probed.leaf.subject),
    issuerCn: cnOf(probed.leaf.issuer),
  };
  if (probed.pems.length >= 2) {
    return {
      pem: probed.pems.join(""),
      ...base,
      rootCn: cnOf(probed.root.subject),
      rootFingerprint:
        probed.root.fingerprint256 || probed.root.fingerprint || "",
    };
  }
  // Only the leaf — Node did not expose issuerCertificate; ask openssl.
  const full = await opensslChainPem(host, port);
  if (!full) {
    logTls(
      `node probe returned only the leaf for ${host} and openssl fallback failed; ` +
        `cannot offer the chain for trust`
    );
    return undefined;
  }
  const certs = splitPemCerts(full);
  if (!certs.length) {
    return undefined;
  }
  const rootCn = await opensslCertSubjectCn(certs[certs.length - 1]);
  return {
    pem: certs.join(""),
    ...base,
    rootCn,
    rootFingerprint: sha256Fingerprint(derOfPem(certs[certs.length - 1])),
  };
}

/**
 * TOFU flow for one host. Returns true when the chain was accepted and
 * pinned — the caller should retry the request immediately.
 */
async function maybeTrustOnFirstUse(url: URL): Promise<boolean> {
  if (url.protocol !== "https:") {
    return false;
  }
  const host = safeHostname(url.hostname);
  if (!host || declinedHosts.has(host)) {
    return false;
  }
  const existing = inflightTrust.get(host);
  if (existing) {
    return existing;
  }
  const flow = (async (): Promise<boolean> => {
    if (!isAutoTrustEnabled()) {
      return false;
    }
    const chain = await probeServerChain(host, Number(url.port) || 443);
    if (!chain) {
      logTls(
        `untrusted certificate for ${host}; auto-trust unavailable (probe failed). ` +
          `Add the CA chain to ~/.harbor/certs/pinned/${host}.pem to trust it.`
      );
      return false;
    }
    const changed = Boolean(getPinnedCaForHost(host));
    let accepted = false;
    if (trustPrompt) {
      accepted = await trustPrompt({
        host,
        leafCn: chain.leafCn,
        issuerCn: chain.issuerCn,
        rootCn: chain.rootCn,
        rootFingerprint: chain.rootFingerprint,
        changed,
      });
    } else {
      logTls(
        `untrusted internal CA "${chain.issuerCn}" for ${host} (no UI attached). ` +
          `Accept it once in VS Code or save the chain to ~/.harbor/certs/pinned/${host}.pem.`
      );
    }
    if (!accepted) {
      declinedHosts.add(host);
      return false;
    }
    if (savePinnedCaForHost(host, chain.pem)) {
      logTls(`pinned CA chain for ${host} (root: ${chain.rootCn})`);
      return true;
    }
    logTls(`failed to persist pin for ${host} under ${pinnedDir()}`);
    return false;
  })();
  inflightTrust.set(host, flow);
  try {
    return await flow;
  } finally {
    inflightTrust.delete(host);
  }
}

/** Fetch error code, unwrapping fetch's TypeError "fetch failed" cause chain. */
function errorCodeDeep(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    const code = (current as NodeJS.ErrnoException)?.code;
    if (typeof code === "string" && code) {
      return code;
    }
    current = (current as { cause?: unknown })?.cause;
  }
  return undefined;
}

function isTrustErrorCode(code: string | undefined): boolean {
  return Boolean(code && TRUST_ERROR_CODES.has(code));
}

interface UndiciModule {
  fetch?: typeof fetch;
  Agent?: new (options: unknown) => unknown;
}

let undiciModule: UndiciModule | null | undefined;

function loadUndici(): UndiciModule | null {
  if (undiciModule !== undefined) {
    return undiciModule;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    undiciModule = require("undici") as UndiciModule;
  } catch {
    undiciModule = null;
  }
  return undiciModule;
}

const pinnedHttpsAgents = new Map<string, https.Agent>();

/** Cache key includes the CA hash so a re-pinned chain gets a fresh agent. */
function pinnedCacheKey(host: string, ca: string): string {
  return `${host}|${crypto.createHash("sha256").update(ca).digest("hex").slice(0, 16)}`;
}

function getOrCreatePinnedHttpsAgent(host: string, ca: string): https.Agent {
  const key = pinnedCacheKey(host, ca);
  const existing = pinnedHttpsAgents.get(key);
  if (existing) {
    return existing;
  }
  const agent = new https.Agent({ ca, keepAlive: true });
  pinnedHttpsAgents.set(key, agent);
  return agent;
}

const pinnedDispatchers = new Map<
  string,
  { fetch: typeof fetch; dispatcher: unknown }
>();

/**
 * Fetch with a pinned CA chain. Prefers undici + per-host dispatcher so SSE
 * streaming keeps flowing incrementally (undici validates the chain via
 * connect.ca with rejectUnauthorized still on); falls back to buffered
 * node https when undici is unavailable or the input is a Request object.
 */
function fetchWithPinnedCa(
  url: URL,
  input: string | URL | Request,
  init: RequestInit | undefined,
  ca: string
): Promise<Response> {
  const undici = loadUndici();
  const host = url.hostname;
  if (undici?.fetch && (typeof input === "string" || input instanceof URL)) {
    const key = pinnedCacheKey(host, ca);
    let entry = pinnedDispatchers.get(key);
    if (!entry && undici.Agent) {
      entry = {
        fetch: undici.fetch.bind(undici),
        dispatcher: new undici.Agent({ connect: { ca } }),
      };
      pinnedDispatchers.set(key, entry);
    }
    if (entry) {
      return entry.fetch(input, {
        ...(init || {}),
        dispatcher: entry.dispatcher,
      } as Parameters<typeof fetch>[1]) as unknown as Promise<Response>;
    }
  }
  return nodeHttpsFetch(input, init, getOrCreatePinnedHttpsAgent(host, ca));
}

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
  let trustRetryUsed = false;
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
      // Untrusted internal CA → trust-on-first-use, then one extra retry.
      if (!trustRetryUsed && isTrustErrorCode(errorCodeDeep(error))) {
        trustRetryUsed = true;
        const rawUrl = urlStringOf(input);
        const url = rawUrl ? new URL(rawUrl) : undefined;
        if (url && (await maybeTrustOnFirstUse(url))) {
          continue;
        }
      }
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

function urlStringOf(input: string | URL | Request): string | undefined {
  try {
    if (typeof input === "string") {
      return input;
    }
    if (input instanceof URL) {
      return input.toString();
    }
    return String((input as Request).url || "") || undefined;
  } catch {
    return undefined;
  }
}

function dispatchHarborFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  // Trust the last applyHarborTlsPolicy() result — not a fresh getConfig()
  // read — so Figma/headless turns that just set rejectUnauthorized:false
  // are not flipped back to strict native fetch.
  if (applied !== false || !insecureAgent) {
    const rawUrl = urlStringOf(input);
    if (rawUrl) {
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === "https:") {
          const pinnedCa = getPinnedCaForHost(parsed.hostname);
          if (pinnedCa) {
            return fetchWithPinnedCa(parsed, input, init, pinnedCa);
          }
        }
      } catch {
        /* not a parseable absolute URL — native fetch path */
      }
    }
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
