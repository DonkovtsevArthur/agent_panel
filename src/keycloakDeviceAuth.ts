/**
 * Native Keycloak device flow for Gennadiy — same SSO form as
 * `gennadiy auth login`, without shelling out to the CLI.
 *
 * POST {keycloak}/realms/{realm}/protocol/openid-connect/auth/device
 * → open verification_uri_complete in the browser
 * → poll {keycloak}/realms/{realm}/protocol/openid-connect/token
 * → persist tokens in the CLI auth store + Harbor provider apiKey.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export interface KeycloakDeviceConfig {
  url: string;
  realm: string;
  clientId: string;
  clientSecret?: string;
}

export interface KeycloakDeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface KeycloakTokenSuccess {
  access: string;
  refresh: string;
  expires: number;
  email: string;
  accountId: string;
}

/** Test-env defaults matching gennadiy 1.18.3 PRESETS.test.keycloak. */
export const GENNADIY_KEYCLOAK_DEFAULT: KeycloakDeviceConfig = {
  url: "https://sso-id-test-int.severstal.com",
  realm: "common",
  clientId: "gennadiy-df",
};

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

function endpoints(cfg: KeycloakDeviceConfig) {
  const base = `${cfg.url.replace(/\/$/, "")}/realms/${cfg.realm}/protocol/openid-connect`;
  return {
    device: `${base}/auth/device`,
    token: `${base}/token`,
  };
}

