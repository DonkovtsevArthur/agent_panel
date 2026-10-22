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
  LEGACY_FIGMA_DATA_BLOCKED_JSON,
  prepareFigmaToolArgs,
  qualifyToolName,
  shouldHideLegacyFigmaDataTool,
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
import {
  createConfluenceNativeClient,
  CONFLUENCE_NATIVE_COMMAND,
  CONFLUENCE_NATIVE_TOOLS,
  CONFLUENCE_NATIVE_WRITE_TOOLS,
} from "./confluenceNative";
import {
  compactAtlassianToolDefs,
  resolveAtlassianDispatch,
  type AtlassianToolDef,
} from "./atlassianCompact";
import {
  ATLASSIAN_PRODUCTS,
  atlassianProductOf,
  detectJiraTokenSourceEnv,
  JIRA_TLS_HINT_EN,
  looksLikeTlsError,
  splitSecretEnv,
  writeJiraAgentFiles,
  type AtlassianProduct,
} from "./jiraAgentRules";
import { prepareJiraConnection, type JiraPreflightResult } from "./jiraConnect";
import { removeMcpServerRules, writeMcpServerRules } from "./mcpAgentRules";
import { compactMcpServerTools, resolveMcpDispatch } from "./toolsOnDemand";
import {
  createJiraNativeClient,
  JIRA_NATIVE_COMMAND,
  JIRA_NATIVE_TOOLS,
  JIRA_NATIVE_WRITE_TOOLS,
} from "./jiraNative";
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
/** One-time switch of preset `uvx mcp-atlassian` Jira servers to built-in. */
const JIRA_NATIVE_MIGRATED_KEY = "agentPanel.jira.nativeMigrated";
/** First `uvx mcp-atlassian` run downloads the package — allow more time. */
const JIRA_CONNECT_TIMEOUT_MS = 120_000;
const CUSTOM_LIST_TOOLS_TIMEOUT_MS = 15_000;
const CUSTOM_RETRY_BASE_MS = 5_000;
const CUSTOM_RETRY_MAX_MS = 60_000;
/**
 * After a failed lazy Figma connect, skip further attempts for this long so a
 * blocked corporate network does not re-stall every figma-linked turn. Reset
 * on successful connect, configuration change, and manual connect.
 */
const FIGMA_RECONNECT_COOLDOWN_MS = 5 * 60_000;
/** Hard bound for a lazy Figma connect attempt inside an agent turn. */
const FIGMA_ENSURE_TIMEOUT_MS = 10_000;

interface ServerRuntime {
  client?: Client;
  tools: ChatTool[];
  status: McpServerRuntimeStatus;
  connectPromise?: Promise<McpServerRuntimeStatus>;
  failureCount: number;
  nextRetryAt: number;
  /** Last successful Jira pre-flight (CA bundle / host pin facts). */
  jira?: JiraPreflightResult;
  /** File that got this server's `harbor:mcp:<id>` rule block on the last connect. */
  agentRulesFile?: string;
}

