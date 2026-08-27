/**
 * Headless Harbor panel host for the JetBrains sidecar.
 * Owns AgentsStoreV2 + agent turns; emits HostToWebview-shaped events.
 */
import * as fs from "fs";
import * as path from "path";
import { runAgentTurn, type AgentPhase } from "./agentLoop";
import type { AgentStepEvent } from "./agentSteps";
import {
  discardClineChatSession,
  discardClineChatSessions,
  onClineActiveChatChanged,
  retainClineChatSession,
  restoreClineChatCheckpoint,
} from "./clineRuntime";
import {
  getConfig,
  getContextWindow,
  getEnabledModels,
  getModeById,
  getResolvedModes,
  resolveModelEndpoint,
  resolveProviderProbeUrl,
} from "./config";
import { buildHarborSettingsPayloadCore } from "./settingsPayload";
import {
  buildSkillsListPayload,
  ensureHarborSkillRoots,
  globalHarborSkillsDir,
  workspaceHarborSkillsDir,
} from "./harborSkills";
import {
  AgentsStoreV2,
  UiMessage,
  archiveAgentInStore,
  branchChatFromMessage,
  buildAgentsList,
  buildArchiveList,
  buildBranchesList,
  createDefaultStore,
  copyUiAttachmentsOntoHistory,
  createEmptyAgent,
  deleteAgentBranch,
  deleteAgentFromStore,
  deleteAllArchivedAgentsFromStore,
  ensureActiveVisible,
  findAgentByChatId,
  formatListTime,
  getActiveChat,
  getAgentChatIds,
  getAgentDisplayName,
  applyAgentName,
  restoreAgentInStore,
  switchAgentBranch,
  touchChat,
} from "./sessionStore";
import { maybeGenerateChatTitle } from "./chatTitle";
import {
  getOpenAICompatibleClient,
  type ChatMessage,
  type ListedProviderModel,
} from "./openaiClient";
import type { ChatSession } from "./sessionStore";
import { HarborHeadless } from "./vscodeHeadlessStub";
import {
  enrichAttachmentsForUi,
  persistIncomingAttachments,
  stripAttachmentPayload,
  type IncomingAttachment,
  type MessageAttachment,
} from "./attachments";
import { resolveToolApproval } from "./toolApproval";
import { resolveUiLanguage } from "./i18n";
import {
  formatAbortedAssistantText,
  harborAbortInfoFromCode,
  isAbortNoticeText,
  reasonFromAbortSignal,
} from "./abortReason";
import { modePhaseStatusLabel, modeThinkingLabel } from "./modes";
import { applyHarborTlsPolicy } from "./tlsPolicy";
import type { FileEditStat } from "./diffStats";
import { hasUncommittedChanges } from "./gitStatus";
import { toRepoRelativePath } from "./repoPaths";
import { resolveRemainingReviewFiles } from "./turnFileChanges";
import { discardPaths } from "./discardPaths";
import {
  assistantFinaleDisplayText,
  lastUiUserText,
} from "./planImplement";
import { getMcpManager } from "./mcpBundle";
import { parseArgsInput, parseEnvLines } from "./mcpBundle";
import type { FigmaStatusPayload } from "./mcpBundle";
import type { McpServerRuntimeStatus } from "./mcpBundle";
import { TODO_STEP_ID, TODO_TOOL } from "./todoTool";

type ProviderConnState = "unknown" | "connecting" | "connected" | "error";
type ChatRunState = "running" | "success" | "error";

interface ProviderConnStatus {
  providerId: string;
  providerName: string;
  state: ProviderConnState;
  message?: string;
  modelCount?: number;
  updatedAt: number;
}

const PROVIDER_PROBE_TTL_MS = 90_000;
const PROVIDER_PROBE_TIMEOUT_MS = 10_000;

export type HeadlessEmit = (message: Record<string, unknown>) => void;

export interface HeadlessPanelOptions {
  workspaceRoot: string;
  sessionPath: string;
  settingsPath: string;
  emit: HeadlessEmit;
  /** Notify IDE to refresh VFS after edits */
  onVfsRefresh?: (paths: string[]) => void;
}

function readJsonFile(filePath: string): unknown | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function isStoreV2(raw: unknown): raw is AgentsStoreV2 {
  return (
    !!raw &&
    typeof raw === "object" &&
    (raw as AgentsStoreV2).version === 2 &&
    Array.isArray((raw as AgentsStoreV2).agents)
  );
}

export class HeadlessPanelHost {
  private store: AgentsStoreV2;
  private history: ChatMessage[] = [];
  private uiMessages: UiMessage[] = [];
  private selectedModel = "";
  private selectedMode = "agent";
  private selectedReasoningEffort = "";
  private contextTokens = 0;
  /** Live turn per chat — parallel chats may run simultaneously (VS Code parity). */
  private readonly chatRuns = new Map<string, AbortController>();
  private readonly opts: HeadlessPanelOptions;
  private readonly providerConnStatuses = new Map<string, ProviderConnStatus>();
  private lastTurnModel = "";
  private readonly providerProbePromises = new Map<
    string,
    Promise<ProviderConnStatus>
  >();
  /** Per-chat run indicator for the agents rail loader (cube). */
  private readonly chatRunState = new Map<string, ChatRunState>();
  /** Busy-line under the transcript («Думаю…» / tool phases) — same as VS Code. */
  private readonly chatStatusState = new Map<
    string,
    { text: string; hidden: boolean; phase?: AgentPhase; modelLabel?: string }
  >();

  constructor(opts: HeadlessPanelOptions) {
    this.opts = opts;
    this.reloadSettings();
    const loaded = readJsonFile(opts.sessionPath);
    if (isStoreV2(loaded)) {
      this.store = loaded;
      ensureActiveVisible(this.store);
    } else {
      const cfg = getConfig();
      this.store = createDefaultStore(cfg.defaultModel || "");
    }
    this.hydrateFromActiveChat();
  }

  private reloadSettings(): void {
    const raw = readJsonFile(this.opts.settingsPath);
    const settings =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    HarborHeadless.install({
      workspaceRoot: this.opts.workspaceRoot,
      settings,
      settingsPath: this.opts.settingsPath,
      storageDir: path.dirname(this.opts.settingsPath),
    });
    // Cline uses global fetch — mirror Advanced → Validate TLS.
    applyHarborTlsPolicy(getConfig().rejectUnauthorized);
  }

  private hydrateFromActiveChat(): void {
    const chat = getActiveChat(this.store);
    const cfg = getConfig();
    this.selectedModel =
      chat?.selectedModel || cfg.defaultModel || cfg.models[0]?.id || "";
    this.selectedMode = chat?.selectedMode || "agent";
    this.selectedReasoningEffort = String(chat?.selectedReasoningEffort || "");
    // Copy arrays — sharing store refs lets later mutations (or a concurrent
    // turn) silently rewrite another chat's transcript on disk.
    this.history = copyUiAttachmentsOntoHistory(
      Array.isArray(chat?.history) ? (chat!.history as ChatMessage[]).slice() : [],
      Array.isArray(chat?.uiMessages) ? chat!.uiMessages.slice() : []
    );
    this.uiMessages = Array.isArray(chat?.uiMessages)
      ? chat!.uiMessages.slice()
      : [];
    this.contextTokens =
      typeof chat?.contextTokens === "number" && chat.contextTokens > 0
        ? chat.contextTokens
        : 0;
  }

  private persist(): void {
    writeJsonFile(this.opts.sessionPath, this.store);
  }

  private storageUri() {
    return HarborHeadless.getExtensionContext().storageUri as never;
  }

  private async enrichUiMessages(list: UiMessage[]): Promise<UiMessage[]> {
    const storage = this.storageUri();
    const out: UiMessage[] = [];
    for (const msg of list) {
      if (!msg.attachments?.length) {
        out.push(msg);
        continue;
      }
      out.push({
        ...msg,
        attachments: await enrichAttachmentsForUi(msg.attachments, storage),
      });
    }
    return out;
  }

  private scheduleChatTitle(chatId: string): void {
    const id = String(chatId || "").trim();
    if (!id) {
      return;
    }
    const fallbackModelId =
      this.store.chats[id]?.selectedModel || this.selectedModel;
    void maybeGenerateChatTitle(this.store, id, { fallbackModelId }).then(
      (name) => {
        if (!name) {
          return;
        }
        const agent = findAgentByChatId(this.store, id);
        if (!agent) {
          return;
        }
        this.persist();
        this.postAgentsList();
        const renamed: Record<string, unknown> = {
          type: "agentRenamed",
          agentId: agent.id,
          name: agent.name,
        };
        if (agent.id === this.store.activeAgentId) {
          renamed.branches = buildBranchesList(this.store, agent.id);
        }
        this.post(renamed);
      }
    );
  }

  private post(message: Record<string, unknown>): void {
    this.opts.emit(message);
  }

  private serializeModes() {
    const storedIds = new Set(getConfig().modes.map((m) => m.id));
    return getResolvedModes().map((m) => ({
      id: m.id,
      label: m.label,
      description: m.description || "",
      tools: m.tools,
      prompt: m.prompt || "",
      color: m.color || "",
      enabled: m.enabled !== false,
      builtin: Boolean(m.builtin),
      overridden: storedIds.has(m.id),
      placeholder: m.placeholder || "",
    }));
  }

  private modelsForUi() {
    return getEnabledModels().map((m) => ({
      id: m.id,
      label: m.label || m.id,
      providerId: m.providerId,
      supportsVision: m.supportsVision,
      supportsReasoningEffort: m.supportsReasoningEffort,
      reasoningEffortDefault: m.reasoningEffortDefault,
      favorite: m.favorite,
    }));
  }

  private agentMeta() {
    const agent = this.store.agents.find(
      (a) => a.id === this.store.activeAgentId
    );
    const name = agent
      ? getAgentDisplayName(agent, getActiveChat(this.store))
      : "Agent";
    const branches = agent ? buildBranchesList(this.store, agent.id) : [];
    return {
      agentId: agent?.id || "",
      agentName: name,
      chatTitle: name,
      chatId: this.store.activeChatId || "",
      branches,
    };
  }

