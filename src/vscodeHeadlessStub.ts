/**
 * Minimal `vscode` module stub for the JetBrains Node sidecar.
 * Injected via esbuild `alias: { vscode: ... }` when bundling harborSidecar.js.
 *
 * Configure via:
 *   HarborHeadless.install({ workspaceRoot, settings })
 * Settings mirror VS Code `agentPanel.*` keys (flat dotted get).
 */
export type HeadlessSettings = Record<string, unknown>;

type ConfigChangeListener = () => void;

class HeadlessConfiguration {
  constructor(private readonly section: string, private readonly root: HeadlessSettings) {}

  get<T>(key: string, defaultValue?: T): T {
    const full = this.section ? `${this.section}.${key}` : key;
    // Prefer nested section object when present: settings.agentPanel[key]
    const sectionObj = this.root[this.section];
    if (sectionObj && typeof sectionObj === "object" && !Array.isArray(sectionObj)) {
      const bag = sectionObj as Record<string, unknown>;
      if (key in bag) {
        return bag[key] as T;
      }
      // dotted within section: soundNotifications.enabled
      const parts = key.split(".");
      let cur: unknown = bag;
      for (const p of parts) {
        if (!cur || typeof cur !== "object") {
          cur = undefined;
          break;
        }
        cur = (cur as Record<string, unknown>)[p];
      }
      if (cur !== undefined) {
        return cur as T;
      }
    }
    if (full in this.root) {
      return this.root[full] as T;
    }
    // Top-level convenience: settings.providers when section is agentPanel
    if (this.section === "agentPanel" && key in this.root) {
      return this.root[key] as T;
    }
    return defaultValue as T;
  }

  async update(): Promise<void> {
    /* no-op in sidecar — persist via Harbor settings file */
  }

  inspect() {
    return undefined;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
}

const state: {
  workspaceRoot: string;
  settings: HeadlessSettings;
  configListeners: ConfigChangeListener[];
} = {
  workspaceRoot: process.cwd(),
  settings: {},
  configListeners: [],
};

export const HarborHeadless = {
  install(options: {
    workspaceRoot: string;
    settings?: HeadlessSettings;
  }): void {
    state.workspaceRoot = options.workspaceRoot || process.cwd();
    state.settings = options.settings || {};
  },
  getSettings(): HeadlessSettings {
    return state.settings;
  },
  setSettings(settings: HeadlessSettings): void {
    state.settings = settings || {};
    for (const l of state.configListeners) {
      try {
        l();
      } catch {
        /* ignore */
      }
    }
  },
  workspaceRoot(): string {
    return state.workspaceRoot;
  },
};

function fileUri(fsPath: string) {
  const normalized = fsPath.replace(/\\/g, "/");
  return {
    fsPath: fsPath,
    path: normalized,
    scheme: "file",
    authority: "",
    query: "",
    fragment: "",
    toString: () => `file://${normalized}`,
    with: (change: { path?: string }) =>
      fileUri(change.path || fsPath),
  };
}

export const Uri = {
  file: (p: string) => fileUri(p),
  parse: (value: string) => {
    if (value.startsWith("file://")) {
      return fileUri(decodeURIComponent(value.replace(/^file:\/\//, "")));
    }
    return fileUri(value);
  },
  joinPath: (base: { fsPath: string }, ...parts: string[]) => {
    const path = require("path") as typeof import("path");
    return fileUri(path.join(base.fsPath, ...parts));
  },
};

export const workspace = {
  workspaceFolders: [
    {
      uri: fileUri(state.workspaceRoot),
      name: "workspace",
      index: 0,
    },
  ] as Array<{ uri: ReturnType<typeof fileUri>; name: string; index: number }>,
  getConfiguration: (section?: string) =>
    new HeadlessConfiguration(section || "", state.settings),
  onDidChangeConfiguration: (listener: ConfigChangeListener) => {
    state.configListeners.push(listener);
    return { dispose: () => undefined };
  },
  fs: {
    readFile: async () => new Uint8Array(),
    writeFile: async () => undefined,
    stat: async () => ({ type: 1, ctime: 0, mtime: 0, size: 0 }),
  },
  findFiles: async () => [],
  openTextDocument: async () => ({
    getText: () => "",
    fileName: "",
    uri: fileUri(""),
    lineCount: 0,
  }),
  getWorkspaceFolder: () => ({
    uri: fileUri(state.workspaceRoot),
    name: "workspace",
    index: 0,
  }),
  asRelativePath: (pathOrUri: string | { fsPath: string }) => {
    const path = require("path") as typeof import("path");
    const p = typeof pathOrUri === "string" ? pathOrUri : pathOrUri.fsPath;
    return path.relative(state.workspaceRoot, p) || p;
  },
};

// Keep workspaceFolders in sync when install() updates root
const _origInstall = HarborHeadless.install.bind(HarborHeadless);
HarborHeadless.install = (options) => {
  _origInstall(options);
  (workspace as { workspaceFolders: unknown }).workspaceFolders = [
    {
      uri: fileUri(state.workspaceRoot),
      name: "workspace",
      index: 0,
    },
  ];
};

export const env = {
  language: process.env.HARBOR_LANG || "en",
  openExternal: async () => true,
  clipboard: {
    writeText: async () => undefined,
    readText: async () => "",
  },
  appName: "HarborSidecar",
  uriScheme: "harbor",
};

export const window = {
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showInputBox: async () => undefined,
  showQuickPick: async () => undefined,
  createOutputChannel: () => ({
    appendLine: () => undefined,
    append: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
    clear: () => undefined,
  }),
  createStatusBarItem: () => ({
    show: () => undefined,
    hide: () => undefined,
    dispose: () => undefined,
    text: "",
  }),
  activeTextEditor: undefined,
  visibleTextEditors: [],
  onDidChangeActiveTextEditor: () => ({ dispose: () => undefined }),
};

export const commands = {
  executeCommand: async () => undefined,
  registerCommand: () => ({ dispose: () => undefined }),
};

export const extensions = {
  getExtension: () => undefined,
  all: [],
};

export const ProgressLocation = { Notification: 15, Window: 10, SourceControl: 1 };
export const StatusBarAlignment = { Left: 1, Right: 2 };
export const ViewColumn = { One: 1, Beside: -2 };
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
export const EndOfLine = { LF: 1, CRLF: 2 };
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  };
  fire(data: T): void {
    for (const l of this.listeners) {
      l(data);
    }
  }
  dispose(): void {
    this.listeners = [];
  }
}

export default {
  Uri,
  workspace,
  env,
  window,
  commands,
  extensions,
  ProgressLocation,
  StatusBarAlignment,
  ViewColumn,
  TreeItemCollapsibleState,
  EndOfLine,
  EventEmitter,
  HarborHeadless,
};
