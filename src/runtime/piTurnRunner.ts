/**
 * Pi adapter (first slice): a Harbor turn executed by @earendil-works/pi-coding-agent
 * instead of the Cline core.
 *
 * Scope of this slice: streaming text, read-only tools with tool cards, Stop,
 * usage/timing, live session per chat. Edits, shell, approvals, skills,
 * checkpoints and MCP servers are the next stages (see
 * docs/pi-runtime-migration.md §5, stages 3–5) — they are intentionally off.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import {
  getConfig,
  getModeById,
  resolveApiModelId,
  resolveProviderPromptCache,
  type AgentModel,
  type AgentProvider,
} from "../config";
import { isReadonlyPolicy } from "../modes";
import { requestHarborToolApproval } from "../toolApproval";
import {
  harborHostIdentityRulesForLanguage,
  harborModelIdentityRulesForLanguage,
  harborReasoningLanguageRulesForLanguage,
  isBuiltinSystemPrompt,
  resolveUiLanguage,
} from "../i18n";
import { resolveSkillDirectories } from "../harborSkills";
import {
  isGennadiyProvider,
  readGennadiyAccessTokenAllowExpired,
  readGennadiyRefreshToken,
  resolveGennadiyApiKey,
  writeGennadiyKeycloakEntry,
} from "../gennadiyAuth";
import { refreshKeycloakToken } from "../keycloakDeviceAuth";
import { GENNADIY_KEYCLOAK_REALM, GENNADIY_KEYCLOAK_URL } from "../buildFlags.generated";
import { refreshGennadiyAccessToken } from "../gennadiyTokenRefresh";
import { previewText, toolStepId } from "../agentSteps";
import type { AgentStepEvent } from "../agentSteps";
import type { AgentTurnOptions } from "./agentRuntime";
import type { ChatMessage } from "../openaiTypes";
import { startProviderProxy, type ProviderProxy } from "./piGatewayProxy";
import { getMcpManager } from "../mcpBundle";
import { parseQualifiedToolName, qualifyMcpToolName } from "../mcp/types";

/** Read-only Pi tools available in this slice. */
// `find` is omitted: Pi's find tool shells out to `fd`, which is not present on
// stock macOS/Windows — the card would always end red. `grep` covers content
// search and `ls` covers directory listing.
const READ_ONLY_TOOLS = ["read", "grep", "ls"];
const AGENT_TOOLS = ["read", "grep", "ls", "edit", "write", "bash"];

let piModule: unknown;
/** Native dynamic import: TS would downlevel `import()` to require() in CJS. */
const importEsm = new Function("s", "return import(s)") as (specifier: string) => Promise<any>;

const proxies = new Map<string, ProviderProxy>();
const sessions = new Map<string, LiveSession>();

interface PiContext {
  pi: any;
  runtime: any;
  agentDir: string;
  modelsPath: string;
}

interface LiveSession {
  session: any;
  fingerprint: string;
}

/**
 * Pi chunk locations: VS Code ships `out/pi/pi.mjs`; the JetBrains sidecar
 * bundle sits next to `pi/pi.mjs` (see jetbrains/build.gradle.kts).
 */
function piChunkCandidates(): string[] {
  return [
    path.join(__dirname, "..", "..", "out", "pi", "pi.mjs"),
    path.join(__dirname, "pi", "pi.mjs"),
    path.join(__dirname, "..", "pi", "pi.mjs"),
  ];
}

/**
 * Thrown only when Pi cannot be loaded at all (chunk missing / import failed).
 * The runtime seam treats it as "fall back to Cline silently" — see
 * `runAgentTurn` in `src/agentLoop.ts`.
 */
export class PiRuntimeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiRuntimeUnavailableError";
  }
}

/** Chunk availability probe used by the runtime seam before starting a turn. */
export function piRuntimeStatus(): {
  available: boolean;
  entry?: string;
  reason?: string;
} {
  const entry = piChunkCandidates().find((candidate) => fs.existsSync(candidate));
  if (entry) {
    return { available: true, entry };
  }
  return {
    available: false,
    reason: `Pi chunk not found (looked in ${piChunkCandidates().join(", ")})`,
  };
}

