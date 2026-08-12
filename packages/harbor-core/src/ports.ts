/**
 * Host ports — IDE-specific adapters implement these.
 * VS Code: workspaceState / SecretStorage / vscode.workspace
 * JetBrains: file store / PasswordSafe / VFS
 */

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
  /** Absolute path of the primary workspace folder, or process.cwd(). */
  cwd(): string;
  /** Notify IDE to refresh filesystem after Node-side edits. */
  refreshPaths?(paths: string[]): Promise<void> | void;
  openExternal?(url: string): Promise<void> | void;
  openFile?(path: string): Promise<void> | void;
  copyText?(text: string): Promise<void> | void;
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

export interface MemorySecretsPort extends SecretsPort {
  readonly _map: Map<string, string>;
}

export function createMemorySecrets(): MemorySecretsPort {
  const map = new Map<string, string>();
  return {
    _map: map,
    async get(key) {
      return map.get(key);
    },
    async set(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

export function createMemorySettings(
  initial: Record<string, unknown> = {}
): SettingsPort {
  const data = { ...initial };
  return {
    get<T>(key: string) {
      return data[key] as T | undefined;
    },
    async set(key, value) {
      data[key] = value;
    },
  };
}