  async handleWebviewMessage(msg: {
    type: string;
    [key: string]: unknown;
  }): Promise<unknown> {
    if (
      msg.type === "send" ||
      msg.type === "regenerate" ||
      msg.type === "editUserMessage"
    ) {
      HarborHeadless.applyIdeContext(msg.ideContext);
    }
    switch (msg.type) {
      case "ready":
        return this.onReady(String(msg.surface || "panel"));
      case "send": {
        // Do not await the full turn — otherwise openAgent/stop RPC stay queued
        // behind a long runAgentTurn. User bubble is persisted synchronously
        // before the first await inside onSend.
        void this.onSend(
          msg as {
            text?: unknown;
            model?: unknown;
            agentMode?: unknown;
            reasoningEffort?: unknown;
            attachments?: unknown;
            hideUser?: unknown;
          }
        ).catch((err) => {
          const text = err instanceof Error ? err.message : String(err);
          this.post({
            type: "runFailed",
            text,
            chatId: this.store.activeChatId,
          });
          this.post({ type: "idle", chatId: this.store.activeChatId });
        });
        return { ok: true, started: true };
      }
      case "editUserMessage":
        return this.onEditUserMessage(msg as {
          index?: unknown;
          text?: unknown;
          model?: unknown;
          agentMode?: unknown;
          reasoningEffort?: unknown;
          attachments?: unknown;
        });
      case "regenerate":
        return this.onRegenerate(msg as {
          agentMode?: unknown;
          reasoningEffort?: unknown;
        });
      case "stop": {
        // Per-chat: stop only the run of the chat the user is looking at.
        // Background runs in other chats keep going.
        const stopChatId = this.store.activeChatId || "";
        this.abortChatRun(stopChatId, "user-stop");
        if (stopChatId) {
          this.setStatusForChat(stopChatId, "", true);
        }
        this.post({ type: "stopped", chatId: stopChatId });
        this.post({ type: "idle", chatId: stopChatId });
        return { ok: true };
      }
      case "toolApprovalResult":
        resolveToolApproval(
          String(msg.requestId || ""),
          msg.approved === true
        );
        return { ok: true };
      case "restoreCheckpoint": {
        const chatId = String(msg.chatId || this.store.activeChatId || "");
        const runCount = Number(msg.checkpointRunCount);
        const result = await restoreClineChatCheckpoint(chatId, {
          checkpointRunCount:
            Number.isFinite(runCount) && runCount > 0 ? runCount : undefined,
        });
        if (result.ok) {
          const edited = this.store.chats[chatId]?.lastAgentEditedPaths || [];
          this.opts.onVfsRefresh?.(edited);
        }
        this.post({
          type: result.ok ? "status" : "runFailed",
          text: result.ok
            ? "Workspace restored from checkpoint"
            : result.error || "Checkpoint restore failed",
          chatId,
        });
        return result;
      }
      case "newChat":
      case "newAgent":
        return this.onNewAgent();
      case "openAgent":
        return this.onOpenAgent(String(msg.agentId || ""));
      case "renameAgent":
        return this.onRenameAgent(
          String(msg.agentId || ""),
          String(msg.name || "")
        );
      case "showAgents":
        this.postAgentsList();
        this.post({ type: "showAgents" });
        return { ok: true };
      case "showArchive":
        this.store.screen = "archive";
        this.postArchiveList();
        this.post({ type: "showArchive" });
        return { ok: true };
      case "archiveAgent":
        return this.onArchiveAgent(String(msg.agentId || ""));
      case "restoreAgent":
        return this.onRestoreAgent(String(msg.agentId || ""));
      case "deleteAgent":
        return this.onDeleteAgent(String(msg.agentId || ""));
      case "deleteAllArchived":
        return this.onDeleteAllArchived();
      case "deleteBranch":
        return this.onDeleteBranch(String(msg.chatId || ""));
      case "branchFromMessage":
        return this.onBranchFromMessage(Number(msg.messageIndex));
      case "switchBranch":
        return this.onSwitchBranch(String(msg.chatId || ""));
      case "discardChanges":
        return this.onDiscardChanges(
          Array.isArray(msg.paths) ? (msg.paths as unknown[]) : []
        );
      case "modelChanged":
        this.selectedModel = String(msg.model || "").trim();
        if (this.store.activeChatId) {
          touchChat(this.store, this.store.activeChatId, {
            selectedModel: this.selectedModel,
          });
          this.persist();
        }
        this.ensureProviderProbe(this.selectedModel);
        return { ok: true };
      case "modeChanged":
        this.selectedMode = String(msg.mode || "agent").trim() || "agent";
        if (this.store.activeChatId) {
          touchChat(this.store, this.store.activeChatId, {
            selectedMode: this.selectedMode,
          });
          this.persist();
        }
        return { ok: true };
      case "reasoningEffortChanged":
        this.selectedReasoningEffort = String(msg.reasoningEffort || "");
        if (this.store.activeChatId) {
          touchChat(this.store, this.store.activeChatId, {
            selectedReasoningEffort: this.selectedReasoningEffort,
          } as Partial<ChatSession>);
          this.persist();
        }
        return { ok: true };
      case "saveSettings": {
        const settings = (msg.settings || {}) as Record<string, unknown>;
        this.persistUiSettings(settings);
        this.reloadSettings();
        const mcp = getMcpManager();
        if (mcp && typeof settings.figmaEnabled === "boolean") {
          void mcp.setEnabled(settings.figmaEnabled === true);
        }
        this.providerConnStatuses.clear();
        this.postSettingsPayload();
        this.postUiFontSize();
        this.postFigmaStatus();
        this.postMcpServersList();
        this.post({
          type: "modelsUpdated",
          models: this.modelsForUi(),
          selectedModel: this.selectedModel,
        });
        this.post({ type: "modesUpdated", modes: this.serializeModes() });
        this.ensureAllProvidersProbed(true);
        return { ok: true };
      }
      case "listProviderModels":
        return this.handleListProviderModels(msg as {
          requestId?: unknown;
          providerId?: unknown;
          baseUrl?: unknown;
          apiKey?: unknown;
          rejectUnauthorized?: unknown;
        });
      case "saveModes": {
        const modes = msg.modes;
        this.persistUiSettings({ modes });
        this.reloadSettings();
        this.post({ type: "modesUpdated", modes: this.serializeModes() });
        return { ok: true };
      }
      case "showSettings":
        this.postSettingsPayload();
        this.postSkillsList();
        this.post({ type: "showSettings" });
        return { ok: true };
      case "closeSettings":
        return { ok: true };
      case "figmaRefreshStatus":
        return this.refreshFigmaStatus();
      case "figmaConnect":
        return this.handleFigmaConnect();
      case "figmaDisconnect":
        return this.handleFigmaDisconnect();
      case "figmaConnectPat":
        return this.handleFigmaConnectPat(String(msg.token || ""));
      case "mcpRefreshList":
        this.postMcpServersList();
        return { ok: true };
      case "mcpSetEnabled":
        return this.handleMcpSetEnabled(
          String(msg.id || ""),
          Boolean(msg.enabled)
        );
      case "mcpConnectServer":
        return this.handleMcpConnect(String(msg.id || ""));
      case "mcpDeleteServer":
        return this.handleMcpDelete(String(msg.id || ""));
      case "mcpUpsertServer":
        return this.handleMcpUpsert(
          (msg.server || {}) as Record<string, unknown>
        );
      case "skillsRefreshList":
        this.postSkillsList();
        return { ok: true };
      case "skillsSetMasterEnabled":
        return this.handleSkillsSetMasterEnabled(Boolean(msg.enabled));
      case "skillsSetEnabled":
        return this.handleSkillsSetEnabled(
          String(msg.name || ""),
          Boolean(msg.enabled)
        );
      case "skillsSetSourceEnabled":
        return this.handleSkillsSetSourceEnabled(
          String(msg.source || ""),
          Boolean(msg.enabled),
          String(msg.path || "")
        );
      case "skillsAddDirectory":
        return this.handleSkillsAddDirectory(String(msg.path || ""));
      case "skillsRemoveDirectory":
        return this.handleSkillsRemoveDirectory(String(msg.path || ""));
      case "skillsPickDirectory":
        // Folder picker is IDE-native (VS Code dialog / JetBrains FileChooser).
        return { ok: true, deferred: true, type: msg.type };
      case "skillsOpenPath":
        return { ok: true, deferred: true, type: msg.type };
      default:
        return { ok: true, deferred: true, type: msg.type };
    }
  }

  /** Map VS Code settings UI payload → global settings file. */
  private persistUiSettings(settings: Record<string, unknown>): void {
    const existing =
      (readJsonFile(this.opts.settingsPath) as Record<string, unknown>) || {};
    const agentPanel: Record<string, unknown> = {
      ...((existing.agentPanel as object) || {}),
      ...settings,
    };
    // Flatten common keys for headless getConfiguration("agentPanel")
    const next: Record<string, unknown> = {
      ...existing,
      ...settings,
      agentPanel,
    };
    writeJsonFile(this.opts.settingsPath, next);
  }

  private buildSettingsPayload(): Record<string, unknown> {
    const config = getConfig();
    return {
      ...buildHarborSettingsPayloadCore(config),
      modes: this.serializeModes(),
      workspaceName: path.basename(this.opts.workspaceRoot),
      figma: this.getFigmaStatusPayload(),
      providerConnStatuses: this.getProviderConnStatusesPayload(),
    };
  }

  private getProviderConnStatusesPayload(): ProviderConnStatus[] {
    return getConfig().providers.map((p) => {
      const existing = this.providerConnStatuses.get(p.id);
      if (existing) {
        return { ...existing };
      }
      return {
        providerId: p.id,
        providerName: p.name || p.id,
        state: "unknown" as const,
        updatedAt: 0,
      };
    });
  }

  private getProviderConnStatusForModel(modelId: string): ProviderConnStatus {
    const endpoint = resolveModelEndpoint(modelId || this.selectedModel);
    const providerId = endpoint.providerId || "";
    if (!providerId) {
      return {
        providerId: "",
        providerName: endpoint.providerName || "",
        state: "error",
        message: "No provider configured",
        updatedAt: Date.now(),
      };
    }
    const existing = this.providerConnStatuses.get(providerId);
    if (existing) {
      return { ...existing };
    }
    return {
      providerId,
      providerName: endpoint.providerName || providerId,
      state: "unknown",
      updatedAt: 0,
    };
  }

  private isProviderStatusFresh(
    status: ProviderConnStatus | undefined
  ): boolean {
    if (!status || status.state === "unknown" || status.state === "connecting") {
      return false;
    }
    return Date.now() - status.updatedAt < PROVIDER_PROBE_TTL_MS;
  }

  private postProviderConnStatus(status: ProviderConnStatus): void {
    this.post({ type: "providerConnStatus", status });
  }

  private setProviderConnStatus(status: ProviderConnStatus): void {
    if (!status.providerId) {
      this.postProviderConnStatus(status);
      return;
    }
    this.providerConnStatuses.set(status.providerId, status);
    this.postProviderConnStatus(status);
  }

  private ensureAllProvidersProbed(force = false): void {
    for (const provider of getConfig().providers) {
      const current = this.providerConnStatuses.get(provider.id);
      if (!force && this.isProviderStatusFresh(current)) {
        this.postProviderConnStatus(current!);
        continue;
      }
      void this.probeProvider(provider.id, { force, silent: Boolean(force) });
    }
  }

  private ensureProviderProbe(modelId?: string, force = false): void {
    const endpoint = resolveModelEndpoint(modelId || this.selectedModel);
    const providerId = endpoint.providerId || "";
    if (!providerId) {
      this.postProviderConnStatus({
        providerId: "",
        providerName: endpoint.providerName || "",
        state: "error",
        message: "No provider configured",
        updatedAt: Date.now(),
      });
      return;
    }
    const current = this.providerConnStatuses.get(providerId);
    if (!force && this.isProviderStatusFresh(current)) {
      this.postProviderConnStatus(current!);
      return;
    }
    void this.probeProvider(providerId, { force });
  }

