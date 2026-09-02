/**
 * Harbor Figma sidecar — local Node host with Cline under the hood.
 *
 * Figma plugin UI talks HTTP (NDJSON turn stream + toolResult).
 * Canvas tools execute in the Figma plugin; this process only runs Cline.
 *
 * Usage:
 *   node out/figmaSidecar.js
 *   HARBOR_FIGMA_PORT=17891 node out/figmaSidecar.js
 */
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import { HarborHeadless } from "./vscodeHeadlessStub";
import { applyHarborTlsPolicy } from "./tlsPolicy";
import {
  runFigmaClineTurn,
  discardFigmaClineChatSession,
  type FigmaTurnEvent,
} from "./figmaClineTurn";

const DEFAULT_PORT = 17891;

type PendingTool = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ActiveTurn = {
  turnId: string;
  abort: AbortController;
  pendingTools: Map<string, PendingTool>;
};

const activeTurns = new Map<string, ActiveTurn>();

function rejectUnauthorizedFromSettings(
  settings: Record<string, unknown>
): boolean {
  if (typeof settings.rejectUnauthorized === "boolean") {
    return settings.rejectUnauthorized;
  }
  const ap = settings.agentPanel;
  if (ap && typeof ap === "object" && !Array.isArray(ap)) {
    const v = (ap as Record<string, unknown>).rejectUnauthorized;
    if (typeof v === "boolean") {
      return v;
    }
  }
  return true;
}

/** Keep headless getConfig() in sync — harborFetch checks both settings and applied TLS. */
function applyFigmaTlsPolicy(rejectUnauthorized: boolean): void {
  const current = HarborHeadless.getSettings();
  const next: Record<string, unknown> = { ...current };
  const ap =
    next.agentPanel &&
    typeof next.agentPanel === "object" &&
    !Array.isArray(next.agentPanel)
      ? { ...(next.agentPanel as Record<string, unknown>) }
      : {};
  ap.rejectUnauthorized = rejectUnauthorized;
  next.agentPanel = ap;
  next.rejectUnauthorized = rejectUnauthorized;
  HarborHeadless.setSettings(next);
  applyHarborTlsPolicy(rejectUnauthorized);
}

function annotateTlsError(message: string, rejectUnauthorized: boolean): string {
  if (!rejectUnauthorized) {
    return message;
  }
  if (
    !/self[_ -]?signed|SELF_SIGNED_CERT|unable to verify the first certificate|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY/i.test(
      message
    )
  ) {
    return message;
  }
  return (
    message +
    " — Turn off Settings → Advanced → Validate TLS certificate " +
    "(corporate LiteLLM / MITM proxy)."
  );
}

function persistSidecarSettingsFile(
  settingsPath: string,
  rejectUnauthorized: boolean
): void {
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    settings = {};
  }
  const ap =
    settings.agentPanel &&
    typeof settings.agentPanel === "object" &&
    !Array.isArray(settings.agentPanel)
      ? { ...(settings.agentPanel as Record<string, unknown>) }
      : {};
  ap.rejectUnauthorized = rejectUnauthorized;
  settings.agentPanel = ap;
  settings.rejectUnauthorized = rejectUnauthorized;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
  applyFigmaTlsPolicy(rejectUnauthorized);
}

function harborFigmaHome(): string {
  return (
    process.env.HARBOR_FIGMA_HOME ||
    path.join(os.homedir(), ".harbor", "figma")
  );
}

function ensureDirs(): { home: string; workspace: string; settingsPath: string } {
  const home = harborFigmaHome();
  const workspace =
    process.env.HARBOR_FIGMA_WORKSPACE || path.join(home, "workspace");
  const settingsPath = path.join(home, "settings.json");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          agentPanel: {
            rejectUnauthorized: true,
          },
        },
        null,
        2
      ),
      "utf8"
    );
  }
  return { home, workspace, settingsPath };
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as unknown);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(payload);
}

function corsPreflight(res: http.ServerResponse): void {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  });
  res.end();
}

function writeNdjson(res: http.ServerResponse, event: unknown): void {
  res.write(`${JSON.stringify(event)}\n`);
}

function resolvePort(): number {
  const raw = process.env.HARBOR_FIGMA_PORT || process.env.PORT || "";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PORT;
}

