import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as vscode from "vscode";
import { listenForOAuthCallback } from "./callbackServer";
import { FIGMA_MCP_REMOTE_URL } from "./figma";
import { VsCodeFigmaOAuthProvider } from "./oauthProvider";

export async function connectFigmaRemote(options: {
  secrets: vscode.SecretStorage;
  interactive: boolean;
  signal?: AbortSignal;
}): Promise<Client> {
  const openBrowser = async (url: URL) => {
    await vscode.env.openExternal(vscode.Uri.parse(url.toString()));
  };

  if (!options.interactive) {
    // Reuse stored tokens; fail fast if re-auth is required.
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
      openBrowser
    );
    await provider.ensureLoaded();

    const client = new Client(
      { name: "harbor-agents", version: "1.0.0" },
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
      if (!(error instanceof UnauthorizedError)) {
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
    { name: "harbor-agents", version: "1.0.0" },
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

/** Short user-facing message for Settings / toasts. */
export function formatFigmaRemoteError(
  error: unknown,
  lang: "en" | "ru" = "en"
): string {
  if (looksLikeCatalogBlockedError(error)) {
    return lang === "ru"
      ? "Remote Figma MCP недоступен этому клиенту (403 Forbidden). Используйте Personal Access Token ниже (Figma → Settings → Security → Personal access tokens)."
      : "Remote Figma MCP rejected this client (403 Forbidden). Use a Personal Access Token below (Figma → Settings → Security → Personal access tokens).";
  }
  const message = error instanceof Error ? error.message : String(error);
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

