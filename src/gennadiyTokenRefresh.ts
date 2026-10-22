/**
 * Seamless Gennadiy (Keycloak) access-token refresh shared by VS Code and the
 * JetBrains sidecar. The access token lives ~30 min, so a long chat must not
 * keep the key it started with: model requests go through
 * {@link wrapFetchWithGennadiyAuth}, which puts the current token on every
 * request and retries once after a 401.
 *
 * vscode-free: hosts plug in settings sync / the re-login prompt via
 * {@link setGennadiyRefreshHooks}.
 */

import {
  gennadiyTokenNeedsRefresh,
  readGennadiyAccessToken,
  readGennadiyRefreshToken,
  writeGennadiyKeycloakEntry,
} from "./gennadiyAuth";
import {
  GENNADIY_KEYCLOAK_DEFAULT,
  KeycloakRefreshError,
  refreshKeycloakToken,
} from "./keycloakDeviceAuth";

/** A hung token endpoint must not block every later run (shared in-flight). */
export const GENNADIY_REFRESH_TIMEOUT_MS = 15_000;

export interface GennadiyRefreshHooks {
  /** New access token written to the auth store (copy it into settings). */
  onRefreshed?: (access: string) => void | Promise<void>;
  /** Refresh token expired / revoked and no live token is left — sign in again. */
  onRejected?: (error: Error) => void;
}

