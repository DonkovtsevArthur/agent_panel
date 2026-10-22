/**
 * Gennadiy corporate auth (Keycloak device flow via `gennadiy auth login`).
 * Tokens live in the CLI store (~/.local/share/gennadiy/auth.json); Harbor
 * reuses the access token as the provider API key after login.
 * Pure fs helpers stay vscode-free for tests; host wiring lives in the panel.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface GennadiyAuthEntry {
  type?: string;
  access?: string;
  refresh?: string;
  expires?: number;
  accountId?: string;
  email?: string;
}

export interface GennadiyAuthStore {
  keycloak?: GennadiyAuthEntry;
  [key: string]: unknown;
}

const GATEWAY_HINT = /gennadiy/i;

/** Provider id / name / baseUrl looks like the corporate Gennadiy gateway. */
export function isGennadiyProvider(provider: {
  id?: string;
  name?: string;
  baseUrl?: string;
}): boolean {
  const id = String(provider?.id || "").trim();
  const name = String(provider?.name || "").trim();
  const baseUrl = String(provider?.baseUrl || "").trim();
  return GATEWAY_HINT.test(id) || GATEWAY_HINT.test(name) || GATEWAY_HINT.test(baseUrl);
}

/** CLI auth store path (XDG data dir, same as gennadiy). */
export function gennadiyAuthJsonPath(): string {
  const dataHome =
    process.env.XDG_DATA_HOME ||
    path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "gennadiy", "auth.json");
}

export function readGennadiyAuthStore(): GennadiyAuthStore | undefined {
  try {
    const raw = fs.readFileSync(gennadiyAuthJsonPath(), "utf8");
    const parsed = JSON.parse(raw) as GennadiyAuthStore;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Keycloak access token when present and not expired (skew 60s).
 * Empty string when login is required.
 */
export function readGennadiyAccessToken(): string {
  const entry = readGennadiyAuthStore()?.keycloak;
  const access = String(entry?.access || "").trim();
  if (!access) {
    return "";
  }
  const expires = Number(entry?.expires);
  if (Number.isFinite(expires) && expires > 0 && expires <= Date.now() + 60_000) {
    return "";
  }
  return access;
}

export function gennadiyAuthEmail(): string {
  return String(readGennadiyAuthStore()?.keycloak?.email || "").trim();
}

/**
 * Prefer a live CLI token over a stale pasted key so `gennadiy auth login`
 * is enough; fall back to the settings API key.
 */
export function resolveGennadiyApiKey(providerApiKey?: string): string {
  return readGennadiyAccessToken() || String(providerApiKey || "").trim();
}

/** Offline refresh token when present (no expiry check — Keycloak offline). */
export function readGennadiyRefreshToken(): string {
  const entry = readGennadiyAuthStore()?.keycloak;
  return String(entry?.refresh || "").trim();
}

/** Access token may be expired but present (caller decides to refresh). */
export function readGennadiyAccessTokenAllowExpired(): string {
  return String(readGennadiyAuthStore()?.keycloak?.access || "").trim();
}

export function gennadiyTokenExpiresAt(): number {
  const expires = Number(readGennadiyAuthStore()?.keycloak?.expires);
  return Number.isFinite(expires) && expires > 0 ? expires : 0;
}

/**
 * True when the stored access token is missing or expires within `skewMs`.
 */
export function gennadiyTokenNeedsRefresh(skewMs = 60_000): boolean {
  const access = readGennadiyAccessTokenAllowExpired();
  if (!access) {
    return Boolean(readGennadiyRefreshToken());
  }
  const expires = gennadiyTokenExpiresAt();
  if (!expires) {
    return false;
  }
  return expires <= Date.now() + skewMs;
}

/** Patch only the keycloak entry in the CLI auth store (merge). */
export function writeGennadiyKeycloakEntry(patch: {
  access?: string;
  refresh?: string;
  expires?: number;
  email?: string;
  accountId?: string;
}): void {
  const file = gennadiyAuthJsonPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let store: GennadiyAuthStore = {};
  try {
    store = JSON.parse(fs.readFileSync(file, "utf8")) as GennadiyAuthStore;
  } catch {
    store = {};
  }
  const prev = (store.keycloak || {}) as GennadiyAuthEntry;
  store.keycloak = {
    ...prev,
    type: "oauth",
    access: patch.access ?? prev.access,
    refresh: patch.refresh ?? prev.refresh,
    expires: patch.expires ?? prev.expires,
    email: patch.email ?? prev.email,
    accountId: patch.accountId ?? prev.accountId,
  };
  fs.writeFileSync(file, JSON.stringify(store, null, 2), { mode: 0o600 });
}