  private async probeProvider(
    providerId: string,
    options?: { force?: boolean; silent?: boolean }
  ): Promise<ProviderConnStatus | undefined> {
    const force = Boolean(options?.force);
    const silent = Boolean(options?.silent);
    if (!providerId) {
      return undefined;
    }
    const config = getConfig();
    applyHarborTlsPolicy(config.rejectUnauthorized);
    const provider = config.providers.find((p) => p.id === providerId);
    const endpoint = provider
      ? {
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey || "",
          providerId: provider.id,
          providerName: provider.name || provider.id,
          statusUrl: provider.statusUrl,
        }
      : resolveModelEndpoint(this.selectedModel);

    const existing = this.providerConnStatuses.get(providerId);
    if (!force && this.isProviderStatusFresh(existing)) {
      return existing!;
    }

    const inFlight = this.providerProbePromises.get(providerId);
    if (inFlight) {
      return inFlight;
    }

    if (!silent || !existing || existing.state === "unknown") {
      this.setProviderConnStatus({
        providerId,
        providerName: endpoint.providerName || providerId,
        state: "connecting",
        updatedAt: Date.now(),
      });
    }

    const promise = (async (): Promise<ProviderConnStatus> => {
      const probeUrl = resolveProviderProbeUrl({
        baseUrl: endpoint.baseUrl,
        statusUrl: endpoint.statusUrl,
      });
      if (!probeUrl) {
        const status: ProviderConnStatus = {
          providerId,
          providerName: endpoint.providerName || providerId,
          state: "error",
          message: "No base URL",
          updatedAt: Date.now(),
        };
        this.setProviderConnStatus(status);
        return status;
      }

      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        PROVIDER_PROBE_TIMEOUT_MS
      );
      try {
        const client = getOpenAICompatibleClient(
          endpoint.baseUrl || probeUrl,
          endpoint.apiKey,
          {
            rejectUnauthorized: config.rejectUnauthorized,
            caBundlePath: config.caBundlePath,
          }
        );
        const defaultModelsUrl = endpoint.baseUrl
          ? resolveProviderProbeUrl({ baseUrl: endpoint.baseUrl })
          : "";
        if (probeUrl === defaultModelsUrl) {
          const models = await client.listModels(controller.signal);
          const status: ProviderConnStatus = {
            providerId,
            providerName: endpoint.providerName || providerId,
            state: "connected",
            modelCount: models.length,
            updatedAt: Date.now(),
          };
          this.setProviderConnStatus(status);
          return status;
        }
        await client.probeGet(probeUrl, controller.signal);
        const status: ProviderConnStatus = {
          providerId,
          providerName: endpoint.providerName || providerId,
          state: "connected",
          updatedAt: Date.now(),
        };
        this.setProviderConnStatus(status);
        return status;
      } catch (error) {
        const aborted =
          controller.signal.aborted ||
          (error instanceof Error &&
            (error.message === "aborted" || /abort/i.test(error.message)));
        const raw = error instanceof Error ? error.message : String(error);
        const status: ProviderConnStatus = {
          providerId,
          providerName: endpoint.providerName || providerId,
          state: "error",
          message: (aborted ? "Timeout" : raw).slice(0, 160),
          updatedAt: Date.now(),
        };
        this.setProviderConnStatus(status);
        return status;
      } finally {
        clearTimeout(timer);
      }
    })();

