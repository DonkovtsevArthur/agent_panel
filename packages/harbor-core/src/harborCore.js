"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HarborCore = void 0;
class HarborCore {
    ports;
    turnRunner;
    activeAbort;
    emit;
    constructor(ports, options) {
        this.ports = ports;
        this.turnRunner = options?.turnRunner;
        this.emit = options?.onEvent ?? (() => undefined);
    }
    setTurnRunner(runner) {
        this.turnRunner = runner;
    }
    setEventHandler(handler) {
        this.emit = handler;
    }
    getPorts() {
        return this.ports;
    }
    async handleMethod(method, params) {
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
                const store = params?.store;
                await this.ports.session.save(store);
                return { ok: true };
            }
            case "config.get": {
                const key = params?.key;
                if (!key) {
                    throw new Error("config.get requires key");
                }
                return { value: this.ports.settings.get(key) };
            }
            case "config.set": {
                const { key, value } = params ?? {};
                if (!key) {
                    throw new Error("config.set requires key");
                }
                await this.ports.settings.set(key, value);
                return { ok: true };
            }
            case "turn.start":
                return this.startTurn(params);
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
                    error: "commit.andPush is handled by the IDE host / extension adapter",
                };
            case "commit.message":
                return {
                    ok: false,
                    error: "commit.message is handled by the IDE host / extension adapter",
                };
            case "webview.handle":
                return this.handleWebviewMessage(params);
            default:
                throw new Error(`Unknown sidecar method: ${method}`);
        }
    }
    /**
     * Minimal webview routing for JetBrains MVP.
     * VS Code keeps full routing in agentPanelProvider; JB expands this over time.
     */
    async handleWebviewMessage(msg) {
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
                    });
                }
                else {
                    this.postToWebview({ type: "showAgents" });
                }
                return { ok: true };
            }
            case "send":
                return this.startTurn({
                    model: msg.model,
                    text: msg.text,
                    agentMode: msg.agentMode,
                    reasoningEffort: msg.reasoningEffort,
                    attachments: msg.attachments,
                });
            case "stop":
                this.activeAbort?.abort();
                this.activeAbort = undefined;
                this.emit("turn.idle", { reason: "stop" });
                this.postToWebview({ type: "stopped" });
                this.postToWebview({ type: "idle" });
                return { ok: true };
            case "openExternal":
                await this.ports.workspace.openExternal?.(msg.url);
                return { ok: true };
            case "openFile":
                await this.ports.workspace.openFile?.(msg.path);
                return { ok: true };
            case "copyText":
                await this.ports.workspace.copyText?.(msg.text);
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
    postToWebview(message) {
        this.emit("hostToWebview", message);
    }
    async startTurn(params) {
        this.activeAbort?.abort();
        const ac = new AbortController();
        this.activeAbort = ac;
        const workspaceRoot = params.workspaceRoot || this.ports.workspace.cwd();
        if (!this.turnRunner) {
            const err = "Harbor turn runner is not wired in this process. " +
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
            const result = await this.turnRunner({ ...params, workspaceRoot }, this.emit, ac.signal);
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
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.emit("turn.failed", { error: message });
            this.postToWebview({ type: "runFailed", message });
            this.emit("turn.idle", { reason: "failed" });
            return { ok: false, error: message };
        }
        finally {
            if (this.activeAbort === ac) {
                this.activeAbort = undefined;
            }
        }
    }
}
exports.HarborCore = HarborCore;
//# sourceMappingURL=harborCore.js.map