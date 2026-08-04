import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as vscode from "vscode";
import { listenForOAuthCallback } from "./callbackServer";
import { FIGMA_MCP_REMOTE_URL } from "./figma";
import { VsCodeFigmaOAuthProvider } from "./oauthProvider";
import { applyFigmaTlsCaFromSettings } from "./tlsCa";

function isUnauthorizedError(error: unknown): boolean {
  if (error instanceof UnauthorizedError) {
    return true;
  }
  if (
    error &&
    typeof error === "object" &&
    (error as { name?: string }).name === "UnauthorizedError"
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /re-?authorization required|unauthorized|authentication required/i.test(
    message
  );
}

async function openFigmaAuthInBrowser(url: URL): Promise<void> {
  const href = url.toString();
  try {
    await vscode.env.clipboard.writeText(href);
  } catch {
    // ignore clipboard failures
  }

  let opened = false;
  try {
    opened = await vscode.env.openExternal(vscode.Uri.parse(href));
  } catch {
    opened = false;
  }

  // Non-blocking: keep waiting for the OAuth callback while offering a manual open.
  void vscode.window
    .showInformationMessage(
      opened
        ? "Откройте вкладку Figma и подтвердите доступ. Если браузер пустой — нажмите «Открыть ссылку»."
        : "Браузер не открылся автоматически. Нажмите «Открыть ссылку» и подтвердите доступ Figma.",
      "Открыть ссылку"
    )
    .then(async (choice) => {
      if (choice === "Открыть ссылку") {
        try {
          await vscode.env.openExternal(vscode.Uri.parse(href));
        } catch (error) {
          void vscode.window.showErrorMessage(
            `Не удалось открыть браузер: ${
              error instanceof Error ? error.message : String(error)
            }. Ссылка скопирована в буфер.`
          );
        }
      }
    });
}

export async function connectFigmaRemote(options: {
  secrets: vscode.SecretStorage;
  interactive: boolean;
  signal?: AbortSignal;
}): Promise<Client> {
  applyFigmaTlsCaFromSettings();

  if (!options.interactive) {
    const provider = new VsCodeFigmaOAuthProvider(
      options.secrets,
      "http://127.0.0.1/unused",
      async () => {
        throw new UnauthorizedError("Figma re-authorization required");
      }
    );
    await provider.ensureLoaded();
    if (!(await provider.hasStoredTokens())) {
      throw new UnauthorizedError("No Figma OAuth tokens stored");
    }
    return await connectWithProvider(provider, options.signal);
  }

  const callback = await listenForOAuthCallback();
  try {
    const provider = new VsCodeFigmaOAuthProvider(
      options.secrets,
      callback.redirectUrl,
      openFigmaAuthInBrowser
    );
    await provider.ensureLoaded();
    await provider.invalidateCredentials("client");

    const client = new Client(
      { name: "Codex", version: "1.0.0" },
      { capabilities: {} }
    );

    const transport = new StreamableHTTPClientTransport(
      new URL(FIGMA_MCP_REMOTE_URL),
      { authProvider: provider }
    );

    try {
      await client.connect(transport);
      return client;
    } catch (error) {
      if (!isUnauthorizedError(error)) {
        throw error;
      }
      const { code, state } = await callback.waitForCode();
      const expected = provider.state();
      if (state && expected && state !== expected) {
        throw new Error("OAuth state mismatch");
      }
      await transport.finishAuth(code);
      return await connectWithProvider(provider, options.signal);
    }
  } finally {
    await callback.close();
  }
}

async function connectWithProvider(
  provider: VsCodeFigmaOAuthProvider,
  signal?: AbortSignal
): Promise<Client> {
  if (signal?.aborted) {
    throw new Error("aborted");
  }
  const client = new Client(
    { name: "Codex", version: "1.0.0" },
    { capabilities: {} }
  );
  const transport = new StreamableHTTPClientTransport(
    new URL(FIGMA_MCP_REMOTE_URL),
    { authProvider: provider }
  );
  await client.connect(transport);
  return client;
}

export function looksLikeCatalogBlockedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes("not authorized") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("waitlist") ||
    lower.includes("not allowed") ||
    lower.includes("client not") ||
    lower.includes("unknown client") ||
    lower.includes("catalog") ||
    lower.includes("raw body: forbidden") ||
    /http\s*40[13]/.test(lower)
  );
}

export function formatFigmaRemoteError(
  error: unknown,
  lang: "en" | "ru" = "en"
): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (
    lower.includes("certificate") ||
    lower.includes("unable to get local issuer") ||
    lower.includes("self signed")
  ) {
    return lang === "ru"
      ? "TLS/сертификат: укажите CA bundle в Settings → CA bundle path (system + корпоративный CA), Reload Window, затем Connect Figma снова."
      : "TLS/certificate error: set Settings → CA bundle path (system + corporate CA), Reload Window, then Connect Figma again.";
  }
  if (looksLikeCatalogBlockedError(error)) {
    return lang === "ru"
      ? "Remote Figma MCP отклонил OAuth (403). Нажмите Connect Figma ещё раз или используйте Personal Access Token ниже."
      : "Remote Figma MCP rejected OAuth (403). Try Connect Figma again, or use a Personal Access Token below.";
  }
  const trimmed = message.replace(/\s+/g, " ").trim();
  if (trimmed.length > 220) {
    return `${trimmed.slice(0, 217)}…`;
  }
  return (
    trimmed ||
    (lang === "ru"
      ? "Не удалось подключить remote Figma MCP"
      : "Could not connect to remote Figma MCP")
  );
}

export { applyFigmaTlsCaFromSettings } from "./tlsCa";