export interface GennadiyRefreshOptions {
  /** Refresh even when the stored token still looks live (after a 401). */
  force?: boolean;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

let hooks: GennadiyRefreshHooks = {};
let refreshInFlight: Promise<string> | undefined;

export function setGennadiyRefreshHooks(next: GennadiyRefreshHooks): void {
  hooks = next || {};
}

function logRefresh(message: string): void {
  try {
    process.stderr.write(`[harbor-gennadiy] ${message}\n`);
  } catch {
    /* ignore */
  }
}

/**
 * Live access token, refreshed via the offline refresh token when it is
 * missing / about to expire (or `force`). Concurrent callers share one network
 * refresh. Never throws: on failure returns whatever live token the store has
 * ("" when login is required).
 */
export function refreshGennadiyAccessToken(
  options?: GennadiyRefreshOptions
): Promise<string> {
  const live = readGennadiyAccessToken();
  if (!options?.force && live && !gennadiyTokenNeedsRefresh()) {
    return Promise.resolve(live);
  }
  if (refreshInFlight) {
    return refreshInFlight;
  }
  const refresh = readGennadiyRefreshToken();
  if (!refresh) {
    return Promise.resolve(live);
  }
  refreshInFlight = (async () => {
    try {
      const tokens = await refreshKeycloakToken(
        refresh,
        GENNADIY_KEYCLOAK_DEFAULT,
        options?.fetchFn || fetch,
        {
          signal: AbortSignal.timeout(
            options?.timeoutMs ?? GENNADIY_REFRESH_TIMEOUT_MS
          ),
        }
      );
      writeGennadiyKeycloakEntry({
        access: tokens.access,
        refresh: tokens.refresh || refresh,
        expires: tokens.expires,
        email: tokens.email || undefined,
        accountId: tokens.accountId || undefined,
      });
      try {
        await hooks.onRefreshed?.(tokens.access);
      } catch (error) {
        logRefresh(`settings sync after refresh failed: ${String(error)}`);
      }
      return tokens.access;
    } catch (error) {
      logRefresh(
        `token refresh failed: ${error instanceof Error ? error.message : String(error)}`
      );
      // The CLI / another IDE may have rotated the refresh token meanwhile —
      // the store then already holds a fresh access token.
      const stored = readGennadiyAccessToken();
      if (
        !stored &&
        error instanceof KeycloakRefreshError &&
        error.grantRejected
      ) {
        hooks.onRejected?.(error);
      }
      return stored;
    } finally {
      refreshInFlight = undefined;
    }
  })();
  return refreshInFlight;
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function isRequestObject(input: FetchInput): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

/** Bodies that can be sent twice (streams / Request bodies are single-use). */
function isReplayableRequest(input: FetchInput, init: FetchInit): boolean {
  if (isRequestObject(input) && init?.body === undefined) {
    return input.body === null;
  }
  const body = init?.body;
  return (
    body === undefined ||
    body === null ||
    typeof body === "string" ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    (typeof Blob !== "undefined" && body instanceof Blob)
  );
}

/**
 * Same request with the Gennadiy token: replaces `x-api-key` (anthropic
 * protocol) and/or `Authorization: Bearer`. Headers become a plain object —
 * inner fetch wrappers spread `init.headers`.
 */
export function withGennadiyToken(
  input: FetchInput,
  init: FetchInit,
  token: string
): RequestInit {
  const headers = new Headers(
    init?.headers ?? (isRequestObject(input) ? input.headers : undefined)
  );
  const hasApiKeyHeader = headers.has("x-api-key");
  if (hasApiKeyHeader) {
    headers.set("x-api-key", token);
  }
  if (headers.has("authorization") || !hasApiKeyHeader) {
    headers.set("authorization", `Bearer ${token}`);
  }
  const plain: Record<string, string> = {};
  headers.forEach((value, key) => {
    plain[key] = value;
  });
  return { ...(init || {}), headers: plain };
}

/**
 * Fetch for a Gennadiy session: current token on every request (refresh when
 * near expiry), one retry with a fresh token after a 401. The Cline session
 * keeps its context — only the header changes.
 */
export function wrapFetchWithGennadiyAuth(
  fetchImpl: typeof fetch,
  refresh: (
    options?: GennadiyRefreshOptions
  ) => Promise<string> = refreshGennadiyAccessToken
): typeof fetch {
  return (async (input: FetchInput, init?: FetchInit) => {
    const token = await refresh();
    if (!token) {
      return fetchImpl(input, init);
    }
    const first = await fetchImpl(input, withGennadiyToken(input, init, token));
    if (first.status !== 401 || !isReplayableRequest(input, init)) {
      return first;
    }
    // Another process may already have refreshed; otherwise force one.
    let fresh = readGennadiyAccessToken();
    if (!fresh || fresh === token) {
      fresh = await refresh({ force: true });
    }
    if (!fresh || fresh === token) {
      return first;
    }
    await first.body?.cancel().catch(() => {
      /* ignore */
    });
    return fetchImpl(input, withGennadiyToken(input, init, fresh));
  }) as typeof fetch;
}

/**
 * Background refresh cadence. Each refresh with the offline token resets
 * Keycloak's "Offline Session Idle" timer, so the sign-in form only comes
 * back after a long idle stretch or the realm's max session lifespan.
 */
export const GENNADIY_KEEPALIVE_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Periodically refresh the Gennadiy token even when no chat is running.
 * `shouldRun` gates each tick (e.g. a Gennadiy provider is configured).
 * Returns a stop function; the timer never keeps the process alive.
 */
export function startGennadiyKeepAlive(options: {
  shouldRun: () => boolean;
  intervalMs?: number;
  firstDelayMs?: number;
  refresh?: (options?: GennadiyRefreshOptions) => Promise<string>;
}): () => void {
  const refresh = options.refresh || refreshGennadiyAccessToken;
  const tick = (): void => {
    try {
      if (!options.shouldRun() || !readGennadiyRefreshToken()) {
        return;
      }
    } catch {
      return;
    }
    void refresh({ force: true }).catch(() => {
      /* refreshGennadiyAccessToken never throws; custom refresh might */
    });
  };
  // First tick soon after start: the IDE may have been closed for days.
  const first = setTimeout(tick, options.firstDelayMs ?? 30_000);
  const timer = setInterval(
    tick,
    options.intervalMs ?? GENNADIY_KEEPALIVE_INTERVAL_MS
  );
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

/**
 * openaiClient per-request key resolver: Gennadiy endpoints (by base URL)
 * get a refreshed token, everything else keeps its configured key.
 */
export function createGennadiyApiKeyResolver(
  isGennadiyBaseUrl: (baseUrl: string) => boolean
): (baseUrl: string, apiKey: string) => Promise<string> {
  return async (baseUrl, apiKey) => {
    if (!isGennadiyBaseUrl(baseUrl)) {
      return apiKey;
    }
    return (await refreshGennadiyAccessToken()) || apiKey;
  };
}
