import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import * as vscode from "vscode";
import { resolveUiLanguage } from "../i18n";
import type { ChatTool } from "../openaiClient";
import { connectCustomMcpServer } from "./customClient";
import {
  FIGMA_SERVER_ID,
  FigmaStatusPayload,
  FigmaTransportMode,
  figmaSystemHint,
  isMcpReadonlyTool,
  mcpSystemHint,
  messageHasFigmaUrl,
  parseQualifiedToolName,
  qualifyToolName,
} from "./figma";
import {
  joinMcpToolResult,
  splitMcpToolResult,
  type SplitMcpToolResult,
} from "./resultFormat";
import {
  connectFigmaRemote,
  formatFigmaRemoteError,
  looksLikeCatalogBlockedError,
} from "./httpClient";
import { VsCodeFigmaOAuthProvider } from "./oauthProvider";
import {
  deleteServerSecrets,
  getServerBearerToken,
  getServerSecretEnv,
  normalizeMcpServerConfig,
  readMcpServerConfigs,
  setServerBearerToken,
  setServerSecretEnv,
  writeMcpServerConfigs,
} from "./serversStore";
import { connectFigmaPat } from "./stdioClient";
import {
  formatTransportDetail,
  McpServerConfig,
  McpServerRuntimeStatus,
  qualifyMcpToolName,
  sanitizeMcpServerId,
  slugifyMcpServerId,
} from "./types";

const SECRET_PAT = "agentPanel.figma.pat";
const GLOBAL_MODE_KEY = "agentPanel.figma.transportMode";
const GLOBAL_SHOW_PAT_KEY = "agentPanel.figma.showPatFallback";
const CUSTOM_CONNECT_TIMEOUT_MS = 15_000;
const CUSTOM_LIST_TOOLS_TIMEOUT_MS = 15_000;
const CUSTOM_RETRY_BASE_MS = 5_000;
const CUSTOM_RETRY_MAX_MS = 60_000;

interface ServerRuntime {
  client?: Client;
  tools: ChatTool[];
  status: McpServerRuntimeStatus;
  connectPromise?: Promise<McpServerRuntimeStatus>;
  failureCount: number;
  nextRetryAt: number;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function truncateToolText(text: string): string {
  return text.length > 120_000
    ? `${text.slice(0, 120_000)}\n\n[truncated]`
    : text;
}

export class McpManager {
  /** Figma-specific fields kept for existing UI. */
  private figmaClient: Client | undefined;
  private figmaMode: FigmaTransportMode | undefined;
  private figmaTools: ChatTool[] = [];
  private figmaStatus: FigmaStatusPayload = {
    state: "disconnected",
    enabled: false,
  };
  private figmaConnectPromise: Promise<void> | undefined;

