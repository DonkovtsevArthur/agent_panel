/**
 * VS Code side of Gennadiy corporate login.
 *
 * Preferred: native Keycloak **device flow** (same SSO form as
 * `gennadiy auth login`) opened in the system browser — no CLI, no terminal.
 * Fallback: run `gennadiy auth login` in a terminal when the browser flow
 * cannot start.
 */

import * as vscode from "vscode";
import { resolveUiLanguage } from "./i18n";
import { getConfig } from "./config";
import {
  gennadiyAuthEmail,
  isGennadiyProvider,
  readGennadiyAccessToken,
  readGennadiyRefreshToken,
  gennadiyTokenNeedsRefresh,
  writeGennadiyKeycloakEntry,
} from "./gennadiyAuth";
import {
  GENNADIY_KEYCLOAK_DEFAULT,
  pollKeycloakDeviceToken,
  refreshKeycloakToken,
  startKeycloakDeviceFlow,
  writeGennadiyAuthStore,
} from "./keycloakDeviceAuth";

export const GENNADIY_AUTH_LOGIN_COMMAND = "gennadiy auth login";

/** Terminal name shown in the panel while the device-flow login runs. */
const GENNADIY_AUTH_TERMINAL = "Harbor: Gennadiy Auth";

let nativeLoginInFlight = false;
let refreshInFlight: Promise<string> | undefined;

/**
 * Refresh the Keycloak access token via the offline refresh token (30 min
 * access). Safe to call before every run; concurrent callers share one
 * network refresh.
 */
export async function ensureGennadiyAccessToken(): Promise<string> {
  const live = readGennadiyAccessToken();
  if (live && !gennadiyTokenNeedsRefresh()) {
    return live;
  }
  if (refreshInFlight) {
    return refreshInFlight;
  }
  const refresh = readGennadiyRefreshToken();
  if (!refresh) {
    return live;
  }
  refreshInFlight = (async () => {
    try {
      const tokens = await refreshKeycloakToken(
        refresh,
        GENNADIY_KEYCLOAK_DEFAULT
      );
      writeGennadiyKeycloakEntry({
        access: tokens.access,
        refresh: tokens.refresh || refresh,
        expires: tokens.expires,
        email: tokens.email || undefined,
        accountId: tokens.accountId || undefined,
      });
      await syncGennadiyTokenToSettings();
      return tokens.access;
    } catch {
      return readGennadiyAccessToken();
    } finally {
      refreshInFlight = undefined;
    }
  })();
  return refreshInFlight;
}

/**
 * True when the failing endpoint is the corporate Gennadiy gateway
 * (provider id/name/baseUrl).
 */
export function providerNeedsGennadiyLogin(providerId: string): boolean {
  const config = getConfig();
  const provider =
    config.providers.find((p) => p.id === providerId) ||
    config.providers.find((p) =>
      isGennadiyProvider({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
      })
    );
  return Boolean(
    provider &&
      isGennadiyProvider({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
      })
  );
}

/**
 * After a successful CLI login, copy the live access token into
 * `agentPanel.providers[].apiKey` for Gennadiy rows so every host path
 * (Cline, commit message, autocomplete) uses it even without live lookup.
 */
export async function syncGennadiyTokenToSettings(): Promise<boolean> {
  const token = readGennadiyAccessToken();
  if (!token) {
    return false;
  }
  const cfg = vscode.workspace.getConfiguration("agentPanel");
  const raw = cfg.get<Array<Record<string, unknown>>>("providers");
  if (!Array.isArray(raw) || !raw.length) {
    return false;
  }
  let changed = false;
  const next = raw.map((row) => {
    if (
      !isGennadiyProvider({
        id: String(row?.id || ""),
        name: String(row?.name || ""),
        baseUrl: String(row?.baseUrl || ""),
      })
    ) {
      return row;
    }
    if (String(row?.apiKey || "") === token) {
      return row;
    }
    changed = true;
    return { ...row, apiKey: token };
  });
  if (changed) {
    await cfg.update("providers", next, vscode.ConfigurationTarget.Global);
  }
  return changed;
}

/**
 * Native Keycloak device flow: open the corporate SSO form in the browser
 * (same page as `gennadiy auth login`), poll tokens, persist them.
 */
