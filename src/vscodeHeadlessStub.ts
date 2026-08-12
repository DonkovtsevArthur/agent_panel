/**
 * Minimal `vscode` module stub for the JetBrains Node sidecar.
 * Injected via esbuild `alias: { vscode: ... }` when bundling harborSidecar.js.
 *
 * Configure via:
 *   HarborHeadless.install({ workspaceRoot, settings, storageDir, settingsPath })
 * Settings mirror VS Code `agentPanel.*` keys (flat dotted get).
 */
import * as fs from "fs";
import * as path from "path";

export type HeadlessSettings = Record<string, unknown>;

type ConfigChangeListener = (event: {
  affectsConfiguration: (section: string) => boolean;
}) => void;

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

type StubUri = {
  fsPath: string;
  path: string;
  scheme: string;
  authority: string;
  query: string;
  fragment: string;
  toString: () => string;
  with: (change?: { path?: string }) => StubUri;
};

function fileUri(fsPath: string): StubUri {
  const normalized = fsPath.replace(/\\/g, "/");
  return {
    fsPath: fsPath,
    path: normalized,
    scheme: "file",
    authority: "",
    query: "",
    fragment: "",
    toString: () => `file://${normalized}`,
    with: (change?: { path?: string }) => fileUri(change?.path || fsPath),
  };
}

function httpUri(value: string): StubUri {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fileUri(value);
  }
  return {
    fsPath: "",
    path: parsed.pathname,
    scheme: parsed.protocol.replace(/:$/, ""),
    authority: parsed.host,
    query: parsed.search.replace(/^\?/, ""),
    fragment: parsed.hash.replace(/^#/, ""),
    toString: () => parsed.toString(),
    with: () => httpUri(value),
  };
}

function readJsonMap(filePath: string): Record<string, unknown> {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
  } catch {
    /* missing */
  }
  return {};
}

function writeJsonMap(filePath: string, value: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* ignore */
  }
}

function setNested(
  root: HeadlessSettings,
  section: string,
  key: string,
  value: unknown
): void {
  if (!section) {
    root[key] = value;
    return;
  }
  const bag =
    root[section] &&
    typeof root[section] === "object" &&
    !Array.isArray(root[section])
      ? ({ ...(root[section] as Record<string, unknown>) } as Record<
          string,
          unknown
        >)
      : ({} as Record<string, unknown>);
  const parts = key.split(".");
  if (parts.length === 1) {
    bag[key] = value;
  } else {
    let cur: Record<string, unknown> = bag;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      const next = cur[p];
      if (!next || typeof next !== "object" || Array.isArray(next)) {
        cur[p] = {};
      }
      cur = cur[p] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = value;
  }
  root[section] = bag;
  if (section === "agentPanel") {
    root[key] = value;
  }
}

class HeadlessConfiguration {
  constructor(
    private readonly section: string,
    private readonly root: HeadlessSettings
  ) {}

  /** UI saveSettings uses camelCase; getConfig often expects dotted keys. */
  private static readonly KEY_ALIASES: Record<string, string[]> = {
    "commitMessage.prompt": ["commitMessagePrompt"],
    "commitMessage.language": ["commitMessageLanguage"],
    "commitMessage.modelId": ["commitMessageModelId"],
    "commitMessage.scope": ["commitMessageScope"],
    "autoglm.enabled": ["autoglmEnabled"],
    "autoglm.browser": ["autoglmBrowser"],
    "autoglm.autoApprove": ["autoglmAutoApprove"],
    "autoglm.binaryPath": ["autoglmBinaryPath"],
    "figma.enabled": ["figmaEnabled"],
    "soundNotifications.enabled": ["soundNotificationsEnabled"],
    "subagents.enabled": ["subagentsEnabled"],
    "parallelToolCalls.enabled": ["parallelToolCallsEnabled"],
    "autoCompact.enabled": ["autoCompactEnabled"],
    "selectionHints.enabled": ["selectionHintsEnabled"],
    "tabAutocomplete.enabled": ["tabAutocompleteEnabled"],
    "tabAutocomplete.modelId": ["tabAutocompleteModelId"],
    "tabAutocomplete.aggressiveness": ["tabAutocompleteAggressiveness"],
    "tabAutocomplete.alternatives": ["tabAutocompleteAlternatives"],
    "tabAutocomplete.excludeGlobs": ["tabAutocompleteExcludeGlobs"],
    "tabAutocomplete.nextEdit": ["tabAutocompleteNextEdit"],
    "tabAutocomplete.showMode": ["tabAutocompleteShowMode"],
    "tabAutocomplete.fim": ["tabAutocompleteFim"],
  };