    this.providerProbePromises.set(providerId, promise);
    try {
      return await promise;
    } finally {
      this.providerProbePromises.delete(providerId);
    }
  }

  private async handleListProviderModels(msg: {
    requestId?: unknown;
    providerId?: unknown;
    baseUrl?: unknown;
    apiKey?: unknown;
    rejectUnauthorized?: unknown;
  }): Promise<unknown> {
    const requestId = String(msg.requestId || "");
    const providerId = String(msg.providerId || "").trim();
    const config = getConfig();
    applyHarborTlsPolicy(config.rejectUnauthorized);
    const saved = config.providers.find((p) => p.id === providerId);
    const baseUrl = String(msg.baseUrl || saved?.baseUrl || "")
      .trim()
      .replace(/\/$/, "");
    const apiKey =
      typeof msg.apiKey === "string" ? msg.apiKey : saved?.apiKey || "";
    const rejectUnauthorized =
      typeof msg.rejectUnauthorized === "boolean"
        ? msg.rejectUnauthorized
        : config.rejectUnauthorized;

    const reply = (payload: {
      models?: ListedProviderModel[];
      error?: string;
    }) => {
      this.post({
        type: "providerModelsListed",
        requestId,
        providerId,
        models: payload.models || [],
        error: payload.error,
      });
    };

    if (!providerId) {
      reply({ error: "No provider id" });
      return { ok: false };
    }
    if (!baseUrl) {
      reply({ error: "No base URL" });
      return { ok: false };
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      PROVIDER_PROBE_TIMEOUT_MS
    );
    try {
      const client = getOpenAICompatibleClient(baseUrl, apiKey, {
        rejectUnauthorized,
        caBundlePath: config.caBundlePath,
      });
      const models = await client.listModels(controller.signal);
      reply({ models });
      return { ok: true };
    } catch (error) {
      const aborted =
        controller.signal.aborted ||
        (error instanceof Error &&
          (error.message === "aborted" || /abort/i.test(error.message)));
      const raw = error instanceof Error ? error.message : String(error);
      reply({ error: (aborted ? "Timeout" : raw).slice(0, 240) });
      return { ok: false, error: raw };
    } finally {
      clearTimeout(timer);
    }
  }

  private postSettingsPayload(): void {
    this.post({
      type: "settings",
      settings: this.buildSettingsPayload(),
    });
  }

  private postUiFontSize(): void {
    this.post({
      type: "uiFontSize",
      fontSize: getConfig().fontSize,
    });
  }

  private readySeq = 0;
  private lastReadyAt = 0;
  /** Chat id last fully painted by onReady — debounce only same-chat repeats. */
  private lastReadyChatId = "";

  private async onReady(surface: string): Promise<unknown> {
    // JetBrains JCEF may emit ready several times (load + host timer + panel retry).
    // Do NOT suppress when the active chat changed — otherwise switching agents
    // within 1.5s skips showChat and the webview keeps the previous (often empty) transcript.
    const now = Date.now();
    const activeChatId = this.store.activeChatId || "";
    if (
      now - this.lastReadyAt < 1500 &&
      surface !== "settings" &&
      activeChatId &&
      activeChatId === this.lastReadyChatId
    ) {
      return { ok: true, deduped: true };
    }
    this.lastReadyAt = now;
    this.lastReadyChatId = activeChatId;
    const seq = ++this.readySeq;
    await new Promise((r) => setTimeout(r, 30));
    if (seq !== this.readySeq) {
      return { ok: true, deduped: true };
    }
    this.reloadSettings();
    if (surface === "settings") {
      this.postSettingsPayload();
      this.post({ type: "showSettings" });
      this.postFigmaStatus();
      this.postMcpServersList();
      return { ok: true };
    }

    this.acknowledgeViewedChatRunState(this.store.activeChatId);
    const models = this.modelsForUi();
    if (!this.selectedModel && models[0]) {
      this.selectedModel = models[0].id;
    }
    const meta = this.agentMeta();
    const busy =
      this.chatRunState.get(this.store.activeChatId || "") === "running";
    // Prefer store transcript for paint — live this.uiMessages can lag after a
    // rapid agent switch if hydrate and a background sync raced.
    const paintUi = await this.enrichUiMessages(
      (
        getActiveChat(this.store)?.uiMessages || this.uiMessages || []
      ).slice()
    );
    this.post({
      type: "init",
      models,
      selectedModel: this.selectedModel,
      selectedMode: this.selectedMode,
      selectedReasoningEffort: this.selectedReasoningEffort,
      uiMessages: paintUi,
      busy,
      canRegenerate: Boolean(this.getRegenerateState()),
      screen: this.store.screen || "chat",
      ...meta,
      contextUsed: this.contextTokens,
      contextMax: getContextWindow(this.selectedModel),
      modes: this.serializeModes(),
      harborHost: "jetbrains",
      fontSize: getConfig().fontSize,
      providerConnStatus: this.getProviderConnStatusForModel(this.selectedModel),
      status: this.chatStatusState.get(this.store.activeChatId || "") || null,
    });
    this.postAgentsList();
    this.postSettingsPayload();
    this.postFigmaStatus();
    this.postMcpServersList();
    this.post({
      type: "showChat",
      models,
      selectedModel: this.selectedModel,
      selectedMode: this.selectedMode,
      selectedReasoningEffort: this.selectedReasoningEffort,
      uiMessages: paintUi,
      busy,
      canRegenerate: Boolean(this.getRegenerateState()),
      ...meta,
      contextUsed: this.contextTokens,
      contextMax: getContextWindow(this.selectedModel),
      status: this.chatStatusState.get(this.store.activeChatId || "") || null,
      providerConnStatus: this.getProviderConnStatusForModel(this.selectedModel),
      fontSize: getConfig().fontSize,
    });
    this.ensureAllProvidersProbed();
    this.scheduleScmRefresh([200, 800]);
    return { ok: true };
  }

  private modelLabel(modelId: string): string {
    const id = String(modelId || "").trim();
    if (!id) {
      return "—";
    }
    const row = getConfig().models.find((m) => m.id === id);
    return String(row?.label || id).trim() || id;
  }

  /** Label for the chat busy-line; empty so the webview omits `(—)`. */
  private statusModelLabel(modelId: string): string {
    const label = this.modelLabel(modelId);
    return !label || label === "—" ? "" : label;
  }

  private setStatusForChat(
    chatId: string | undefined,
    text: string,
    hidden = false,
    phase?: AgentPhase,
    modelLabel?: string
  ): void {
    if (!chatId) {
      return;
    }
    const nextHidden = Boolean(hidden || !text);
    if (nextHidden) {
      this.chatStatusState.delete(chatId);
    } else {
      this.chatStatusState.set(chatId, {
        text,
        hidden: false,
        phase,
        modelLabel: modelLabel || undefined,
      });
    }
    if (this.isViewingChat(chatId)) {
      this.post({
        type: "status",
        chatId,
        text,
        hidden: nextHidden,
        phase,
        modelLabel: nextHidden ? undefined : modelLabel || undefined,
      });
    }
  }

  private isViewingChat(chatId: string | undefined): boolean {
    return Boolean(chatId) && this.store.activeChatId === chatId;
  }

  private setRunStateForChat(
    chatId: string,
    state?: ChatRunState
  ): void {
    if (!findAgentByChatId(this.store, chatId)) {
      return;
    }
    if (state === "running" || (state && !this.isViewingChat(chatId))) {
      this.chatRunState.set(chatId, state);
    } else {
      this.chatRunState.delete(chatId);
    }
    this.postAgentsList();
  }

  private acknowledgeViewedChatRunState(chatId: string | undefined): boolean {
    if (!chatId || this.chatRunState.get(chatId) === "running") {
      return false;
    }
    return this.chatRunState.delete(chatId);
  }

  private runStateForAgent(agentId: string): ChatRunState | "" {
    const agent = this.store.agents.find((item) => item.id === agentId);
    if (!agent) {
      return "";
    }
    const states = getAgentChatIds(agent)
      .map((id) => this.chatRunState.get(id))
      .filter((state): state is ChatRunState => Boolean(state));
    if (states.includes("running")) {
      return "running";
    }
    if (states.includes("error")) {
      return "error";
    }
    return states.includes("success") ? "success" : "";
  }

  private runModeForAgent(agentId: string): string {
    const agent = this.store.agents.find((item) => item.id === agentId);
    if (!agent) {
      return "";
    }
    for (const chatId of getAgentChatIds(agent)) {
      if (this.chatRunState.get(chatId) !== "running") {
        continue;
      }
      return getModeById(this.store.chats[chatId]?.selectedMode).id;
    }
    return "";
  }

  private postAgentsList(): void {
    const lang = resolveUiLanguage(getConfig().language);
    const agents = buildAgentsList(this.store).map((a) => ({
      id: a.id,
      name: a.name,
      model: this.modelLabel(a.model) || a.model || "—",
      preview: a.preview,
      time: formatListTime(a.createdAt || a.updatedAt, lang),
      active: a.active,
      empty: a.empty,
      runState: this.runStateForAgent(a.id),
      runMode: this.runModeForAgent(a.id),
    }));
    this.post({
      type: "agentsList",
      agents,
      activeAgentId: this.store.activeAgentId,
      screen: this.store.screen || "chat",
    });
  }

  private postArchiveList(): void {
    const lang = resolveUiLanguage(getConfig().language);
    const agents = buildArchiveList(this.store).map((a) => ({
      id: a.id,
      name: a.name,
      preview: a.preview,
      archivedAt: a.archivedAt,
      time: formatListTime(a.archivedAt, lang),
    }));
    this.post({
      type: "archiveList",
      agents,
    });
  }

  private async afterStoreMutation(opts?: {
    preferArchive?: boolean;
    showAgentsRail?: boolean;
  }): Promise<void> {
    ensureActiveVisible(this.store);
    this.hydrateFromActiveChat();
    this.persist();
    this.postAgentsList();
    if (opts?.preferArchive || this.store.screen === "archive") {
      this.store.screen = "archive";
      this.postArchiveList();
      this.post({ type: "showArchive" });
      return;
    }
    this.store.screen = "chat";
    // Bypass ready debounce so list/chat refresh after delete/archive.
    this.lastReadyAt = 0;
    await this.onReady("panel");
    if (opts?.showAgentsRail) {
      this.post({ type: "showAgents" });
    }
  }

  private async onArchiveAgent(agentId: string): Promise<unknown> {
    const agent = this.store.agents.find((a) => a.id === agentId);
    if (!agent || agent.archivedAt) {
      return { ok: false };
    }
    const chatIds = getAgentChatIds(agent);
    for (const id of chatIds) {
      if (this.chatRunState.get(id) === "running") {
        this.abortChatRun(id, "delete-agent");
      }
    }
    await discardClineChatSessions(chatIds);
    if (!archiveAgentInStore(this.store, agentId)) {
      return { ok: false };
    }
    retainClineChatSession(this.store.activeChatId);
    await this.afterStoreMutation({ showAgentsRail: true });
    return { ok: true };
  }

  private async onRestoreAgent(agentId: string): Promise<unknown> {
    if (!agentId || !restoreAgentInStore(this.store, agentId)) {
      return { ok: false };
    }
    this.store.screen = "archive";
    this.persist();
    this.postArchiveList();
    this.postAgentsList();
    this.post({ type: "showArchive" });
    return { ok: true };
  }

  private async onDeleteAgent(agentId: string): Promise<unknown> {
    if (!agentId) {
      return { ok: false };
    }
    const preferArchive = this.store.screen === "archive";
    const agent = this.store.agents.find((a) => a.id === agentId);
    if (agent) {
      for (const id of getAgentChatIds(agent)) {
        if (this.chatRunState.get(id) === "running") {
          this.abortChatRun(id, "delete-agent");
        }
      }
      await discardClineChatSessions(getAgentChatIds(agent));
    }
    if (!deleteAgentFromStore(this.store, agentId)) {
      return { ok: false };
    }
    retainClineChatSession(this.store.activeChatId);
    await this.afterStoreMutation({
      preferArchive,
      showAgentsRail: !preferArchive,
    });
    return { ok: true };
  }

  private async onDeleteAllArchived(): Promise<unknown> {
    const archived = buildArchiveList(this.store);
    const ids: string[] = [];
    for (const item of archived) {
      const agent = this.store.agents.find((a) => a.id === item.id);
      if (!agent) {
        continue;
      }
      ids.push(...getAgentChatIds(agent));
    }
    await discardClineChatSessions(ids);
    const n = deleteAllArchivedAgentsFromStore(this.store);
    if (!n) {
      return { ok: true, deleted: 0 };
    }
    retainClineChatSession(this.store.activeChatId);
    this.store.screen = "archive";
    ensureActiveVisible(this.store);
    this.hydrateFromActiveChat();
    this.persist();
    this.postAgentsList();
    this.postArchiveList();
    this.post({ type: "showArchive" });
    return { ok: true, deleted: n };
  }

  private async onDeleteBranch(chatId: string): Promise<unknown> {
    const agentId = this.store.activeAgentId;
    if (!agentId || !chatId) {
      return { ok: false };
    }
    // Match VS Code: stop a run on the branch being deleted, then flush.
    if (this.chatRunState.get(chatId) === "running") {
      this.abortChatRun(chatId, "delete-agent");
      this.post({ type: "stopped", chatId });
      this.post({ type: "idle", chatId });
    }
    this.flushActiveChatToStore();
    await discardClineChatSession(chatId);
    if (!deleteAgentBranch(this.store, agentId, chatId)) {
      return { ok: false };
    }
    retainClineChatSession(this.store.activeChatId);
    this.chatRunState.delete(chatId);
    this.store.screen = "chat";
    this.hydrateFromActiveChat();
    this.persist();
    this.postAgentsList();
    // Bypass ready debounce and push a fresh showChat (branches) — JCEF OSR
    // otherwise keeps painting deleted fork pills.
    this.lastReadyAt = 0;
    await this.onReady("panel");
    return { ok: true };
  }

  private async onBranchFromMessage(messageIndex: number): Promise<unknown> {
    const agentId = this.store.activeAgentId;
    const fromChatId = this.store.activeChatId;
    if (!agentId || !fromChatId || !Number.isInteger(messageIndex)) {
      return { ok: false, error: "invalid" };
    }
    this.flushActiveChatToStore();
    const source = this.store.chats[fromChatId];
    const created = branchChatFromMessage(
      this.store,
      agentId,
      fromChatId,
      messageIndex,
      this.history.length
        ? this.history
        : Array.isArray(source?.history)
          ? source!.history
          : [],
      this.uiMessages.length
        ? this.uiMessages
        : Array.isArray(source?.uiMessages)
          ? source!.uiMessages
          : []
    );
    if (!created) {
      return { ok: false, error: "cannot branch" };
    }
    onClineActiveChatChanged({
      previousChatId: fromChatId,
      nextChatId: created.id,
      previousStillRunning: this.isChatRunning(fromChatId),
    });
    this.store.screen = "chat";
    this.hydrateFromActiveChat();
    this.persist();
    this.postAgentsList();
    this.lastReadyAt = 0;
    await this.onReady("panel");
    this.scheduleChatTitle(created.id);
    return { ok: true, chatId: created.id };
  }

  private async onSwitchBranch(chatId: string): Promise<unknown> {
    if (!chatId) {
      return { ok: false };
    }
    if (chatId === this.store.activeChatId) {
      return { ok: true };
    }
    this.flushActiveChatToStore();
    const previousChatId = this.store.activeChatId;
    if (!switchAgentBranch(this.store, this.store.activeAgentId, chatId)) {
      return { ok: false };
    }
    onClineActiveChatChanged({
      previousChatId,
      nextChatId: chatId,
      previousStillRunning: this.isChatRunning(previousChatId),
    });
    this.store.screen = "chat";
    this.hydrateFromActiveChat();
    this.persist();
    if (this.acknowledgeViewedChatRunState(chatId)) {
      this.postAgentsList();
    }
    this.lastReadyAt = 0;
    await this.onReady("panel");
    return { ok: true };
  }

  private mergeEdits(edits: FileEditStat[]): FileEditStat[] {
    const map = new Map<string, FileEditStat>();
    for (const edit of edits) {
      const key = String(edit.path || "").trim();
      if (!key) {
        continue;
      }
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { ...edit, path: key });
        continue;
      }
      map.set(key, {
        path: key,
        created: prev.created || edit.created,
        added: prev.added + edit.added,
        removed: prev.removed + edit.removed,
      });
    }
    return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Same contract as VS Code publishReview: webview expects `{ files, showScm }`,
   * not raw `edits`.
   */
  private async publishReview(
    edits: FileEditStat[],
    chatId: string,
    runUiMessages: UiMessage[]
  ): Promise<UiMessage[]> {
    const folder = this.opts.workspaceRoot;
    const unique = this.mergeEdits(edits)
      .map((e) => ({
        ...e,
        path: folder ? toRepoRelativePath(e.path, folder) || e.path : e.path,
      }))
      .filter((e) => Boolean(e.path));
    if (!unique.length) {
      return runUiMessages;
    }

    // Prefer live git dirty set so a turn that wrote then reverted does not
    // leave a permanent SCM strip (+N −M) with Commit/Discard.
    let remaining: FileEditStat[] = [];
    try {
      remaining = await resolveRemainingReviewFiles(
        unique.map((f) => f.path),
        folder
      );
    } catch {
      remaining = [];
    }
    const files = remaining.length ? remaining : unique;
    let showScm = remaining.length > 0;
    if (!showScm) {
      try {
        showScm = await hasUncommittedChanges(unique.map((f) => f.path));
      } catch {
        showScm = false;
      }
    }

    const nextUi = [
      ...runUiMessages,
      {
        role: "review" as const,
        text: JSON.stringify({ files, showScm }),
      },
    ];
    touchChat(this.store, chatId, {
      uiMessages: nextUi,
      lastAgentEditedPaths: files.map((f) => f.path),
    });
    this.persist();
    if (this.store.activeChatId === chatId) {
      this.uiMessages = nextUi;
      this.post({
        type: "review",
        files,
        showScm,
        chatId,
      });
    }
    this.scheduleScmRefresh([400, 1200]);
    return nextUi;
  }

  private scheduleScmRefresh(delayMs: number | number[] = 400): void {
    const delays = Array.isArray(delayMs) ? delayMs : [delayMs];
    for (const ms of delays) {
      setTimeout(() => {
        void this.refreshReviewScmButtons();
      }, Math.max(0, ms));
    }
  }

  private async refreshReviewScmButtons(): Promise<void> {
    if (this.store.screen && this.store.screen !== "chat") {
      return;
    }
    const chatId = this.store.activeChatId;
    if (!chatId || !this.store.chats[chatId]) {
      return;
    }

    // Prefer live snapshot when viewing this chat.
    let uiMessages =
      this.store.activeChatId === chatId
        ? [...this.uiMessages]
        : [...(this.store.chats[chatId]?.uiMessages || [])];

    const reviews: {
      paths: string[];
      showScm: boolean;
      files: FileEditStat[];
    }[] = [];
    let changed = false;

    for (let i = 0; i < uiMessages.length; i++) {
      const msg = uiMessages[i];
      if (msg.role !== "review") {
        continue;
      }
      let parsed: { files: FileEditStat[]; showScm: boolean };
      try {
        const data = JSON.parse(String(msg.text || "")) as
          | FileEditStat[]
          | { files?: FileEditStat[]; showScm?: boolean };
        if (Array.isArray(data)) {
          parsed = { files: data, showScm: false };
        } else {
          parsed = {
            files: Array.isArray(data.files) ? data.files : [],
            showScm: Boolean(data.showScm),
          };
        }
      } catch {
        continue;
      }
      if (!parsed.files.length) {
        continue;
      }
      const seedPaths = parsed.files.map((f) => f.path);
      const remaining = await resolveRemainingReviewFiles(
        seedPaths,
        this.opts.workspaceRoot
      );
      const showScm = remaining.length > 0;
      const files = showScm ? remaining : parsed.files;
      reviews.push({
        paths: files.map((f) => f.path),
        showScm,
        files,
      });

      const sameFiles =
        files.length === parsed.files.length &&
        files.every((f, idx) => {
          const prev = parsed.files[idx];
          return (
            prev &&
            prev.path === f.path &&
            Number(prev.added) === Number(f.added) &&
            Number(prev.removed) === Number(f.removed)
          );
        });
      if (parsed.showScm !== showScm || !sameFiles) {
        changed = true;
        uiMessages[i] = {
          ...msg,
          text: JSON.stringify({ files, showScm }),
        };
      }
    }

    if (changed) {
      touchChat(this.store, chatId, {
        uiMessages: uiMessages.slice(-200),
      });
      this.persist();
      if (this.store.activeChatId === chatId) {
        this.uiMessages = uiMessages;
      }
    }

    if (reviews.length > 0) {
      this.post({ type: "scmButtons", reviews, chatId });
    } else {
      // Explicitly clear composer SCM strip when no review cards remain dirty.
      this.post({ type: "scmButtons", reviews: [], chatId });
    }
  }

  private async onDiscardChanges(rawPaths: unknown[]): Promise<unknown> {
    const chatId = this.store.activeChatId;
    if (!chatId || this.chatRuns.has(chatId)) {
      this.post({ type: "discardCancelled", chatId });
      this.post({ type: "idle", chatId });
      return { ok: false, error: "busy" };
    }
    const paths = rawPaths.map((p) => String(p || "").trim()).filter(Boolean);
    if (!paths.length) {
      this.post({ type: "discardCancelled", chatId });
      this.post({ type: "idle", chatId });
      return { ok: false, error: "no paths" };
    }
    this.post({ type: "discardStarted", chatId });
    try {
      const remaining = await resolveRemainingReviewFiles(
        paths,
        this.opts.workspaceRoot
      );
      const targets = [
        ...new Set([
          ...(remaining.length ? remaining.map((f) => f.path) : []),
          ...paths,
        ]),
      ];
      const chat = this.store.chats[chatId];
      const fallbackPaths = Array.isArray(chat?.lastAgentEditedPaths)
        ? chat.lastAgentEditedPaths
        : [];
      const result = await discardPaths(targets, { fallbackPaths });
      if (result.ok) {
        touchChat(this.store, chatId, { lastAgentEditedPaths: [] });
        this.persist();
      }
      this.post({
        type: "assistantDone",
        text: result.answer,
        chatId,
      });
      this.opts.onVfsRefresh?.(targets);
      await this.refreshReviewScmButtons();
      this.post({ type: "idle", chatId });
      return { ok: result.ok, answer: result.answer };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({
        type: "append",
        role: "error",
        text: message,
        chatId,
      });
      this.post({ type: "idle", chatId });
      return { ok: false, error: message };
    }
  }

  private flushActiveChatToStore(): void {
    const chatId = this.store.activeChatId;
    if (!chatId || !this.store.chats[chatId]) {
      return;
    }
    // While a turn owns this chat, syncRunChat already wrote history/uiMessages.
    // Flushing this.uiMessages on switch can stomp that with a stale snapshot.
    const running = this.chatRunState.get(chatId) === "running";
    touchChat(this.store, chatId, {
      selectedModel: this.selectedModel,
      selectedMode: this.selectedMode,
      selectedReasoningEffort: this.selectedReasoningEffort,
      contextTokens: this.contextTokens,
      ...(running
        ? {}
        : {
            history: this.history,
            uiMessages: this.uiMessages,
          }),
    } as Partial<ChatSession>);
    this.persist();
  }

  private isChatRunning(chatId: string | undefined): boolean {
    return Boolean(chatId && this.chatRuns.has(chatId));
  }

  /**
   * Abort and deregister the live turn of one chat (VS Code parity).
   * Leaves runs of other chats untouched.
   */
  private abortChatRun(
    chatId: string | undefined,
    reason = "user-stop"
  ): void {
    if (!chatId) {
      return;
    }
    const controller = this.chatRuns.get(chatId);
    if (controller) {
      this.chatRuns.delete(chatId);
      controller.abort(reason);
    }
    // Clear the rail loader immediately — do not wait for the async turn catch.
    if (this.chatRunState.get(chatId) === "running") {
      this.setRunStateForChat(chatId);
    }
  }

  /**
   * Call before changing `store.activeChatId`. Idle-evicts the previous
   * Cline session unless a turn is still running there.
   */
  private syncClineSessionForChatSwitch(nextChatId: string): void {
    onClineActiveChatChanged({
      previousChatId: this.store.activeChatId,
      nextChatId,
      previousStillRunning: this.isChatRunning(this.store.activeChatId),
    });
    HarborHeadless.resetIdeTerminalSnapshot();
  }

  private async onNewAgent(): Promise<unknown> {
    this.flushActiveChatToStore();
    const { agent, chat } = createEmptyAgent(this.selectedModel);
    this.syncClineSessionForChatSwitch(chat.id);
    this.store.agents.unshift(agent);
    this.store.chats[chat.id] = chat;
    this.store.activeAgentId = agent.id;
    this.store.activeChatId = chat.id;
    this.store.screen = "chat";
    this.hydrateFromActiveChat();
    this.persist();
    this.postAgentsList();
    this.lastReadyAt = 0;
    this.lastReadyChatId = "";
    await this.onReady("panel");
    return { ok: true };
  }

  private async onRenameAgent(agentId: string, name: string): Promise<unknown> {
    const agent = this.store.agents.find((a) => a.id === agentId);
    const next = String(name || "").trim();
    if (!agent || !next) {
      return { ok: false };
    }
    applyAgentName(this.store, agent.id, next, "user");
    this.persist();
    this.postAgentsList();
    const renamed: Record<string, unknown> = {
      type: "agentRenamed",
      agentId: agent.id,
      name: agent.name,
    };
    if (agent.id === this.store.activeAgentId) {
      renamed.branches = buildBranchesList(this.store, agent.id);
    }
    this.post(renamed);
    return { ok: true };
  }

  private async onOpenAgent(agentId: string): Promise<unknown> {
    const agent = this.store.agents.find((a) => a.id === agentId);
    if (!agent) {
      return { ok: false, error: "agent not found" };
    }
    this.flushActiveChatToStore();
    this.syncClineSessionForChatSwitch(agent.chatId);
    this.store.activeAgentId = agent.id;
    this.store.activeChatId = agent.chatId;
    this.store.screen = "chat";
    this.hydrateFromActiveChat();
    this.persist();
    if (this.acknowledgeViewedChatRunState(agent.chatId)) {
      this.postAgentsList();
    }
    // Force showChat even if another ready fired recently (agent switch).
    this.lastReadyAt = 0;
    this.lastReadyChatId = "";
    await this.onReady("panel");
    return { ok: true };
  }

  private historyContentText(content: ChatMessage["content"] | undefined): string {
    if (!content) {
      return "";
    }
    if (typeof content === "string") {
      return content;
    }
    if (!Array.isArray(content)) {
      return "";
    }
    return content
      .map((part) =>
        part && typeof part === "object" && (part as { type?: string }).type === "text"
          ? String((part as { text?: string }).text || "")
          : "[image]"
      )
      .join("\n")
      .trim();
  }

  private getRegenerateState():
    | {
        userText: string;
        attachments: MessageAttachment[];
        model: string;
        history: ChatMessage[];
        uiMessages: UiMessage[];
      }
    | undefined {
    const model = (this.lastTurnModel || this.selectedModel || "").trim();
    if (!model || this.history.length < 2) {
      return undefined;
    }
    const lastAssistant = this.history[this.history.length - 1];
    const lastUser = this.history[this.history.length - 2];
    const lastUserText = this.historyContentText(lastUser?.content);
    const lastAssistantText = this.historyContentText(lastAssistant?.content);
    if (
      lastUser?.role !== "user" ||
      !lastUserText ||
      lastAssistant?.role !== "assistant" ||
      !lastAssistantText
    ) {
      return undefined;
    }
    let assistantIndex = -1;
    for (let i = this.uiMessages.length - 1; i >= 0; i--) {
      const msg = this.uiMessages[i];
      if (msg.role === "assistant" && String(msg.text || "").trim()) {
        assistantIndex = i;
        break;
      }
    }
    if (assistantIndex < 0) {
      return undefined;
    }
    for (let i = assistantIndex + 1; i < this.uiMessages.length; i++) {
      const msg = this.uiMessages[i];
      if (
        msg.role === "user" &&
        (String(msg.text || "").trim() || msg.attachments?.length)
      ) {
        return undefined;
      }
    }
    let userIndex = -1;
    for (let i = assistantIndex - 1; i >= 0; i--) {
      const msg = this.uiMessages[i];
      if (
        msg.role === "user" &&
        (String(msg.text || "").trim() || msg.attachments?.length)
      ) {
        userIndex = i;
        break;
      }
    }
    if (userIndex < 0) {
      return undefined;
    }
    const uiUser = this.uiMessages[userIndex];
    const attachments = (uiUser.attachments || []) as MessageAttachment[];
    const userText =
      String(uiUser.text || "").trim() ||
      lastUserText
        .replace(/\n?\[image: [^\]]+\]/g, "")
        .replace(/\n?\[file: [^\]]+\]/g, "")
        .trim();
    return {
      userText,
      attachments,
      model,
      history: this.history.slice(0, -2),
      uiMessages: this.uiMessages.slice(0, userIndex + 1),
    };
  }

  private postRegenerateState(): void {
    this.post({
      type: "regenerateState",
      canRegenerate: Boolean(this.getRegenerateState()),
      selectedModel: this.selectedModel,
    });
  }

  /**
   * Shared abort finalizer for a chat turn. Cleans up transient (in-progress)
   * tool rows so reload does not show stuck spinners, marks the todo plan card
   * as cancelled, persists the snapshot, and posts stopped/idle to the webview.
   */
  private finalizeAbortedTurn(
    chatId: string,
    uiMessages: UiMessage[],
    transientStart: number,
    snapshot: {
      history: ChatMessage[];
      selectedModel: string;
      selectedMode: string;
      contextTokens: number;
      lastAgentEditedPaths?: string[];
    },
    abortSignal?: AbortSignal
  ): void {
    // A newer run already owns this chat (Stop → immediate resend, edit+rerun):
    // its snapshot, run state and webview busy belong to it — ours must not
    // clobber them.
    if (this.chatRuns.has(chatId)) {
      return;
    }
    // Find and remove the todo plan card (may be anywhere in the array).
    const todoIx = uiMessages.findIndex(
      (m) =>
        m.role === "tool" &&
        m.step?.kind === "todo" &&
        m.step.stepId === TODO_STEP_ID
    );
    const todoBefore = todoIx >= 0 ? uiMessages[todoIx] : undefined;
    if (todoIx >= 0) {
      uiMessages.splice(todoIx, 1);
    }

    // Drop all transient (in-progress) tool rows produced by this turn.
    uiMessages.splice(transientStart);

    // onAssistant is gated on !aborted — surface the stop reason here.
    const lang = resolveUiLanguage(getConfig().language);
    const signalCode = reasonFromAbortSignal(abortSignal) || "user-stop";
    const fromHistory = [...snapshot.history]
      .reverse()
      .find((m) => m.role === "assistant");
    const historyText = String(fromHistory?.content || "").trim();
    const abortNotice = isAbortNoticeText(historyText)
      ? historyText
      : formatAbortedAssistantText(
          lang,
          harborAbortInfoFromCode(signalCode)
        );
    const lastUi = uiMessages[uiMessages.length - 1];
    if (
      !(
        lastUi?.role === "assistant" &&
        String(lastUi.text || "").trim() === abortNotice
      )
    ) {
      uiMessages.push({ role: "assistant", text: abortNotice });
      if (this.store.activeChatId === chatId) {
        this.post({
          type: "assistantDone",
          chatId,
          text: abortNotice,
        });
      }
    }

    // Re-append the todo card with cancelled status.
    if (todoBefore?.step) {
      const cancelledPreview =
        lang === "ru" ? "Отменено пользователем" : "Cancelled by user";
      uiMessages.push({
        ...todoBefore,
        step: {
          ...todoBefore.step,
          status: "error",
          resultPreview: cancelledPreview,
        },
      });

      // Post the cancelled card to the live webview.
      if (this.store.activeChatId === chatId) {
        this.post({
          type: "step",
          chatId,
          stepId: TODO_STEP_ID,
          kind: "todo",
          name: TODO_TOOL,
          status: "error",
          argsPreview: todoBefore.step.argsPreview,
          steps: todoBefore.step.steps,
          resultPreview: cancelledPreview,
        });
      }
    }

    // Persist the cleaned snapshot.
    touchChat(this.store, chatId, {
      history: snapshot.history,
      uiMessages,
      selectedModel: snapshot.selectedModel,
      selectedMode: snapshot.selectedMode,
      lastAgentEditedPaths: snapshot.lastAgentEditedPaths,
      contextTokens: snapshot.contextTokens,
    });
    this.persist();
    if (this.store.activeChatId === chatId) {
      this.history = snapshot.history;
      this.uiMessages = uiMessages;
      this.contextTokens = snapshot.contextTokens;
    }

    // Clear run-state and notify the webview.
    this.setRunStateForChat(chatId);
    if (this.store.activeChatId === chatId) {
      this.postRegenerateState();
      this.post({ type: "stopped", chatId });
      this.post({ type: "idle", chatId });
    }
  }

  private async onEditUserMessage(msg: {
    index?: unknown;
    text?: unknown;
    model?: unknown;
    agentMode?: unknown;
    reasoningEffort?: unknown;
    attachments?: unknown;
  }): Promise<unknown> {
    const index = Number(msg.index);
    const nextText = String(msg.text || "").trim();
    const target = this.uiMessages[index];
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      !target ||
      target.role !== "user"
    ) {
      this.postRegenerateState();
      this.post({ type: "idle", chatId: this.store.activeChatId });
      return { ok: false, error: "bad index" };
    }

    let attachments: MessageAttachment[] = [];
    try {
      attachments = await this.persistTurnAttachments(
        Array.isArray(msg.attachments) ? msg.attachments : target.attachments
      );
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      this.post({
        type: "runFailed",
        text: messageText,
        chatId: this.store.activeChatId,
      });
      this.post({ type: "idle", chatId: this.store.activeChatId });
      return { ok: false, error: messageText };
    }
    if (!nextText && !attachments.length) {
      this.postRegenerateState();
      this.post({ type: "idle", chatId: this.store.activeChatId });
      return { ok: false, error: "empty" };
    }

    let userOrdinal = 0;
    for (let i = 0; i < index; i++) {
      if (this.uiMessages[i]?.role === "user") {
        userOrdinal += 1;
      }
    }

    this.abortChatRun(this.store.activeChatId, "edit-message");

    const agentMode = String(msg.agentMode || this.selectedMode || "agent");
    const model =
      String(msg.model || "").trim() ||
      this.selectedModel ||
      getConfig().defaultModel;
    this.selectedModel = model;
    this.selectedMode = agentMode;
    this.history = this.history.slice(0, Math.max(0, userOrdinal * 2));
    this.uiMessages = this.uiMessages.slice(0, index);
    const uiMsg: UiMessage = {
      role: "user",
      text: nextText,
      mode: agentMode,
    };
    if (attachments.length) {
      uiMsg.attachments = attachments.map(stripAttachmentPayload);
    }
    this.uiMessages.push(uiMsg);
    this.lastTurnModel = "";
    this.contextTokens = 0;
    if (this.store.activeChatId) {
      touchChat(this.store, this.store.activeChatId, {
        history: this.history,
        uiMessages: this.uiMessages,
        selectedModel: model,
        selectedMode: agentMode,
        contextTokens: 0,
      });
      this.persist();
    }
    this.post({
      type: "messagesReplaced",
      uiMessages: this.uiMessages,
      selectedModel: this.selectedModel,
      canRegenerate: false,
      chatId: this.store.activeChatId,
    });
    return this.onSend({
      text: nextText,
      model,
      agentMode,
      reasoningEffort: msg.reasoningEffort,
      attachments,
      hideUser: true,
      resetSession: true,
    });
  }

  private async onRegenerate(msg: {
    agentMode?: unknown;
    reasoningEffort?: unknown;
  }): Promise<unknown> {
    const state = this.getRegenerateState();
    if (!state) {
      this.postRegenerateState();
      this.post({ type: "idle", chatId: this.store.activeChatId });
      return { ok: false, error: "cannot regenerate" };
    }
    this.abortChatRun(this.store.activeChatId, "regenerate");
    this.history = state.history;
    this.uiMessages = state.uiMessages;
    this.selectedModel = state.model;
    const agentMode = String(msg.agentMode || this.selectedMode || "agent");
    this.selectedMode = agentMode;
    if (this.store.activeChatId) {
      touchChat(this.store, this.store.activeChatId, {
        history: this.history,
        uiMessages: this.uiMessages,
        selectedModel: this.selectedModel,
        selectedMode: agentMode,
      });
      this.persist();
    }
    this.post({
      type: "messagesReplaced",
      uiMessages: this.uiMessages,
      selectedModel: this.selectedModel,
      canRegenerate: false,
      chatId: this.store.activeChatId,
    });
    return this.onSend({
      text: state.userText,
      model: state.model,
      agentMode,
      reasoningEffort: msg.reasoningEffort,
      attachments: state.attachments,
      hideUser: true,
      resetSession: true,
    });
  }

  private async persistTurnAttachments(
    incoming: unknown
  ): Promise<MessageAttachment[]> {
    if (!Array.isArray(incoming) || !incoming.length) {
      return [];
    }
    return persistIncomingAttachments(
      incoming as IncomingAttachment[],
      HarborHeadless.getExtensionContext().storageUri as never
    );
  }

  private async onSend(msg: {
    text?: unknown;
    model?: unknown;
    agentMode?: unknown;
    reasoningEffort?: unknown;
    attachments?: unknown;
    hideUser?: unknown;
    resetSession?: unknown;
  }): Promise<unknown> {
    const text = String(msg.text || "").trim();
    if (this.chatRuns.has(this.store.activeChatId || "")) {
      // The webview renders the user bubble optimistically before this RPC
      // returns; a silent rejection ghosts the message with no feedback.
      const lang = resolveUiLanguage(getConfig().language);
      this.post({
        type: "runFailed",
        text:
          lang === "ru"
            ? "Предыдущий ход ещё выполняется — сначала остановите его"
            : "Previous turn is still running — stop it first",
        chatId: this.store.activeChatId,
      });
      return { ok: false, error: "busy" };
    }

    let attachments: MessageAttachment[] = [];
    try {
      attachments = await this.persistTurnAttachments(msg.attachments);
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      this.post({
        type: "runFailed",
        text: messageText,
        chatId: this.store.activeChatId,
      });
      this.post({ type: "idle", chatId: this.store.activeChatId });
      return { ok: false, error: messageText };
    }
    if (!text && !attachments.length) {
      return { ok: false, error: "empty" };
    }

    const runChatId = this.store.activeChatId;
    if (!runChatId || !this.store.chats[runChatId]) {
      return { ok: false, error: "no chat" };
    }

    const sourceChat = this.store.chats[runChatId];
    const model =
      String(msg.model || "").trim() ||
      this.selectedModel ||
      sourceChat.selectedModel ||
      getConfig().defaultModel;
    const agentMode = String(
      msg.agentMode || this.selectedMode || sourceChat.selectedMode || "agent"
    );
    const reasoningEffort = String(
      msg.reasoningEffort ||
        this.selectedReasoningEffort ||
        sourceChat.selectedReasoningEffort ||
        ""
    );
    if (this.store.activeChatId === runChatId) {
      this.selectedModel = model;
      this.selectedMode = agentMode;
    }

    // Copies pinned to runChatId — do not re-read this.history after awaits.
    let runHistory = (
      this.store.activeChatId === runChatId
        ? this.history
        : sourceChat.history || []
    ).slice() as ChatMessage[];
    let runUiMessages = [
      ...(this.store.activeChatId === runChatId
        ? this.uiMessages
        : sourceChat.uiMessages || []),
    ];
    let runContextTokens =
      this.store.activeChatId === runChatId
        ? this.contextTokens
        : typeof sourceChat.contextTokens === "number"
          ? sourceChat.contextTokens
          : 0;

    const syncRunChat = (): void => {
      if (!runActive()) return;
      const chat = this.store.chats[runChatId];
      if (!chat) {
        return;
      }
      touchChat(this.store, runChatId, {
        history: runHistory,
        uiMessages: runUiMessages,
        selectedModel: model,
        selectedMode: agentMode,
        contextTokens: runContextTokens,
      });
      this.persist();
      // Keep live snapshot only while this chat is still open.
      if (this.store.activeChatId === runChatId) {
        this.history = runHistory;
        this.uiMessages = runUiMessages;
        this.contextTokens = runContextTokens;
      }
    };

    const postToRun = (message: Record<string, unknown>): void => {
      // VS Code parity (postToRunChat): stream only into the chat being
      // viewed. Background runs update the store via syncRunChat and the
      // rail via agentsList; the webview repaints them on switch.
      if (this.store.activeChatId !== runChatId) {
        return;
      }
      this.post({ ...message, chatId: runChatId });
    };

    // Own the run before the first syncRunChat call — syncRunChat checks
    // runActive(), and runActive must already be initialized there (TDZ).
    // Replaces any zombie run still registered for this chat.
    const ac = new AbortController();
    /** False after Stop (signal.aborted) or after a newer run replaced us. */
    const runActive = (): boolean =>
      !ac.signal.aborted && this.chatRuns.get(runChatId) === ac;
    this.abortChatRun(runChatId, "new-run");
    this.chatRuns.set(runChatId, ac);
    retainClineChatSession(runChatId);

    if (!msg.hideUser) {
      const userUi: UiMessage = {
        role: "user",
        text,
        mode: agentMode,
      };
      const attachmentsForUi = attachments.map(stripAttachmentPayload);
      if (attachmentsForUi.length) {
        userUi.attachments = attachmentsForUi;
      }
      // Persist immediately (webview already showed the bubble). Otherwise
      // switching chats before the turn finishes drops the user message.
      runUiMessages = [...runUiMessages, userUi];
      syncRunChat();
    }

    // Index after which all UI messages are transient (produced by the
    // current turn). Used by finalizeAbortedTurn to splice them out on Stop.
    const runTransientStart = runUiMessages.length;

    const editedPaths: string[] = [];
    let assistantText = "";
    const runStartedAt = Date.now();
    /**
     * Headless runs do not persist tool steps into uiMessages (JetBrains
     * MVP) — keep the last in-group step so the success path can repost it
     * with the run duration stamp for the «выполнено · … · 18,6 с» summary.
     */
    let lastGroupStep: AgentStepEvent | undefined;
    let runTtftMs = 0;
    this.setRunStateForChat(runChatId, "running");
    const mode = getModeById(agentMode);
    let activeTurnModel = model;
    this.setStatusForChat(
      runChatId,
      modeThinkingLabel(mode),
      false,
      "thinking",
      this.statusModelLabel(activeTurnModel)
    );

    try {
      runHistory = await runAgentTurn({
        model,
        history: runHistory,
        userText: text,
        attachments: attachments.length ? attachments : undefined,
        signal: ac.signal,
        agentMode,
        reasoningEffort: reasoningEffort || undefined,
        lastAgentEditedPaths:
          this.store.chats[runChatId]?.lastAgentEditedPaths || [],
        chatId: runChatId,
        resetSession: Boolean(msg.resetSession),
        priorUiMessages: runUiMessages,
        storageUri: HarborHeadless.getExtensionContext().storageUri as never,
        callbacks: {
          onPhase: (phase, detail) => {
            if (!runActive()) return;
            if (phase === "cline") {
              this.setStatusForChat(
                runChatId,
                detail || "cline",
                false,
                "cline",
                this.statusModelLabel(activeTurnModel)
              );
              return;
            }
            this.setStatusForChat(
              runChatId,
              detail || modePhaseStatusLabel(phase, mode),
              false,
              phase,
              this.statusModelLabel(activeTurnModel)
            );
          },
          onActiveModel: (modelId) => {
            if (!runActive()) return;
            activeTurnModel = modelId;
            const current = this.chatStatusState.get(runChatId);
            if (current && !current.hidden && current.text) {
              this.setStatusForChat(
                runChatId,
                current.text,
                false,
                current.phase,
                this.statusModelLabel(activeTurnModel)
              );
            }
          },
          onTool: (t) => {
            if (!runActive()) return;
            postToRun({
              type: "append",
              role: "tool",
              text: t,
            });
          },
          onStep: (event) => {
            if (!runActive()) return;
            // Only tool steps live inside the collapsed group body — checkpoint,
            // thinking, and todo cards render elsewhere and cannot carry the
            // run-duration stamp (the webview would not find them by stepId).
            if (event.stepId && event.kind === "tool") {
              lastGroupStep = event;
            }
            // Persist tool/todo/text steps into runUiMessages so that
            // chat-switch redraws restore the timeline with correct statuses.
            if (event.stepId && event.kind === "tool") {
              const label = event.name
                ? `⚙ ${event.name}(${event.argsPreview || ""})`
                : "⚙ tool";
              const existingIx = runUiMessages.findIndex(
                (m) => m.role === "tool" && m.step?.stepId === event.stepId
              );
              const uiMsg = {
                role: "tool" as const,
                text: label,
                step: {
                  stepId: event.stepId,
                  kind: "tool" as const,
                  toolCallId: event.toolCallId,
                  name: event.name,
                  argsPreview: event.argsPreview,
                  status: event.status,
                  resultPreview: event.resultPreview,
                  metrics: event.metrics,
                  ...(typeof event.durationMs === "number" &&
                  event.durationMs >= 0
                    ? { durationMs: event.durationMs }
                    : {}),
                },
              };
              if (existingIx >= 0) {
                runUiMessages[existingIx] = uiMsg;
              } else {
                runUiMessages.push(uiMsg);
              }
            } else if (event.stepId && event.kind === "todo") {
              const todoUiMsg = {
                role: "tool" as const,
                text: `⚙ plan ${event.argsPreview || ""}`.trim(),
                step: {
                  stepId: event.stepId,
                  kind: "todo" as const,
                  name: event.name,
                  status: event.status,
                  argsPreview: event.argsPreview,
                  steps: event.steps,
                },
              };
              const todoIx = runUiMessages.findIndex(
                (m) => m.role === "tool" && m.step?.stepId === event.stepId
              );
              if (todoIx >= 0) {
                runUiMessages[todoIx] = todoUiMsg;
              } else {
                runUiMessages.push(todoUiMsg);
              }
            }
            postToRun({
              type: "step",
              ...event,
            } as Record<string, unknown>);
          },
          onFileEdit: (edit) => {
            if (edit.path) {
              editedPaths.push(edit.path);
            }
          },
          onAssistantDelta: (delta) => {
            if (!runActive()) return;
            assistantText += delta;
            postToRun({
              type: "assistantDelta",
              text: delta,
            });
          },
          onAssistantStreamClear: () => {
            if (!runActive()) return;
            assistantText = "";
            postToRun({ type: "assistantStreamClear" });
          },
          onAssistant: (full, meta) => {
            if (!runActive()) return;
            const raw = full || assistantText;
            const displayText = assistantFinaleDisplayText(raw, {
              modeId: agentMode,
              hadFileEdits: editedPaths.length > 0,
              previousUserText: lastUiUserText(runUiMessages),
            });
            assistantText = displayText;
            this.lastTurnModel = model;
            runUiMessages = [
              ...runUiMessages,
              {
                role: "assistant",
                text: displayText,
                reasoning: meta?.reasoning,
              },
            ];
            syncRunChat();
            postToRun({
              type: "assistantDone",
              text: displayText,
              reasoning: meta?.reasoning,
            });
            this.postRegenerateState();
          },
          onReasoning: (r) => {
            if (!runActive()) return;
            postToRun({
              type: "reasoning",
              text: r,
            });
          },
          onReview: async (edits) => {
            if (!runActive()) return;
            const reviewEdits =
              edits && edits.length
                ? edits
                : [...new Set(editedPaths)]
                    .filter(Boolean)
                    .map((p) => ({
                      path: p,
                      added: 0,
                      removed: 0,
                      created: false,
                    }));
            runUiMessages = await this.publishReview(
              reviewEdits,
              runChatId,
              runUiMessages
            );
            for (const e of reviewEdits) {
              if (e.path) {
                editedPaths.push(e.path);
              }
            }
            this.opts.onVfsRefresh?.(
              [...new Set(editedPaths.map(String).filter(Boolean))]
            );
          },
          onUsage: (usage) => {
            if (!runActive()) return;
            runContextTokens = usage.used;
            postToRun({
              type: "contextUsage",
              ...usage,
            });
          },
          onFigmaNeedsConnect: () => {
            if (!runActive()) return;
            this.post({ type: "figmaNeedsConnect" });
          },
          onTiming: (info) => {
            if (!runActive()) return;
            if (typeof info.ttftMs === "number" && info.ttftMs >= 0) {
              runTtftMs = Math.round(info.ttftMs);
            }
          },
        },
      });

      // Repost the last in-group step with the run duration BEFORE the
      // runActive() guard: the finally block below deletes the run from
      // chatRuns, so any postToRun after that guard silently drops the
      // stamp. The webview's upsertAgentStep is idempotent on stepId —
      // reposting the full event is safe.
      const runDurationMs = lastGroupStep
        ? Date.now() - runStartedAt
        : 0;
      if (lastGroupStep) {
        postToRun({
          type: "step",
          ...lastGroupStep,
          runDurationMs,
          ...(runTtftMs > 0 ? { ttftMs: runTtftMs } : {}),
        } as Record<string, unknown>);
      }
      // Stamp runDurationMs on the persisted uiMessages so that
      // history redraws (chat switch / reload) keep the duration.
      // Only stamp the last tool step of THIS turn (from runTransientStart),
      // not the entire chat — otherwise each new turn overwrites the previous
      // turn's duration with its own value.
      if (runDurationMs > 0) {
        for (let i = runUiMessages.length - 1; i >= runTransientStart; i -= 1) {
          const ui = runUiMessages[i];
          if (ui?.role === "tool" && ui.step?.stepId) {
            ui.step = {
              ...ui.step,
              runDurationMs,
              ...(runTtftMs > 0 ? { ttftMs: runTtftMs } : {}),
            };
            break;
          }
        }
        // Also stamp runDurationMs on the last assistant message of this turn.
        for (let i = runUiMessages.length - 1; i >= runTransientStart; i -= 1) {
          if (runUiMessages[i]?.role === "assistant") {
            runUiMessages[i] = {
              ...runUiMessages[i],
              runDurationMs,
              ...(runTtftMs > 0 ? { ttftMs: runTtftMs } : {}),
            };
            break;
          }
        }
        // Live label under the assistant bubble (VS Code posts the same
        // message from agentPanelProvider). Must run before the runActive()
        // guard below — postToRun is a no-op when another chat is viewed.
        postToRun({
          type: "runDuration",
          runDurationMs,
          ...(runTtftMs > 0 ? { ttftMs: runTtftMs } : {}),
        });
      }

      // Race guard: if Stop+continue already started a newer run, the old
      // draining turn must not post assistantDone / runFinished / idle —
      // that would kill the new run's preloader and reset visible steps.
      // Clean up transient rows and persist so the aborted turn survives reload.
      if (!runActive()) {
        this.finalizeAbortedTurn(
          runChatId,
          runUiMessages,
          runTransientStart,
          {
            history: runHistory,
            selectedModel: model,
            selectedMode: agentMode,
            lastAgentEditedPaths: editedPaths.length
              ? [...new Set(editedPaths)]
              : this.store.chats[runChatId]?.lastAgentEditedPaths,
            contextTokens: runContextTokens,
          },
          ac.signal
        );
        return { ok: true };
      }
      touchChat(this.store, runChatId, {
        history: runHistory,
        uiMessages: runUiMessages,
        selectedModel: model,
        selectedMode: agentMode,
        lastAgentEditedPaths: editedPaths.length
          ? [...new Set(editedPaths)]
          : this.store.chats[runChatId]?.lastAgentEditedPaths,
        contextTokens: runContextTokens,
      });
      this.persist();
      if (this.store.activeChatId === runChatId) {
        this.history = runHistory;
        this.uiMessages = runUiMessages;
        this.contextTokens = runContextTokens;
      }
      this.setRunStateForChat(runChatId, "success");
      postToRun({ type: "runFinished", outcome: "success" });
      this.scheduleChatTitle(runChatId);
      this.scheduleScmRefresh([500, 1500]);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const aborted =
        ac.signal.aborted ||
        /abort/i.test(message) ||
        message === "aborted";
      // Race guard: if a newer run started (Stop+continue), do not post
      // runFailed / set error state — the new run owns the chat now.
      // Clean up transient rows and persist so the aborted turn survives reload.
      if (aborted && !runActive()) {
        this.finalizeAbortedTurn(
          runChatId,
          runUiMessages,
          runTransientStart,
          {
            history: runHistory,
            selectedModel: model,
            selectedMode: agentMode,
            contextTokens: runContextTokens,
          },
          ac.signal
        );
        return { ok: true };
      }
      runUiMessages = [...runUiMessages, { role: "error", text: message }];
      postToRun({
        type: "runFailed",
        message,
      });
      touchChat(this.store, runChatId, {
        history: runHistory,
        uiMessages: runUiMessages,
        contextTokens: runContextTokens,
      });
      this.persist();
      if (this.store.activeChatId === runChatId) {
        this.history = runHistory;
        this.uiMessages = runUiMessages;
        this.contextTokens = runContextTokens;
      }
      if (aborted) {
        this.setRunStateForChat(runChatId);
      } else {
        this.setRunStateForChat(runChatId, "error");
      }
      this.scheduleScmRefresh(500);
      return { ok: false, error: message };
      } finally {
        // Race guard: if a newer run is active or we were stopped, do not
        // clear its abort controller and do not post idle — that would
        // kill the new run's preloader and reset visible steps.
        if (runActive()) {
          this.chatRuns.delete(runChatId);
          this.setStatusForChat(runChatId, "", true);
          postToRun({ type: "idle" });
        }
      onClineActiveChatChanged({
        previousChatId: runChatId,
        nextChatId: this.store.activeChatId,
      });
    }
  }

  private getFigmaStatusPayload(): FigmaStatusPayload {
    const mcp = getMcpManager();
    if (!mcp) {
      return {
        state: "disconnected",
        enabled: getConfig().figma.enabled,
      };
    }
    return mcp.getStatus();
  }

  private postFigmaStatus(status?: FigmaStatusPayload): void {
    const payload = status || this.getFigmaStatusPayload();
    this.post({
      type: "figmaStatus",
      status: payload,
    });
    this.postMcpServersList();
  }

  private postMcpServersList(servers?: McpServerRuntimeStatus[]): void {
    const mcp = getMcpManager();
    const list = servers || mcp?.listServerStatuses() || [];
    this.post({
      type: "mcpServers",
      servers: list,
    });
  }

  private postSkillsList(): void {
    const cwd = this.opts.workspaceRoot || process.cwd();
    ensureHarborSkillRoots(cwd);
    const config = getConfig().skills;
    this.post({
      type: "skillsList",
      ...buildSkillsListPayload(cwd, config),
    });
  }

  private handleSkillsSetMasterEnabled(enabled: boolean): unknown {
    this.persistUiSettings({ skillsEnabled: enabled !== false });
    this.reloadSettings();
    this.postSkillsList();
    this.postSettingsPayload();
    return { ok: true };
  }

  private handleSkillsSetEnabled(name: string, enabled: boolean): unknown {
    const skillName = String(name || "").trim();
    if (!skillName) {
      return { ok: false };
    }
    const disabled = [...getConfig().skills.disabled];
    const lower = skillName.toLowerCase();
    const next = enabled
      ? disabled.filter((n) => n.toLowerCase() !== lower)
      : disabled.some((n) => n.toLowerCase() === lower)
        ? disabled
        : [...disabled, skillName];
    this.persistUiSettings({ skillsDisabled: next });
    this.reloadSettings();
    this.postSkillsList();
    return { ok: true };
  }

  private handleSkillsSetSourceEnabled(
    source: string,
    enabled: boolean,
    rawPath: string
  ): unknown {
    const src = String(source || "").trim().toLowerCase();
    if (src === "workspace") {
      this.persistUiSettings({ skillsWorkspaceEnabled: enabled !== false });
      this.reloadSettings();
      this.postSkillsList();
      this.postSettingsPayload();
      return { ok: true };
    }
    if (src === "global") {
      this.persistUiSettings({ skillsGlobalEnabled: enabled !== false });
      this.reloadSettings();
      this.postSkillsList();
      this.postSettingsPayload();
      return { ok: true };
    }
    if (src === "extra") {
      const dir = path.resolve(String(rawPath || "").trim());
      if (!dir) {
        return { ok: false };
      }
      const disabled = [...getConfig().skills.disabledExtraDirectories];
      const next = enabled
        ? disabled.filter((p) => path.resolve(String(p || "")) !== dir)
        : disabled.some((p) => path.resolve(String(p || "")) === dir)
          ? disabled
          : [...disabled, dir];
      this.persistUiSettings({ skillsDisabledExtraDirectories: next });
      this.reloadSettings();
      this.postSkillsList();
      this.postSettingsPayload();
      return { ok: true };
    }
    return { ok: false };
  }

  private handleSkillsAddDirectory(rawPath: string): unknown {
    const dir = String(rawPath || "").trim();
    if (!dir) {
      return { ok: false };
    }
    const cwd = this.opts.workspaceRoot || process.cwd();
    const normalized = path.resolve(dir);
    const builtins = new Set([
      path.resolve(workspaceHarborSkillsDir(cwd)),
      path.resolve(globalHarborSkillsDir()),
    ]);
    if (builtins.has(normalized)) {
      this.postSkillsList();
      return { ok: true };
    }
    const extra = [...getConfig().skills.extraDirectories];
    if (!extra.some((p) => path.resolve(String(p || "")) === normalized)) {
      extra.push(normalized);
    }
    this.persistUiSettings({ skillsExtraDirectories: extra });
    this.reloadSettings();
    this.postSkillsList();
    this.postSettingsPayload();
    return { ok: true };
  }

  private handleSkillsRemoveDirectory(rawPath: string): unknown {
    const dir = String(rawPath || "").trim();
    if (!dir) {
      return { ok: false };
    }
    const normalized = path.resolve(dir);
    const extra = getConfig().skills.extraDirectories.filter(
      (p) => path.resolve(String(p || "")) !== normalized
    );
    const disabledExtra = getConfig().skills.disabledExtraDirectories.filter(
      (p) => path.resolve(String(p || "")) !== normalized
    );
    this.persistUiSettings({
      skillsExtraDirectories: extra,
      skillsDisabledExtraDirectories: disabledExtra,
    });
    this.reloadSettings();
    this.postSkillsList();
    this.postSettingsPayload();
    return { ok: true };
  }

  private async refreshFigmaStatus(): Promise<unknown> {
    const mcp = getMcpManager();
    if (mcp) {
      await mcp.refreshSecretFlags();
      await mcp.tryQuietReconnect();
    }
    this.postFigmaStatus();
    return { ok: true };
  }

  private async handleFigmaConnect(): Promise<unknown> {
    const mcp = getMcpManager();
    if (!mcp) {
      this.postFigmaStatus({
        state: "error",
        enabled: getConfig().figma.enabled,
        message: "MCP manager is not available",
        showPatFallback: true,
      });
      return { ok: false };
    }
    // Post connecting immediately so UI updates while OAuth/browser opens.
    this.postFigmaStatus({
      ...mcp.getStatus(),
      state: "connecting",
      mode: "remote",
      message: "Opening Figma authorization…",
    });
    const status = await mcp.connectRemoteInteractive();
    this.postFigmaStatus(status);
    return { ok: status.state === "connected", status };
  }

  private async handleFigmaDisconnect(): Promise<unknown> {
    const mcp = getMcpManager();
    if (!mcp) {
      return { ok: false };
    }
    const status = await mcp.disconnect();
    this.postFigmaStatus(status);
    return { ok: true, status };
  }

  private async handleFigmaConnectPat(token: string): Promise<unknown> {
    const mcp = getMcpManager();
    if (!mcp) {
      this.postFigmaStatus({
        state: "error",
        enabled: true,
        message: "MCP manager is not available",
        showPatFallback: true,
      });
      return { ok: false };
    }
    this.postFigmaStatus({
      ...mcp.getStatus(),
      state: "connecting",
      mode: "pat",
      message: "Starting local Figma MCP…",
      showPatFallback: true,
    });
    const status = await mcp.connectWithPat(token);
    this.postFigmaStatus(status);
    return { ok: status.state === "connected", status };
  }

  private async handleMcpSetEnabled(
    id: string,
    enabled: boolean
  ): Promise<unknown> {
    const mcp = getMcpManager();
    if (!mcp) {
      return { ok: false };
    }
    await mcp.setCustomEnabled(id, enabled);
    this.postMcpServersList();
    this.postFigmaStatus();
    return { ok: true };
  }

  private async handleMcpConnect(id: string): Promise<unknown> {
    const mcp = getMcpManager();
    if (!mcp) {
      return { ok: false };
    }
    if (id === "figma") {
      return this.handleFigmaConnect();
    }
    const status = await mcp.connectCustom(id);
    this.postMcpServersList();
    return { ok: status.state === "connected", status };
  }

  private async handleMcpDelete(id: string): Promise<unknown> {
    const mcp = getMcpManager();
    if (!mcp) {
      return { ok: false };
    }
    await mcp.deleteCustomServer(id);
    this.postMcpServersList();
    this.postFigmaStatus();
    return { ok: true };
  }

  private async handleMcpUpsert(
    raw: Record<string, unknown>
  ): Promise<unknown> {
    const mcp = getMcpManager();
    if (!mcp) {
      return { ok: false };
    }
    try {
      const status = await mcp.upsertCustomServer({
        id: typeof raw.id === "string" ? raw.id : undefined,
        name: String(raw.name || ""),
        transport: raw.transport === "http" ? "http" : "stdio",
        command: typeof raw.command === "string" ? raw.command : undefined,
        args: parseArgsInput(String(raw.argsText || "")),
        env: parseEnvLines(String(raw.envText || "")),
        cwd: typeof raw.cwd === "string" ? raw.cwd : undefined,
        url: typeof raw.url === "string" ? raw.url : undefined,
        bearerToken:
          typeof raw.bearerToken === "string" ? raw.bearerToken : undefined,
        enabled: raw.enabled !== false,
        connect: raw.connect !== false,
      });
      this.postMcpServersList();
      return { ok: status.state === "connected", status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  }
}

export function defaultHarborPaths(workspaceRoot: string): {
  sessionPath: string;
  settingsPath: string;
} {
  const dir = path.join(workspaceRoot, ".idea", "harbor");
  return {
    sessionPath: path.join(dir, "session.v2.json"),
    settingsPath: path.join(dir, "settings.json"),
  };
}