export async function openGennadiyAuthLoginNative(): Promise<boolean> {
  const lang = resolveUiLanguage(getConfig().language);
  if (nativeLoginInFlight) {
    void vscode.window.showInformationMessage(
      lang === "ru"
        ? "Gennadiy: вход уже выполняется — завершите его в браузере."
        : "Gennadiy: sign-in already in progress — finish it in the browser."
    );
    return true;
  }
  nativeLoginInFlight = true;
  try {
    const start = await startKeycloakDeviceFlow(GENNADIY_KEYCLOAK_DEFAULT);
    await vscode.env.openExternal(vscode.Uri.parse(start.verificationUriComplete));
    void vscode.window.showInformationMessage(
      lang === "ru"
        ? `Gennadiy: код ${start.userCode} — подтвердите вход в браузере (Keycloak).`
        : `Gennadiy: code ${start.userCode} — confirm sign-in in the browser (Keycloak).`
    );
    const tokens = await pollKeycloakDeviceToken(start, GENNADIY_KEYCLOAK_DEFAULT);
    writeGennadiyAuthStore(tokens);
    await syncGennadiyTokenToSettings();
    void vscode.window.showInformationMessage(
      lang === "ru"
        ? `Gennadiy: вход выполнен${tokens.email ? ` (${tokens.email})` : ""}. Токен сохранён.`
        : `Gennadiy: signed in${tokens.email ? ` (${tokens.email})` : ""}. Token saved.`
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/aborted/i.test(message)) {
      return false;
    }
    void vscode.window.showWarningMessage(
      lang === "ru"
        ? `Gennadiy: не удалось войти через браузер (${message}). Запускаю gennadiy auth login.`
        : `Gennadiy: browser sign-in failed (${message}). Falling back to gennadiy auth login.`
    );
    return false;
  } finally {
    nativeLoginInFlight = false;
  }
}

/**
 * Open Gennadiy login: native Keycloak form first, CLI terminal as fallback.
 */
export async function openGennadiyAuthLogin(): Promise<void> {
  const ok = await openGennadiyAuthLoginNative();
  if (ok) {
    return;
  }
  const lang = resolveUiLanguage(getConfig().language);
  const terminal =
    vscode.window.terminals.find((t) => t.name === GENNADIY_AUTH_TERMINAL) ||
    vscode.window.createTerminal({
      name: GENNADIY_AUTH_TERMINAL,
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      env: {},
    });
  terminal.show();
  terminal.sendText(GENNADIY_AUTH_LOGIN_COMMAND);

  void vscode.window.showInformationMessage(
    lang === "ru"
      ? "Gennadiy: выполните вход в терминале (Keycloak). После успеха токен подхватится автоматически."
      : "Gennadiy: complete sign-in in the terminal (Keycloak). The token is applied automatically after success.",
    { modal: false }
  );

  void syncGennadiyTokenToSettings();
  void (async () => {
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 5_000));
      if (await syncGennadiyTokenToSettings()) {
        return;
      }
    }
  })();
}

/**
 * 401/Unauthorized for a Gennadiy provider: offer the corporate login form
 * (`gennadiy auth login`) instead of a bare API-key field. Returns true when
 * the login prompt was shown.
 */
export async function promptGennadiyAuthLogin(): Promise<boolean> {
  const lang = resolveUiLanguage(getConfig().language);
  const login =
    lang === "ru" ? "Войти (Keycloak)" : "Sign in (Keycloak)";
  const settings = lang === "ru" ? "Настройки" : "Open settings";
  const already =
    readGennadiyAccessToken() && gennadiyAuthEmail()
      ? gennadiyAuthEmail()
      : "";
  const message = already
    ? lang === "ru"
      ? `Gennadiy: ключ отклонён (401). Текущий вход: ${already}. Войти заново?`
      : `Gennadiy: the API key was rejected (401). Signed in as ${already}. Sign in again?`
    : lang === "ru"
      ? "Gennadiy: требуется авторизация (401). Войдите через Keycloak."
      : "Gennadiy: authorization required (401). Sign in with Keycloak.";

  const pick = await vscode.window.showErrorMessage(
    message,
    { modal: true },
    login,
    settings
  );
  if (pick === login) {
    await openGennadiyAuthLogin();
    return true;
  }
  return false;
}