async function handleTurn(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const body = (await readJsonBody(req)) as {
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    agentMode?: string;
    text?: string;
    userText?: string;
    history?: Array<{ role: string; text?: string }>;
    selection?: unknown;
    chatId?: string;
    resetSession?: boolean;
    supportsVision?: boolean;
    promptCache?: boolean;
    contextWindow?: number;
    maxOutputTokens?: number;
    rejectUnauthorized?: boolean;
    language?: string;
  };

  const model = String(body.model || "").trim();
  const apiKey = String(body.apiKey || "").trim();
  const baseUrl = String(body.baseUrl || "").trim();
  const userText = String(body.userText || body.text || "").trim();
  if (!model || !baseUrl) {
    sendJson(res, 400, {
      ok: false,
      error: "model and baseUrl are required",
    });
    return;
  }

  const turnId = randomUUID();
  const abort = new AbortController();
  const pendingTools = new Map<string, PendingTool>();
  const turn: ActiveTurn = { turnId, abort, pendingTools };
  activeTurns.set(turnId, turn);

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-Harbor-Turn-Id": turnId,
  });
  writeNdjson(res, { type: "turnStarted", turnId });

  const selection = body.selection as {
    previewPngDataUrl?: string;
  } | null;

  const onEvent = (event: FigmaTurnEvent) => {
    if (event.type === "toolRequest") {
      writeNdjson(res, event);
      return;
    }
    writeNdjson(res, event);
  };

  const invokeTool = (
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> => {
    const requestId = randomUUID();
    const timeoutMs =
      name === "figma_set_prototype_flow" || name === "figma_apply_edits"
        ? 120_000
        : 60_000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingTools.delete(requestId);
        reject(new Error(`Tool timed out: ${name}`));
      }, timeoutMs);
      pendingTools.set(requestId, { resolve, reject, timer });
      writeNdjson(res, {
        type: "toolRequest",
        requestId,
        name,
        args: args || {},
      });
    });
  };

  // Do not abort on HTTP client disconnect — Figma fetch may half-close early.
  // Turns stop only via explicit POST /v1/abort (Stop button).

  const rejectUnauthorized =
    typeof body.rejectUnauthorized === "boolean"
      ? body.rejectUnauthorized
      : rejectUnauthorizedFromSettings(HarborHeadless.getSettings());
  applyFigmaTlsPolicy(rejectUnauthorized);

  try {
    await runFigmaClineTurn({
      model,
      apiKey,
      baseUrl,
      agentMode: body.agentMode,
      userText,
      history: Array.isArray(body.history) ? body.history : [],
      selection: body.selection,
      previewPngDataUrl: selection?.previewPngDataUrl,
      chatId: body.chatId ? String(body.chatId) : undefined,
      resetSession: !!body.resetSession,
      supportsVision:
        typeof body.supportsVision === "boolean"
          ? body.supportsVision
          : undefined,
      promptCache: body.promptCache === true,
      contextWindow:
        typeof body.contextWindow === "number" && body.contextWindow > 0
          ? body.contextWindow
          : undefined,
      maxOutputTokens:
        typeof body.maxOutputTokens === "number" && body.maxOutputTokens > 0
          ? body.maxOutputTokens
          : undefined,
      language: body.language || undefined,
      signal: abort.signal,
      invokeTool,
      onEvent,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!abort.signal.aborted) {
      writeNdjson(res, {
        type: "error",
        message: annotateTlsError(message, rejectUnauthorized),
      });
    } else {
      writeNdjson(res, { type: "done", text: "" });
    }
  } finally {
    for (const pending of pendingTools.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Turn ended"));
    }
    pendingTools.clear();
    activeTurns.delete(turnId);
    res.end();
  }
}

async function handleToolResult(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const body = (await readJsonBody(req)) as {
    turnId?: string;
    requestId?: string;
    result?: unknown;
    error?: string;
  };
  const turnId = String(body.turnId || "");
  const requestId = String(body.requestId || "");
  const turn = activeTurns.get(turnId);
  if (!turn || !requestId) {
    sendJson(res, 404, { ok: false, error: "unknown turn or requestId" });
    return;
  }
  const pending = turn.pendingTools.get(requestId);
  if (!pending) {
    sendJson(res, 404, { ok: false, error: "unknown requestId" });
    return;
  }
  turn.pendingTools.delete(requestId);
  clearTimeout(pending.timer);
  if (body.error) {
    pending.reject(new Error(String(body.error)));
  } else {
    pending.resolve(body.result);
  }
  sendJson(res, 200, { ok: true });
}