export async function startKeycloakDeviceFlow(
  cfg: KeycloakDeviceConfig = GENNADIY_KEYCLOAK_DEFAULT,
  fetchFn: typeof fetch = fetch
): Promise<KeycloakDeviceStart & { codeVerifier: string }> {
  const { challenge, verifier } = pkcePair();
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    scope: "openid profile email offline_access",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (cfg.clientSecret) {
    body.set("client_secret", cfg.clientSecret);
  }
  const res = await fetchFn(endpoints(cfg).device, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Keycloak device flow failed: ${res.status} ${text}`);
  }
  const json = JSON.parse(text) as Record<string, unknown>;
  const deviceCode = String(json.device_code || "");
  const userCode = String(json.user_code || "");
  const verificationUri = String(json.verification_uri || "");
  if (!deviceCode || !userCode || !verificationUri) {
    throw new Error("Keycloak device response missing device_code / user_code");
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete:
      String(json.verification_uri_complete || "") || verificationUri,
    expiresIn: Number(json.expires_in) || 600,
    interval: Number(json.interval) || 5,
    codeVerifier: verifier,
  };
}

/**
 * Hint shown while waiting for the browser. `verification_uri_complete`
 * already carries the code — nothing to type, just sign in and confirm; the
 * code is shown only when the page will ask for it.
 */
export function gennadiyDeviceLoginHint(
  start: KeycloakDeviceStart,
  lang: string
): string {
  const codeInLink =
    Boolean(start.verificationUriComplete) &&
    start.verificationUriComplete !== start.verificationUri;
  if (codeInLink) {
    return lang === "ru"
      ? "войдите на открывшейся странице и нажмите «Подтвердить» — код вводить не нужно"
      : "sign in on the opened page and press Confirm — no code to type";
  }
  return lang === "ru"
    ? `введите код ${start.userCode} на странице ${start.verificationUri}`
    : `enter code ${start.userCode} at ${start.verificationUri}`;
}

export async function pollKeycloakDeviceToken(
  start: KeycloakDeviceStart & { codeVerifier?: string },
  cfg: KeycloakDeviceConfig = GENNADIY_KEYCLOAK_DEFAULT,
  options?: {
    signal?: AbortSignal;
    fetchFn?: typeof fetch;
    onPending?: () => void;
  }
): Promise<KeycloakTokenSuccess> {
  const fetchFn = options?.fetchFn || fetch;
  const intervalMs = Math.max(2, start.interval) * 1000;
  const deadline = Date.now() + Math.max(30, start.expiresIn) * 1000;
  let delay = intervalMs;
  while (Date.now() < deadline) {
    if (options?.signal?.aborted) {
      throw new Error("aborted");
    }
    await new Promise((r) => setTimeout(r, delay));
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: start.deviceCode,
      client_id: cfg.clientId,
    });
    if (cfg.clientSecret) {
      body.set("client_secret", cfg.clientSecret);
    }
    if (start.codeVerifier) {
      body.set("code_verifier", start.codeVerifier);
    }
    const res = await fetchFn(endpoints(cfg).token, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      signal: options?.signal,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && json.access_token) {
      const access = String(json.access_token);
      const refresh = String(json.refresh_token || "");
      const expiresIn = Number(json.expires_in) || 300;
      const idToken = String(json.id_token || "");
      const claims = decodeJwtPayload(idToken || access);
      return {
        access,
        refresh,
        expires: Date.now() + expiresIn * 1000,
        email: String(claims.email || claims.preferred_username || ""),
        accountId: String(claims.sub || ""),
      };
    }
    const err = String(json.error || "");
    if (err === "authorization_pending") {
      options?.onPending?.();
      continue;
    }
    if (err === "slow_down") {
      delay += 5000;
      continue;
    }
    if (err === "expired_token") {
      throw new Error("Код подтверждения истёк. Запустите вход ещё раз.");
    }
    if (err === "access_denied" || err === "authorization_denied") {
      throw new Error("Вход отменён в Keycloak.");
    }
    if (err) {
      throw new Error(`Keycloak token error: ${err} ${String(json.error_description || "")}`);
    }
    options?.onPending?.();
  }
  throw new Error("Время ожидания входа в Keycloak истекло.");
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  try {
    const part = jwt.split(".")[1] || "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

/** CLI-compatible auth store so `gennadiy` and Harbor share one session. */
export function gennadiyAuthStorePath(): string {
  const dataHome =
    process.env.XDG_DATA_HOME ||
    path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".local",
      "share"
    );
  return path.join(dataHome, "gennadiy", "auth.json");
}

/** Token endpoint rejected a refresh (`oauthError` from the JSON body). */
export class KeycloakRefreshError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly oauthError: string
  ) {
    super(message);
    this.name = "KeycloakRefreshError";
  }

  /** Refresh token expired / revoked (offline session ended) — sign in again. */
  get grantRejected(): boolean {
    return this.oauthError === "invalid_grant";
  }
}

/** Refresh an offline Keycloak token; throws when refresh is rejected. */
export async function refreshKeycloakToken(
  refreshToken: string,
  cfg: KeycloakDeviceConfig = GENNADIY_KEYCLOAK_DEFAULT,
  fetchFn: typeof fetch = fetch,
  options?: { signal?: AbortSignal }
): Promise<KeycloakTokenSuccess> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cfg.clientId,
  });
  if (cfg.clientSecret) {
    body.set("client_secret", cfg.clientSecret);
  }
  const res = await fetchFn(endpoints(cfg).token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
    signal: options?.signal,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !json.access_token) {
    throw new KeycloakRefreshError(
      `Keycloak refresh failed: ${res.status} ${String(json.error || "")} ${String(json.error_description || "")}`,
      res.status,
      String(json.error || "")
    );
  }
  const access = String(json.access_token);
  const refresh = String(json.refresh_token || refreshToken);
  const expiresIn = Number(json.expires_in) || 300;
  const claims = decodeJwtPayload(String(json.id_token || access));
  return {
    access,
    refresh,
    expires: Date.now() + expiresIn * 1000,
    email: String(claims.email || claims.preferred_username || ""),
    accountId: String(claims.sub || ""),
  };
}

export function writeGennadiyAuthStore(tokens: KeycloakTokenSuccess): void {
  const file = gennadiyAuthStorePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let store: Record<string, unknown> = {};
  try {
    store = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    store = {};
  }
  const prev = (store.keycloak || {}) as Record<string, unknown>;
  store.keycloak = {
    ...prev,
    type: "oauth",
    access: tokens.access,
    refresh: tokens.refresh,
    expires: tokens.expires,
    accountId: tokens.accountId || prev.accountId || "",
    email: tokens.email || prev.email || "",
  };
  fs.writeFileSync(file, JSON.stringify(store, null, 2), { mode: 0o600 });
}