function jiraCheckFailedNotice(detail: string, label = "Jira"): string {
  const base =
    `${label} MCP started, but the token check failed — ${label} rule not written. ${detail}`.slice(
      0,
      400
    );
  return looksLikeTlsError(detail) ? `${base} ${JIRA_TLS_HINT_EN}` : base;
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

/** Static tool definitions of a built-in Jira / Confluence server. */
function nativeAtlassianTools(
  cfg: McpServerConfig
):
  | { prefix: string; defs: AtlassianToolDef[]; writes: ReadonlySet<string> }
  | undefined {
  if (!isNativeAtlassianConfig(cfg)) {
    return undefined;
  }
  return cfg.command === CONFLUENCE_NATIVE_COMMAND
    ? {
        prefix: "confluence",
        defs: CONFLUENCE_NATIVE_TOOLS,
        writes: CONFLUENCE_NATIVE_WRITE_TOOLS,
      }
    : { prefix: "jira", defs: JIRA_NATIVE_TOOLS, writes: JIRA_NATIVE_WRITE_TOOLS };
}

type McpOnDemandMode = {
  onDemand: boolean;
  atlassianOnDemand: boolean;
  lazy: boolean;
};

function atlassianChatTools(
  serverId: string,
  native: { prefix: string; defs: AtlassianToolDef[]; writes: ReadonlySet<string> },
  onDemand: boolean,
  lazy = false
): ChatTool[] {
  const defs = onDemand
    ? compactAtlassianToolDefs(native.prefix, native.defs, native.writes, {
        lazy,
      })
    : native.defs;
  return defs.map((tool) => ({
    type: "function" as const,
    function: {
      name: qualifyMcpToolName(serverId, tool.name),
      description: tool.description,
      parameters: tool.inputSchema as Record<string, unknown>,
    },
  }));
}

/** Built-in Jira / Confluence (in-process REST client, static tool list). */
function isNativeAtlassianConfig(cfg: McpServerConfig): boolean {
  const product = atlassianProductOf(cfg);
  return Boolean(
    product && cfg.command === ATLASSIAN_PRODUCTS[product].nativeCommand
  );
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
  /** Skips lazy Figma connects until this timestamp (see FIGMA_RECONNECT_COOLDOWN_MS). */
  private figmaCooldownUntil = 0;

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

  /** Jira server ids that have a PAT in SecretStorage (for the edit form). */
  private jiraTokenIds = new Set<string>();

  /**
   * Move secret env values of Jira servers out of settings.json into
   * SecretStorage (older saves / tokens typed under an unknown key), and
   * refresh which servers have a saved PAT.
   */
  private async migrateJiraSecretEnv(): Promise<void> {
    let changed = false;
    const next: McpServerConfig[] = [];
    const tokenIds = new Set<string>();
    const migrateNative = !this.context.globalState.get<boolean>(JIRA_NATIVE_MIGRATED_KEY);
    for (const original of this.customConfigs) {
      let cfg = original;
      const product = atlassianProductOf(cfg);
      if (!product) {
        next.push(cfg);
        continue;
      }
      // Preset `uvx mcp-atlassian` → built-in REST client (once; a user who
      // switches back under "Advanced" keeps mcp-atlassian).
      if (
        migrateNative &&
        product === "jira" &&
        /(^|[\\/])uvx(\.exe)?$/i.test(cfg.command || "") &&
        (cfg.args || []).join(" ").trim() === "mcp-atlassian"
      ) {
        cfg = { ...cfg, command: JIRA_NATIVE_COMMAND, args: [] };
        changed = true;
      }
      const split = splitSecretEnv(cfg.env);
      let secretEnv = await getServerSecretEnv(this.context.secrets, cfg.id);
      if (Object.keys(split.secretEnv).length) {
        secretEnv = { ...secretEnv, ...split.secretEnv };
        await setServerSecretEnv(this.context.secrets, cfg.id, secretEnv);
        next.push({ ...cfg, env: split.env });
        changed = true;
      } else {
        next.push(cfg);
      }
      if (secretEnv[ATLASSIAN_PRODUCTS[product].tokenEnv]) {
        tokenIds.add(cfg.id);
      }
    }
    this.jiraTokenIds = tokenIds;
    if (migrateNative) {
      await this.context.globalState.update(JIRA_NATIVE_MIGRATED_KEY, true);
    }
    if (changed) {
      this.customConfigs = next;
      await writeMcpServerConfigs(next);
    }
    this.notifyList();
  }

  reloadCustomConfigs(): void {
    this.customConfigs = readMcpServerConfigs();
    void this.migrateJiraSecretEnv();
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
        ...(atlassianProductOf(cfg)
          ? { hasSecretToken: this.jiraTokenIds.has(cfg.id) }
          : {}),
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

  /**
   * Wait (bounded) for enabled custom servers that are still connecting or
   * were never tried — right after a window reload the first turn otherwise
   * starts before e.g. the Jira pre-flight finishes and the model is told
   * "Jira is not connected". Servers in error / retry backoff are not awaited.
   */
  async awaitPendingCustomServers(timeoutMs = 20_000): Promise<void> {
    const pending: Promise<unknown>[] = [];
    for (const cfg of this.customConfigs) {
      if (cfg.enabled === false) {
        continue;
      }
      const rt = this.customRuntimes.get(cfg.id);
      if (rt?.status.state === "connected") {
        continue;
      }
      if (isNativeAtlassianConfig(cfg)) {
        // Static tool list (listOpenAiTools) — start the pre-flight in the
        // background instead of holding the turn for it (3–15s after reload).
        if (
          !rt?.connectPromise &&
          (!rt || (rt.status.state === "disconnected" && rt.failureCount === 0))
        ) {
          void this.connectCustom(cfg.id).catch(() => undefined);
        }
        continue;
      }
      if (rt?.connectPromise) {
        pending.push(rt.connectPromise.catch(() => undefined));
      } else if (!rt || (rt.status.state === "disconnected" && rt.failureCount === 0)) {
        pending.push(this.connectCustom(cfg.id).catch(() => undefined));
      }
    }
    if (!pending.length) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled(pending),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
    if (timer) {
      clearTimeout(timer);
    }
  }

  async listOpenAiTools(readonlyOnly = false): Promise<ChatTool[]> {
    // Snapshot of *currently connected* servers only. Healing is kicked off
    // in the background (custom servers have their own retry backoff); Figma
    // never reconnects here — its remote attempt is unbounded on blocked
    // corporate networks and must not stall the per-turn fingerprint. Figma
    // connects lazily via ensureFigmaConnected on turns that reference a
    // Figma URL, plus explicit activation / Settings paths.
    void this.healCustomServers();
    return this.collectOpenAiTools(readonlyOnly, this.onDemandMode());
  }

  /** Settings → how MCP tools are sent (see toolsOnDemand.ts / atlassianCompact.ts). */
  private onDemandMode(): McpOnDemandMode {
    const lazy = this.mcpLazyTools();
    return {
      // Lazy implies on demand — it is a stricter form of the same dispatchers.
      onDemand: lazy || this.mcpToolsOnDemand(),
      atlassianOnDemand: lazy || this.atlassianToolsOnDemand(),
      lazy,
    };
  }

  /**
   * Full schemas hidden behind `<server>_read` / `_write` dispatchers (tools
   * on demand) — not sent with requests; the «Context» popover lists them as
   * deferred.
   */
  listDeferredOpenAiTools(readonlyOnly = false): ChatTool[] {
    const sent = new Set(
      this.collectOpenAiTools(readonlyOnly, this.onDemandMode()).map(
        (t) => t.function.name
      )
    );
    return this.collectOpenAiTools(readonlyOnly, {
      onDemand: false,
      atlassianOnDemand: false,
      lazy: false,
    }).filter((t) => !sent.has(t.function.name));
  }

  private collectOpenAiTools(
    readonlyOnly: boolean,
    mode: McpOnDemandMode
  ): ChatTool[] {
    const { onDemand, atlassianOnDemand, lazy } = mode;
    const serverTools = (id: string, list: ChatTool[]): ChatTool[] =>
      onDemand ? compactMcpServerTools(id, list, { lazy }) : list;
    const tools = [
      ...(this.figmaStatus.enabled !== false &&
      this.figmaStatus.state === "connected"
        ? serverTools(FIGMA_SERVER_ID, this.visibleFigmaTools())
        : []),
      ...[...this.customRuntimes.entries()]
        .filter(
          ([, rt]) => rt.status.enabled && rt.status.state === "connected"
        )
        .flatMap(([id, rt]) => {
          const cfg = this.customConfigs.find((c) => c.id === id);
          const native = cfg ? nativeAtlassianTools(cfg) : undefined;
          if (native) {
            return atlassianOnDemand
              ? atlassianChatTools(id, native, true, lazy)
              : rt.tools;
          }
          return serverTools(id, rt.tools);
        }),
      ...this.nativeToolsWhileConnecting(mode),
    ];
    if (!readonlyOnly) {
      return tools;
    }
    return tools.filter((t) => isMcpReadonlyTool(t.function.name));
  }

  /**
   * Built-in Jira / Confluence tools are static, so list them while the
   * pre-flight (token probe, CA export, VPN DNS) is still running — the turn
   * does not wait for it and the session tool set (fingerprint) stays the same
   * once it connects. A call made before then waits in callToolRaw →
   * connectCustom. Servers in error / backoff are left out, as before.
   */
  private nativeToolsWhileConnecting(
    mode: McpOnDemandMode = this.onDemandMode()
  ): ChatTool[] {
    const out: ChatTool[] = [];
    for (const cfg of this.customConfigs) {
      if (cfg.enabled === false || !isNativeAtlassianConfig(cfg)) {
        continue;
      }
      const rt = this.customRuntimes.get(cfg.id);
      const state = rt?.status.state;
      if (state === "connected" || state === "error" || (rt?.failureCount ?? 0) > 0) {
        continue;
      }
      const native = nativeAtlassianTools(cfg);
      if (native) {
        out.push(
          ...atlassianChatTools(
            cfg.id,
            native,
            mode.atlassianOnDemand,
            mode.lazy
          )
        );
      }
    }
    return out;
  }

  /** Figma tools without the legacy data tool hidden next to Dev Mode tools. */
  private visibleFigmaTools(): ChatTool[] {
    const figmaCatalog = this.figmaTools.map((t) => t.function.name);
    return this.figmaTools.filter(
      (t) => !shouldHideLegacyFigmaDataTool(t.function.name, figmaCatalog)
    );
  }

  /** `agentPanel.mcp.lazyTools` (default on) — names-only dispatchers for every server. */
  private mcpLazyTools(): boolean {
    return (
      vscode.workspace
        .getConfiguration("agentPanel")
        .get<boolean>("mcp.lazyTools") !== false
    );
  }

  /** `agentPanel.mcp.toolsOnDemand` (default on) — Figma / custom servers, see toolsOnDemand.ts. */
  private mcpToolsOnDemand(): boolean {
    return (
      vscode.workspace
        .getConfiguration("agentPanel")
        .get<boolean>("mcp.toolsOnDemand") !== false
    );
  }

  /** `agentPanel.mcp.atlassianToolsOnDemand` (default on) — see atlassianCompact.ts. */
  private atlassianToolsOnDemand(): boolean {
    return (
      vscode.workspace
        .getConfiguration("agentPanel")
        .get<boolean>("mcp.atlassianToolsOnDemand") !== false
    );
  }

  buildSystemHint(toolNames: string[]): string {
    const sentFigma = toolNames.filter((n) =>
      n.startsWith(`mcp__${FIGMA_SERVER_ID}__`)
    );
    // Lazy mode sends only figma_read / figma_write — the hint still names the
    // real tools (get_design_context…); the dispatcher routes them.
    const figmaTools =
      sentFigma.length && this.onDemandMode().lazy
        ? this.visibleFigmaTools().map((t) => t.function.name)
        : sentFigma;
    const lazyFigma =
      figmaTools !== sentFigma
        ? `Figma tools above are called through ${sentFigma.join(" / ")} with { tool, arguments }; describe: true returns a tool's schema.`
        : "";
    return [
      mcpSystemHint(toolNames),
      figmaSystemHint(figmaTools.length > 0, figmaTools),
      lazyFigma,
    ]
      .filter(Boolean)
      .join("\n");
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
    const raw = await this.callToolRaw(qualifiedName, argsJson);
    if (raw && typeof raw === "object" && "error" in (raw as object)) {
      const err = String((raw as { error?: unknown }).error || "").trim();
      if (err) {
        return { text: JSON.stringify({ error: err }), imageDataUrls: [] };
      }
    }
    const split = splitMcpToolResult(raw);
    return {
      text: truncateToolText(split.text),
      imageDataUrls: split.imageDataUrls,
    };
  }

  /**
   * Raw MCP CallToolResult for Cline createMcpTools (preserves image content).
   */
  async callToolRaw(
    qualifiedName: string,
    argsJson: string
  ): Promise<unknown> {
    const parsed = parseQualifiedToolName(qualifiedName);
    if (!parsed) {
      return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown MCP tool: ${qualifiedName}` }) }] };
    }
    let args: Record<string, unknown> = {};
    try {
      args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
    } catch {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Invalid tool arguments JSON" }),
          },
        ],
      };
    }

    if (parsed.serverId === FIGMA_SERVER_ID) {
      if (!this.figmaClient || this.figmaStatus.state !== "connected") {
        await this.tryQuietReconnect();
      }
      // Tools on demand: `figma_read` / `figma_write` run the inner tool, so
      // the legacy-tool guard and arg patching below see its real name.
      let figmaToolName = parsed.toolName;
      const mode = this.onDemandMode();
      if (mode.onDemand) {
        const dispatch = resolveMcpDispatch(
          FIGMA_SERVER_ID,
          parsed.toolName,
          args,
          this.visibleFigmaTools(),
          { lazy: mode.lazy }
        );
        if (dispatch.kind === "result") {
          return { content: [{ type: "text", text: dispatch.text }] };
        }
        if (dispatch.kind === "call") {
          figmaToolName = dispatch.tool;
          args = dispatch.args;
        }
      }
      const figmaCatalog = this.figmaTools.map((t) => t.function.name);
      if (shouldHideLegacyFigmaDataTool(figmaToolName, figmaCatalog)) {
        return {
          content: [{ type: "text", text: LEGACY_FIGMA_DATA_BLOCKED_JSON }],
        };
      }
      if (!this.figmaClient) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error:
                  "Figma MCP is not connected. Open Settings → MCP Servers.",
              }),
            },
          ],
        };
      }
      return this.invokeClientToolRaw(
        this.figmaClient,
        figmaToolName,
        prepareFigmaToolArgs(figmaToolName, args)
      );
    }

    const rt = this.customRuntimes.get(parsed.serverId);
    if (!rt?.client || rt.status.state !== "connected") {
      await this.connectCustom(parsed.serverId);
    }
    const client = this.customRuntimes.get(parsed.serverId)?.client;
    // Built-in Jira / Confluence on demand: `<product>_read` / `_write`
    // dispatchers run the inner tool (or return its schema).
    const nativeCfg = this.customConfigs.find((c) => c.id === parsed.serverId);
    const native = nativeCfg ? nativeAtlassianTools(nativeCfg) : undefined;
    let toolName = parsed.toolName;
    const mode = this.onDemandMode();
    if (native) {
      const dispatch = resolveAtlassianDispatch(
        native.prefix,
        parsed.toolName,
        args,
        native.defs,
        native.writes,
        { lazy: mode.lazy }
      );
      if (dispatch.kind === "result") {
        return { content: [{ type: "text", text: dispatch.text }] };
      }
      if (dispatch.kind === "call") {
        toolName = dispatch.tool;
        args = dispatch.args;
      }
    } else if (mode.onDemand) {
      // Any other server: `<server>_read` / `_write` dispatchers.
      const dispatch = resolveMcpDispatch(
        parsed.serverId,
        parsed.toolName,
        args,
        this.customRuntimes.get(parsed.serverId)?.tools || [],
        { lazy: mode.lazy }
      );
      if (dispatch.kind === "result") {
        return { content: [{ type: "text", text: dispatch.text }] };
      }
      if (dispatch.kind === "call") {
        toolName = dispatch.tool;
        args = dispatch.args;
      }
    }
    if (!client) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `MCP server "${parsed.serverId}" is not connected.`,
            }),
          },
        ],
      };
    }
    return this.invokeClientToolRaw(client, toolName, args);
  }

  private async invokeClientToolRaw(
    client: Client,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    try {
      return await client.callTool({
        name: toolName,
        arguments: args,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          { type: "text", text: JSON.stringify({ error: message }) },
        ],
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

  /**
   * Lazy Figma connect for agent turns whose prompt references a Figma URL.
   * Bounded by timeout and cooled down after failures; a blocked network must
   * not stall the turn for the OS TCP timeout on every figma-linked message.
   */
  async ensureFigmaConnected(timeoutMs = FIGMA_ENSURE_TIMEOUT_MS): Promise<boolean> {
    if (!this.figmaStatus.enabled) {
      return false;
    }
    if (this.figmaStatus.state === "connected" && this.figmaClient) {
      return true;
    }
    if (Date.now() < this.figmaCooldownUntil) {
      return false;
    }
    try {
      await withTimeout(
        this.tryQuietReconnect(),
        timeoutMs,
        "Figma lazy connect"
      );
    } catch {
      // timed out or failed — cooldown below
    }
    if (this.figmaStatus.state === "connected") {
      this.figmaCooldownUntil = 0;
      return true;
    }
    this.figmaCooldownUntil = Date.now() + FIGMA_RECONNECT_COOLDOWN_MS;
    return false;
  }

  /** Kick reconnects for enabled-but-disconnected custom servers without waiting. */
  private healCustomServers(): void {
    for (const cfg of this.customConfigs) {
      if (cfg.enabled === false) {
        continue;
      }
      const rt = this.customRuntimes.get(cfg.id);
      if (rt?.status.state === "connected") {
        continue;
      }
      void this.connectCustom(cfg.id).catch(() => {
        // quiet failures — status already reflects the retry backoff
      });
    }
  }

  private async handleConfigurationChange(): Promise<void> {
    const figmaEnabled = vscode.workspace
      .getConfiguration("agentPanel")
      .get<boolean>("figma.enabled");
    const nextFigmaEnabled = figmaEnabled === true;
    if (nextFigmaEnabled !== this.figmaStatus.enabled) {
      this.figmaStatus.enabled = nextFigmaEnabled;
      // Fresh configuration invalidates the lazy-connect cooldown.
      this.figmaCooldownUntil = 0;
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
    /** Jira PAT from the dedicated form field; empty keeps the saved one. */
    jiraToken?: string;
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
    const product = atlassianProductOf(options);
    const isJira = Boolean(product);
    let env = options.env;
    let secretEnv = options.secretEnv;
    if (product) {
      // Jira / Confluence PAT goes to SecretStorage, never into settings / AGENTS.md.
      const tokenEnv = ATLASSIAN_PRODUCTS[product].tokenEnv;
      const split = splitSecretEnv(options.env);
      env = split.env;
      const jiraToken = String(options.jiraToken || "").trim();
      if (jiraToken) {
        split.secretEnv[tokenEnv] = jiraToken;
      }
      if (Object.keys(split.secretEnv).length) {
        secretEnv = {
          ...(await getServerSecretEnv(this.context.secrets, id)),
          ...(options.secretEnv || {}),
          ...split.secretEnv,
        };
      }
      if (secretEnv?.[tokenEnv]) {
        this.jiraTokenIds.add(id);
      }
    }
    const raw: Record<string, unknown> = {
      id,
      name,
      enabled: options.enabled !== false,
      transport: options.transport,
      command: options.command,
      args: options.args,
      env,
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

    if (secretEnv) {
      await setServerSecretEnv(this.context.secrets, id, secretEnv);
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
    const status =
      this.customRuntimes.get(id)?.status || this.makeDisconnectedStatus(cfg);
    if (product && status.state === "connected") {
      return { ...status, notice: await this.writeJiraAgentRules(id, cfg, product) };
    }
    if (isJira && looksLikeTlsError(status.message || "")) {
      return { ...status, notice: JIRA_TLS_HINT_EN };
    }
    const rulesFile = this.customRuntimes.get(id)?.agentRulesFile;
    if (status.state === "connected" && rulesFile) {
      return { ...status, notice: `MCP rule written: ${rulesFile}.` };
    }
    return status;
  }

  private agentRulesEnabled(): boolean {
    return (
      vscode.workspace
        .getConfiguration("agentPanel")
        .get<boolean>("mcp.agentRules.enabled") !== false
    );
  }

  /**
   * Record what a connected custom server is for in the workspace AGENTS.md
   * (`harbor:mcp:<id>` block). Jira / Confluence have their own verified
   * block (writeJiraAgentRules). Idempotent: unchanged content is not rewritten.
   */
  private writeServerAgentRules(
    cfg: McpServerConfig,
    rt: ServerRuntime,
    tools: { name: string; description?: string }[],
    instructions: string | undefined
  ): void {
    rt.agentRulesFile = undefined;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root || atlassianProductOf(cfg) || !this.agentRulesEnabled()) {
      return;
    }
    try {
      const result = writeMcpServerRules(root, {
        id: cfg.id,
        name: cfg.name,
        transport: cfg.transport,
        command: cfg.command,
        args: cfg.args,
        url: cfg.url,
        instructions,
        tools,
      });
      rt.agentRulesFile = result.file;
    } catch {
      // Read-only workspace / permissions — the server still works without the rule.
    }
  }

  private removeServerAgentRules(id: string): void {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root || !this.agentRulesEnabled()) {
      return;
    }
    try {
      removeMcpServerRules(root, id);
    } catch {
      // ignore
    }
  }

  /**
   * After the user connects Jira: check that the PAT actually reads issues,
   * then record how to connect in AGENTS.md + MCP configs for other agent
   * tools. Returns a short user-facing notice.
   */
  private async writeJiraAgentRules(
    id: string,
    cfg: McpServerConfig,
    product: AtlassianProduct = "jira"
  ): Promise<string> {
    const spec = ATLASSIAN_PRODUCTS[product];
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const url = String(cfg.env?.[spec.urlEnv] || "").trim();
    if (!root || !url) {
      return `${spec.label} connected; AGENTS.md rule not written (no workspace folder or ${spec.urlEnv}).`;
    }
    const native = cfg.command === spec.nativeCommand;
    const rt = this.customRuntimes.get(id);
    const searchTool = product === "confluence" ? "confluence_search" : "jira_search";
    const searchArgs =
      product === "confluence"
        ? native
          ? { cql: "type = page ORDER BY lastmodified DESC", limit: 1 }
          : { query: "type = page", limit: 1 }
        : { jql: "ORDER BY created DESC", fields: "summary", limit: 1 };
    const hasSearch = rt?.tools.some(
      (t) => t.function.name === qualifyMcpToolName(id, searchTool)
    );
    let verifiedHow = "MCP tools listed";
    if (rt?.client && hasSearch) {
      try {
        const res = await withTimeout(
          rt.client.callTool({ name: searchTool, arguments: searchArgs }),
          CUSTOM_LIST_TOOLS_TIMEOUT_MS,
          `Checking ${spec.label} access`
        );
        if (res.isError) {
          return jiraCheckFailedNotice(splitMcpToolResult(res).text, spec.label);
        }
        verifiedHow = native
          ? `${searchTool} via Harbor built-in ${spec.label}`
          : `${searchTool} via mcp-atlassian`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jiraCheckFailedNotice(message, spec.label);
      }
    }
    const secretEnv = await getServerSecretEnv(this.context.secrets, id);
    const result = writeJiraAgentFiles(root, {
      product,
      url,
      // Other agent tools have no built-in Jira / Confluence — give them mcp-atlassian.
      command: native ? "uvx" : cfg.command || "uvx",
      args: native ? ["mcp-atlassian"] : cfg.args || [],
      env: cfg.env || {},
      secretKeys: Object.keys(secretEnv),
      tokenSourceEnv: detectJiraTokenSourceEnv(process.env, product),
      corporateCa: Boolean(rt?.jira?.corporateCa),
      hostOverride: rt?.jira?.hostOverride,
      verifiedAt: new Date().toISOString().slice(0, 10),
      verifiedHow,
    });
    const parts = [`${spec.label} rule written: ${result.written.join(", ") || "—"}.`];
    if (result.skipped.length) {
      parts.push(
        `Skipped: ${result.skipped.map((s) => `${s.file} (${s.reason})`).join(", ")}.`
      );
    }
    return parts.join(" ");
  }

  async deleteCustomServer(id: string): Promise<void> {
    if (id === FIGMA_SERVER_ID) {
      await this.disconnect();
      return;
    }
    await this.closeCustomClient(id);
    this.customRuntimes.delete(id);
    this.removeServerAgentRules(id);
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
      this.removeServerAgentRules(id);
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
      let connectConfig = cfg;
      const product = atlassianProductOf(cfg);
      const spec = product ? ATLASSIAN_PRODUCTS[product] : undefined;
      const isJira = Boolean(spec);
      const isJiraNative = Boolean(spec && cfg.command === spec.nativeCommand);
      if (spec) {
        // URL + token is all the user gives: resolve uvx, corporate CA and
        // VPN-only DNS here, as runtime env (never persisted).
        rt.status = { ...rt.status, message: `Checking ${spec.label} access…` };
        this.notifyList();
        const prep = await prepareJiraConnection({
          url: String(cfg.env?.[spec.urlEnv] || ""),
          token: String(secretEnv[spec.tokenEnv] || ""),
          command: cfg.command || "uvx",
          userEnv: cfg.env,
          launcher: !isJiraNative,
          product: spec.id,
        });
        if (!prep.ok) {
          throw new Error(prep.error || `${spec.label} check failed`);
        }
        rt.jira = prep;
        connectConfig = {
          ...cfg,
          command: prep.command || cfg.command,
          env: { ...(cfg.env || {}), ...prep.env },
        };
      }
      const nativeConn =
        spec && isJiraNative
          ? {
              baseUrl: String(cfg.env?.[spec.urlEnv] || ""),
              token: String(secretEnv[spec.tokenEnv] || ""),
              ca: rt.jira?.ca || [],
              pinIp: rt.jira?.pinIp,
            }
          : undefined;
      client = nativeConn
        ? // Built-in REST tools: no child process, no Python / uv.
          ((cfg.command === CONFLUENCE_NATIVE_COMMAND
            ? createConfluenceNativeClient(nativeConn)
            : createJiraNativeClient(nativeConn)) as unknown as Client)
        : await withTimeout(
            connectCustomMcpServer({
              config: connectConfig,
              bearerToken,
              secretEnv,
            }),
            isJira ? JIRA_CONNECT_TIMEOUT_MS : CUSTOM_CONNECT_TIMEOUT_MS,
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
      this.writeServerAgentRules(
        cfg,
        rt,
        (listed.tools || []).map((tool) => ({
          name: tool.name,
          description: tool.description,
        })),
        nativeConn ? undefined : client.getInstructions?.()
      );
      rt.status = {
        id,
        name: cfg.name,
        enabled: cfg.enabled !== false,
        builtin: false,
        transport: cfg.transport,
        state: "connected",
        toolCount: tools.length,
        message: rt.jira?.user ? `Connected as ${rt.jira.user}` : "Connected",
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

    // Prefer remote OAuth when tokens exist; PAT is the fallback.
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
    this.figmaCooldownUntil = 0;
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