  private customConfigs: McpServerConfig[] = [];
  private customRuntimes = new Map<string, ServerRuntime>();
  private statusListeners = new Set<(status: FigmaStatusPayload) => void>();
  private listListeners = new Set<(servers: McpServerRuntimeStatus[]) => void>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    const enabled = vscode.workspace
      .getConfiguration("agentPanel")
      .get<boolean>("figma.enabled");
    this.figmaStatus.enabled = enabled === true;
    this.figmaStatus.showPatFallback = Boolean(
      this.context.globalState.get(GLOBAL_SHOW_PAT_KEY)
    );
    const savedMode = this.context.globalState.get<string>(GLOBAL_MODE_KEY);
    if (savedMode === "remote" || savedMode === "pat") {
      this.figmaMode = savedMode;
    }
    this.reloadCustomConfigs();
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("agentPanel.mcp.servers") ||
          event.affectsConfiguration("agentPanel.figma.enabled")
        ) {
          void this.handleConfigurationChange();
        }
      })
    );
  }

  reloadCustomConfigs(): void {
    this.customConfigs = readMcpServerConfigs();
    for (const cfg of this.customConfigs) {
      if (!this.customRuntimes.has(cfg.id)) {
        this.customRuntimes.set(cfg.id, {
          tools: [],
          status: this.makeDisconnectedStatus(cfg),
          failureCount: 0,
          nextRetryAt: 0,
        });
      } else {
        const rt = this.customRuntimes.get(cfg.id)!;
        rt.status.name = cfg.name;
        rt.status.enabled = cfg.enabled !== false;
        rt.status.detail = formatTransportDetail(cfg);
        rt.status.transport = cfg.transport;
      }
    }
    for (const id of [...this.customRuntimes.keys()]) {
      if (!this.customConfigs.some((c) => c.id === id)) {
        void this.closeCustomClient(id);
        this.customRuntimes.delete(id);
      }
    }
    this.notifyList();
  }

  getStatus(): FigmaStatusPayload {
    return { ...this.figmaStatus, toolCount: this.figmaTools.length };
  }

  listServerStatuses(): McpServerRuntimeStatus[] {
    const figmaDetail =
      this.figmaMode === "pat"
        ? "stdio · figma-developer-mcp"
        : "http · https://mcp.figma.com/mcp";
    const figma: McpServerRuntimeStatus = {
      id: FIGMA_SERVER_ID,
      name: "Figma",
      enabled: this.figmaStatus.enabled !== false,
      builtin: true,
      transport: this.figmaMode || "remote",
      state: this.figmaStatus.state,
      toolCount: this.figmaTools.length,
      message: this.figmaStatus.message,
      detail: figmaDetail,
      hasCredentials: Boolean(this.figmaStatus.hasPat),
    };
    const customs = this.customConfigs.map((cfg) => {
      const rt = this.customRuntimes.get(cfg.id);
      const base =
        rt?.status || {
          ...this.makeDisconnectedStatus(cfg),
        };
      return {
        ...base,
        command: cfg.command,
        args: cfg.args,
        env: cfg.env,
        cwd: cfg.cwd,
        url: cfg.url,
        transport: cfg.transport,
        detail: formatTransportDetail(cfg),
      };
    });
    return [figma, ...customs];
  }

  getCustomConfig(id: string): McpServerConfig | undefined {
    return this.customConfigs.find((c) => c.id === id);
  }

  async refreshSecretFlags(): Promise<void> {
    const pat = await this.context.secrets.get(SECRET_PAT);
    this.figmaStatus.hasPat = Boolean(pat && pat.trim());
  }

  isConnected(): boolean {
    return (
      (this.figmaStatus.state === "connected" && Boolean(this.figmaClient)) ||
      [...this.customRuntimes.values()].some(
        (rt) => rt.status.state === "connected" && Boolean(rt.client)
      )
    );
  }

  async listOpenAiTools(readonlyOnly = false): Promise<ChatTool[]> {
    await this.tryQuietReconnectAll();
    const tools = [
      ...(this.figmaStatus.enabled !== false &&
      this.figmaStatus.state === "connected"
        ? this.figmaTools
        : []),
      ...[...this.customRuntimes.values()]
        .filter(
          (rt) => rt.status.enabled && rt.status.state === "connected"
        )
        .flatMap((rt) => rt.tools),
    ];
    if (!readonlyOnly) {
      return tools;
    }
    return tools.filter((t) => isMcpReadonlyTool(t.function.name));
  }

  buildSystemHint(toolNames: string[]): string {
    const figmaTools = toolNames.filter((n) =>
      n.startsWith(`mcp__${FIGMA_SERVER_ID}__`)
    );
    return [
      mcpSystemHint(toolNames),
      figmaSystemHint(figmaTools.length > 0, figmaTools),
    ].join("\n");
  }

  async callTool(qualifiedName: string, argsJson: string): Promise<string> {
    const split = await this.callToolWithMedia(qualifiedName, argsJson);
    return joinMcpToolResult(split);
  }

  /**
   * Like callTool, but keeps image payloads as data URLs so the agent loop
   * can run an under-the-hood vision helper without dumping base64 into the
   * main (often non-vision) model context.
   */
  async callToolWithMedia(
    qualifiedName: string,
    argsJson: string
  ): Promise<SplitMcpToolResult> {
    const parsed = parseQualifiedToolName(qualifiedName);
    if (!parsed) {
      return {
        text: JSON.stringify({ error: `Unknown MCP tool: ${qualifiedName}` }),
        imageDataUrls: [],
      };
    }
    let args: Record<string, unknown> = {};
    try {
      args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
    } catch {
      return {
        text: JSON.stringify({ error: "Invalid tool arguments JSON" }),
        imageDataUrls: [],
      };
    }

    if (parsed.serverId === FIGMA_SERVER_ID) {
      if (!this.figmaClient || this.figmaStatus.state !== "connected") {
        await this.tryQuietReconnect();
      }
      if (!this.figmaClient) {
        return {
          text: JSON.stringify({
            error:
              "Figma MCP is not connected. Open Settings → MCP Servers.",
          }),
          imageDataUrls: [],
        };
      }
      return this.invokeClientTool(this.figmaClient, parsed.toolName, args);
    }

    const rt = this.customRuntimes.get(parsed.serverId);
    if (!rt?.client || rt.status.state !== "connected") {
      await this.connectCustom(parsed.serverId);
    }
    const client = this.customRuntimes.get(parsed.serverId)?.client;
    if (!client) {
      return {
        text: JSON.stringify({
          error: `MCP server "${parsed.serverId}" is not connected.`,
        }),
        imageDataUrls: [],
      };
    }
    return this.invokeClientTool(client, parsed.toolName, args);
  }

  private async invokeClientTool(
    client: Client,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<SplitMcpToolResult> {
    try {
      const result = await client.callTool({
        name: toolName,
        arguments: args,
      });
      const split = splitMcpToolResult(result);
      return {
        text: truncateToolText(split.text),
        imageDataUrls: split.imageDataUrls,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        text: JSON.stringify({ error: message }),
        imageDataUrls: [],
      };
    }
  }

  // —— Figma (existing API) ——

  async connectRemoteInteractive(): Promise<FigmaStatusPayload> {
    this.figmaStatus = {
      ...this.figmaStatus,
      state: "connecting",
      mode: "remote",
      message: "Opening Figma authorization…",
    };
    this.notifyStatus();
    this.notifyList();
    try {
      await this.disconnectFigmaClientOnly();
      const client = await connectFigmaRemote({
        secrets: this.context.secrets,
        interactive: true,
      });
      await this.adoptFigmaClient(client, "remote");
      await this.context.globalState.update(GLOBAL_SHOW_PAT_KEY, false);
      this.figmaStatus.showPatFallback = false;
      this.notifyStatus();
      this.notifyList();
      return this.getStatus();
    } catch (error) {
      const catalogBlocked = looksLikeCatalogBlockedError(error);
      const langSetting = vscode.workspace
        .getConfiguration("agentPanel")
        .get<"auto" | "en" | "ru">("language");
      const lang = resolveUiLanguage(
        langSetting === "en" || langSetting === "ru" ? langSetting : "auto"
      );
      const message = formatFigmaRemoteError(error, lang);
      await this.context.globalState.update(GLOBAL_SHOW_PAT_KEY, true);
      this.figmaStatus = {
        state: "error",
        mode: "remote",
        enabled: this.figmaStatus.enabled,
        message,
        showPatFallback: true,
        hasPat: this.figmaStatus.hasPat,
        preferPat: catalogBlocked,
      };
      this.notifyStatus();
      this.notifyList();
      return this.getStatus();
    }
  }

  async connectWithPat(token: string): Promise<FigmaStatusPayload> {
    const trimmed = token.trim();
    if (!trimmed) {
      this.figmaStatus = {
        ...this.figmaStatus,
        state: "error",
        message: "Enter a Figma Personal Access Token",
        showPatFallback: true,
      };
      this.notifyStatus();
      this.notifyList();
      return this.getStatus();
    }
    this.figmaStatus = {
      ...this.figmaStatus,
      state: "connecting",
      mode: "pat",
      message: "Starting local Figma MCP…",
      showPatFallback: true,
    };
    this.notifyStatus();
    this.notifyList();
    try {
      await this.context.secrets.store(SECRET_PAT, trimmed);
      this.figmaStatus.hasPat = true;
      this.figmaStatus.enabled = true;
      await vscode.workspace
        .getConfiguration("agentPanel")
        .update("figma.enabled", true, vscode.ConfigurationTarget.Global);
      await this.disconnectFigmaClientOnly();
      const client = await connectFigmaPat(trimmed);
      await this.adoptFigmaClient(client, "pat");
      this.notifyStatus();
      this.notifyList();
      return this.getStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.figmaStatus = {
        state: "error",
        mode: "pat",
        enabled: this.figmaStatus.enabled,
        message,
        showPatFallback: true,
        hasPat: true,
      };
      this.notifyStatus();
      this.notifyList();
      return this.getStatus();
    }
  }

  async disconnect(): Promise<FigmaStatusPayload> {
    await this.disconnectFigmaClientOnly();
    const oauth = new VsCodeFigmaOAuthProvider(
      this.context.secrets,
      "http://127.0.0.1/unused",
      () => undefined
    );
    await oauth.clearAll();
    try {
      await this.context.secrets.delete(SECRET_PAT);
    } catch {
      // ignore
    }
    await this.context.globalState.update(GLOBAL_MODE_KEY, undefined);
    this.figmaMode = undefined;
    this.figmaStatus = {
      state: "disconnected",
      enabled: this.figmaStatus.enabled,
      showPatFallback: this.figmaStatus.showPatFallback,
      hasPat: false,
      message: undefined,
      toolCount: 0,
    };
    this.notifyStatus();
    this.notifyList();
    return this.getStatus();
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.figmaStatus.enabled = enabled;
    if (!enabled && this.figmaClient) {
      await this.disconnectFigmaClientOnly();
      this.figmaStatus.state = "disconnected";
      this.figmaStatus.message = "Figma MCP disabled";
    } else if (enabled) {
      this.figmaStatus = {
        ...this.figmaStatus,
        state: "connecting",
        message: "Connecting…",
      };
      this.notifyStatus();
      this.notifyList();
      await this.tryQuietReconnect();
    }
    this.notifyStatus();
    this.notifyList();
  }

  async tryQuietReconnect(): Promise<boolean> {
    if (!this.figmaStatus.enabled) {
      return false;
    }
    if (this.figmaStatus.state === "connected" && this.figmaClient) {
      return true;
    }
    if (this.figmaConnectPromise) {
      await this.figmaConnectPromise;
      return this.figmaStatus.state === "connected";
    }
    this.figmaConnectPromise = this.quietReconnectFigma();
    try {
      await this.figmaConnectPromise;
    } finally {
      this.figmaConnectPromise = undefined;
    }
    return this.figmaStatus.state === "connected";
  }

  async tryQuietReconnectAll(): Promise<void> {
    await this.tryQuietReconnect();
    for (const cfg of this.customConfigs) {
      if (cfg.enabled === false) {
        continue;
      }
      const rt = this.customRuntimes.get(cfg.id);
      if (rt?.status.state === "connected") {
        continue;
      }
      try {
        await this.connectCustom(cfg.id);
      } catch {
        // ignore quiet failures
      }
    }
  }

  private async handleConfigurationChange(): Promise<void> {
    const figmaEnabled = vscode.workspace
      .getConfiguration("agentPanel")
      .get<boolean>("figma.enabled");
    const nextFigmaEnabled = figmaEnabled === true;
    if (nextFigmaEnabled !== this.figmaStatus.enabled) {
      this.figmaStatus.enabled = nextFigmaEnabled;
      if (!nextFigmaEnabled) {
        await this.disconnectFigmaClientOnly();
        this.figmaStatus.state = "disconnected";
        this.figmaStatus.message = "Figma MCP disabled";
      } else if (!this.figmaClient) {
        this.figmaStatus.state = "connecting";
        this.figmaStatus.message = "Connecting…";
        void this.tryQuietReconnect();
      }
      this.notifyStatus();
    }

    const previous = new Map(
      this.customConfigs.map((cfg) => [cfg.id, JSON.stringify(cfg)])
    );
    this.reloadCustomConfigs();
    for (const cfg of this.customConfigs) {
      const changed = previous.get(cfg.id) !== JSON.stringify(cfg);
      if (!changed) {
        continue;
      }
      await this.closeCustomClient(cfg.id);
      const rt = this.customRuntimes.get(cfg.id);
      if (rt) {
        rt.tools = [];
        rt.connectPromise = undefined;
        rt.status = this.makeDisconnectedStatus(cfg);
      }
      if (cfg.enabled !== false) {
        void this.connectCustom(cfg.id, { force: true });
      }
    }
    this.notifyList();
  }

  // —— Custom servers ——

  async upsertCustomServer(options: {
    id?: string;
    name: string;
    transport: "stdio" | "http";
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    secretEnv?: Record<string, string>;
    cwd?: string;
    url?: string;
    bearerToken?: string;
    enabled?: boolean;
    connect?: boolean;
  }): Promise<McpServerRuntimeStatus> {
    const name = options.name.trim();
    if (!name) {
      throw new Error("Name is required");
    }
    let id = options.id
      ? sanitizeMcpServerId(options.id)
      : slugifyMcpServerId(name);
    if (!id || id === FIGMA_SERVER_ID) {
      id = slugifyMcpServerId(`${name}-${Date.now().toString(36)}`);
    }
    const existing = this.customConfigs.find((c) => c.id === id);
    const raw: Record<string, unknown> = {
      id,
      name,
      enabled: options.enabled !== false,
      transport: options.transport,
      command: options.command,
      args: options.args,
      env: options.env,
      cwd: options.cwd,
      url: options.url,
    };
    const cfg = normalizeMcpServerConfig(raw, new Set([FIGMA_SERVER_ID]));
    if (!cfg) {
      throw new Error(
        options.transport === "http"
          ? "URL is required for HTTP MCP servers"
          : "Command is required for stdio MCP servers"
      );
    }
    cfg.id = id;
    const next = existing
      ? this.customConfigs.map((c) => (c.id === id ? cfg : c))
      : [...this.customConfigs, cfg];
    await writeMcpServerConfigs(next);
    this.customConfigs = next;

    if (options.secretEnv) {
      await setServerSecretEnv(this.context.secrets, id, options.secretEnv);
    }
    if (options.bearerToken !== undefined) {
      await setServerBearerToken(
        this.context.secrets,
        id,
        options.bearerToken
      );
    }

    if (!this.customRuntimes.has(id)) {
      this.customRuntimes.set(id, {
        tools: [],
        status: this.makeDisconnectedStatus(cfg),
        failureCount: 0,
        nextRetryAt: 0,
      });
    } else {
      const rt = this.customRuntimes.get(id)!;
      rt.status = {
        ...rt.status,
        name: cfg.name,
        enabled: cfg.enabled !== false,
        detail: formatTransportDetail(cfg),
        transport: cfg.transport,
      };
    }

    if (options.connect !== false && cfg.enabled !== false) {
      await this.connectCustom(id, { force: true });
    } else {
      this.notifyList();
    }
    return (
      this.customRuntimes.get(id)?.status || this.makeDisconnectedStatus(cfg)
    );
  }

  async deleteCustomServer(id: string): Promise<void> {
    if (id === FIGMA_SERVER_ID) {
      await this.disconnect();
      return;
    }
    await this.closeCustomClient(id);
    this.customRuntimes.delete(id);
    this.customConfigs = this.customConfigs.filter((c) => c.id !== id);
    await writeMcpServerConfigs(this.customConfigs);
    await deleteServerSecrets(this.context.secrets, id);
    this.notifyList();
  }

  async setCustomEnabled(id: string, enabled: boolean): Promise<void> {
    if (id === FIGMA_SERVER_ID) {
      await this.setEnabled(enabled);
      await vscode.workspace
        .getConfiguration("agentPanel")
        .update("figma.enabled", enabled, vscode.ConfigurationTarget.Global);
      return;
    }
    const cfg = this.customConfigs.find((c) => c.id === id);
    if (!cfg) {
      return;
    }
    cfg.enabled = enabled;
    await writeMcpServerConfigs(this.customConfigs);
    const rt = this.customRuntimes.get(id);
    if (rt) {
      rt.status.enabled = enabled;
    }
    if (!enabled) {
      await this.closeCustomClient(id);
      if (rt) {
        rt.status.state = "disconnected";
        rt.status.message = "Disabled";
        rt.tools = [];
        rt.status.toolCount = 0;
        rt.connectPromise = undefined;
      }
    } else {
      await this.connectCustom(id, { force: true });
    }
    this.notifyList();
  }

  async connectCustom(
    id: string,
    options?: { force?: boolean }
  ): Promise<McpServerRuntimeStatus> {
    const cfg = this.customConfigs.find((c) => c.id === id);
    if (!cfg) {
      throw new Error(`Unknown MCP server: ${id}`);
    }
    let rt = this.customRuntimes.get(id);
    if (!rt) {
      rt = {
        tools: [],
        status: this.makeDisconnectedStatus(cfg),
        failureCount: 0,
        nextRetryAt: 0,
      };
      this.customRuntimes.set(id, rt);
    }
    if (rt.connectPromise) {
      return rt.connectPromise;
    }
    const now = Date.now();
    if (!options?.force && rt.nextRetryAt > now) {
      const waitSeconds = Math.max(
        1,
        Math.ceil((rt.nextRetryAt - now) / 1000)
      );
      rt.status = {
        ...rt.status,
        state: "error",
        message: `Reconnect paused for ${waitSeconds}s after repeated failures.`,
        enabled: cfg.enabled !== false,
      };
      this.notifyList();
      return rt.status;
    }
    rt.connectPromise = this.connectCustomInner(id, cfg, rt);
    try {
      return await rt.connectPromise;
    } finally {
      if (rt.connectPromise) {
        rt.connectPromise = undefined;
      }
    }
  }

  private async connectCustomInner(
    id: string,
    cfg: McpServerConfig,
    rt: ServerRuntime
  ): Promise<McpServerRuntimeStatus> {
    rt.status = {
      ...rt.status,
      state: "connecting",
      message: "Connecting…",
      enabled: cfg.enabled !== false,
    };
    this.notifyList();
    let client: Client | undefined;
    try {
      await this.closeCustomClient(id);
      const bearerToken = await getServerBearerToken(this.context.secrets, id);
      const secretEnv = await getServerSecretEnv(this.context.secrets, id);
      client = await withTimeout(
        connectCustomMcpServer({
          config: cfg,
          bearerToken,
          secretEnv,
        }),
        CUSTOM_CONNECT_TIMEOUT_MS,
        `Connecting MCP server "${cfg.name}"`
      );
      const listed = await withTimeout(
        client.listTools(),
        CUSTOM_LIST_TOOLS_TIMEOUT_MS,
        `Listing tools for "${cfg.name}"`
      );
      const tools = (listed.tools || []).map((tool) => ({
        type: "function" as const,
        function: {
          name: qualifyMcpToolName(id, tool.name),
          description:
            tool.description || `MCP tool ${tool.name} (${cfg.name})`,
          parameters:
            (tool.inputSchema as Record<string, unknown>) ||
            ({ type: "object", properties: {} } as Record<string, unknown>),
        },
      }));
      rt.client = client;
      rt.tools = tools;
      rt.failureCount = 0;
      rt.nextRetryAt = 0;
      rt.status = {
        id,
        name: cfg.name,
        enabled: cfg.enabled !== false,
        builtin: false,
        transport: cfg.transport,
        state: "connected",
        toolCount: tools.length,
        message: "Connected",
        detail: formatTransportDetail(cfg),
      };
      this.notifyList();
      return rt.status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (client) {
        try {
          await client.close();
        } catch {
          // ignore
        }
      }
      rt.client = undefined;
      rt.tools = [];
      rt.failureCount += 1;
      const retryDelay = Math.min(
        CUSTOM_RETRY_MAX_MS,
        CUSTOM_RETRY_BASE_MS * 2 ** Math.max(0, rt.failureCount - 1)
      );
      rt.nextRetryAt = Date.now() + retryDelay;
      rt.status = {
        id,
        name: cfg.name,
        enabled: cfg.enabled !== false,
        builtin: false,
        transport: cfg.transport,
        state: "error",
        toolCount: 0,
        message: `${message} Retry in ${Math.ceil(retryDelay / 1000)}s.`,
        detail: formatTransportDetail(cfg),
      };
      this.notifyList();
      return rt.status;
    }
  }

  private makeDisconnectedStatus(cfg: McpServerConfig): McpServerRuntimeStatus {
    return {
      id: cfg.id,
      name: cfg.name,
      enabled: cfg.enabled !== false,
      builtin: false,
      transport: cfg.transport,
      state: "disconnected",
      toolCount: 0,
      detail: formatTransportDetail(cfg),
    };
  }

  private async quietReconnectFigma(): Promise<void> {
    await this.refreshSecretFlags();
    const hasPat = Boolean(this.figmaStatus.hasPat);
    const preferPat =
      hasPat ||
      this.figmaMode === "pat" ||
      Boolean(this.figmaStatus.preferPat) ||
      Boolean(this.figmaStatus.showPatFallback);

    const tryRemote = async () => {
      const client = await connectFigmaRemote({
        secrets: this.context.secrets,
        interactive: false,
      });
      await this.adoptFigmaClient(client, "remote");
    };
    const tryPat = async () => {
      const pat = await this.context.secrets.get(SECRET_PAT);
      if (!pat?.trim()) {
        throw new Error("No PAT");
      }
      const client = await connectFigmaPat(pat);
      await this.adoptFigmaClient(client, "pat");
    };

    // Harbor Agents is usually blocked on remote Figma MCP (403). Prefer PAT.
    const order = preferPat ? [tryPat, tryRemote] : [tryRemote, tryPat];
    let lastError: unknown;
    for (const attempt of order) {
      try {
        await attempt();
        this.notifyList();
        return;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError && looksLikeCatalogBlockedError(lastError)) {
      const langSetting = vscode.workspace
        .getConfiguration("agentPanel")
        .get<"auto" | "en" | "ru">("language");
      const lang = resolveUiLanguage(
        langSetting === "en" || langSetting === "ru" ? langSetting : "auto"
      );
      this.figmaStatus = {
        ...this.figmaStatus,
        state: "error",
        message: formatFigmaRemoteError(lastError, lang),
        showPatFallback: true,
        preferPat: true,
      };
    } else if (lastError) {
      const message =
        lastError instanceof Error ? lastError.message : String(lastError);
      this.figmaStatus = {
        ...this.figmaStatus,
        state: "error",
        message: message.slice(0, 400),
        showPatFallback: true,
      };
    }
  }

  private async adoptFigmaClient(
    client: Client,
    mode: FigmaTransportMode
  ): Promise<void> {
    this.figmaClient = client;
    this.figmaMode = mode;
    await this.context.globalState.update(GLOBAL_MODE_KEY, mode);
    const listed = await client.listTools();
    this.figmaTools = (listed.tools || []).map((tool) => ({
      type: "function" as const,
      function: {
        name: qualifyToolName(tool.name),
        description: tool.description || `Figma MCP tool: ${tool.name}`,
        parameters:
          (tool.inputSchema as Record<string, unknown>) ||
          ({ type: "object", properties: {} } as Record<string, unknown>),
      },
    }));
    this.figmaStatus = {
      state: "connected",
      mode,
      enabled: true,
      toolCount: this.figmaTools.length,
      message:
        mode === "remote"
          ? "Connected to Figma (remote MCP)"
          : "Connected to Figma (Personal Access Token)",
      showPatFallback: mode === "pat" || this.figmaStatus.showPatFallback,
      hasPat: this.figmaStatus.hasPat,
    };
    await vscode.workspace
      .getConfiguration("agentPanel")
      .update("figma.enabled", true, vscode.ConfigurationTarget.Global);
  }

  private async disconnectFigmaClientOnly(): Promise<void> {
    const client = this.figmaClient;
    this.figmaClient = undefined;
    this.figmaTools = [];
    if (client) {
      try {
        await client.close();
      } catch {
        // ignore
      }
    }
  }

  private async closeCustomClient(id: string): Promise<void> {
    const rt = this.customRuntimes.get(id);
    if (!rt?.client) {
      return;
    }
    const client = rt.client;
    rt.client = undefined;
    rt.tools = [];
    try {
      await client.close();
    } catch {
      // ignore
    }
  }

  onStatus(listener: (status: FigmaStatusPayload) => void): vscode.Disposable {
    this.statusListeners.add(listener);
    return {
      dispose: () => {
        this.statusListeners.delete(listener);
      },
    };
  }

  onServersChanged(
    listener: (servers: McpServerRuntimeStatus[]) => void
  ): vscode.Disposable {
    this.listListeners.add(listener);
    return {
      dispose: () => {
        this.listListeners.delete(listener);
      },
    };
  }

  private notifyStatus(): void {
    const snapshot = this.getStatus();
    for (const listener of this.statusListeners) {
      try {
        listener(snapshot);
      } catch {
        // ignore
      }
    }
  }

  private notifyList(): void {
    const snapshot = this.listServerStatuses();
    for (const listener of this.listListeners) {
      try {
        listener(snapshot);
      } catch {
        // ignore
      }
    }
  }

  dispose(): void {
    void this.disconnectFigmaClientOnly();
    for (const id of [...this.customRuntimes.keys()]) {
      void this.closeCustomClient(id);
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.statusListeners.clear();
    this.listListeners.clear();
  }
}

let singleton: McpManager | undefined;

export function initMcpManager(context: vscode.ExtensionContext): McpManager {
  if (!singleton) {
    singleton = new McpManager(context);
  }
  return singleton;
}

export function getMcpManager(): McpManager | undefined {
  return singleton;
}

export { mcpSystemHint, messageHasFigmaUrl };