  /** autoglm.browser → autoglmBrowser */
  private static dottedToCamel(key: string): string {
    const parts = key.split(".");
    if (parts.length < 2) {
      return key;
    }
    return (
      parts[0] +
      parts
        .slice(1)
        .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : ""))
        .join("")
    );
  }

  private lookupAlias(key: string): unknown {
    const aliases = [
      ...(HeadlessConfiguration.KEY_ALIASES[key] || []),
      HeadlessConfiguration.dottedToCamel(key),
    ];
    const seen = new Set<string>();
    const bag =
      this.root[this.section] &&
      typeof this.root[this.section] === "object" &&
      !Array.isArray(this.root[this.section])
        ? (this.root[this.section] as Record<string, unknown>)
        : undefined;
    for (const alias of aliases) {
      if (!alias || seen.has(alias)) {
        continue;
      }
      seen.add(alias);
      if (bag && alias in bag) {
        return bag[alias];
      }
      if (alias in this.root) {
        return this.root[alias];
      }
    }
    return undefined;
  }

  get<T>(key: string, defaultValue?: T): T {
    const full = this.section ? `${this.section}.${key}` : key;
    const sectionObj = this.root[this.section];
    if (
      sectionObj &&
      typeof sectionObj === "object" &&
      !Array.isArray(sectionObj)
    ) {
      const bag = sectionObj as Record<string, unknown>;
      if (key in bag) {
        return bag[key] as T;
      }
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
    if (this.section === "agentPanel" && key in this.root) {
      return this.root[key] as T;
    }
    const aliased = this.lookupAlias(key);
    if (aliased !== undefined) {
      return aliased as T;
    }
    return defaultValue as T;
  }

  async update(key: string, value: unknown, _target?: unknown): Promise<void> {
    setNested(this.root, this.section, key, value);
    if (state.settingsPath) {
      try {
        writeJsonMap(state.settingsPath, this.root);
      } catch {
        /* ignore */
      }
    }
    fireConfigChange(this.section ? `${this.section}.${key}` : key);
  }

  inspect(key: string) {
    const value = this.get(key);
    if (value === undefined) {
      return undefined;
    }
    const scope = String(
      this.get<string>("commitMessageScope") ||
        this.get<string>("commitMessage.scope") ||
        "global"
    ).toLowerCase();
    if (scope === "workspace") {
      return {
        key: this.section ? `${this.section}.${key}` : key,
        workspaceValue: value,
        globalValue: undefined,
      };
    }
    return {
      key: this.section ? `${this.section}.${key}` : key,
      globalValue: value,
      workspaceValue: undefined,
    };
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
}

class FileMemento {
  constructor(private readonly filePath: string) {}

  private read(): Record<string, unknown> {
    return readJsonMap(this.filePath);
  }

  get<T>(key: string, defaultValue?: T): T {
    const bag = this.read();
    return (key in bag ? bag[key] : defaultValue) as T;
  }

  async update(key: string, value: unknown): Promise<void> {
    const bag = this.read();
    if (value === undefined) {
      delete bag[key];
    } else {
      bag[key] = value;
    }
    writeJsonMap(this.filePath, bag);
  }

  keys(): readonly string[] {
    return Object.keys(this.read());
  }
}

class FileSecretStorage {
  private readonly change = new EventEmitter<{ key: string }>();

  constructor(private readonly filePath: string) {}

  private read(): Record<string, string> {
    const bag = readJsonMap(this.filePath);
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(bag)) {
      if (typeof v === "string") {
        out[k] = v;
      }
    }
    return out;
  }

  async get(key: string): Promise<string | undefined> {
    const v = this.read()[key];
    return v === undefined || v === "" ? undefined : v;
  }

  async store(key: string, value: string): Promise<void> {
    const bag = this.read();
    bag[key] = value;
    writeJsonMap(this.filePath, bag);
    this.change.fire({ key });
  }

  async delete(key: string): Promise<void> {
    const bag = this.read();
    if (!(key in bag)) {
      return;
    }
    delete bag[key];
    writeJsonMap(this.filePath, bag);
    this.change.fire({ key });
  }

  get onDidChange() {
    return this.change.event;
  }
}

export type HeadlessExtensionContext = {
  secrets: FileSecretStorage;
  globalState: FileMemento;
  workspaceState: FileMemento;
  subscriptions: Array<{ dispose: () => void }>;
  extensionUri: ReturnType<typeof fileUri>;
  extensionPath: string;
  globalStorageUri: ReturnType<typeof fileUri>;
  storageUri: ReturnType<typeof fileUri>;
  logUri: ReturnType<typeof fileUri>;
};

