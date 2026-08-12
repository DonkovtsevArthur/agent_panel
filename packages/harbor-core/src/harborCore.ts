import type {
  HostToWebview,
  SidecarEventName,
  SidecarMethod,
  WebviewToHost,
} from "./protocol";
import type { HarborHostPorts } from "./ports";

export type CoreEventHandler = (
  event: SidecarEventName,
  params: unknown
) => void;

export interface TurnStartParams {
  model: string;
  text: string;
  agentMode?: string;
  reasoningEffort?: string;
  history?: unknown[];
  attachments?: unknown[];
  workspaceRoot?: string;
}

/**
 * Host-agnostic Harbor core facade.
 *
 * VS Code uses this in-process (see `src/harborCoreInProcess.ts`).
 * JetBrains talks to the same surface via the stdio sidecar.
 *
 * Full Cline turns still run through the VS Code / extension `out/` bundle
 * when `turnRunner` is provided; otherwise turn.start returns a structured
 * "not wired" error (skeleton / smoke).
 */
export type TurnRunner = (
  params: TurnStartParams,
  emit: CoreEventHandler,
  signal: AbortSignal
) => Promise<{ ok: true } | { ok: false; error: string }>;

export class HarborCore {
  private readonly ports: HarborHostPorts;
  private turnRunner?: TurnRunner;
  private activeAbort?: AbortController;
  private emit: CoreEventHandler;

  constructor(
    ports: HarborHostPorts,
    options?: { turnRunner?: TurnRunner; onEvent?: CoreEventHandler }
  ) {
    this.ports = ports;
    this.turnRunner = options?.turnRunner;
    this.emit = options?.onEvent ?? (() => undefined);
  }

  setTurnRunner(runner: TurnRunner | undefined): void {
    this.turnRunner = runner;
  }

  setEventHandler(handler: CoreEventHandler): void {
    this.emit = handler;
  }

  getPorts(): HarborHostPorts {
    return this.ports;
  }

  async handleMethod(
    method: SidecarMethod | string,
    params: unknown
  ): Promise<unknown> {
    switch (method) {
      case "ping":
        return {
          ok: true,
          protocol: 1,
          cwd: this.ports.workspace.cwd(),
        };
      case "session.get":
        return { store: await this.ports.session.load() };
      case "session.save": {
        const store = (params as { store?: unknown })?.store;
        await this.ports.session.save(store);
        return { ok: true };
      }
      case "config.get": {
        const key = (params as { key?: string })?.key;
        if (!key) {
          throw new Error("config.get requires key");
        }
        return { value: this.ports.settings.get(key) };
      }
      case "config.set": {
        const { key, value } = (params as {
          key?: string;
          value?: unknown;
        }) ?? {};
        if (!key) {
          throw new Error("config.set requires key");
        }
        await this.ports.settings.set(key, value);
        return { ok: true };
      }
      case "turn.start":
        return this.startTurn(params as TurnStartParams);
      case "turn.abort":
        this.activeAbort?.abort();
        this.activeAbort = undefined;
        this.emit("turn.idle", { reason: "abort" });
        return { ok: true };
      case "mcp.list":
      case "mcp.refresh":
        return { servers: [] };
      case "commit.andPush":
        return {
          ok: false,
          error:
            "commit.andPush is handled by the IDE host / extension adapter",
        };
      case "commit.message":
        return {
          ok: false,
          error:
            "commit.message is handled by the IDE host / extension adapter",
        };
      case "webview.handle":
        return this.handleWebviewMessage(params as WebviewToHost);
      default:
        throw new Error(`Unknown sidecar method: ${method}`);
    }
  }

  /**
   * Minimal webview routing for JetBrains MVP.
   * VS Code keeps full routing in agentPanelProvider; JB expands this over time.
   */
  async handleWebviewMessage(msg: WebviewToHost): Promise<unknown> {
    if (!msg || typeof msg !== "object" || !("type" in msg)) {
      return { ok: false, error: "invalid message" };
    }

    switch (msg.type) {
      case "ready": {
        const store = await this.ports.session.load();
        this.postToWebview({
          type: "init",
          harborCore: true,
          protocol: 1,
          ide: "jetbrains",
          store: store ?? null,
        });
        if (store) {
          this.postToWebview({
            type: "showChat",
            store,
          } as HostToWebview);
        } else {
          this.postToWebview({ type: "showAgents" });
        }
        return { ok: true };
      }
      case "send":
        return this.startTurn({
          model: String(msg.model ?? ""),
          text: String(msg.text ?? ""),
          agentMode:
            msg.agentMode != null ? String(msg.agentMode) : undefined,
          reasoningEffort:
            msg.reasoningEffort != null
              ? String(msg.reasoningEffort)
              : undefined,
          attachments: Array.isArray(msg.attachments)
            ? msg.attachments
            : undefined,
        });
      case "stop":
        this.activeAbort?.abort();
        this.activeAbort = undefined;
        this.emit("turn.idle", { reason: "stop" });
        this.postToWebview({ type: "stopped" });
        this.postToWebview({ type: "idle" });
        return { ok: true };
      case "openExternal":
        await this.ports.workspace.openExternal?.(String(msg.url ?? ""));
        return { ok: true };
      case "openFile":
        await this.ports.workspace.openFile?.(String(msg.path ?? ""));
        return { ok: true };
      case "copyText":
        await this.ports.workspace.copyText?.(String(msg.text ?? ""));
        this.postToWebview({ type: "copied" });
        return { ok: true };
      case "figmaRefreshStatus":
        this.postToWebview({ type: "figmaStatus", connected: false });
        return { ok: true };
      case "mcpRefreshList":
        this.postToWebview({ type: "mcpServers", servers: [] });
        return { ok: true };
      default:
        // Acknowledge unknown types so the UI does not hang; IDE host may handle.
        return { ok: true, deferred: true, type: msg.type };
    }
  }

  private postToWebview(message: HostToWebview): void {
    this.emit("hostToWebview", message);
  }

  private async startTurn(params: TurnStartParams): Promise<unknown> {
    this.activeAbort?.abort();
    const ac = new AbortController();
    this.activeAbort = ac;

    const workspaceRoot =
      params.workspaceRoot || this.ports.workspace.cwd();

    if (!this.turnRunner) {
      const err =
        "Harbor turn runner is not wired in this process. " +
        "VS Code should set turnRunner via harborCoreInProcess; " +
        "JetBrains sidecar loads the extension turn runner when bundled.";
      this.emit("turn.failed", { error: err });
      this.postToWebview({
        type: "runFailed",
        message: err,
      });
      this.emit("turn.idle", { reason: "failed" });
      return { ok: false, error: err };
    }

    try {
      const result = await this.turnRunner(
        { ...params, workspaceRoot },
        this.emit,
        ac.signal
      );
      if (!result.ok) {
        this.emit("turn.failed", { error: result.error });
        this.postToWebview({
          type: "runFailed",
          message: result.error,
        });
      }
      this.emit("turn.idle", { reason: result.ok ? "done" : "failed" });
      this.postToWebview({ type: "idle" });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit("turn.failed", { error: message });
      this.postToWebview({ type: "runFailed", message });
      this.emit("turn.idle", { reason: "failed" });
      return { ok: false, error: message };
    } finally {
      if (this.activeAbort === ac) {
        this.activeAbort = undefined;
      }
    }
  }
}
