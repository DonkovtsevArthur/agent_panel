/**
 * VS Code implementations of HarborHostPorts (packages/harbor-core).
 *
 * Bridges VS Code ExtensionContext APIs (workspaceState, SecretStorage,
 * workspace configuration) to the host-agnostic port interfaces that
 * HarborCore expects. JetBrains sidecar uses file-backed / memory
 * equivalents — this module is the VS Code counterpart.
 *
 * Types are defined locally (not imported from packages/harbor-core)
 * because tsconfig rootDir is `src/` and cannot reach `packages/`.
 */
import * as vscode from "vscode";

// ─── Port interfaces (mirror packages/harbor-core/src/ports.ts) ─────────────

export interface SecretsPort {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface SettingsPort {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): Promise<void>;
}

export interface WorkspacePort {
  cwd(): string;
  refreshPaths?(paths: string[]): Promise<void> | void;
  openExternal?(url: string): Promise<void> | void;
  openFile?(path: string): Promise<void> | void;
  copyText?(text: string): Promise<void> | void;
  readClipboardText?(): Promise<string> | string;
}

export interface SessionPersistencePort {
  load(): Promise<unknown | undefined>;
  save(store: unknown): Promise<void>;
}

export interface HarborHostPorts {
  secrets: SecretsPort;
  settings: SettingsPort;
  workspace: WorkspacePort;
  session: SessionPersistencePort;
}

/** Key used in workspaceState for the V2 agent store. */
const STORAGE_KEY_V2 = "agentPanel.session.v2";
/** Legacy V1 key — used for migration only. */
const STORAGE_KEY_V1 = "agentPanel.session.v1";

// ─── Session ────────────────────────────────────────────────────────────────

/**
 * Wraps VS Code `workspaceState` as a `SessionPersistencePort`.
 *
 * Matches the contract of `createFileSessionStore` (JetBrains) but
 * persists through VS Code's Memento API instead of a JSON file.
 */
function createVsCodeSessionStore(
  context: vscode.ExtensionContext
): SessionPersistencePort {
  return {
    async load() {
      const v2 = context.workspaceState.get<unknown>(STORAGE_KEY_V2);
      if (v2 !== undefined) {
        return v2;
      }
      // One-shot migration from V1.
      const v1 = context.workspaceState.get<unknown>(STORAGE_KEY_V1);
      if (v1 !== undefined) {
        return v1;
      }
      // Legacy: seed from globalState (one-time, same as loadStore).
      const global = context.globalState.get<unknown>(STORAGE_KEY_V2);
      if (global !== undefined) {
        // Persist into workspace and clear global.
        await context.workspaceState.update(STORAGE_KEY_V2, global);
        void context.globalState.update(STORAGE_KEY_V2, undefined);
        return global;
      }
      return undefined;
    },
    async save(store: unknown) {
      await context.workspaceState.update(STORAGE_KEY_V2, store);
    },
  };
}

// ─── Settings ───────────────────────────────────────────────────────────────

/**
 * Wraps `vscode.workspace.getConfiguration("agentPanel")` as a
 * `SettingsPort`. Read follows VS Code's configuration resolution
 * (default → global → workspace). Write targets global scope.
 */
function createVsCodeSettingsStore(): SettingsPort {
  return {
    get<T = unknown>(key: string): T | undefined {
      const cfg = vscode.workspace.getConfiguration("agentPanel");
      const val = cfg.get<T>(key);
      return val === undefined ? undefined : val;
    },
    async set(key: string, value: unknown): Promise<void> {
      const cfg = vscode.workspace.getConfiguration("agentPanel");
      await cfg.update(key, value, vscode.ConfigurationTarget.Global);
    },
  };
}

// ─── Workspace ──────────────────────────────────────────────────────────────

/**
 * Wraps VS Code workspace APIs as a `WorkspacePort`.
 */
function createVsCodeWorkspacePort(): WorkspacePort {
  return {
    cwd(): string {
      return (
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
      );
    },
    async refreshPaths(paths: string[]): Promise<void> {
      // VS Code auto-detects file changes via the file watcher.
      void paths;
    },
    async openExternal(url: string): Promise<void> {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    },
    async openFile(filePath: string): Promise<void> {
      const uri = vscode.Uri.file(filePath);
      await vscode.window.showTextDocument(uri);
    },
    async copyText(text: string): Promise<void> {
      await vscode.env.clipboard.writeText(text);
    },
    async readClipboardText(): Promise<string> {
      return vscode.env.clipboard.readText();
    },
  };
}

// ─── Secrets ────────────────────────────────────────────────────────────────

/**
 * Wraps VS Code `SecretStorage` as a `SecretsPort`.
 */
function createVsCodeSecretsPort(
  context: vscode.ExtensionContext
): SecretsPort {
  return {
    async get(key: string): Promise<string | undefined> {
      return context.secrets.get(key);
    },
    async set(key: string, value: string): Promise<void> {
      await context.secrets.store(key, value);
    },
    async delete(key: string): Promise<void> {
      await context.secrets.delete(key);
    },
  };
}

// ─── Composite ──────────────────────────────────────────────────────────────

/**
 * Create a complete `HarborHostPorts` for the VS Code extension host.
 *
 * Usage in `extension.ts`:
 * ```ts
 * const ports = createVsCodeHostPorts(context);
 * // ports.session.load() / save() mirrors workspaceState
 * // ports.settings.get() mirrors agentPanel.* configuration
 * // ports.workspace.cwd() returns the first workspace folder
 * ```
 */
export function createVsCodeHostPorts(
  context: vscode.ExtensionContext
): HarborHostPorts {
  return {
    secrets: createVsCodeSecretsPort(context),
    settings: createVsCodeSettingsStore(),
    workspace: createVsCodeWorkspacePort(),
    session: createVsCodeSessionStore(context),
  };
}
