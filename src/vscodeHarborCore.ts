/**
 * VS Code in-process HarborCore facade.
 *
 * Combines VsCodeHostPorts + VsCodeTurnRunner into a single object
 * that agentPanelProvider.ts can use for session management and turn
 * execution, without importing from packages/harbor-core/ (which is
 * outside tsconfig rootDir).
 *
 * This is the VS Code equivalent of the JetBrains sidecar's
 * `startSidecar()` + `HeadlessPanelHost` combo, but in-process.
 */
import * as vscode from "vscode";
import {
  createVsCodeHostPorts,
  type HarborHostPorts,
  type SessionPersistencePort,
} from "./vscodeHostPorts";
import {
  createVsCodeTurnRunner,
  type TurnRunner,
  type TurnStartParams,
  type CoreEventHandler,
} from "./vscodeTurnRunner";
import type { ChatMessage } from "./openaiTypes";
import type { AgentsStoreV2, UiMessage } from "./sessionStore";

// ─── Facade ─────────────────────────────────────────────────────────────────

export interface VsCodeHarborCoreOptions {
  /** Retrieve per-chat history (Cline messages). */
  getHistory?: (chatId: string) => ChatMessage[];
  /** Persist per-chat history after a turn. */
  setHistory?: (chatId: string, history: ChatMessage[]) => void;
  /** Retrieve prior UI messages for session seeding. */
  getPriorUiMessages?: (chatId: string) => UiMessage[];
  /** Retrieve last agent-edited paths. */
  getLastAgentEditedPaths?: (chatId: string) => string[];
  /** Event handler for turn events (step, delta, idle, etc.). */
  onEvent?: CoreEventHandler;
}

export class VsCodeHarborCore {
  readonly ports: HarborHostPorts;
  private turnRunner: TurnRunner;
  private activeAbort?: AbortController;
  private eventHandler: CoreEventHandler;

  constructor(
    context: vscode.ExtensionContext,
    options: VsCodeHarborCoreOptions
  ) {
    this.ports = createVsCodeHostPorts(context);
    this.turnRunner = createVsCodeTurnRunner({
      getHistory: options.getHistory ?? (() => []),
      setHistory: options.setHistory ?? (() => {}),
      getPriorUiMessages: options.getPriorUiMessages,
      getLastAgentEditedPaths: options.getLastAgentEditedPaths,
    });
    this.eventHandler = options.onEvent ?? (() => undefined);
  }

  /** Replace the event handler (e.g. when the webview is re-resolved). */
  setEventHandler(handler: CoreEventHandler): void {
    this.eventHandler = handler;
  }

  /**
   * Update the turn runner's history callbacks. Called by extension.ts
   * after the provider is constructed so the runner reads/writes the
   * provider's live state rather than empty stubs.
   */
  setTurnCallbacks(callbacks: {
    getHistory: (chatId: string) => ChatMessage[];
    setHistory: (chatId: string, history: ChatMessage[]) => void;
    getPriorUiMessages?: (chatId: string) => UiMessage[];
    getLastAgentEditedPaths?: (chatId: string) => string[];
  }): void {
    this.turnRunner = createVsCodeTurnRunner(callbacks);
  }

  // ─── Session persistence ────────────────────────────────────────────────

  /** Load the persisted store from workspaceState. */
  async loadSession(): Promise<unknown | undefined> {
    return this.ports.session.load();
  }

  /** Save the store to workspaceState. */
  async saveSession(store: unknown): Promise<void> {
    return this.ports.session.save(store);
  }

  // ─── Turn execution ─────────────────────────────────────────────────────

  /**
   * Start a turn through the ClineCore pipeline.
   * Equivalent to HarborCore.handleMethod("turn.start", params).
   */
  async startTurn(params: TurnStartParams): Promise<
    { ok: true } | { ok: false; error: string }
  > {
    // Abort any active turn.
    this.activeAbort?.abort();
    const ac = new AbortController();
    this.activeAbort = ac;

    try {
      const result = await this.turnRunner(
        params,
        this.eventHandler,
        ac.signal
      );
      return result;
    } finally {
      if (this.activeAbort === ac) {
        this.activeAbort = undefined;
      }
    }
  }

  /** Abort the currently running turn. */
  abortTurn(): void {
    this.activeAbort?.abort();
    this.activeAbort = undefined;
    this.eventHandler("turn.idle", { reason: "abort" });
  }

  /** Check if a turn is currently running. */
  get isRunning(): boolean {
    return this.activeAbort !== undefined;
  }

  // ─── Workspace helpers ──────────────────────────────────────────────────

  /** Current workspace root directory. */
  cwd(): string {
    return this.ports.workspace.cwd();
  }

  // ─── Settings helpers ───────────────────────────────────────────────────

  /** Read a setting from agentPanel.* configuration. */
  getSetting<T = unknown>(key: string): T | undefined {
    return this.ports.settings.get<T>(key);
  }

  /** Write a setting to agentPanel.* configuration (global scope). */
  async setSetting(key: string, value: unknown): Promise<void> {
    return this.ports.settings.set(key, value);
  }

  // ─── Disposal ───────────────────────────────────────────────────────────

  dispose(): void {
    this.activeAbort?.abort();
    this.activeAbort = undefined;
  }
}