async function handleAbort(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const body = (await readJsonBody(req)) as { turnId?: string };
  const turnId = String(body.turnId || "");
  const turn = activeTurns.get(turnId);
  if (turn) {
    turn.abort.abort();
  }
  sendJson(res, 200, { ok: true });
}

/** Written in main() — persisted TLS sync from Figma UI. */
let figmaSidecarSettingsPath = "";

async function handleSyncSettings(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const body = (await readJsonBody(req)) as { rejectUnauthorized?: boolean };
  if (typeof body.rejectUnauthorized !== "boolean") {
    sendJson(res, 400, {
      ok: false,
      error: "rejectUnauthorized boolean is required",
    });
    return;
  }
  if (figmaSidecarSettingsPath) {
    persistSidecarSettingsFile(
      figmaSidecarSettingsPath,
      body.rejectUnauthorized
    );
  } else {
    applyFigmaTlsPolicy(body.rejectUnauthorized);
  }
  sendJson(res, 200, { ok: true });
}

function sidecarBuildMtime(): number {
  try {
    const sidecarPath = path.join(__dirname, "figmaSidecar.js");
    return fs.statSync(sidecarPath).mtimeMs;
  } catch {
    return 0;
  }
}

/** Bundle mtime when this process started — used to detect stale sidecar after rebuild. */
const sidecarStartedBuildMtime = sidecarBuildMtime();

function main(): void {
  const { home, workspace, settingsPath } = ensureDirs();
  figmaSidecarSettingsPath = settingsPath;
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    settings = {};
  }

  HarborHeadless.install({
    workspaceRoot: workspace,
    settings,
    settingsPath,
    storageDir: home,
  });
  applyFigmaTlsPolicy(rejectUnauthorizedFromSettings(settings));

  const port = resolvePort();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    const method = req.method || "GET";

    if (method === "OPTIONS") {
      corsPreflight(res);
      return;
    }

    void (async () => {
      try {
        if (method === "GET" && url.pathname === "/v1/health") {
          sendJson(res, 200, {
            ok: true,
            service: "harbor-figma-sidecar",
            cline: true,
            home,
            workspace,
            port,
            buildMtime: sidecarStartedBuildMtime,
          });
          return;
        }
        if (method === "GET" && url.pathname === "/v1/settings") {
          const current = HarborHeadless.getSettings();
          const ru = rejectUnauthorizedFromSettings(current);
          sendJson(res, 200, { ok: true, rejectUnauthorized: ru });
          return;
        }
        if (method === "POST" && url.pathname === "/v1/turn") {
          await handleTurn(req, res);
          return;
        }
        if (method === "POST" && url.pathname === "/v1/toolResult") {
          await handleToolResult(req, res);
          return;
        }
        if (method === "POST" && url.pathname === "/v1/discardChat") {
          const body = (await readJsonBody(req)) as { chatId?: string };
          await discardFigmaClineChatSession(String(body.chatId || ""));
          sendJson(res, 200, { ok: true });
          return;
        }
        if (method === "POST" && url.pathname === "/v1/abort") {
          await handleAbort(req, res);
          return;
        }
        if (method === "POST" && url.pathname === "/v1/syncSettings") {
          await handleSyncSettings(req, res);
          return;
        }
        sendJson(res, 404, { ok: false, error: "not found" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!res.headersSent) {
          sendJson(res, 500, { ok: false, error: message });
        } else {
          try {
            writeNdjson(res, { type: "error", message });
            res.end();
          } catch {
            /* ignore */
          }
        }
      }
    })();
  });

  server.listen(port, "127.0.0.1", () => {
    // eslint-disable-next-line no-console
    console.log(
      `[harbor-figma] Cline sidecar listening on http://127.0.0.1:${port}`
    );
    // eslint-disable-next-line no-console
    console.log(`[harbor-figma] home=${home}`);
  });
}

main();