async function loadPi(): Promise<any> {
  if (!piModule) {
    const status = piRuntimeStatus();
    if (!status.available || !status.entry) {
      throw new PiRuntimeUnavailableError(
        "Pi runtime не собран: " +
          (status.reason || "out/pi/pi.mjs отсутствует") +
          ". Выполните `npm run compile` (шаг bundle-pi) и перезагрузите окно."
      );
    }
    try {
      piModule = await importEsm(pathToFileURL(status.entry).href);
    } catch (error) {
      throw new PiRuntimeUnavailableError(
        `Pi runtime не загрузился (${status.entry}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  return piModule as any;
}


/** `azp` of an already-issued token — the client the refresh token belongs to. */
function tokenClientId(token: string): string {
  try {
    const payload = String(token || "").split(".")[1];
    if (!payload) return "";
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return String(json.azp || json.client_id || "");
  } catch {
    return "";
  }
}

/**
 * Fallback refresh for sessions created by the `gennadiy` CLI (`gennadiy-sf`):
 * Harbor's own refresh uses its device-flow client (`gennadiy-df`) and Keycloak
 * rejects a refresh token issued to another client. Retry with the token's azp.
 */
async function refreshWithStoredClient(): Promise<string> {
  const refresh = readGennadiyRefreshToken();
  const clientId = tokenClientId(readGennadiyAccessTokenAllowExpired());
  if (!refresh || !clientId) return "";
  try {
    const tokens = await refreshKeycloakToken(refresh, {
      url: GENNADIY_KEYCLOAK_URL,
      realm: GENNADIY_KEYCLOAK_REALM,
      clientId,
    });
    writeGennadiyKeycloakEntry({
      access: tokens.access,
      refresh: tokens.refresh,
      expires: tokens.expires,
    });
    return tokens.access;
  } catch {
    return "";
  }
}
function keyResolver(provider: AgentProvider): (force: boolean) => Promise<string> {
  return async (force: boolean): Promise<string> => {
    if (isGennadiyProvider(provider)) {
      const live = force ? "" : resolveGennadiyApiKey(provider.apiKey);
      if (live) return live;
      const refreshed = await refreshGennadiyAccessToken({ force: true });
      if (refreshed) return refreshed;
      return refreshWithStoredClient();
    }
    return String(provider.apiKey || "");
  };
}

function modelsForProvider(provider: AgentProvider, models: AgentModel[], fallbackContext: number): any[] {
  return models
    .filter((model) => (model.providerId || "") === provider.id)
    .map((model) => ({
      id: resolveApiModelId(model.id),
      name: model.label || model.id,
      contextWindow: model.contextWindow && model.contextWindow > 0 ? model.contextWindow : fallbackContext,
      maxTokens: model.maxOutputTokens && model.maxOutputTokens > 0 ? model.maxOutputTokens : 8192,
    }));
}

/**
 * Pi provider `compat` for prompt caching. Pi only emits Anthropic-style
 * `cache_control` markers on the OpenAI-compatible wire when the provider
 * declares `cacheControlFormat: "anthropic"`; the native `anthropic-messages`
 * transport already marks the system prompt, the last tool and the last
 * message on its own. Markerless is the safe default: strict OpenAI upstreams
 * reject the field with 400, so this follows the same opt-in flag as the Cline
 * runtime (`agentPanel.promptCache.enabled` / per-provider `promptCache`).
 */
export function piPromptCacheCompat(
  protocol: string | undefined,
  enabled: boolean
): Record<string, unknown> | undefined {
  if (!enabled) return undefined;
  if ((protocol || "") === "anthropic") return undefined;
  return { cacheControlFormat: "anthropic" };
}

/**
 * Everything `createContext` bakes into `models.json`. A change here means the
 * cached model runtime (and its sessions) must be rebuilt, otherwise a settings
 * toggle would only take effect after a window reload — the Cline runtime gets
 * this for free through its session fingerprint.
 */
export function piContextFingerprint(cfg: {
  providers: ReadonlyArray<{
    id: string;
    baseUrl?: string;
    protocol?: string;
    promptCache?: boolean;
  }>;
  models: ReadonlyArray<{
    id: string;
    providerId?: string;
    contextWindow?: number;
    maxOutputTokens?: number;
  }>;
  defaultContextWindow?: number;
  promptCache?: { enabled?: boolean };
}): string {
  const globalCache = cfg.promptCache?.enabled === true;
  return JSON.stringify({
    providers: cfg.providers.map((provider) => [
      provider.id,
      provider.baseUrl || "",
      provider.protocol || "",
      typeof provider.promptCache === "boolean" ? provider.promptCache : globalCache,
    ]),
    models: cfg.models.map((model) => [
      model.id,
      model.providerId || "",
      model.contextWindow || 0,
      model.maxOutputTokens || 0,
    ]),
    defaultContextWindow: cfg.defaultContextWindow || 0,
  });
}

let contextPromise: Promise<PiContext> | undefined;
let contextFingerprint = "";
/** Turns currently streaming on the live context — never rebuild under them. */
let activePrompts = 0;

/** Drop live sessions and loopback proxies, keeping the module reusable. */
async function releaseContext(): Promise<void> {
  for (const chatId of [...sessions.keys()]) disposePiChatSession(chatId);
  for (const proxy of proxies.values()) {
    try {
      await proxy.close();
    } catch {
      /* ignore */
    }
  }
  proxies.clear();
  contextPromise = undefined;
  contextFingerprint = "";
}

async function ensureContext(): Promise<PiContext> {
  const fingerprint = piContextFingerprint(getConfig());
  if (contextPromise && contextFingerprint !== fingerprint && activePrompts === 0) {
    await releaseContext();
  }
  if (!contextPromise) {
    contextFingerprint = fingerprint;
    contextPromise = createContext();
  }
  try {
    return await contextPromise;
  } catch (error) {
    contextPromise = undefined;
    contextFingerprint = "";
    throw error;
  }
}

async function createContext(): Promise<PiContext> {
  const pi = await loadPi();
  const cfg = getConfig();
  if (!cfg.providers.length) {
    throw new Error("Pi runtime: не настроен ни один провайдер (Settings → Models).");
  }
  const agentDir = path.join(os.homedir(), ".harbor", "pi-agent");
  fs.mkdirSync(agentDir, { recursive: true });

  const providers: Record<string, unknown> = {};
  for (const provider of cfg.providers) {
    if (!provider.baseUrl) continue;
    let proxy = proxies.get(provider.id);
    if (!proxy) {
      proxy = await startProviderProxy({
        targetBase: provider.baseUrl,
        getKey: keyResolver(provider),
      });
      proxies.set(provider.id, proxy);
    }
    const models = modelsForProvider(provider, cfg.models, cfg.defaultContextWindow);
    if (!models.length) continue;
    const protocol = provider.protocol === "anthropic" ? "anthropic-messages" : "openai-completions";
    const cacheCompat = piPromptCacheCompat(provider.protocol, resolveProviderPromptCache(provider.id));
    providers[provider.id] = {
      name: provider.name || provider.id,
      baseUrl: proxy.baseUrl,
      api: protocol,
      apiKey: "harbor-loopback-proxy",
      authHeader: true,
      models,
      ...(cacheCompat ? { compat: cacheCompat } : {}),
    };
  }
  if (!Object.keys(providers).length) {
    throw new Error("Pi runtime: у провайдеров нет моделей — добавьте модель в Settings → Models.");
  }

  const modelsPath = path.join(agentDir, "models.json");
  fs.writeFileSync(modelsPath, JSON.stringify({ providers }, null, 2));
  const runtime = await pi.ModelRuntime.create({ modelsPath, refreshOnCreate: false });
  return { pi, runtime, agentDir, modelsPath };
}

function textOfPiMessage(message: any): string {
  if (!message || !Array.isArray(message.content)) return "";
  return message.content
    .filter((block: any) => block?.type === "text")
    .map((block: any) => block.text)
    .join("");
}

function reasoningOfPiMessage(message: any): string {
  if (!message || !Array.isArray(message.content)) return "";
  return message.content
    .filter((block: any) => block?.type === "thinking")
    .map((block: any) => block.thinking)
    .join("");
}

/** Harbor history → Pi messages; minimal shapes, seeded best-effort. */
function toPiMessage(
  message: ChatMessage,
  providerId: string,
  apiId: string
): unknown | undefined {
  const text =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content
            .map((part) => (part && (part as any).type === "text" ? String((part as any).text || "") : ""))
            .join("")
        : "";
  if (!text.trim()) return undefined;
  if (message.role === "user") {
    return { role: "user", content: text, timestamp: Date.now() };
  }
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "openai-completions",
      provider: providerId,
      model: apiId,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };
  }
  return undefined;
}

function resolveProviderId(modelId: string): string {
  const cfg = getConfig();
  const stored = cfg.models.find((model) => model.id === modelId);
  return stored?.providerId || cfg.providers[0]?.id || "";
}


interface HarborMcpServer {
  id: string;
  name: string;
}

/**
 * Harbor MCP servers exposed to Pi: enabled, and either connected with a real
 * tool list, or a native Atlassian server whose tool list is static
 * (`McpManager.serversWithStaticTools`). Filtering strictly by
 * `state === "connected"` used to hide Jira / Confluence for the whole turn —
 * a native server only connects on the first tool call, so its tools never
 * reached Pi at all.
 */
export function pickExposedMcpServers(
  statuses: ReadonlyArray<{
    id: string;
    name?: string;
    enabled: boolean;
    state: string;
    toolCount?: number;
  }>,
  staticIds: Iterable<string>
): HarborMcpServer[] {
  const statics = new Set(staticIds);
  return statuses
    .filter((server) => server.enabled)
    .filter(
      (server) =>
        (server.state === "connected" && (server.toolCount ?? 0) > 0) ||
        statics.has(server.id)
    )
    .map((server) => ({ id: server.id, name: server.name || server.id }));
}

export function harborMcpServers(): HarborMcpServer[] {
  const manager = getMcpManager();
  if (!manager) return [];
  try {
    return pickExposedMcpServers(
      manager.listServerStatuses(),
      manager.serversWithStaticTools()
    );
  } catch {
    return [];
  }
}

/**
 * Exposes one Harbor MCP server to Pi as an in-process MCP server. Read-only
 * tools only: approvals for destructive MCP calls arrive with stage 3.
 */
function createHarborMcpTransport(serverId: string): any {
  const messageListeners = new Set<(message: any) => void>();
  const closeListeners = new Set<() => void>();
  let closed = false;
  let protocolVersion = "2025-06-18";

  const emit = (message: any): void => {
    for (const listener of messageListeners) listener(message);
  };
  const respond = (id: any, result: any): void => {
    queueMicrotask(() => emit({ jsonrpc: "2.0", id, result }));
  };
  const fail = (id: any, code: number, message: string): void => {
    queueMicrotask(() => emit({ jsonrpc: "2.0", id, error: { code, message } }));
  };

  return {
    async start(): Promise<void> {
      if (closed) throw new Error("transport closed");
    },
    async send(message: any): Promise<void> {
      if (closed) throw new Error("transport closed");
      if (!message || message.id === undefined || !message.method) return;
      const { id, method, params } = message;
      const manager = getMcpManager();
      try {
        switch (method) {
          case "initialize":
            protocolVersion = params?.protocolVersion ?? protocolVersion;
            return respond(id, {
              protocolVersion,
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: `harbor-${serverId}`, version: "1.0.0" },
            });
          case "ping":
          case "logging/setLevel":
            return respond(id, {});
          case "tools/list": {
            if (!manager) return respond(id, { tools: [] });
            const tools = await manager.listOpenAiTools(true);
            const out = [];
            for (const tool of tools) {
              const parsed = parseQualifiedToolName(tool.function?.name || "");
              if (!parsed || parsed.serverId !== serverId) continue;
              out.push({
                name: parsed.toolName,
                description: tool.function?.description || "",
                inputSchema: tool.function?.parameters || { type: "object", properties: {} },
              });
            }
            return respond(id, { tools: out });
          }
          case "tools/call": {
            if (!manager) {
              return respond(id, {
                content: [{ type: "text", text: JSON.stringify({ error: "MCP manager недоступен" }) }],
                isError: true,
              });
            }
            const result = await manager.callToolRaw(
              qualifyMcpToolName(serverId, String(params?.name || "")),
              JSON.stringify(params?.arguments ?? {})
            );
            return respond(id, result);
          }
          case "resources/list":
            return respond(id, { resources: [] });
          case "resources/templates/list":
            return respond(id, { resourceTemplates: [] });
          default:
            return fail(id, -32601, `Method not found: ${method}`);
        }
      } catch (error) {
        fail(id, -32603, error instanceof Error ? error.message : String(error));
      }
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      for (const listener of closeListeners) listener();
    },
    onMessage(listener: (message: any) => void): () => void {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onError(): () => void {
      return () => undefined;
    },
    onClose(listener: () => void): () => void {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    setProtocolVersion(next: string): void {
      protocolVersion = next;
    },
  };
}


/**
 * Harbor settings that Cline receives through its rules slot: custom system
 * prompt, product/model identity, reasoning language, mode prompt, skills.
 * Pi's own base prompt (tool protocol) stays intact — this is appended to it.
 */
function buildPiAppendPrompt(options: AgentTurnOptions, readonlyMode: boolean): string[] {
  const config = getConfig();
  const lang = resolveUiLanguage(config.language);
  const modeDef = getModeById(options.agentMode);
  const custom = String(config.systemPrompt || "").trim();
  const parts = [
    isBuiltinSystemPrompt(custom) ? "" : custom,
    harborHostIdentityRulesForLanguage("VS Code", lang),
    harborModelIdentityRulesForLanguage(options.model, lang),
    harborReasoningLanguageRulesForLanguage(lang),
    String(modeDef.prompt || "").trim()
      ? `# Mode: ${modeDef.label || modeDef.id}\n${String(modeDef.prompt).trim()}`
      : "",
    lang === "ru"
      ? readonlyMode
        ? "# Инструменты этого рантайма\nРежим только для чтения: доступны read, grep, ls и read-only MCP-инструменты (Jira/Confluence/Figma, если подключены). Правка файлов, shell и запись в Jira недоступны."
        : "# Инструменты этого рантайма\nДоступны read, grep, ls, edit, write, bash (по политике approvals Harbor) и read-only MCP-инструменты (Jira/Confluence/Figma, если подключены). Запись в Jira пока недоступна."
      : readonlyMode
        ? "# Tools in this runtime\nRead-only mode: read, grep, ls and read-only MCP tools (Jira/Confluence/Figma when connected). File edits, shell and Jira writes are unavailable."
        : "# Tools in this runtime\nAvailable: read, grep, ls, edit, write, bash (subject to Harbor approvals) and read-only MCP tools (Jira/Confluence/Figma when connected). Jira writes are not available yet.",
  ];
  return parts.map((part) => String(part || "").trim()).filter(Boolean);
}
async function createLiveSession(
  ctx: PiContext,
  options: AgentTurnOptions,
  providerId: string,
  apiId: string,
  model: any
): Promise<LiveSession> {
  const cwd = options.storageUri?.fsPath || process.cwd();
  const sessionManager = ctx.pi.SessionManager.inMemory(cwd);
  for (const message of options.history) {
    const piMessage = toPiMessage(message, providerId, apiId);
    if (!piMessage) continue;
    try {
      sessionManager.appendMessage(piMessage);
    } catch {
      // Shape mismatch on an old message: skip it, the turn still runs.
    }
  }
  const mcpServers = harborMcpServers();
  const config = getConfig();
  const modeDef = getModeById(options.agentMode);
  const readonlyMode = isReadonlyPolicy(modeDef.tools);
  const toolNames = [...(readonlyMode ? READ_ONLY_TOOLS : AGENT_TOOLS), "mcp__*"];
  const skillDirs =
    config.skills && config.skills.enabled !== false ? resolveSkillDirectories(cwd, config.skills) : [];
  const resourceLoader = new ctx.pi.DefaultResourceLoader({
      cwd,
      agentDir: ctx.agentDir,
      extensionFactories: [
        {
          name: "harbor-approvals",
          hidden: true,
          replaceable: true,
          factory: (pi: any) => {
            pi.on("tool_call", async (event: any) => {
              const decision = await requestHarborToolApproval({
                toolName: String(event?.toolName || "tool"),
                input: event?.input,
              });
              if (!decision.approved) {
                return { block: true, reason: "Отклонено пользователем в Harbor Agents (approvals)" };
              }
              return undefined;
            });
          },
        },
        ...(mcpServers.length
        ? [
              {
                name: "harbor-mcp",
                hidden: true,
                replaceable: true,
                factory: ctx.pi.createMcpExtension({
                  loadConfig: () => ({
                    servers: mcpServers.map((server) => ({
                      name: server.id,
                      config: {
                        url: `harbor-inprocess://${server.id}`,
                        exposure: "direct",
                        description: server.name,
                      },
                      source: "harbor",
                      scope: "extension",
                    })),
                    errors: [],
                  }),
                  createTransport: (entry: any) => createHarborMcpTransport(String(entry?.name || "")),
                  startupWaitMs: 5000,
                }),
              },
            ]
        : []),
      ],
      disabledBuiltinExtensions: ["mcp"],
      ...(skillDirs.length ? { additionalSkillPaths: skillDirs } : {}),
      noSkills: skillDirs.length === 0,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: false,
      appendSystemPrompt: buildPiAppendPrompt(options, readonlyMode),
    });
    await resourceLoader.reload();

  const created = await ctx.pi.createAgentSession({
    cwd,
    agentDir: ctx.agentDir,
    modelRuntime: ctx.runtime,
    model,
    sessionManager,
    resourceLoader,
    tools: toolNames,
  });
  try {
    await created.session.bindExtensions({});
  } catch {
    // MCP tools stay unavailable if the extension runtime cannot bind.
  }
  return {
    session: created.session,
    fingerprint: `${providerId}|${apiId}|${options.agentMode || "agent"}`,
  };
}



/** Pi tool name → the card vocabulary the Harbor timeline already renders. */
const PI_TO_CARD_NAME: Record<string, string> = {
  read: "read_files",
  grep: "search_codebase",
  ls: "list_files",
  find: "search_codebase",
  bash: "run_commands",
  edit: "editor",
  write: "editor",
};

/** Reshape Pi arguments into the Cline shapes the timeline labels read. */
function cardArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const path = String(args.path || args.file_path || args.relativePath || "").trim();
  if (name === "read") return { files: [{ path }] };
  if (name === "grep" || name === "find") {
    const pattern = String(args.pattern || args.query || "").trim();
    return { queries: [pattern], ...(path ? { path } : {}) };
  }
  if (name === "ls") return { path: path || "." };
  return args;
}

function toolResultText(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  const content = (result as any)?.content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) => {
        if (block?.type === "text") return String(block.text || "");
        if (block?.type === "image") return "[image]";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function metricsForTool(
  name: string,
  args: Record<string, unknown>,
  text: string,
  isError: boolean
): Record<string, unknown> | undefined {
  if (isError || !text) return undefined;
  const path = String(args.path || args.file_path || args.relativePath || "").trim();
  if (name === "read" && path) {
    const lines = text ? text.split("\n").length : 0;
    return { files: [path], ...(lines > 0 ? { lines } : {}) };
  }
  if (name === "grep") {
    const matches = (text.match(/^[^\n:]+:\d+:/gm) || []).length;
    const files = Array.from(
      new Set(
        text
          .split("\n")
          .map((line) => line.match(/^([^\n:]+):\d+:/)?.[1])
          .filter((value): value is string => Boolean(value))
      )
    ).slice(0, 5);
    if (!matches && !files.length) return undefined;
    return { ...(matches ? { matches } : {}), ...(files.length ? { files } : {}) };
  }
  if (name === "ls") {
    const files = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 10);
    return files.length ? { files } : undefined;
  }
  return undefined;
}

function phaseForTool(name: string): "reading" | "running" | "editing" {
  if (name === "bash") return "running";
  if (name === "edit" || name === "write") return "editing";
  return "reading";
}

function attachmentPreview(options: AgentTurnOptions): string {
  const attachments = options.attachments || [];
  if (!attachments.length) return options.userText;
  const names = attachments
    .map((attachment) => attachment.name || attachment.path || "")
    .filter(Boolean)
    .join(", ");
  return names ? `${options.userText}\n\n[вложения: ${names}]` : options.userText;
}

export async function runPiAgentTurn(options: AgentTurnOptions): Promise<ChatMessage[]> {
  const ctx = await ensureContext();
  const providerId = resolveProviderId(options.model);
  const apiId = resolveApiModelId(options.model);
  const model =
    (providerId && ctx.runtime.getModel(providerId, apiId)) ||
    (providerId && ctx.runtime.getModel(providerId, options.model));
  if (!providerId || !model) {
    throw new Error(
      `Pi runtime: модель «${options.model}» не найдена у провайдера «${providerId || "?"}». ` +
        "Проверьте Settings → Models."
    );
  }

  const chatId = options.chatId || "default";
  const fingerprint = `${providerId}|${apiId}|${options.agentMode || "agent"}`;
  let live = sessions.get(chatId);
  if (!live || live.fingerprint !== fingerprint || options.resetSession) {
    try {
      await live?.session?.dispose?.();
    } catch {
      /* ignore */
    }
    live = await createLiveSession(ctx, options, providerId, apiId, model);
    sessions.set(chatId, live);
  }

  const callbacks = options.callbacks;
  const startedAt = Date.now();
  let lastAssistantText = "";
  let finalText = "";
  let finalReasoning = "";
  let errorText = "";
  let ttftMs = 0;
  const toolStartedAt = new Map<string, number>();
  // tool_execution_end carries no args: keep them from the start event.
  const toolArgsById = new Map<string, { raw: Record<string, unknown>; preview: string }>();

  const unsubscribe = live.session.subscribe((event: any) => {
    switch (event.type) {
      case "message_start":
        if (event.message?.role === "assistant") lastAssistantText = "";
        break;
      case "message_update": {
        if (event.message?.role !== "assistant") break;
        const full = textOfPiMessage(event.message);
        const delta = full.startsWith(lastAssistantText) ? full.slice(lastAssistantText.length) : full;
        lastAssistantText = full;
        if (delta) {
          if (!ttftMs) {
            ttftMs = Date.now() - startedAt;
            callbacks.onTiming?.({ ttftMs });
          }
          callbacks.onAssistantDelta?.(delta);
        }
        const reasoning = reasoningOfPiMessage(event.message);
        if (reasoning) callbacks.onReasoning?.(reasoning);
        break;
      }
      case "message_end": {
        if (event.message?.role !== "assistant") break;
        finalText = textOfPiMessage(event.message) || finalText;
        finalReasoning = reasoningOfPiMessage(event.message) || finalReasoning;
        if (event.message.stopReason === "error") {
          errorText = event.message.errorMessage || "Модель вернула ошибку";
        }
        const usage = event.message.usage;
        if (usage) {
          callbacks.onUsage?.({
            used: Number(usage.input || 0) + Number(usage.output || 0),
            promptTokens: Number(usage.input || 0),
            completionTokens: Number(usage.output || 0),
            cacheReadTokens: Number(usage.cacheRead || 0),
            cacheWriteTokens: Number(usage.cacheWrite || 0),
          });
        }
        break;
      }
      case "tool_execution_start": {
        const rawName = String(event.toolName || "tool");
        const name = PI_TO_CARD_NAME[rawName] || rawName;
        toolStartedAt.set(event.toolCallId, Date.now());
        callbacks.onPhase?.(phaseForTool(rawName));
        const rawArgs = (event.args ?? {}) as Record<string, unknown>;
        const argsPreview = previewText(JSON.stringify(cardArgs(rawName, rawArgs)), 400);
        toolArgsById.set(event.toolCallId, { raw: rawArgs, preview: argsPreview });
        callbacks.onTool?.(`⚙ ${name}(${argsPreview})`);
        callbacks.onStep?.({
          stepId: toolStepId(event.toolCallId),
          kind: "tool",
          toolCallId: event.toolCallId,
          name,
          argsPreview,
          status: "running",
        } as AgentStepEvent);
        break;
      }
      case "tool_execution_end": {
        const rawName = String(event.toolName || "tool");
        const name = PI_TO_CARD_NAME[rawName] || rawName;
        const kept = toolArgsById.get(event.toolCallId);
        const rawArgs = kept?.raw ?? ((event.args ?? {}) as Record<string, unknown>);
        const argsPreview = kept?.preview ?? previewText(JSON.stringify(cardArgs(rawName, rawArgs)), 400);
        const resultText = toolResultText(event.result);
        const preview = previewText(resultText, 240);
        const metrics = metricsForTool(rawName, rawArgs, resultText, Boolean(event.isError));
        callbacks.onStep?.({
          stepId: toolStepId(event.toolCallId),
          kind: "tool",
          toolCallId: event.toolCallId,
          name,
          argsPreview,
          status: event.isError ? "error" : "done",
          resultPreview: preview,
          ...(metrics ? { metrics } : {}),
          durationMs: event.durationMs ?? Date.now() - (toolStartedAt.get(event.toolCallId) || Date.now()),
        } as AgentStepEvent);
        toolStartedAt.delete(event.toolCallId);
        toolArgsById.delete(event.toolCallId);
        callbacks.onPhase?.("thinking");
        break;
      }
      default:
        break;
    }
  });

  const abortHandler = (): void => {
    void live?.session?.abort?.();
  };
  options.signal?.addEventListener("abort", abortHandler);
  callbacks.onPhase?.("cline", `Pi · ${apiId}`);
  activePrompts += 1;
  try {
    await live.session.prompt(attachmentPreview(options));
  } finally {
    activePrompts -= 1;
    options.signal?.removeEventListener("abort", abortHandler);
    unsubscribe();
  }

  if (errorText) {
    throw new Error(errorText);
  }

  const assistantText = finalText || lastAssistantText;
  callbacks.onAssistant(assistantText, finalReasoning ? { reasoning: finalReasoning } : undefined);

  const nextHistory: ChatMessage[] = [
    ...options.history,
    { role: "user", content: options.userText },
    {
      role: "assistant",
      content: assistantText,
      ...(finalReasoning ? { reasoning_content: finalReasoning } : {}),
    },
  ];
  return nextHistory;
}

/** Drop a chat's live Pi session (eviction / new chat / dispose). */
export function disposePiChatSession(chatId: string | undefined): void {
  if (!chatId) return;
  const live = sessions.get(chatId);
  sessions.delete(chatId);
  try {
    void live?.session?.dispose?.();
  } catch {
    /* ignore */
  }
}

/** Release every Pi session and loopback proxy (extension deactivate). */
export async function disposePiRuntime(): Promise<void> {
  await releaseContext();
}