const state: {
  workspaceRoot: string;
  settings: HeadlessSettings;
  settingsPath: string;
  storageDir: string;
  configListeners: ConfigChangeListener[];
  openExternalHook?: (url: string) => void | Promise<void>;
  extensionContext?: HeadlessExtensionContext;
} = {
  workspaceRoot: process.cwd(),
  settings: {},
  settingsPath: "",
  storageDir: "",
  configListeners: [],
};

function fireConfigChange(section: string): void {
  const event = {
    affectsConfiguration: (query: string) =>
      section === query ||
      section.startsWith(`${query}.`) ||
      query.startsWith(`${section}.`),
  };
  for (const l of state.configListeners) {
    try {
      l(event);
    } catch {
      /* ignore */
    }
  }
}

export const HarborHeadless = {
  install(options: {
    workspaceRoot: string;
    settings?: HeadlessSettings;
    storageDir?: string;
    settingsPath?: string;
  }): void {
    state.workspaceRoot = options.workspaceRoot || process.cwd();
    state.settings = options.settings || {};
    state.settingsPath = options.settingsPath || "";
    state.storageDir =
      options.storageDir ||
      path.join(state.workspaceRoot, ".idea", "harbor");
    fs.mkdirSync(state.storageDir, { recursive: true });
    state.extensionContext = undefined;
  },
  getSettings(): HeadlessSettings {
    return state.settings;
  },
  setSettings(settings: HeadlessSettings): void {
    state.settings = settings || {};
    fireConfigChange("agentPanel");
  },
  workspaceRoot(): string {
    return state.workspaceRoot;
  },
  storageDir(): string {
    return state.storageDir;
  },
  setOpenExternalHook(
    hook: ((url: string) => void | Promise<void>) | undefined
  ): void {
    state.openExternalHook = hook;
  },
  getExtensionContext(): HeadlessExtensionContext {
    if (!state.extensionContext) {
      const dir =
        state.storageDir ||
        path.join(state.workspaceRoot, ".idea", "harbor");
      fs.mkdirSync(dir, { recursive: true });
      state.extensionContext = {
        secrets: new FileSecretStorage(path.join(dir, "secrets.json")),
        globalState: new FileMemento(path.join(dir, "globalState.json")),
        workspaceState: new FileMemento(path.join(dir, "workspaceState.json")),
        subscriptions: [],
        extensionUri: fileUri(dir),
        extensionPath: dir,
        globalStorageUri: fileUri(path.join(dir, "globalStorage")),
        storageUri: fileUri(path.join(dir, "storage")),
        logUri: fileUri(path.join(dir, "logs")),
      };
    }
    return state.extensionContext;
  },
};

export const Uri = {
  file: (p: string) => fileUri(p),
  parse: (value: string) => {
    const raw = String(value || "").trim();
    if (!raw) {
      return fileUri("");
    }
    if (/^https?:\/\//i.test(raw)) {
      return httpUri(raw);
    }
    // Accidental file://https://… from older stub — unwrap.
    const unwrapped = raw.replace(/^file:\/+(?=https?:\/\/)/i, "");
    if (/^https?:\/\//i.test(unwrapped)) {
      return httpUri(unwrapped);
    }
    if (raw.startsWith("file://")) {
      return fileUri(decodeURIComponent(raw.replace(/^file:\/\//, "")));
    }
    return fileUri(raw);
  },
  joinPath: (base: { fsPath: string }, ...parts: string[]) =>
    fileUri(path.join(base.fsPath, ...parts)),
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
    return {
      dispose: () => {
        state.configListeners = state.configListeners.filter(
          (l) => l !== listener
        );
      },
    };
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
    const p = typeof pathOrUri === "string" ? pathOrUri : pathOrUri.fsPath;
    return path.relative(state.workspaceRoot, p) || p;
  },
};

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
  openExternal: async (target: { toString?: () => string } | string) => {
    let url =
      typeof target === "string"
        ? target
        : String(target?.toString?.() || "");
    url = url.trim();
    // Guard against file://https://… (Desktop/BrowserUtil UNC error on macOS).
    url = url.replace(/^file:\/+(?=https?:\/\/)/i, "");
    if (!/^https?:\/\//i.test(url)) {
      return false;
    }
    try {
      await state.openExternalHook?.(url);
      return true;
    } catch {
      return false;
    }
  },
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

export const ProgressLocation = {
  Notification: 15,
  Window: 10,
  SourceControl: 1,
};
export const StatusBarAlignment = { Left: 1, Right: 2 };
export const ViewColumn = { One: 1, Beside: -2 };
export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};
export const EndOfLine = { LF: 1, CRLF: 2 };
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };

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
  ConfigurationTarget,
  EventEmitter,
  HarborHeadless,
};
