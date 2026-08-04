import * as http from "http";
import type { AddressInfo } from "net";

export interface OAuthCallbackResult {
  code: string;
  state?: string | null;
}

/**
 * Ephemeral loopback server for OAuth redirect (MCP DCR-friendly).
 */
export async function listenForOAuthCallback(timeoutMs = 5 * 60_000): Promise<{
  redirectUrl: string;
  waitForCode: () => Promise<OAuthCallbackResult>;
  close: () => Promise<void>;
}> {
  let resolveCode: ((value: OAuthCallbackResult) => void) | undefined;
  let rejectCode: ((error: Error) => void) | undefined;
  let settled = false;

  const codePromise = new Promise<OAuthCallbackResult>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = http.createServer((req, res) => {
    if (!req.url || req.url.startsWith("/favicon")) {
      res.writeHead(404);
      res.end();
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(req.url, "http://127.0.0.1");
    } catch {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }

    const error = parsed.searchParams.get("error");
    const code = parsed.searchParams.get("code");
    const state = parsed.searchParams.get("state");

    if (error) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<html><body><h1>Authorization failed</h1><p>${error}</p><p>You can close this window.</p></body></html>`
      );
      if (!settled) {
        settled = true;
        rejectCode?.(new Error(`OAuth error: ${error}`));
      }
      return;
    }

    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<html><body><h1>Missing authorization code</h1></body></html>"
      );
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<html><body><h1>Connected to Figma</h1><p>You can close this window and return to VS Code.</p><script>setTimeout(()=>window.close(),1500)</script></body></html>"
    );
    if (!settled) {
      settled = true;
      resolveCode?.({ code, state });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // Bind all interfaces so macOS browsers that resolve localhost → ::1 still
    // reach the callback (redirect_uri stays on 127.0.0.1 below).
    server.listen(0, "0.0.0.0", () => resolve());
  });

  const address = server.address() as AddressInfo;
  const redirectUrl = `http://127.0.0.1:${address.port}/callback`;

  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectCode?.(new Error("OAuth timed out — try Connect Figma again"));
    }
  }, timeoutMs);

  const close = async () => {
    clearTimeout(timer);
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  };

  return {
    redirectUrl,
    waitForCode: async () => {
      try {
        return await codePromise;
      } finally {
        clearTimeout(timer);
      }
    },
    close,
  };
}
