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
import { getConfig, isGennadiyEndpointBaseUrl } from "./config";
import {
  gennadiyAuthEmail,
  isGennadiyProvider,
  readGennadiyAccessToken,
} from "./gennadiyAuth";
import {
  GENNADIY_KEYCLOAK_DEFAULT,
  gennadiyDeviceLoginHint,
  pollKeycloakDeviceToken,
  startKeycloakDeviceFlow,
  writeGennadiyAuthStore,
} from "./keycloakDeviceAuth";
import {
  createGennadiyApiKeyResolver,
  refreshGennadiyAccessToken,
  setGennadiyRefreshHooks,
  startGennadiyKeepAlive,
} from "./gennadiyTokenRefresh";
import { setOpenAIApiKeyResolver } from "./openaiClient";

export const GENNADIY_AUTH_LOGIN_COMMAND = "gennadiy auth login";

/** Terminal name shown in the panel while the device-flow login runs. */
const GENNADIY_AUTH_TERMINAL = "Harbor: Gennadiy Auth";

let nativeLoginInFlight = false;
/** One "session expired" toast until the next successful sign-in. */
let expiredPromptShown = false;

/**
 * Refresh the Keycloak access token via the offline refresh token (30 min
 * access). Safe to call before every run; concurrent callers share one
 * network refresh. Settings sync runs from the refresh hooks.
 */
export async function ensureGennadiyAccessToken(): Promise<string> {
  return refreshGennadiyAccessToken();
}

/**
 * Wire seamless refresh for the extension host: settings copy of the token
 * after each refresh, a sign-in prompt once the offline session is gone, and
 * per-request keys for utility LLM calls (titles, commit messages, …).
 */
export function registerGennadiyRefreshHooks(): void {
  setGennadiyRefreshHooks({
    onRefreshed: async () => {
      expiredPromptShown = false;
      await syncGennadiyTokenToSettings();
    },
    onRejected: () => {
      void promptGennadiySessionExpired();
    },
  });
  setOpenAIApiKeyResolver(
    createGennadiyApiKeyResolver(isGennadiyEndpointBaseUrl)
  );
}

/**
 * Keep the Keycloak offline session alive while VS Code is open so the
 * sign-in form only returns after a long idle stretch.
 */
export function startGennadiyTokenKeepAlive(): vscode.Disposable {
  const stop = startGennadiyKeepAlive({
    shouldRun: () =>
      getConfig().providers.some((p) => isGennadiyProvider(p)),
  });
  return new vscode.Disposable(stop);
}

async function promptGennadiySessionExpired(): Promise<void> {
  if (expiredPromptShown || nativeLoginInFlight) {
    return;
  }
  expiredPromptShown = true;
  const lang = resolveUiLanguage(getConfig().language);
  const login = lang === "ru" ? "Войти (Keycloak)" : "Sign in (Keycloak)";
  const pick = await vscode.window.showWarningMessage(
    lang === "ru"
      ? "Gennadiy: сессия Keycloak истекла, автообновление токена невозможно. Войдите заново."
      : "Gennadiy: the Keycloak session has expired and the token cannot be refreshed. Sign in again.",
    login
  );
  if (pick === login) {
    await openGennadiyAuthLogin();
  }
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
    // Progress notification: shows the code while waiting, Cancel aborts the
    // poll, and it closes by itself once Keycloak confirms (no stale toast).
    const tokens = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title:
          lang === "ru"
            ? "Gennadiy: подтвердите вход в браузере"
            : "Gennadiy: confirm sign-in in the browser",
        cancellable: true,
      },
      (progress, cancel) => {
        progress.report({
          message: gennadiyDeviceLoginHint(start, lang),
        });
        const abort = new AbortController();
        cancel.onCancellationRequested(() => abort.abort());
        return pollKeycloakDeviceToken(start, GENNADIY_KEYCLOAK_DEFAULT, {
          signal: abort.signal,
        });
      }
    );
    writeGennadiyAuthStore(tokens);
    expiredPromptShown = false;
    await syncGennadiyTokenToSettings();
    void vscode.window.showInformationMessage(
      lang === "ru"
        ? `Gennadiy: вход выполнен${tokens.email ? ` (${tokens.email})` : ""}. Токен сохранён.`
        : `Gennadiy: signed in${tokens.email ? ` (${tokens.email})` : ""}. Token saved.`
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // User pressed Cancel — handled, no CLI terminal fallback.
    if (/aborted/i.test(message)) {
      return true;
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
