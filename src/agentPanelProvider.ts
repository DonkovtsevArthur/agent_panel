import * as vscode from "vscode";
import {
  IncomingAttachment,
  MessageAttachment,
  attachmentsFromUris,
  enrichAttachmentsForUi,
  persistIncomingAttachments,
  pickWorkspaceAttachments,
  stripAttachmentPayload,
  stripUiAttachmentPayloads,
} from "./attachments";
import {
  getConfig,
  getContextWindow,
  getEnabledModels,
  getModeById,
  getResolvedModes,
  resolveModelEndpoint,
  resolveModelReasoningEffort,
  resolveModelSupportsReasoningEffort,
  resolveModelSupportsVision,
  resolveProviderProbeUrl,
} from "./config";
import {
  normalizeReasoningEffort,
  type ReasoningEffortLevel,
} from "./reasoningEffort";
import { isBuiltinCommitMessagePrompt, isBuiltinSystemPrompt, resolveUiLanguage } from "./i18n";
import { runAgentTurn } from "./agentLoop";
import type { AgentPhase } from "./agentLoop";
import {
  classifyModelFallbackError,
  modelFallbackEligibility,
  selectFallbackModel,
} from "./modelRouting";
import type { FileEditStat } from "./diffStats";
import {
  getEditorSelectionPayload,
  resolveFilesForHarbor,
} from "./editorContext";
import { searchWorkspaceFiles } from "./fileMentions";
import { commitAndPushPaths } from "./commitAndPush";
import { discardPaths } from "./discardPaths";
import { hasUncommittedChanges } from "./gitStatus";
import { openWorkingTreeDiff } from "./gitDiff";
import { toRepoRelativePath } from "./repoPaths";
import { resolveRemainingReviewFiles } from "./turnFileChanges";
import {
  modeThinkingLabel,
  parseCustomModes,
  type AgentModeDef,
} from "./modes";
import { getOpenAICompatibleClient, type ChatMessage } from "./openaiClient";
import {
  ensureProposedPlanWrapper,
  looksLikeImplementationPlan,
  planMarkdownFileName,
  stripPlanImplementWrapper,
} from "./planImplement";
import { getMcpManager } from "./mcpBundle";
import type { FigmaStatusPayload } from "./mcpBundle";
import type { McpServerRuntimeStatus } from "./mcp/types";
import { parseArgsInput, parseEnvLines } from "./mcp/serversStore";
import {
  AgentsStoreV2,
  UiMessage,
  archiveAgentInStore,
  buildAgentsList,
  buildArchiveList,
  chatHasMessages,
  cloneStore,
  collapseOldToolUiMessages,
  createEmptyAgent,
  deleteAgentFromStore,
  deleteAllArchivedAgentsFromStore,
  ensureActiveVisible,
  formatListTime,
  findAgentByChatId,
  getActiveChat,
  getAgentDisplayName,
  getAgentChatIds,
  migrateToStoreV2,
  restoreAgentInStore,
  searchChatMessages,
  switchAgentBranch,
  touchChat,
  branchChatFromMessage,
  buildBranchesList,
  deleteAgentBranch,
  type ChatSearchDate,
  type ChatSearchRole,
  type ChatSearchScope,
} from "./sessionStore";

type SettingsPayload = {
  providers: Array<{
    id: string;
    name?: string;
    baseUrl: string;
    apiKey?: string;
    statusUrl?: string;
  }>;
  models: Array<{
    id: string;
    label?: string;
    providerId?: string;
    contextWindow?: number;
    maxOutputTokens?: number;
    enabled?: boolean;
    favorite?: boolean;
    supportsVision?: boolean;
    supportsReasoningEffort?: boolean;
    reasoningEffort?: string;
    reasoningEffortDefault?: string;
  }>;
  language: string;
  defaultModel: string;
  defaultContextWindow: number;
  baseUrl: string;
  apiKey: string;
  rejectUnauthorized: boolean;
  caBundlePath: string;
  systemPrompt: string;
  maxToolRounds: number;
  maxTokens: number;
  maxResponseChars: number;
  soundNotificationsEnabled?: boolean;
  subagentsEnabled?: boolean;
  parallelToolCallsEnabled?: boolean;
  autoCompactEnabled?: boolean;
  selectionHintsEnabled?: boolean;
  modes: AgentModeDef[];
  commitMessagePrompt?: string;
  commitMessageLanguage?: string;
  commitMessageScope?: "global" | "workspace";
  figmaEnabled?: boolean;
  autoglmEnabled?: boolean;
  autoglmBinaryPath?: string;
  autoglmBrowser?: string;
  autoglmAutoApprove?: boolean;
};

type WebviewToHost =
  | { type: "ready"; surface?: "panel" | "settings" }
  | {
      type: "send";
      text: string;
      model: string;
      agentMode?: string;
      reasoningEffort?: string;
      attachments?: IncomingAttachment[];
      /** Не показывать user-сообщение в чате (например, тег commit/push). */
      hideUser?: boolean;
    }
  | { type: "regenerate"; agentMode?: string; reasoningEffort?: string }
  | {
      type: "editUserMessage";
      index: number;
      text: string;
      model: string;
      agentMode?: string;
      reasoningEffort?: string;
      attachments?: IncomingAttachment[];
    }
  | { type: "stop" }
  | { type: "newChat" }
  | { type: "newAgent" }
  | { type: "openAgent"; agentId: string }
  | { type: "showAgents" }
  | { type: "showArchive" }
  | { type: "showSettings" }
  | { type: "closeSettings" }
  | { type: "saveSettings"; settings: SettingsPayload }
  | { type: "saveModes"; modes: SettingsPayload["modes"] }
  | { type: "renameAgent"; agentId: string; name: string }
  | { type: "archiveAgent"; agentId: string }
  | { type: "restoreAgent"; agentId: string }
  | { type: "deleteAgent"; agentId: string }
  | { type: "deleteAllArchived" }
  | { type: "modelChanged"; model: string; chatId?: string }
  | { type: "modeChanged"; mode: string; chatId?: string }
  | {
      type: "reasoningEffortChanged";
      reasoningEffort: string;
      chatId?: string;
    }
  | { type: "openFile"; path: string }
  | { type: "openFileDiff"; path: string }
  | {
      type: "openPlanMarkdown";
      text: string;
      /** Default: editable editor tab (live plan). */
      reveal?: "editor" | "preview";
    }
  | {
      type: "requestLivePlanForBuild";
      requestId: string;
      fallbackText?: string;
    }
  | { type: "commitAndPush"; paths: string[] }
  | { type: "discardChanges"; paths: string[] }
  | { type: "openScm" }
  | { type: "openExternal"; url: string }
  | { type: "pickModel" }
  | { type: "pickAttachments"; imagesOnly?: boolean }
  | { type: "attachUris"; uris: string[] }
  | { type: "attachFiles"; files: IncomingAttachment[] }
  | { type: "searchFiles"; query: string; requestId: string }
  | {
      type: "searchChat";
      query: string;
      requestId: string;
      scope?: ChatSearchScope;
      role?: ChatSearchRole;
      date?: ChatSearchDate;
    }
  | { type: "openSearchHit"; agentId: string; messageIndex: number; chatId?: string }
  | { type: "copyText"; text: string }
  | { type: "chatScroll"; chatId: string; scrollTop: number }
  | { type: "branchFromMessage"; messageIndex: number }
  | { type: "switchBranch"; chatId: string }
  | { type: "deleteBranch"; chatId: string }
  | { type: "figmaConnect" }
  | { type: "figmaDisconnect" }
  | { type: "figmaConnectPat"; token: string }
  | { type: "figmaRefreshStatus" }
  | { type: "mcpRefreshList" }
  | {
      type: "mcpUpsertServer";
      server: {
        id?: string;
        name: string;
        transport: "stdio" | "http";
        command?: string;
        argsText?: string;
        envText?: string;
        cwd?: string;
        url?: string;
        bearerToken?: string;
        enabled?: boolean;
        connect?: boolean;
      };
    }
  | { type: "mcpDeleteServer"; id: string }
  | { type: "mcpSetEnabled"; id: string; enabled: boolean }
  | { type: "mcpConnectServer"; id: string }
  | {
      type: "listProviderModels";
      requestId: string;
      providerId: string;
      baseUrl?: string;
      apiKey?: string;
      rejectUnauthorized?: boolean;
      caBundlePath?: string;
    };

const STORAGE_KEY_V1 = "agentPanel.session.v1";
const STORAGE_KEY_V2 = "agentPanel.session.v2";

type ProviderConnState = "unknown" | "connecting" | "connected" | "error";

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
/** Интервал фоновой проверки, пока виден чат. */
const PROVIDER_PROBE_POLL_MS = 15_000;

export class AgentPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "agentPanel.chat";

  private view?: vscode.WebviewView;
  private settingsPanel?: vscode.WebviewPanel;
  private pendingSettingsOpenMcp = false;
  private store!: AgentsStoreV2;
  private history: ChatMessage[] = [];
  private uiMessages: UiMessage[] = [];
  private selectedModel = "";
  private selectedMode = "agent";
  private selectedReasoningEffort: ReasoningEffortLevel | "" = "";
  private lastTurnModel = "";
  private contextTokens = 0;
  private readonly chatRuns = new Map<string, AbortController>();
  private readonly chatRunTokens = new Map<string, number>();
  private readonly chatRunState = new Map<
    string,
    "running" | "success" | "error"
  >();
  private readonly chatStatusState = new Map<
    string,
    { text: string; hidden: boolean; phase?: AgentPhase; modelLabel?: string }
  >();
  private readonly providerConnStatuses = new Map<string, ProviderConnStatus>();
  private readonly providerProbePromises = new Map<
    string,
    Promise<ProviderConnStatus>
  >();
  private providerConnPollTimer?: ReturnType<typeof setInterval>;
  private readonly disposables: vscode.Disposable[] = [];
  /** Webview-scoped listeners; replaced when the view is re-resolved. */
  private webviewDisposables: vscode.Disposable[] = [];
  private workspaceListenersBound = false;
  private scmRefreshTimer?: ReturnType<typeof setTimeout>;
  private gitApiBound = false;
  private pendingScmReturnRefresh = false;
  private nextRunToken = 1;
  private workspaceGeneration = 1;
  private storeRevision = 0;
  private persistedStoreRevision = 0;
  private storeWriteQueue: Promise<void> = Promise.resolve();
  private pendingComposerInsert = "";
  private pendingComposerMentions: string[] = [];
  private pendingComposerSelection:
    | {
        path: string;
        startLine: number;
        endLine: number;
        text: string;
        language: string;
      }
    | undefined;
  /** Real on-disk markdown used for Plan «Просмотр» (built-in preview needs file:). */
  private planPreviewUri: vscode.Uri | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {
    this.loadStore();
    const mcp = getMcpManager();
    if (mcp) {
      this.disposables.push(
        mcp.onStatus((status) => {
          this.postFigmaStatus(status);
        }),
        mcp.onServersChanged((servers) => {
          this.postMcpServersList(servers);
        })
      );
    }
    this.bindWorkspaceListeners();
  }

  /**
   * Workspace/window listeners once per provider lifetime. Must not be
   * re-registered in resolveWebviewView (that can run again and would leak).
   */
  private bindWorkspaceListeners(): void {
    if (this.workspaceListenersBound) {
      return;
    }
    this.workspaceListenersBound = true;
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("agentPanel")) {
          this.postModels();
          if (e.affectsConfiguration("agentPanel.providers")) {
            this.providerConnStatuses.clear();
            this.ensureProviderProbe(this.selectedModel, true);
          }
          // Не перезатираем форму настроек: webview сам автосохраняет.
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.reloadStoreForWorkspace();
      }),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused && this.view?.visible) {
          this.scheduleScmRefresh();
        }
      })
    );
  }

  private setScreen(screen: AgentsStoreV2["screen"]): void {
    this.store.screen = screen;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "media"),
      ],
    };

    for (const d of this.webviewDisposables) {
      d.dispose();
    }
    this.webviewDisposables = [
      webviewView.webview.onDidReceiveMessage(async (raw) => {
        const message = raw as WebviewToHost;
        await this.onMessage(message);
      }),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          // Не пересобираем HTML: иначе очищается черновик в composer
          // и теряется UI-состояние. retainContextWhenHidden уже держит DOM.
          void this.postInit();
          this.scheduleScmRefresh();
          this.syncProviderConnPolling();
          if (this.pendingScmReturnRefresh) {
            this.pendingScmReturnRefresh = false;
            setTimeout(() => this.scheduleScmRefresh(), 700);
          }
        } else {
          this.syncProviderConnPolling();
        }
      }),
    ];
    this.bindGitStatusRefresh();

    webviewView.webview.html = this.getHtml(webviewView.webview);
    void this.postInit();
    this.syncProviderConnPolling();
  }

  /** Вставить выделенный в редакторе код в composer (чип, не сырой markdown). */
  async addSelectionToChat(): Promise<void> {
    const selection = getEditorSelectionPayload();
    if (!selection) {
      void vscode.window.showInformationMessage(
        "Select a code fragment in the editor."
      );
      return;
    }

    await this.queueSelectionForComposer(selection);
  }

  /** Создать агента и вставить выделенный код в composer его нового чата. */
  async addSelectionToNewChat(): Promise<void> {
    const selection = getEditorSelectionPayload();
    if (!selection) {
      void vscode.window.showInformationMessage(
        "Select a code fragment in the editor."
      );
      return;
    }

    this.newChat();
    await this.queueSelectionForComposer(selection);
  }

  /**
   * Добавить любой файл(ы) в composer как вложение (редактор или explorer).
   * Untitled без диска — как @path. `uri` / `uris` из контекстного меню проводника.
   */
  async addFileToChat(
    uri?: vscode.Uri,
    uris?: readonly vscode.Uri[]
  ): Promise<void> {
    await this.addResolvedFilesToChat(resolveFilesForHarbor(uri, uris));
  }

  /** Новый агент + любой файл(ы) в его composer. */
  async addFileToNewChat(
    uri?: vscode.Uri,
    uris?: readonly vscode.Uri[]
  ): Promise<void> {
    const resolved = resolveFilesForHarbor(uri, uris);
    if (!resolved.fileUris.length && !resolved.mentionPaths.length) {
      void vscode.window.showInformationMessage(
        "Open a file in the editor or pick one in the explorer."
      );
      return;
    }
    this.newChat();
    await this.addResolvedFilesToChat(resolved);
  }

  private async addResolvedFilesToChat(resolved: {
    fileUris: vscode.Uri[];
    mentionPaths: string[];
  }): Promise<void> {
    if (!resolved.fileUris.length && !resolved.mentionPaths.length) {
      void vscode.window.showInformationMessage(
        "Open a file in the editor or pick one in the explorer."
      );
      return;
    }
    if (resolved.fileUris.length) {
      await this.attachUrisFromDrop(resolved.fileUris);
    }
    if (resolved.mentionPaths.length) {
      await this.queueFileMentionsForComposer(resolved.mentionPaths);
    }
  }

  private async queueSelectionForComposer(
    selection: NonNullable<ReturnType<typeof getEditorSelectionPayload>>
  ): Promise<void> {
    this.pendingComposerSelection = selection;
    this.pendingComposerInsert = "";
    this.pendingComposerMentions = [];
    this.setScreen("chat");
    this.saveStore();
    const wasVisible = Boolean(this.view?.visible);
    await vscode.commands.executeCommand("agentPanel.chat.focus");
    // Если панель уже была открыта — HTML не перезагрузится, вставляем сразу.
    if (wasVisible) {
      this.flushPendingComposerInsert();
    }
  }

  private async queueFileMentionsForComposer(paths: string[]): Promise<void> {
    this.pendingComposerMentions = paths.slice();
    this.pendingComposerSelection = undefined;
    this.pendingComposerInsert = "";
    this.setScreen("chat");
    this.saveStore();
    const wasVisible = Boolean(this.view?.visible);
    await vscode.commands.executeCommand("agentPanel.chat.focus");
    if (wasVisible) {
      this.flushPendingComposerInsert();
    }
  }

  private flushPendingComposerInsert(): void {
    if (!this.view) {
      return;
    }
    if (this.pendingComposerSelection) {
      const selection = this.pendingComposerSelection;
      this.pendingComposerSelection = undefined;
      this.pendingComposerInsert = "";
      this.pendingComposerMentions = [];
      this.view.webview.postMessage({
        type: "insertComposerSelection",
        selection,
      });
      return;
    }
    if (this.pendingComposerMentions.length) {
      const paths = this.pendingComposerMentions.slice();
      this.pendingComposerMentions = [];
      this.pendingComposerInsert = "";
      this.view.webview.postMessage({
        type: "insertComposerMentions",
        paths,
      });
      return;
    }
    const text = this.pendingComposerInsert;
    if (!text) {
      return;
    }
    this.pendingComposerInsert = "";
    this.view.webview.postMessage({
      type: "insertComposerText",
      text,
    });
  }

  /** Новый чат теперь всегда создаёт нового агента. */
  newChat(): void {
    const config = getConfig();
    const enabled = getEnabledModels();
    const model =
      this.selectedModel ||
      (enabled.some((m) => m.id === config.defaultModel)
        ? config.defaultModel
        : "") ||
      enabled[0]?.id ||
      "";

    const created = createEmptyAgent(model);
    this.persistActiveChat();
    this.store.agents.unshift(created.agent);
    this.store.chats[created.chat.id] = created.chat;
    this.store.activeAgentId = created.agent.id;
    this.store.activeChatId = created.chat.id;

    this.setScreen("chat");
    this.hydrateActiveChat();
    this.saveStore();
    this.postChatScreen();
  }

  /** Открыть поиск по чату (кнопка в title bar view). */
  async openChatSearch(): Promise<void> {
    await vscode.commands.executeCommand("agentPanel.chat.focus");
    this.view?.webview.postMessage({ type: "openChatSearch" });
  }

  clearChat(): void {
    this.newChat();
  }

  dispose(): void {
    this.abortAllRuns();
    this.stopProviderConnPolling();
    if (this.scmRefreshTimer) {
      clearTimeout(this.scmRefreshTimer);
    }
    this.persistActiveChat();
    this.saveStore();
    this.settingsPanel?.dispose();
    this.settingsPanel = undefined;
    for (const d of this.webviewDisposables) {
      d.dispose();
    }
    this.webviewDisposables = [];
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  /** Открыть настройки во вкладке редактора (не в сайдбаре). */
  openSettingsEditor(options?: { mcp?: boolean }): void {
    const lang = resolveUiLanguage(getConfig().language);
    const title =
      lang === "ru" ? "Настройки — Harbor Agents" : "Settings — Harbor Agents";
    this.pendingSettingsOpenMcp = Boolean(options?.mcp);

    if (this.settingsPanel) {
      this.settingsPanel.title = title;
      this.settingsPanel.reveal(vscode.ViewColumn.Active);
      this.postSettings();
      this.settingsPanel.webview.postMessage({
        type: "showSettings",
        openMcp: this.pendingSettingsOpenMcp,
      });
      this.pendingSettingsOpenMcp = false;
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "agentPanel.settings",
      title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "media"),
        ],
      }
    );
    this.settingsPanel = panel;
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "media", "icon.svg");
    panel.webview.html = this.getHtml(panel.webview, "settings");
    panel.webview.onDidReceiveMessage(async (raw) => {
      await this.onMessage(raw as WebviewToHost);
    });
    panel.onDidDispose(() => {
      if (this.settingsPanel === panel) {
        this.settingsPanel = undefined;
      }
      this.syncProviderConnPolling();
    });
  }

  private closeSettingsEditor(): void {
    this.settingsPanel?.dispose();
    this.settingsPanel = undefined;
    this.syncProviderConnPolling();
  }

  private loadStore(): void {
    const config = getConfig();
    const enabled = getEnabledModels();
    const fallbackModel =
      (enabled.some((m) => m.id === config.defaultModel)
        ? config.defaultModel
        : "") ||
      enabled[0]?.id ||
      "";
    const workspaceV2 = this.context.workspaceState.get(STORAGE_KEY_V2);
    const workspaceV1 = this.context.workspaceState.get(STORAGE_KEY_V1);
    const globalV2 = this.context.globalState.get(STORAGE_KEY_V2);

    let raw: unknown = workspaceV2 ?? workspaceV1;
    let seededFromGlobal = false;

    // Workspace пуст — один раз переносим глобальный список сюда.
    if (!raw && globalV2) {
      raw = globalV2;
      seededFromGlobal = true;
    }

    this.store = migrateToStoreV2(raw, fallbackModel);
    if (!this.store.agents.length) {
      this.store = migrateToStoreV2(undefined, fallbackModel);
    }
    this.storeRevision = 0;
    this.persistedStoreRevision = 0;
    this.storeWriteQueue = Promise.resolve();
    this.ensureChatReady(fallbackModel);
    this.hydrateActiveChat();

    if (seededFromGlobal && this.hasWorkspaceFolder()) {
      void this.writeStoreOnly().then(() =>
        this.context.globalState.update(STORAGE_KEY_V2, undefined)
      );
    } else if (this.hasWorkspaceFolder()) {
      // Сохраняем screen=chat и автосозданного агента.
      void this.writeStoreOnly();
    }
  }

  /** Гарантирует видимого агента/чат и открывает экран чата. */
  private ensureChatReady(fallbackModel?: string): void {
    ensureActiveVisible(this.store);
    const agent = this.store.agents.find(
      (a) => a.id === this.store.activeAgentId && !a.archivedAt
    );
    const chat = getActiveChat(this.store);
    const chatOk =
      Boolean(agent) &&
      Boolean(chat) &&
      !chat!.archivedAt &&
      agent!.chatId === chat!.id;

    if (!chatOk) {
      const config = getConfig();
      const enabled = getEnabledModels();
      const model =
        fallbackModel ||
        this.selectedModel ||
        (enabled.some((m) => m.id === config.defaultModel)
          ? config.defaultModel
          : "") ||
        enabled[0]?.id ||
        "";
      const created = createEmptyAgent(model);
      this.store.agents.unshift(created.agent);
      this.store.chats[created.chat.id] = created.chat;
      this.store.activeAgentId = created.agent.id;
      this.store.activeChatId = created.chat.id;
    }

    this.setScreen("chat");
  }

  private hasWorkspaceFolder(): boolean {
    return Boolean(vscode.workspace.workspaceFolders?.length);
  }

  private hydrateActiveChat(): void {
    const chat = getActiveChat(this.store);
    if (!chat) {
      this.history = [];
      this.uiMessages = [];
      this.selectedModel = getConfig().defaultModel || "";
      this.selectedMode = "agent";
      this.selectedReasoningEffort = "";
      this.lastTurnModel = "";
      this.contextTokens = 0;
      return;
    }
    this.history = chat.history || [];
    this.uiMessages = chat.uiMessages || [];
    this.selectedModel = chat.selectedModel || "";
    this.selectedMode = getModeById(chat.selectedMode).id;
    this.selectedReasoningEffort =
      normalizeReasoningEffort(chat.selectedReasoningEffort) || "";
    this.lastTurnModel = chat.lastTurnModel || "";
    this.contextTokens =
      typeof chat.contextTokens === "number" && chat.contextTokens > 0
        ? chat.contextTokens
        : 0;
  }

  private persistActiveChat(): void {
    const chatId = this.store.activeChatId;
    if (!chatId || !this.store.chats[chatId]) {
      return;
    }
    stripUiAttachmentPayloads(this.uiMessages);
    for (const msg of this.history) {
      if (msg.attachments?.length) {
        msg.attachments = msg.attachments.map(stripAttachmentPayload);
      }
    }
    touchChat(this.store, chatId, {
      selectedModel: this.selectedModel,
      selectedMode: this.selectedMode,
      ...(this.selectedReasoningEffort
        ? { selectedReasoningEffort: this.selectedReasoningEffort }
        : { selectedReasoningEffort: undefined }),
      lastTurnModel: this.lastTurnModel,
      history: this.history,
      uiMessages: this.uiMessages.slice(-200),
      contextTokens: this.contextTokens,
    });
  }

  /**
   * Effective reasoning level for a turn: chat selection → model default.
   * Empty when the model does not support reasoning_effort.
   */
  private resolveReasoningEffortForModel(
    modelId: string,
    preferred?: string
  ): ReasoningEffortLevel | undefined {
    if (!resolveModelSupportsReasoningEffort(modelId)) {
      return undefined;
    }
    return (
      normalizeReasoningEffort(preferred) ||
      normalizeReasoningEffort(this.selectedReasoningEffort) ||
      normalizeReasoningEffort(resolveModelReasoningEffort(modelId)) ||
      "medium"
    );
  }

  private storageUri(): vscode.Uri | undefined {
    return this.context.storageUri || this.context.globalStorageUri;
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

  private async postAttachments(
    attachments: MessageAttachment[]
  ): Promise<void> {
    const enriched = await enrichAttachmentsForUi(
      attachments,
      this.storageUri()
    );
    this.view?.webview.postMessage({
      type: "attachmentsAdded",
      attachments: enriched,
    });
    // Показать чат, чтобы превью вложений было видно в composer
    if (this.store.screen !== "chat") {
      this.setScreen("chat");
      this.saveStore();
      await this.postChatScreen();
    } else {
      void vscode.commands.executeCommand("agentPanel.chat.focus");
    }
  }

  async pickAttachmentsFromUi(options?: { imagesOnly?: boolean }): Promise<void> {
    try {
      const picked = await pickWorkspaceAttachments({
        imagesOnly: Boolean(options?.imagesOnly),
      });
      if (picked.length) {
        const persisted = await persistIncomingAttachments(
          picked,
          this.storageUri()
        );
        await this.postAttachments(persisted);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(text);
    }
  }

  async attachUrisFromDrop(uris: vscode.Uri[]): Promise<void> {
    try {
      const fromUris = await attachmentsFromUris(uris.map((u) => u.toString()));
      if (!fromUris.length) {
        return;
      }
      const persisted = await persistIncomingAttachments(
        fromUris,
        this.storageUri()
      );
      await this.postAttachments(persisted);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(text);
    }
  }

  private historyContentText(content: ChatMessage["content"]): string {
    if (!content) {
      return "";
    }
    if (typeof content === "string") {
      return content;
    }
    return content
      .map((part) => (part.type === "text" ? part.text : "[image]"))
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
    const attachments = (uiUser.attachments || lastUser.attachments || []).map(
      stripAttachmentPayload
    );
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

  private canRegenerate(): boolean {
    return Boolean(this.getRegenerateState());
  }

  private postRegenerateState(): void {
    this.view?.webview.postMessage({
      type: "regenerateState",
      canRegenerate: this.canRegenerate(),
      selectedModel: this.selectedModel,
    });
  }

  private postContextUsage(): void {
    const max = getContextWindow(this.selectedModel);
    this.view?.webview.postMessage({
      type: "contextUsage",
      used: this.contextTokens,
      max,
    });
  }

  private saveStore(): Promise<void> {
    this.persistActiveChat();
    return this.writeStoreOnly();
  }

  private writeStoreOnly(): Promise<void> {
    if (!this.hasWorkspaceFolder()) {
      return Promise.resolve();
    }
    const revision = ++this.storeRevision;
    const snapshot = cloneStore(this.store);
    this.storeWriteQueue = this.storeWriteQueue
      .catch(() => undefined)
      .then(async () => {
        if (revision < this.persistedStoreRevision) {
          return;
        }
        await this.context.workspaceState.update(STORAGE_KEY_V2, snapshot);
        this.persistedStoreRevision = revision;
      });
    return this.storeWriteQueue;
  }

  private isViewingChat(chatId: string): boolean {
    return this.store.screen === "chat" && this.store.activeChatId === chatId;
  }

  /** Active chat id match — for live run UI even if screen briefly drifted. */
  private isActiveChat(chatId: string | undefined): boolean {
    return Boolean(chatId && this.store.activeChatId === chatId);
  }

  private postRunFailed(chatId: string, text: string): void {
    if (!this.isActiveChat(chatId)) {
      return;
    }
    this.view?.webview.postMessage({
      type: "runFailed",
      chatId,
      text,
    });
  }

  private syncActiveSnapshotFromChat(
    chatId: string,
    state: {
      history: ChatMessage[];
      uiMessages: UiMessage[];
      selectedModel: string;
      lastTurnModel: string;
      contextTokens: number;
    }
  ): void {
    if (!this.isViewingChat(chatId)) {
      return;
    }
    this.history = state.history;
    this.uiMessages = state.uiMessages;
    this.selectedModel = state.selectedModel;
    this.lastTurnModel = state.lastTurnModel;
    this.contextTokens = state.contextTokens;
  }

  private setRunStateForChat(
    chatId: string,
    state?: "running" | "success" | "error"
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

  private runStateForAgent(
    agentId: string
  ): "running" | "success" | "error" | "" {
    const agent = this.store.agents.find((item) => item.id === agentId);
    if (!agent) {
      return "";
    }
    const states = getAgentChatIds(agent)
      .map((chatId) => this.chatRunState.get(chatId))
      .filter(
        (state): state is "running" | "success" | "error" => Boolean(state)
      );
    if (states.includes("running")) {
      return "running";
    }
    if (states.includes("error")) {
      return "error";
    }
    return states.includes("success") ? "success" : "";
  }

  /** Mode of the chat currently running under this agent (for loader accent). */
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

  private postRunFinished(
    chatId: string,
    outcome: "success" | "error"
  ): void {
    if (!getConfig().soundNotifications.enabled) {
      return;
    }
    this.view?.webview.postMessage({
      type: "runFinished",
      outcome,
      chatId,
    });
  }

  private isChatRunning(chatId: string | undefined): boolean {
    return Boolean(chatId && this.chatRuns.has(chatId));
  }

  private abortChatRun(chatId: string | undefined): void {
    if (!chatId) {
      return;
    }
    const controller = this.chatRuns.get(chatId);
    if (!controller) {
      return;
    }
    this.chatRuns.delete(chatId);
    this.chatRunTokens.delete(chatId);
    controller.abort();
  }

  private abortAllRuns(): void {
    for (const [chatId, controller] of this.chatRuns.entries()) {
      this.chatRuns.delete(chatId);
      this.chatRunTokens.delete(chatId);
      controller.abort();
    }
  }

  private async reloadStoreForWorkspace(): Promise<void> {
    this.workspaceGeneration += 1;
    this.abortAllRuns();
    await this.saveStore();
    this.loadStore();
    this.workspaceGeneration += 1;
    await this.postInit();
  }

  private beginChatRun(chatId: string): {
    controller: AbortController;
    token: number;
    workspaceGeneration: number;
  } {
    this.abortChatRun(chatId);
    const controller = new AbortController();
    const token = this.nextRunToken++;
    this.chatRuns.set(chatId, controller);
    this.chatRunTokens.set(chatId, token);
    return {
      controller,
      token,
      workspaceGeneration: this.workspaceGeneration,
    };
  }

  /**
   * True while this run token still owns `chatId` in chatRuns.
   * Unlike {@link isChatRunCurrent}, ignores AbortSignal — needed to persist /
   * surface a final error after the gateway fails (or after Stop removes the
   * run from the map via abortChatRun, ownership is already gone).
   */
  private isChatRunOwned(
    chatId: string,
    run: {
      controller: AbortController;
      token: number;
      workspaceGeneration: number;
    }
  ): boolean {
    return (
      this.workspaceGeneration === run.workspaceGeneration &&
      this.chatRuns.get(chatId) === run.controller &&
      this.chatRunTokens.get(chatId) === run.token
    );
  }

  private isChatRunCurrent(
    chatId: string,
    run: {
      controller: AbortController;
      token: number;
      workspaceGeneration: number;
    }
  ): boolean {
    return (
      this.isChatRunOwned(chatId, run) && !run.controller.signal.aborted
    );
  }

  private finishChatRun(
    chatId: string,
    run: {
      controller: AbortController;
      token: number;
      workspaceGeneration: number;
    }
  ): void {
    // Clear even when the signal is aborted — otherwise a mid-turn abort that
    // did not go through abortChatRun could leave chatRuns stuck "running".
    if (!this.isChatRunOwned(chatId, run)) {
      return;
    }
    this.chatRuns.delete(chatId);
    this.chatRunTokens.delete(chatId);
  }

  /** Persist run UI/history without requiring !aborted (final error / stop). */
  private persistRunChatSnapshot(
    chatId: string,
    patch: {
      history?: ChatMessage[];
      uiMessages: UiMessage[];
      selectedModel?: string;
      lastTurnModel?: string;
      contextTokens?: number;
    }
  ): void {
    if (!this.store.chats[chatId]) {
      return;
    }
    const nextUi = patch.uiMessages.slice(-200);
    touchChat(this.store, chatId, {
      ...(patch.history ? { history: patch.history } : {}),
      uiMessages: nextUi,
      ...(patch.selectedModel ? { selectedModel: patch.selectedModel } : {}),
      ...(patch.lastTurnModel !== undefined
        ? { lastTurnModel: patch.lastTurnModel }
        : {}),
      ...(typeof patch.contextTokens === "number"
        ? { contextTokens: patch.contextTokens }
        : {}),
    });
    if (this.isActiveChat(chatId)) {
      this.uiMessages = nextUi;
      if (patch.history) {
        this.history = patch.history;
      }
      if (patch.selectedModel) {
        this.selectedModel = patch.selectedModel;
      }
      if (patch.lastTurnModel !== undefined) {
        this.lastTurnModel = patch.lastTurnModel;
      }
      if (typeof patch.contextTokens === "number") {
        this.contextTokens = patch.contextTokens;
      }
    }
    void this.writeStoreOnly();
  }

  private saveSession(): void {
    this.saveStore();
  }

  private pushUi(role: UiMessage["role"], text: string): void {
    this.uiMessages.push({ role, text });
    if (this.uiMessages.length > 200) {
      this.uiMessages = this.uiMessages.slice(-200);
    }
    this.saveSession();
    this.view?.webview.postMessage({ type: "append", role, text });
  }

  private pushUiToChat(
    chatId: string | undefined,
    role: UiMessage["role"],
    text: string
  ): void {
    if (!chatId) {
      this.pushUi(role, text);
      return;
    }
    const chat = this.store.chats[chatId];
    if (!chat) {
      return;
    }
    const nextUiMessages = [...chat.uiMessages, { role, text }].slice(-200);
    touchChat(this.store, chatId, { uiMessages: nextUiMessages });
    if (this.isViewingChat(chatId)) {
      this.uiMessages = nextUiMessages;
      this.writeStoreOnly();
      this.view?.webview.postMessage({ type: "append", role, text, chatId });
      return;
    }
    this.writeStoreOnly();
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
      this.view?.webview.postMessage({
        type: "status",
        chatId,
        text,
        hidden: nextHidden,
        phase,
        modelLabel: nextHidden ? undefined : modelLabel || undefined,
      });
    }
  }

  private modelLabel(id: string): string {
    if (!id) {
      return "";
    }
    const found = getConfig().models.find((m) => m.id === id);
    return found?.label || id;
  }

  private getProviderConnStatusForModel(
    modelId: string
  ): ProviderConnStatus {
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

  private isProviderStatusFresh(status: ProviderConnStatus | undefined): boolean {
    if (!status || status.state === "unknown" || status.state === "connecting") {
      return false;
    }
    return Date.now() - status.updatedAt < PROVIDER_PROBE_TTL_MS;
  }

  private postProviderConnStatus(status: ProviderConnStatus): void {
    const current = resolveModelEndpoint(this.selectedModel);
    const forChat =
      !status.providerId ||
      !current.providerId ||
      status.providerId === current.providerId;
    if (forChat) {
      this.view?.webview.postMessage({
        type: "providerConnStatus",
        status,
      });
    }
    this.settingsPanel?.webview.postMessage({
      type: "providerConnStatus",
      status,
    });
  }

  private setProviderConnStatus(status: ProviderConnStatus): void {
    if (!status.providerId) {
      return;
    }
    this.providerConnStatuses.set(status.providerId, status);
    this.postProviderConnStatus(status);
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
      const status: ProviderConnStatus = {
        providerId: "",
        providerName: endpoint.providerName || "",
        state: "error",
        message: "No provider configured",
        updatedAt: Date.now(),
      };
      this.postProviderConnStatus(status);
      return;
    }
    const current = this.providerConnStatuses.get(providerId);
    if (!force && this.isProviderStatusFresh(current)) {
      this.postProviderConnStatus(current!);
      return;
    }
    void this.probeProvider(providerId, { force });
  }

  private syncProviderConnPolling(): void {
    const need = Boolean(this.view?.visible) || Boolean(this.settingsPanel);
    if (need) {
      this.startProviderConnPolling();
    } else {
      this.stopProviderConnPolling();
    }
  }

  private startProviderConnPolling(): void {
    if (this.providerConnPollTimer) {
      return;
    }
    if (this.settingsPanel) {
      this.ensureAllProvidersProbed(true);
    } else {
      this.ensureProviderProbe(this.selectedModel, true);
    }
    this.providerConnPollTimer = setInterval(() => {
      if (!this.view?.visible && !this.settingsPanel) {
        this.stopProviderConnPolling();
        return;
      }
      if (this.settingsPanel) {
        this.ensureAllProvidersProbed(true);
      } else {
        void this.probeProvider(
          resolveModelEndpoint(this.selectedModel).providerId || "",
          { force: true, silent: true }
        );
      }
    }, PROVIDER_PROBE_POLL_MS);
  }

  private stopProviderConnPolling(): void {
    if (this.providerConnPollTimer) {
      clearInterval(this.providerConnPollTimer);
      this.providerConnPollTimer = undefined;
    }
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
      const connecting: ProviderConnStatus = {
        providerId,
        providerName: endpoint.providerName || providerId,
        state: "connecting",
        updatedAt: Date.now(),
      };
      this.setProviderConnStatus(connecting);
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

  private async handleListProviderModels(message: {
    requestId: string;
    providerId: string;
    baseUrl?: string;
    apiKey?: string;
    rejectUnauthorized?: boolean;
    caBundlePath?: string;
  }): Promise<void> {
    const requestId = String(message.requestId || "");
    const providerId = String(message.providerId || "").trim();
    const config = getConfig();
    const saved = config.providers.find((p) => p.id === providerId);
    const baseUrl = String(message.baseUrl || saved?.baseUrl || "")
      .trim()
      .replace(/\/$/, "");
    const apiKey =
      typeof message.apiKey === "string"
        ? message.apiKey
        : saved?.apiKey || "";
    const rejectUnauthorized =
      typeof message.rejectUnauthorized === "boolean"
        ? message.rejectUnauthorized
        : config.rejectUnauthorized;
    const caBundlePath =
      typeof message.caBundlePath === "string"
        ? message.caBundlePath.trim()
        : config.caBundlePath;

    const reply = (payload: {
      models?: string[];
      error?: string;
    }): void => {
      this.settingsPanel?.webview.postMessage({
        type: "providerModelsListed",
        requestId,
        providerId,
        models: payload.models || [],
        error: payload.error,
      });
    };

    if (!providerId) {
      reply({ error: "No provider id" });
      return;
    }
    if (!baseUrl) {
      reply({ error: "No base URL" });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      PROVIDER_PROBE_TIMEOUT_MS
    );
    try {
      const client = getOpenAICompatibleClient(baseUrl, apiKey, {
        rejectUnauthorized,
        caBundlePath,
      });
      const models = await client.listModels(controller.signal);
      const unique = Array.from(
        new Set(
          models
            .map((id) => String(id || "").trim())
            .filter(Boolean)
        )
      ).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base", numeric: true })
      );
      reply({ models: unique });
    } catch (error) {
      const aborted =
        controller.signal.aborted ||
        (error instanceof Error &&
          (error.message === "aborted" || /abort/i.test(error.message)));
      const raw = error instanceof Error ? error.message : String(error);
      reply({ error: (aborted ? "Timeout" : raw).slice(0, 240) });
    } finally {
      clearTimeout(timer);
    }
  }

  private postAgentsList(): void {
    const lang = resolveUiLanguage(getConfig().language);
    const list = buildAgentsList(this.store).map((a) => ({
      id: a.id,
      name: a.name,
      model: this.modelLabel(a.model) || a.model || "—",
      preview: a.preview,
      time: formatListTime(a.updatedAt, lang),
      active: a.active,
      empty: a.empty,
      runState: this.runStateForAgent(a.id),
      runMode: this.runModeForAgent(a.id),
    }));
    this.view?.webview.postMessage({
      type: "agentsList",
      agents: list,
      screen: this.store.screen,
    });
  }

  private postArchiveList(): void {
    const lang = resolveUiLanguage(getConfig().language);
    const archive = buildArchiveList(this.store);
    this.view?.webview.postMessage({
      type: "archiveList",
      agents: archive.map((a) => ({
        id: a.id,
        name: a.name,
        preview: a.preview,
        time: formatListTime(a.archivedAt, lang),
      })),
      screen: "archive",
    });
  }

  private async postChatScreen(highlightMessageIndex?: number): Promise<void> {
    if (this.acknowledgeViewedChatRunState(this.store.activeChatId)) {
      this.postAgentsList();
    }
    const config = getConfig();
    const models = getEnabledModels();
    if (!this.selectedModel || !models.some((m) => m.id === this.selectedModel)) {
      this.selectedModel =
        models.find((m) => m.id === config.defaultModel)?.id ??
        models[0]?.id ??
        "";
      if (this.store.activeChatId && this.store.chats[this.store.activeChatId]) {
        touchChat(this.store, this.store.activeChatId, {
          selectedModel: this.selectedModel,
        });
        this.writeStoreOnly();
      }
    }
    const agent = this.store.agents.find((a) => a.id === this.store.activeAgentId);
    const agentName = agent
      ? getAgentDisplayName(agent, this.store.chats[this.store.activeChatId])
      : "Agent";
    const branches = agent ? buildBranchesList(this.store, agent.id) : [];
    const providerConnStatus = this.getProviderConnStatusForModel(
      this.selectedModel
    );
    const payload: Record<string, unknown> = {
      type: "showChat",
      models,
      selectedModel: this.selectedModel,
      selectedMode: this.selectedMode,
      selectedReasoningEffort:
        this.resolveReasoningEffortForModel(this.selectedModel) || "",
      uiMessages: await this.enrichUiMessages(this.uiMessages),
      busy: this.isChatRunning(this.store.activeChatId),
      canRegenerate: this.canRegenerate(),
      agentId: agent?.id || "",
      agentName,
      chatTitle: agentName,
      chatId: this.store.activeChatId || "",
      branches,
      contextUsed: this.contextTokens,
      contextMax: getContextWindow(this.selectedModel),
      scrollTop: this.store.chats[this.store.activeChatId || ""]?.scrollTop,
      status: this.chatStatusState.get(this.store.activeChatId || "") || null,
      providerConnStatus,
    };
    if (
      typeof highlightMessageIndex === "number" &&
      Number.isInteger(highlightMessageIndex) &&
      highlightMessageIndex >= 0
    ) {
      payload.highlightMessageIndex = highlightMessageIndex;
    }
    this.view?.webview.postMessage(payload);
    this.ensureProviderProbe(this.selectedModel);
    this.scheduleScmRefresh();
  }

  private async onMessage(message: WebviewToHost): Promise<void> {
    switch (message.type) {
      case "ready":
        if (message.surface === "settings") {
          this.postSettings();
          this.settingsPanel?.webview.postMessage({
            type: "showSettings",
            openMcp: this.pendingSettingsOpenMcp,
          });
          this.pendingSettingsOpenMcp = false;
        } else {
          void this.postInit();
        }
        break;
      case "modelChanged": {
        // Guard against stale modelChanged arriving after a chat switch:
        // if the webview sent this for a different chat, ignore it — the
        // new active chat's model was already hydrated by openAgent.
        const msgChatId = String(message.chatId || "");
        if (
          msgChatId &&
          this.store.activeChatId &&
          msgChatId !== this.store.activeChatId
        ) {
          break;
        }
        this.selectedModel = String(message.model || "").trim();
        if (this.store.activeChatId && this.store.chats[this.store.activeChatId]) {
          touchChat(this.store, this.store.activeChatId, {
            selectedModel: this.selectedModel,
          });
        }
        this.saveSession();
        this.postContextUsage();
        this.postRegenerateState();
        this.view?.webview.postMessage({
          type: "modelsUpdated",
          models: getEnabledModels(),
          selectedModel: this.selectedModel,
          selectedReasoningEffort:
            this.resolveReasoningEffortForModel(this.selectedModel) || "",
        });
        this.ensureProviderProbe(this.selectedModel);
        break;
      }
      case "modeChanged": {
        const msgChatId = String(message.chatId || "");
        if (
          msgChatId &&
          this.store.activeChatId &&
          msgChatId !== this.store.activeChatId
        ) {
          break;
        }
        this.selectedMode = getModeById(message.mode).id;
        if (this.store.activeChatId && this.store.chats[this.store.activeChatId]) {
          touchChat(this.store, this.store.activeChatId, {
            selectedMode: this.selectedMode,
          });
        }
        this.saveSession();
        break;
      }
      case "reasoningEffortChanged": {
        const msgChatId = String(message.chatId || "");
        if (
          msgChatId &&
          this.store.activeChatId &&
          msgChatId !== this.store.activeChatId
        ) {
          break;
        }
        const next =
          normalizeReasoningEffort(message.reasoningEffort) || "";
        this.selectedReasoningEffort = next;
        if (this.store.activeChatId && this.store.chats[this.store.activeChatId]) {
          touchChat(this.store, this.store.activeChatId, {
            selectedReasoningEffort: next || undefined,
          });
        }
        this.saveSession();
        break;
      }
      case "newChat":
        this.newChat();
        break;
      case "newAgent":
        await this.createAgent();
        break;
      case "showAgents":
        this.persistActiveChat();
        this.ensureChatReady();
        this.hydrateActiveChat();
        this.setScreen("chat");
        this.saveStore();
        this.postAgentsList();
        await this.postChatScreen();
        this.view?.webview.postMessage({
          type: "showAgents",
          busy: this.isChatRunning(this.store.activeChatId),
        });
        break;
      case "showArchive":
        this.persistActiveChat();
        this.setScreen("archive");
        this.saveStore();
        this.postArchiveList();
        this.view?.webview.postMessage({
          type: "showArchive",
          busy: this.isChatRunning(this.store.activeChatId),
        });
        break;
      case "showSettings":
        this.openSettingsEditor();
        break;
      case "closeSettings":
        this.closeSettingsEditor();
        break;
      case "saveSettings":
        await this.saveSettings(message.settings);
        break;
      case "saveModes":
        await this.saveModes(message.modes);
        break;
      case "figmaConnect":
        await this.handleFigmaConnect();
        break;
      case "figmaDisconnect":
        await this.handleFigmaDisconnect();
        break;
      case "figmaConnectPat":
        await this.handleFigmaConnectPat(message.token);
        break;
      case "figmaRefreshStatus":
        await this.refreshFigmaStatus();
        break;
      case "mcpRefreshList":
        this.postMcpServersList();
        break;
      case "mcpUpsertServer":
        await this.handleMcpUpsert(message.server);
        break;
      case "mcpDeleteServer":
        await this.handleMcpDelete(message.id);
        break;
      case "mcpSetEnabled":
        await this.handleMcpSetEnabled(message.id, message.enabled);
        break;
      case "mcpConnectServer":
        await this.handleMcpConnect(message.id);
        break;
      case "listProviderModels":
        await this.handleListProviderModels(message);
        break;
      case "openAgent":
        this.openAgent(message.agentId);
        break;
      case "renameAgent": {
        const agent = this.store.agents.find((a) => a.id === message.agentId);
        if (agent && message.name.trim()) {
          agent.name = message.name.trim().slice(0, 80);
          agent.updatedAt = Date.now();
          this.saveStore();
          this.postAgentsList();
          this.view?.webview.postMessage({
            type: "agentRenamed",
            agentId: agent.id,
            name: agent.name,
          });
        }
        break;
      }
      case "archiveAgent":
        this.archiveAgent(message.agentId);
        break;
      case "restoreAgent":
        this.restoreAgent(message.agentId);
        break;
      case "deleteAgent":
        await this.confirmDeleteAgent(message.agentId);
        break;
      case "deleteAllArchived":
        await this.confirmDeleteAllArchived();
        break;
      case "stop":
        this.abortChatRun(this.store.activeChatId);
        this.setStatusForChat(this.store.activeChatId, "", true);
        this.postRegenerateState();
        this.view?.webview.postMessage({
          type: "stopped",
          chatId: this.store.activeChatId,
        });
        break;
      case "regenerate":
        await this.handleRegenerate(
          getModeById(message.agentMode).id,
          message.reasoningEffort
        );
        break;
      case "editUserMessage":
        await this.handleEditUserMessage(
          Number(message.index),
          String(message.text || ""),
          String(message.model || ""),
          message.attachments,
          getModeById(message.agentMode).id,
          message.reasoningEffort
        );
        break;
      case "pickAttachments":
        await this.pickAttachmentsFromUi({
          imagesOnly: Boolean(message.imagesOnly),
        });
        break;
      case "searchFiles": {
        const requestId = String(message.requestId || "");
        const query = String(message.query || "");
        try {
          const files = await searchWorkspaceFiles(query, 12);
          this.view?.webview.postMessage({
            type: "fileSearchResults",
            requestId,
            files,
          });
        } catch {
          this.view?.webview.postMessage({
            type: "fileSearchResults",
            requestId,
            files: [],
          });
        }
        break;
      }
      case "searchChat": {
        const requestId = String(message.requestId || "");
        this.persistActiveChat();
        const hits = searchChatMessages(this.store, {
          query: String(message.query || ""),
          scope: message.scope,
          role: message.role,
          date: message.date,
          activeAgentId: this.store.activeAgentId,
          limit: 50,
        }).map((hit) => ({
          ...hit,
          time: formatListTime(
            hit.updatedAt,
            resolveUiLanguage(getConfig().language)
          ),
        }));
        this.view?.webview.postMessage({
          type: "chatSearchResults",
          requestId,
          hits,
        });
        break;
      }
      case "openSearchHit": {
        const agentId = String(message.agentId || "");
        const messageIndex = Number(message.messageIndex);
        const chatId = String(message.chatId || "");
        if (!agentId || !Number.isInteger(messageIndex) || messageIndex < 0) {
          break;
        }
        this.openAgent(agentId, messageIndex, chatId || undefined);
        break;
      }
      case "branchFromMessage":
        this.branchFromMessage(Number(message.messageIndex));
        break;
      case "switchBranch":
        this.switchBranch(String(message.chatId || ""));
        break;
      case "deleteBranch":
        void this.deleteBranch(String(message.chatId || ""));
        break;
      case "attachUris":
        await this.attachUrisFromDrop(
          (Array.isArray(message.uris) ? message.uris : [])
            .map((u) => {
              try {
                return vscode.Uri.parse(String(u || ""));
              } catch {
                return undefined;
              }
            })
            .filter((u): u is vscode.Uri => Boolean(u))
        );
        break;
      case "attachFiles":
        try {
          const persisted = await persistIncomingAttachments(
            Array.isArray(message.files) ? message.files : [],
            this.storageUri()
          );
          await this.postAttachments(persisted);
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          void vscode.window.showErrorMessage(text);
        }
        break;
      case "openFile":
        await this.openWorkspaceFile(message.path);
        break;
      case "openFileDiff":
        await this.openWorkspaceFileDiff(message.path);
        break;
      case "openPlanMarkdown":
        await this.openPlanMarkdown(String(message.text || ""), {
          reveal: message.reveal === "preview" ? "preview" : "editor",
        });
        break;
      case "requestLivePlanForBuild": {
        const live = await this.readLivePlanMarkdown();
        const fallback = stripPlanImplementWrapper(
          String(message.fallbackText || "")
        );
        const text = live || fallback;
        this.view?.webview.postMessage({
          type: "livePlanForBuild",
          requestId: String(message.requestId || ""),
          text,
        });
        break;
      }
      case "commitAndPush":
        await this.handleCommitAndPush(
          Array.isArray(message.paths) ? message.paths : []
        );
        break;
      case "discardChanges":
        await this.handleDiscardChanges(
          Array.isArray(message.paths) ? message.paths : []
        );
        break;
      case "openScm":
        this.pendingScmReturnRefresh = true;
        await vscode.commands.executeCommand("workbench.view.scm");
        break;
      case "openExternal": {
        const raw = message.url?.trim();
        if (raw && /^https?:\/\//i.test(raw)) {
          await vscode.env.openExternal(vscode.Uri.parse(raw));
        }
        break;
      }
      case "copyText": {
        const text = String(message.text || "");
        if (text) {
          await vscode.env.clipboard.writeText(text);
          this.view?.webview.postMessage({ type: "copied" });
        }
        break;
      }
      case "chatScroll": {
        const chatId = String(message.chatId || "");
        const chat = this.store.chats[chatId];
        const scrollTop = Number(message.scrollTop);
        if (chat && Number.isFinite(scrollTop) && scrollTop >= 0) {
          chat.scrollTop = scrollTop;
          this.writeStoreOnly();
        }
        break;
      }
      case "pickModel":
        await this.pickModel();
        break;
      case "send":
        await this.handleSend(message.text, message.model, {
          attachments: message.attachments,
          agentMode: getModeById(message.agentMode).id,
          reasoningEffort: message.reasoningEffort,
        });
        break;
    }
  }

  private openAgent(
    agentId: string,
    highlightMessageIndex?: number,
    chatId?: string
  ): void {
    this.persistActiveChat();

    const agent = this.store.agents.find((a) => a.id === agentId);
    if (!agent || agent.archivedAt) {
      return;
    }
    const ids = getAgentChatIds(agent);
    const wantedChatId =
      chatId && ids.includes(chatId)
        ? chatId
        : ids.includes(agent.chatId)
          ? agent.chatId
          : ids[0];
    const chat = wantedChatId ? this.store.chats[wantedChatId] : undefined;
    if (!chat || chat.archivedAt) {
      return;
    }

    agent.chatId = chat.id;
    agent.chatIds = ids;
    this.store.activeAgentId = agentId;
    this.store.activeChatId = chat.id;
    this.setScreen("chat");
    this.acknowledgeViewedChatRunState(chat.id);
    this.hydrateActiveChat();
    this.saveStore();
    this.postAgentsList();
    void this.postChatScreen(
      Number.isInteger(highlightMessageIndex) &&
        (highlightMessageIndex as number) >= 0
        ? (highlightMessageIndex as number)
        : undefined
    );
  }

  private branchFromMessage(messageIndex: number): void {
    // Allowed while the source chat is still running: we snapshot history into
    // a new branch and switch to it; the old run keeps going on fromChatId
    // (same pattern as switchBranch / deleteBranch during a turn).
    const agentId = this.store.activeAgentId;
    const fromChatId = this.store.activeChatId;
    if (!agentId || !fromChatId) {
      return;
    }

    this.persistActiveChat();
    const created = branchChatFromMessage(
      this.store,
      agentId,
      fromChatId,
      messageIndex,
      this.history,
      this.uiMessages
    );
    if (!created) {
      void vscode.window.showWarningMessage(
        "You cannot branch from this message."
      );
      return;
    }

    this.setScreen("chat");
    this.hydrateActiveChat();
    this.saveStore();
    void this.postChatScreen();
  }

  private switchBranch(chatId: string): void {
    if (!chatId) {
      return;
    }
    if (chatId === this.store.activeChatId) {
      return;
    }
    this.persistActiveChat();
    if (!switchAgentBranch(this.store, this.store.activeAgentId, chatId)) {
      return;
    }
    this.setScreen("chat");
    this.hydrateActiveChat();
    this.saveStore();
    void this.postChatScreen();
  }

  private async deleteBranch(chatId: string): Promise<void> {
    if (!chatId) {
      return;
    }
    const agent = this.store.agents.find(
      (a) => a.id === this.store.activeAgentId
    );
    if (!agent) {
      return;
    }
    const branches = buildBranchesList(this.store, agent.id);
    const target = branches.find((b) => b.id === chatId);
    if (!target || !target.canDelete) {
      return;
    }

    const answer = await vscode.window.showWarningMessage(
      `Delete branch "${target.label}"?`,
      {
        modal: true,
        detail: "This branch history will be deleted permanently.",
      },
      "Delete"
    );
    if (answer !== "Delete") {
      return;
    }

    this.abortChatRun(chatId);
    this.persistActiveChat();
    if (!deleteAgentBranch(this.store, agent.id, chatId)) {
      return;
    }
    this.setScreen("chat");
    this.hydrateActiveChat();
    this.saveStore();
    void this.postChatScreen();
  }

  private async createAgent(): Promise<void> {
    const config = getConfig();
    const enabled = getEnabledModels();
    const model =
      this.selectedModel ||
      (enabled.some((m) => m.id === config.defaultModel)
        ? config.defaultModel
        : "") ||
      enabled[0]?.id ||
      "";
    const created = createEmptyAgent(model);
    this.persistActiveChat();
    this.store.agents.unshift(created.agent);
    this.store.chats[created.chat.id] = created.chat;
    this.store.activeAgentId = created.agent.id;
    this.store.activeChatId = created.chat.id;
    this.setScreen("chat");
    this.hydrateActiveChat();
    this.saveStore();
    this.postAgentsList();
    void this.postChatScreen();
  }

  /** Archive immediately — no confirm modal (restore stays in Archive screen). */
  private archiveAgent(agentId: string): void {
    const agent = this.store.agents.find((a) => a.id === agentId);
    if (!agent || agent.archivedAt) {
      return;
    }

    for (const chatId of getAgentChatIds(agent)) {
      this.abortChatRun(chatId);
    }
    this.persistActiveChat();
    if (!archiveAgentInStore(this.store, agentId)) {
      return;
    }
    this.setScreen("chat");
    this.hydrateActiveChat();
    this.saveStore();
    this.postAgentsList();
    void this.postChatScreen();
    this.view?.webview.postMessage({ type: "showAgents" });
  }

  private restoreAgent(agentId: string): void {
    this.persistActiveChat();
    if (!restoreAgentInStore(this.store, agentId)) {
      return;
    }
    this.setScreen("archive");
    this.saveStore();
    this.postArchiveList();
    this.postAgentsList();
  }

  private async confirmDeleteAgent(agentId: string): Promise<void> {
    const agent = this.store.agents.find((a) => a.id === agentId);
    if (!agent) {
      return;
    }
    const empty = getAgentChatIds(agent).every(
      (id) => !chatHasMessages(this.store.chats[id]?.uiMessages)
    );
    const isRu = resolveUiLanguage(getConfig().language) === "ru";
    const deleteLabel = isRu ? "Удалить" : "Delete";
    const answer = await vscode.window.showWarningMessage(
      empty
        ? isRu
          ? `Удалить пустого агента «${agent.name}»?`
          : `Delete empty agent "${agent.name}"?`
        : isRu
          ? `Удалить «${agent.name}» безвозвратно?`
          : `Delete "${agent.name}" permanently?`,
      {
        modal: true,
        detail: empty
          ? isRu
            ? "У агента нет сообщений — он будет удалён без архивации."
            : "This agent has no messages and will be deleted without archiving."
          : isRu
            ? "История сообщений будет удалена безвозвратно."
            : "Message history will be deleted permanently.",
      },
      deleteLabel
    );
    if (answer !== deleteLabel) {
      return;
    }

    for (const chatId of getAgentChatIds(agent)) {
      this.abortChatRun(chatId);
    }
    this.persistActiveChat();
    if (!deleteAgentFromStore(this.store, agentId)) {
      return;
    }
    this.hydrateActiveChat();
    this.saveStore();
    if (this.store.screen === "archive") {
      this.postArchiveList();
      this.postAgentsList();
    } else {
      this.setScreen("chat");
      this.postAgentsList();
      void this.postChatScreen();
      this.view?.webview.postMessage({ type: "showAgents" });
    }
  }

  private async confirmDeleteAllArchived(): Promise<void> {
    const archived = buildArchiveList(this.store);
    if (!archived.length) {
      return;
    }
    const isRu = resolveUiLanguage(getConfig().language) === "ru";
    const deleteLabel = isRu ? "Удалить все" : "Delete all";
    const answer = await vscode.window.showWarningMessage(
      isRu
        ? `Удалить все агенты из архива (${archived.length})?`
        : `Delete all archived agents (${archived.length})?`,
      {
        modal: true,
        detail: isRu
          ? "История сообщений будет удалена безвозвратно."
          : "Message history will be deleted permanently.",
      },
      deleteLabel
    );
    if (answer !== deleteLabel) {
      return;
    }

    for (const item of archived) {
      const agent = this.store.agents.find((a) => a.id === item.id);
      if (!agent) {
        continue;
      }
      for (const chatId of getAgentChatIds(agent)) {
        this.abortChatRun(chatId);
      }
    }
    this.persistActiveChat();
    deleteAllArchivedAgentsFromStore(this.store);
    this.hydrateActiveChat();
    this.saveStore();
    this.setScreen("archive");
    this.postArchiveList();
    this.postAgentsList();
  }

  private async pickModel(): Promise<void> {
    const models = getEnabledModels();
    if (!models.length) {
      void vscode.window.showWarningMessage(
        "No models are enabled. Enable models in Harbor Agents settings."
      );
      return;
    }

    const items = models.map((m) => ({
      label: `${m.favorite === true ? "$(heart-filled) " : ""}${m.label || m.id}`,
      description: m.id === this.selectedModel ? "current" : m.id,
      id: m.id,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      title: "Agent Model",
      placeHolder: "Choose a model",
      matchOnDescription: true,
    });

    if (!picked) {
      return;
    }

    this.selectedModel = picked.id;
    this.saveSession();
    this.view?.webview.postMessage({
      type: "modelsUpdated",
      models,
      selectedModel: this.selectedModel,
    });
    this.ensureProviderProbe(this.selectedModel);
  }

  private async openWorkspaceFile(relativePath: string): Promise<void> {
    const uri = this.resolveWorkspaceUri(relativePath);
    if (!uri) {
      return;
    }
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        `Failed to open ${relativePath}: ${text}`
      );
    }
  }

  /**
   * Open/update the latest Plan as a live editable Markdown document
   * (`План.md` / `Plan.md` under globalStorage). Same URI every turn so
   * revisions overwrite the buffer; Build reads unsaved editor text via
   * `readLivePlanMarkdown`.
   *
   * reveal "editor" (default) — text tab beside the panel (Cursor-like live plan).
   * reveal "preview" — markdown preview (card «Open in tab» opt-in).
   */
  private async openPlanMarkdown(
    markdown: string,
    options?: { reveal?: "editor" | "preview" }
  ): Promise<void> {
    const content = stripPlanImplementWrapper(markdown);
    if (!content) {
      return;
    }
    const reveal = options?.reveal === "preview" ? "preview" : "editor";
    const fileName = planMarkdownFileName(
      resolveUiLanguage(getConfig().language)
    );
    try {
      const dir = vscode.Uri.joinPath(
        this.context.globalStorageUri,
        "plan-preview"
      );
      await vscode.workspace.fs.createDirectory(dir);
      const uri = vscode.Uri.joinPath(dir, fileName);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
      this.planPreviewUri = uri;

      const openDoc = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.toString() === uri.toString()
      );
      if (openDoc && openDoc.getText() !== content) {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          openDoc.positionAt(0),
          openDoc.positionAt(openDoc.getText().length)
        );
        edit.replace(uri, fullRange, content);
        await vscode.workspace.applyEdit(edit);
      }

      const doc = await vscode.workspace.openTextDocument(uri);
      if (doc.languageId !== "markdown") {
        await vscode.languages.setTextDocumentLanguage(doc, "markdown");
      }
      if (doc.getText() !== content) {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          doc.positionAt(0),
          doc.positionAt(doc.getText().length)
        );
        edit.replace(uri, fullRange, content);
        await vscode.workspace.applyEdit(edit);
      }

      if (reveal === "preview") {
        try {
          await vscode.commands.executeCommand("markdown.showPreviewToSide", uri);
          try {
            await vscode.commands.executeCommand("markdown.preview.refresh");
          } catch {
            // older builds
          }
        } catch {
          await vscode.window.showTextDocument(doc, {
            preview: false,
            preserveFocus: true,
            viewColumn: vscode.ViewColumn.Beside,
          });
        }
        return;
      }

      await vscode.window.showTextDocument(doc, {
        preview: false,
        preserveFocus: true,
        viewColumn: vscode.ViewColumn.Beside,
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        `Failed to open plan markdown: ${text}`
      );
    }
  }

  /**
   * Current live plan body: prefer unsaved editor buffer, else disk file.
   */
  private async readLivePlanMarkdown(): Promise<string> {
    const uri = this.planPreviewUri;
    if (!uri) {
      const fileName = planMarkdownFileName(
        resolveUiLanguage(getConfig().language)
      );
      const fallbackUri = vscode.Uri.joinPath(
        this.context.globalStorageUri,
        "plan-preview",
        fileName
      );
      try {
        const bytes = await vscode.workspace.fs.readFile(fallbackUri);
        this.planPreviewUri = fallbackUri;
        return stripPlanImplementWrapper(
          Buffer.from(bytes).toString("utf8")
        );
      } catch {
        return "";
      }
    }
    const openDoc = vscode.workspace.textDocuments.find(
      (doc) => doc.uri.toString() === uri.toString()
    );
    if (openDoc) {
      return stripPlanImplementWrapper(openDoc.getText());
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return stripPlanImplementWrapper(Buffer.from(bytes).toString("utf8"));
    } catch {
      return "";
    }
  }

  /** Diff working tree vs HEAD — свой provider, без git.openChange. */
  private async openWorkspaceFileDiff(relativePath: string): Promise<void> {
    const opened = await openWorkingTreeDiff(relativePath);
    if (opened) {
      return;
    }
    await this.openWorkspaceFile(relativePath);
  }

  private resolveWorkspaceUri(relativePath: string): vscode.Uri | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return undefined;
    }
    const normalized = relativePath
      .trim()
      .replace(/^\.\//, "")
      .replace(/^\/+/, "")
      .replace(/\\/g, "/");
    if (!normalized) {
      return undefined;
    }
    return vscode.Uri.joinPath(folder.uri, ...normalized.split("/"));
  }

  private async handleSend(
    text: string,
    model: string,
    options?: {
      appendUser?: boolean;
      attachments?: IncomingAttachment[] | MessageAttachment[];
      agentMode?: string;
      reasoningEffort?: string;
    }
  ): Promise<void> {
    const config = getConfig();
    const enabledModels = getEnabledModels();
    const runChatId = this.store.activeChatId;
    if (!enabledModels.length) {
      this.pushUiToChat(
        runChatId,
        "error",
        "No models are enabled. Enable models in Harbor Agents settings."
      );
      this.view?.webview.postMessage({
        type: "idle",
        chatId: runChatId,
      });
      return;
    }

    let attachments: MessageAttachment[] = [];
    try {
      attachments = await persistIncomingAttachments(
        options?.attachments,
        this.storageUri()
      );
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      this.pushUiToChat(runChatId, "error", messageText);
      this.view?.webview.postMessage({
        type: "idle",
        chatId: runChatId,
      });
      return;
    }

    const trimmed = String(text || "").trim();
    if (!trimmed && !attachments.length) {
      this.view?.webview.postMessage({
        type: "idle",
        chatId: runChatId,
      });
      return;
    }

    const requestedModel =
      (model && enabledModels.some((m) => m.id === model) ? model : "") ||
      (this.selectedModel &&
      enabledModels.some((m) => m.id === this.selectedModel)
        ? this.selectedModel
        : "") ||
      (config.defaultModel &&
      enabledModels.some((m) => m.id === config.defaultModel)
        ? config.defaultModel
        : "") ||
      enabledModels[0].id;
    const selectedMode = getModeById(options?.agentMode ?? this.selectedMode);
    // Режим из UI — как выбрал пользователь. Не подменяем Agent→Ask.
    const modeForRun = selectedMode;
    // Картинки: пиксели уходят в Cline как image parts; vision/placeholder —
    // на стороне Cline по capabilities модели. Harbor модель не подменяет.
    const chosen = requestedModel;
    const reasoningEffortForRun = this.resolveReasoningEffortForModel(
      chosen,
      options?.reasoningEffort
    );
    this.selectedMode = modeForRun.id;
    if (reasoningEffortForRun) {
      this.selectedReasoningEffort = reasoningEffortForRun;
    }
    if (this.store.activeChatId && this.store.chats[this.store.activeChatId]) {
      touchChat(this.store, this.store.activeChatId, {
        selectedMode: this.selectedMode,
        ...(reasoningEffortForRun
          ? { selectedReasoningEffort: reasoningEffortForRun }
          : {}),
      });
    }
    if (!runChatId || !this.store.chats[runChatId]) {
      this.view?.webview.postMessage({ type: "idle", chatId: runChatId });
      return;
    }
    let runHistory = this.history;
    let runUiMessages = this.uiMessages;
    let runTransientStart = runUiMessages.length;
    let runLastTurnModel = this.lastTurnModel || "";
    let runContextTokens = this.contextTokens;
    const syncRunChat = (): void => {
      if (!this.isChatRunCurrent(runChatId, runRef)) {
        return;
      }
      // Use the live picker choice only if the user is still viewing this
      // chat. If they switched to another chat mid-run, this.selectedModel
      // belongs to the other chat — don't let it leak into runChatId.
      const modelForChat =
        this.store.activeChatId === runChatId
          ? this.selectedModel || chosen
          : chosen;
      touchChat(this.store, runChatId, {
        selectedModel: modelForChat,
        lastTurnModel: runLastTurnModel,
        history: runHistory,
        uiMessages: runUiMessages.slice(-200),
        contextTokens: runContextTokens,
      });
      this.syncActiveSnapshotFromChat(runChatId, {
        history: runHistory,
        uiMessages: runUiMessages,
        selectedModel: modelForChat,
        lastTurnModel: runLastTurnModel,
        contextTokens: runContextTokens,
      });
      void this.writeStoreOnly();
    };
    // Live run UI: activeChatId is enough. Gating on screen==="chat" dropped
    // assistantDone/deltas when screen briefly drifted while the user still
    // had this chat selected — finale stayed only in store until remount.
    const postToRunChat = (message: Record<string, unknown>): void => {
      if (
        this.isChatRunCurrent(runChatId, runRef) &&
        this.isActiveChat(runChatId)
      ) {
        this.view?.webview.postMessage({ ...message, chatId: runChatId });
      }
    };
    this.selectedModel = chosen;
    void this.saveSession();
    this.ensureProviderProbe(chosen);

    const endpoint = resolveModelEndpoint(chosen);
    if (!endpoint.baseUrl) {
      this.pushUiToChat(
        runChatId,
        "error",
        `No base URL is configured for "${endpoint.providerName}". Add a provider in settings.`
      );
      this.view?.webview.postMessage({ type: "idle", chatId: runChatId });
      return;
    }

    // Start run tracking before we touch UI/store for this run.
    // Otherwise early syncRunChat() calls could run in TDZ of runRef.
    const runRef = this.beginChatRun(runChatId);
    const currentRun = runRef.controller;

    if (options?.appendUser !== false) {
      const uiMsg: UiMessage = {
        role: "user",
        text: trimmed,
        mode: modeForRun.id,
      };
      if (attachments.length) {
        uiMsg.attachments = attachments.map(stripAttachmentPayload);
      }
      runUiMessages.push(uiMsg);
      syncRunChat();
    }
    // Tool-статусы этого запуска временные до успешного финала.
    runTransientStart = runUiMessages.length;

    this.setRunStateForChat(runChatId, "running");
    const mode = modeForRun;
    const agentMode = mode.id;
    const turnEdits: FileEditStat[] = [];
    let activeTurnModel = chosen;
    let fallbackAttempted = false;
    let turnHadToolSideEffects = false;
    let turnHadAssistantOutput = false;
    this.setStatusForChat(
      runChatId,
      modeThinkingLabel(mode),
      false,
      "thinking",
      this.modelLabel(activeTurnModel)
    );

    try {
      while (true) {
        try {
          runHistory = await runAgentTurn({
            model: activeTurnModel,
            history: runHistory,
            userText: trimmed,
            attachments,
            storageUri: this.storageUri(),
            signal: currentRun.signal,
            agentMode,
            reasoningEffort: reasoningEffortForRun,
            lastAgentEditedPaths:
              this.store.chats[runChatId]?.lastAgentEditedPaths || [],
            callbacks: {
          onPhase: (phase, detail) => {
            if (!this.isChatRunCurrent(runChatId, runRef)) {
              return;
            }
            if (phase === "cline") {
              this.setStatusForChat(
                runChatId,
                detail || "cline",
                false,
                "cline",
                this.modelLabel(activeTurnModel)
              );
              return;
            }
            const lang = resolveUiLanguage(getConfig().language);
            const fallback =
              phase === "done"
                ? lang === "ru"
                  ? "Готово"
                  : "Done"
                : phase === "editing"
                  ? lang === "ru"
                    ? "Редактирую..."
                    : "Editing..."
                  : phase === "verifying"
                    ? lang === "ru"
                      ? "Проверяю..."
                      : "Verifying..."
                  : phase === "reading"
                    ? lang === "ru"
                      ? "Читаю..."
                      : "Reading..."
                    : phase === "listing"
                      ? lang === "ru"
                        ? "Просматриваю..."
                        : "Listing..."
                      : phase === "running"
                        ? lang === "ru"
                          ? "Запускаю..."
                          : "Running..."
                        : lang === "ru"
                          ? "Думаю..."
                          : "Thinking...";
            this.setStatusForChat(
              runChatId,
              detail || fallback,
              false,
              phase,
              this.modelLabel(activeTurnModel)
            );
          },
          onActiveModel: (modelId) => {
            if (!this.isChatRunCurrent(runChatId, runRef)) {
              return;
            }
            activeTurnModel = modelId;
            const current = this.chatStatusState.get(runChatId);
            if (current && !current.hidden && current.text) {
              this.setStatusForChat(
                runChatId,
                current.text,
                false,
                current.phase,
                this.modelLabel(activeTurnModel)
              );
            }
          },
          onTool: (toolText) => {
            if (!this.isChatRunCurrent(runChatId, runRef)) {
              return;
            }
            turnHadToolSideEffects = true;
            runUiMessages.push({ role: "tool", text: toolText });
            syncRunChat();
            postToRunChat({ type: "append", role: "tool", text: toolText });
          },
          onStep: (event) => {
            if (!this.isChatRunCurrent(runChatId, runRef)) {
              return;
            }
            if (event.kind === "tool") {
              turnHadToolSideEffects = true;
              const label = event.name
                ? `⚙ ${event.name}(${event.argsPreview || ""})`
                : "⚙ tool";
              const existingIx = runUiMessages.findIndex(
                (m) => m.role === "tool" && m.step?.stepId === event.stepId
              );
              const uiMsg: import("./sessionStore").UiMessage = {
                role: "tool",
                text: label,
                step: {
                  stepId: event.stepId,
                  kind: "tool",
                  toolCallId: event.toolCallId,
                  name: event.name,
                  argsPreview: event.argsPreview,
                  status: event.status,
                  resultPreview: event.resultPreview,
                },
              };
              if (existingIx >= 0) {
                runUiMessages[existingIx] = uiMsg;
              } else {
                runUiMessages.push(uiMsg);
              }
              syncRunChat();
            } else if (event.kind === "compaction" || event.kind === "retry") {
              runUiMessages.push({
                role: "tool",
                text: event.text || event.kind,
                step: {
                  stepId: event.stepId,
                  kind: event.kind,
                  text: event.text,
                  attempt: event.attempt,
                  maxAttempts: event.maxAttempts,
                },
              });
              syncRunChat();
            }
            postToRunChat({ type: "step", ...event });
          },
          onFileEdit: (edit) => {
            if (!this.isChatRunCurrent(runChatId, runRef)) {
              return;
            }
            turnEdits.push(edit);
          },
          onAssistant: (assistantText, meta) => {
            if (!this.isChatRunCurrent(runChatId, runRef)) {
              return;
            }
            turnHadAssistantOutput = true;
            runLastTurnModel = activeTurnModel;
            // Plan card: wrap in Plan mode, or when the finale clearly is a
            // plan (Agent often drafts Figma/impl plans without switching mode).
            const displayText =
              mode.id === "plan" ||
              looksLikeImplementationPlan(assistantText)
                ? ensureProposedPlanWrapper(assistantText)
                : assistantText;
            const uiMsg: UiMessage = { role: "assistant", text: displayText };
            if (meta?.reasoning) {
              uiMsg.reasoning = meta.reasoning;
            }
            runUiMessages.push(uiMsg);
            syncRunChat();
            this.setRunStateForChat(runChatId, "success");
            postToRunChat({
              type: "assistantDone",
              text: displayText,
              ...(meta?.reasoning ? { reasoning: meta.reasoning } : {}),
            });
            if (this.isViewingChat(runChatId)) {
              this.postRegenerateState();
            }
          },
          onReasoning: (reasoningText) => {
            if (!this.isChatRunCurrent(runChatId, runRef)) {
              return;
            }
            postToRunChat({
              type: "reasoning",
              text: reasoningText,
            });
          },
          onAssistantDelta: (chunk) => {
            if (!this.isChatRunCurrent(runChatId, runRef)) {
              return;
            }
            if (chunk) {
              // Never replay a turn through another model after any visible
              // streamed output; that could duplicate or contradict content.
              turnHadAssistantOutput = true;
            }
            postToRunChat({ type: "assistantDelta", text: chunk });
          },
          onAssistantStreamClear: () => {
            if (!this.isChatRunCurrent(runChatId, runRef)) {
              return;
            }
            postToRunChat({ type: "assistantStreamClear" });
          },
          onReview: (edits) => {
            if (!this.isChatRunCurrent(runChatId, runRef)) {
              return;
            }
            const reviewEdits = edits.length ? edits : turnEdits;
            // Remember paths for later «отмени изменения» (agent-only discard).
            const editedPaths = [
              ...new Set(
                reviewEdits
                  .map((edit) => String(edit.path || "").trim())
                  .filter(Boolean)
              ),
            ];
            touchChat(this.store, runChatId, {
              lastAgentEditedPaths: editedPaths,
            });
            void this.writeStoreOnly();
            // Не завязываемся на chatRuns после await: finally снимает run,
            // а review всё ещё должен попасть в UI (если не abort / не новый run).
            return this.publishReview(
              reviewEdits,
              runChatId,
              runUiMessages,
              () =>
                this.workspaceGeneration === runRef.workspaceGeneration &&
                !runRef.controller.signal.aborted &&
                Boolean(this.store.chats[runChatId])
            );
          },
          onUsage: (usage) => {
            if (!this.isChatRunCurrent(runChatId, runRef)) {
              return;
            }
            runContextTokens = usage.used;
            syncRunChat();
            if (this.isViewingChat(runChatId)) {
              this.postContextUsage();
            }
          },
          onFigmaNeedsConnect: () => {
            if (!this.isChatRunCurrent(runChatId, runRef)) {
              return;
            }
            const lang = resolveUiLanguage(getConfig().language);
            const text =
              lang === "ru"
                ? "Figma не подключён. Откройте Settings → MCP Servers и настройте подключение (Personal Access Token)."
                : "Figma is not connected. Open Settings → MCP Servers and configure a connection (Personal Access Token).";
            this.pushUiToChat(runChatId, "error", text);
            this.view?.webview.postMessage({
              type: "figmaNeedsConnect",
              chatId: runChatId,
            });
            this.openSettingsEditor({ mcp: true });
          },
            },
          });
          break;
        } catch (error) {
          const fallbackError = modelFallbackEligibility({
            error,
            fallbackAlreadyAttempted: fallbackAttempted,
            hadFileEdits: turnEdits.length > 0,
            hadToolSideEffects: turnHadToolSideEffects,
            hadAssistantOutput: turnHadAssistantOutput,
            aborted:
              currentRun.signal.aborted ||
              (error instanceof Error && error.message === "aborted"),
          });
          if (!fallbackError) {
            throw error;
          }

          const failedModel = activeTurnModel;
          const failedContextWindow = getContextWindow(failedModel);
          const minimumContextWindow =
            fallbackError.kind === "context"
              ? failedContextWindow + 1
              : failedContextWindow;
          const fallback = selectFallbackModel(enabledModels, {
            failedModelId: failedModel,
            minContextWindow: minimumContextWindow,
          });
          if (!fallback) {
            throw error;
          }

          fallbackAttempted = true;
          activeTurnModel = fallback.modelId;
          runUiMessages.splice(runTransientStart);
          syncRunChat();
          postToRunChat({ type: "assistantStreamClear" });

          const fallbackLabel =
            enabledModels.find((item) => item.id === activeTurnModel)?.label ||
            activeTurnModel;
          const reason = fallbackError.message.replace(/\s+/g, " ").slice(0, 240);
          const lang = resolveUiLanguage(getConfig().language);
          const statusText =
            lang === "ru"
              ? `Модель ${failedModel} отказала (${reason}). Повторяю один раз через ${fallbackLabel}.`
              : `${failedModel} failed (${reason}). Retrying once with ${fallbackLabel}.`;
          this.setStatusForChat(
            runChatId,
            statusText,
            false,
            "thinking",
            this.modelLabel(activeTurnModel)
          );
          void vscode.window.showWarningMessage(statusText);
        }
      }
      // Drop older tool cards from persisted UI (API history unchanged). Keeps
      // the 200-message window useful after long Plan/Agent explore turns.
      const collapsedUi = collapseOldToolUiMessages(runUiMessages);
      if (collapsedUi !== runUiMessages) {
        runUiMessages = collapsedUi;
      }
      syncRunChat();
      if (
        this.isChatRunCurrent(runChatId, runRef) &&
        this.isViewingChat(runChatId)
      ) {
        this.postContextUsage();
      }
      if (
        this.isChatRunCurrent(runChatId, runRef) &&
        !currentRun.signal.aborted
      ) {
        this.postRunFinished(runChatId, "success");
      }
    } catch (error) {
      const owned = this.isChatRunOwned(runChatId, runRef);
      const superseded =
        !owned && this.chatRuns.get(runChatId) !== runRef.controller;
      const rawMessage =
        error instanceof Error ? error.message : String(error);
      const transportKind = classifyModelFallbackError(error)?.kind;
      // Transport/API 500 must surface even if AbortSignal raced (Stop / socket).
      // Treating those as a silent abort left «Работаю…» with no error bubble.
      const aborted =
        transportKind !== "transport" &&
        (currentRun.signal.aborted ||
          (error instanceof Error && error.message === "aborted"));

      if (owned || this.isActiveChat(runChatId)) {
        this.setStatusForChat(runChatId, "", true);
      }

      if (aborted) {
        // Не оставляем в истории незавершённые tool-строки после Stop.
        // abortChatRun already removed us from chatRuns — persist directly.
        runUiMessages.splice(runTransientStart);
        this.persistRunChatSnapshot(runChatId, {
          history: runHistory,
          uiMessages: runUiMessages,
          selectedModel: chosen,
          lastTurnModel: runLastTurnModel,
          contextTokens: runContextTokens,
        });
        this.setRunStateForChat(runChatId);
        if (this.isActiveChat(runChatId)) {
          this.postRegenerateState();
          this.view?.webview.postMessage({
            type: "stopped",
            chatId: runChatId,
          });
        }
        return;
      }

      // A newer run replaced this one — do not paint error into the new turn.
      if (superseded) {
        return;
      }

      let messageText = rawMessage;
      if (transportKind === "transport") {
        const lang = resolveUiLanguage(getConfig().language);
        const reason = rawMessage.replace(/\s+/g, " ").slice(0, 240);
        const isHttpServerError = /\bAPI\s*5\d\d\b/i.test(reason);
        if (lang === "ru") {
          messageText = isHttpServerError
            ? `Ошибка сервера модели: ${reason}. Отправьте запрос ещё раз.`
            : `Соединение с моделью разорвано: ${reason}. Отправьте запрос ещё раз.`;
        } else {
          messageText = isHttpServerError
            ? `Model server error: ${reason}. Send the request again.`
            : `Connection to the model was interrupted: ${reason}. Send the request again.`;
        }
      }
      const lastUi = runUiMessages[runUiMessages.length - 1];
      if (!(lastUi?.role === "error" && lastUi.text === messageText)) {
        runUiMessages.push({ role: "error", text: messageText });
      }
      // Persist even if AbortSignal flipped mid-catch; do not rely on
      // syncRunChat → isChatRunCurrent (!aborted).
      this.persistRunChatSnapshot(runChatId, {
        history: runHistory,
        uiMessages: runUiMessages,
        selectedModel: chosen,
        lastTurnModel: runLastTurnModel,
        contextTokens: runContextTokens,
      });
      this.setRunStateForChat(runChatId, "error");
      this.postRunFinished(runChatId, "error");
      // Dedicated runFailed: append + seal + clear busy in one webview message.
      // Do not gate on screen==="chat" — activeChatId is enough.
      this.postRunFailed(runChatId, messageText);
      if (this.isActiveChat(runChatId)) {
        this.postRegenerateState();
      }
    } finally {
      this.finishChatRun(runChatId, runRef);
      // Belt-and-suspenders: success relies on assistantDone; transport errors
      // / missing finales must not leave the composer stuck on Stop.
      if (this.isActiveChat(runChatId) && !this.isChatRunning(runChatId)) {
        this.view?.webview.postMessage({ type: "idle", chatId: runChatId });
        // Re-send last assistant finale from store. Covers races where the
        // first assistantDone was dropped or painted onto a detached stream
        // node; webview treats duplicate finales as no-ops.
        this.postAssistantFinaleCatchUp(runChatId);
      }
    }
  }

  /**
   * After a turn ends, ensure the active webview has the last assistant
   * message from store (idempotent on the webview side).
   */
  private postAssistantFinaleCatchUp(chatId: string): void {
    if (!this.isActiveChat(chatId)) {
      return;
    }
    const msgs = this.store.chats[chatId]?.uiMessages || [];
    let lastAssistant: UiMessage | undefined;
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const row = msgs[i];
      if (!row) {
        continue;
      }
      if (row.role === "assistant") {
        lastAssistant = row;
        break;
      }
      // Stop at the prior user turn — don't resurrect an older finale.
      if (row.role === "user") {
        break;
      }
    }
    const text = String(lastAssistant?.text || "").trim();
    if (!text) {
      return;
    }
    this.view?.webview.postMessage({
      type: "assistantDone",
      chatId,
      text: lastAssistant!.text,
      ...(lastAssistant?.reasoning
        ? { reasoning: lastAssistant.reasoning }
        : {}),
    });
  }

  private async handleRegenerate(
    agentMode = "agent",
    reasoningEffort?: string
  ): Promise<void> {
    const state = this.getRegenerateState();
    if (!state) {
      this.postRegenerateState();
      this.view?.webview.postMessage({
        type: "idle",
        chatId: this.store.activeChatId,
      });
      return;
    }

    this.abortChatRun(this.store.activeChatId);
    this.history = state.history;
    this.uiMessages = state.uiMessages;
    this.selectedModel = state.model;
    this.saveSession();
    this.view?.webview.postMessage({
      type: "messagesReplaced",
      uiMessages: await this.enrichUiMessages(this.uiMessages),
      selectedModel: this.selectedModel,
      canRegenerate: false,
    });
    await this.handleSend(state.userText, state.model, {
      appendUser: false,
      attachments: state.attachments,
      agentMode,
      reasoningEffort,
    });
  }

  private async handleEditUserMessage(
    index: number,
    text: string,
    model: string,
    incomingAttachments?: IncomingAttachment[],
    agentMode = "agent",
    reasoningEffort?: string
  ): Promise<void> {
    const nextText = text.trim();
    const target = this.uiMessages[index];
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      !target ||
      target.role !== "user"
    ) {
      this.postRegenerateState();
      this.view?.webview.postMessage({
        type: "idle",
        chatId: this.store.activeChatId,
      });
      return;
    }

    let attachments: MessageAttachment[] = [];
    try {
      if (incomingAttachments?.length) {
        attachments = await persistIncomingAttachments(
          incomingAttachments,
          this.storageUri()
        );
      } else if (target.attachments?.length) {
        attachments = target.attachments.map(stripAttachmentPayload);
      }
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      this.pushUiToChat(this.store.activeChatId, "error", messageText);
      this.view?.webview.postMessage({
        type: "idle",
        chatId: this.store.activeChatId,
      });
      return;
    }

    if (!nextText && !attachments.length) {
      this.postRegenerateState();
      this.view?.webview.postMessage({
        type: "idle",
        chatId: this.store.activeChatId,
      });
      return;
    }

    let userOrdinal = 0;
    for (let i = 0; i < index; i++) {
      if (this.uiMessages[i]?.role === "user") {
        userOrdinal += 1;
      }
    }

    this.abortChatRun(this.store.activeChatId);
    this.history = this.history.slice(0, Math.max(0, userOrdinal * 2));
    this.uiMessages = this.uiMessages.slice(0, index);
    const uiMsg: UiMessage = {
      role: "user",
      text: nextText,
      mode: getModeById(agentMode).id,
    };
    if (attachments.length) {
      uiMsg.attachments = attachments.map(stripAttachmentPayload);
    }
    this.uiMessages.push(uiMsg);
    this.lastTurnModel = "";
    this.contextTokens = 0;
    this.saveSession();
    this.view?.webview.postMessage({
      type: "messagesReplaced",
      uiMessages: await this.enrichUiMessages(this.uiMessages),
      selectedModel: this.selectedModel,
      canRegenerate: false,
    });
    await this.handleSend(nextText, model, {
      appendUser: false,
      attachments,
      agentMode,
      reasoningEffort,
    });
  }

  private async handleCommitAndPush(paths: string[]): Promise<void> {
    const runChatId = this.store.activeChatId;
    const lang = resolveUiLanguage(getConfig().language);
    if (!runChatId || !this.store.chats[runChatId]) {
      this.view?.webview.postMessage({ type: "idle", chatId: runChatId });
      return;
    }
    if (this.isChatRunning(runChatId)) {
      void vscode.window.showWarningMessage(
        lang === "ru"
          ? "Дождитесь завершения текущего ответа."
          : "Wait for the current response to finish."
      );
      this.view?.webview.postMessage({ type: "idle", chatId: runChatId });
      return;
    }

    const runRef = this.beginChatRun(runChatId);
    let runUiMessages = this.isViewingChat(runChatId)
      ? this.uiMessages
      : [...(this.store.chats[runChatId]?.uiMessages || [])];
    const syncRunChat = (): void => {
      if (!this.isChatRunCurrent(runChatId, runRef)) {
        return;
      }
      touchChat(this.store, runChatId, {
        uiMessages: runUiMessages.slice(-200),
      });
      if (this.isViewingChat(runChatId)) {
        this.uiMessages = runUiMessages;
      }
      void this.writeStoreOnly();
    };
    const postToRunChat = (message: Record<string, unknown>): void => {
      if (
        this.isChatRunCurrent(runChatId, runRef) &&
        this.isViewingChat(runChatId)
      ) {
        this.view?.webview.postMessage(message);
      }
    };

    this.setRunStateForChat(runChatId, "running");
    this.setStatusForChat(
      runChatId,
      lang === "ru" ? "Коммичу и пушу…" : "Committing and pushing…",
      false,
      "running"
    );

    try {
      const result = await commitAndPushPaths(paths, {
        signal: runRef.controller.signal,
        onPhase: (detail) => {
          if (!this.isChatRunCurrent(runChatId, runRef)) {
            return;
          }
          this.setStatusForChat(runChatId, detail, false, "running");
        },
        onStep: (step) => {
          if (!this.isChatRunCurrent(runChatId, runRef)) {
            return;
          }
          const toolText = `⚙ run_command(${JSON.stringify({
            command: step.command,
          })})`;
          runUiMessages.push({ role: "tool", text: toolText });
          syncRunChat();
          postToRunChat({ type: "append", role: "tool", text: toolText });
          const output = [step.stdout, step.stderr].filter(Boolean).join("\n").trim();
          if (output) {
            const resultText = step.ok
              ? output
              : `Error: ${output}`;
            runUiMessages.push({ role: "tool", text: resultText });
            syncRunChat();
            postToRunChat({ type: "append", role: "tool", text: resultText });
          }
        },
      });

      if (!this.isChatRunCurrent(runChatId, runRef)) {
        return;
      }

      this.setStatusForChat(runChatId, "", true);
      runUiMessages.push({ role: "assistant", text: result.answer });
      syncRunChat();
      this.setRunStateForChat(runChatId, result.ok ? "success" : "error");
      postToRunChat({
        type: "assistantDone",
        text: result.answer,
      });
      if (this.isViewingChat(runChatId)) {
        this.postRegenerateState();
      }
      this.scheduleScmRefresh();
      if (this.isChatRunCurrent(runChatId, runRef)) {
        this.postRunFinished(runChatId, result.ok ? "success" : "error");
      }
    } catch (error) {
      if (!this.isChatRunCurrent(runChatId, runRef)) {
        return;
      }
      this.setStatusForChat(runChatId, "", true);
      if (runRef.controller.signal.aborted) {
        this.setRunStateForChat(runChatId);
        postToRunChat({ type: "idle", chatId: runChatId });
        return;
      }
      const text = error instanceof Error ? error.message : String(error);
      const answer =
        lang === "ru"
          ? `Не удалось закоммитить и запушить: ${text}`
          : `Failed to commit and push: ${text}`;
      runUiMessages.push({ role: "error", text: answer });
      syncRunChat();
      this.setRunStateForChat(runChatId, "error");
      postToRunChat({ type: "append", role: "error", text: answer });
      this.postRunFinished(runChatId, "error");
    } finally {
      if (this.isChatRunCurrent(runChatId, runRef)) {
        this.view?.webview.postMessage({ type: "idle", chatId: runChatId });
        this.finishChatRun(runChatId, runRef);
      }
    }
  }

  private async handleDiscardChanges(paths: string[]): Promise<void> {
    const runChatId = this.store.activeChatId;
    const lang = resolveUiLanguage(getConfig().language);
    if (!runChatId || !this.store.chats[runChatId]) {
      this.view?.webview.postMessage({ type: "idle", chatId: runChatId });
      return;
    }
    if (this.isChatRunning(runChatId)) {
      void vscode.window.showWarningMessage(
        lang === "ru"
          ? "Дождитесь завершения текущего ответа."
          : "Wait for the current response to finish."
      );
      this.view?.webview.postMessage({ type: "idle", chatId: runChatId });
      return;
    }

    const confirmLabel = lang === "ru" ? "Отменить изменения" : "Discard changes";
    const cancelLabel = lang === "ru" ? "Не сейчас" : "Keep changes";
    const confirm = await vscode.window.showWarningMessage(
      lang === "ru"
        ? "Отменить незакоммиченные изменения по файлам из этой правки? Действие необратимо."
        : "Discard uncommitted changes for the files from this edit? This cannot be undone.",
      { modal: true },
      confirmLabel,
      cancelLabel
    );
    if (confirm !== confirmLabel) {
      this.view?.webview.postMessage({ type: "idle", chatId: runChatId });
      return;
    }

    const runRef = this.beginChatRun(runChatId);
    let runUiMessages = this.isViewingChat(runChatId)
      ? this.uiMessages
      : [...(this.store.chats[runChatId]?.uiMessages || [])];
    const syncRunChat = (): void => {
      if (!this.isChatRunCurrent(runChatId, runRef)) {
        return;
      }
      touchChat(this.store, runChatId, {
        uiMessages: runUiMessages.slice(-200),
      });
      if (this.isViewingChat(runChatId)) {
        this.uiMessages = runUiMessages;
      }
      void this.writeStoreOnly();
    };
    const postToRunChat = (message: Record<string, unknown>): void => {
      if (
        this.isChatRunCurrent(runChatId, runRef) &&
        this.isViewingChat(runChatId)
      ) {
        this.view?.webview.postMessage(message);
      }
    };

    this.setRunStateForChat(runChatId, "running");
    this.setStatusForChat(
      runChatId,
      lang === "ru" ? "Отменяю изменения…" : "Discarding changes…",
      false,
      "running"
    );

    try {
      const remaining = await resolveRemainingReviewFiles(paths);
      const chat = this.store.chats[runChatId];
      const fallbackPaths = Array.isArray(chat?.lastAgentEditedPaths)
        ? chat.lastAgentEditedPaths
        : [];
      // Prefer live dirty review paths; always keep the UI paths + last edits as seeds.
      const targets = [
        ...new Set([
          ...(remaining.length ? remaining.map((f) => f.path) : []),
          ...paths.map(String).filter(Boolean),
        ]),
      ];
      const result = await discardPaths(targets, {
        fallbackPaths,
        signal: runRef.controller.signal,
        onPhase: (detail) => {
          if (!this.isChatRunCurrent(runChatId, runRef)) {
            return;
          }
          this.setStatusForChat(runChatId, detail, false, "running");
        },
        onStep: (step) => {
          if (!this.isChatRunCurrent(runChatId, runRef)) {
            return;
          }
          const toolText = `⚙ run_command(${JSON.stringify({
            command: step.command,
          })})`;
          runUiMessages.push({ role: "tool", text: toolText });
          syncRunChat();
          postToRunChat({ type: "append", role: "tool", text: toolText });
          const output = [step.stdout, step.stderr]
            .filter(Boolean)
            .join("\n")
            .trim();
          if (output) {
            const resultText = step.ok ? output : `Error: ${output}`;
            runUiMessages.push({ role: "tool", text: resultText });
            syncRunChat();
            postToRunChat({ type: "append", role: "tool", text: resultText });
          }
        },
      });

      if (!this.isChatRunCurrent(runChatId, runRef)) {
        return;
      }

      if (result.ok) {
        touchChat(this.store, runChatId, {
          lastAgentEditedPaths: [],
        });
        void this.writeStoreOnly();
      }

      this.setStatusForChat(runChatId, "", true);
      runUiMessages.push({ role: "assistant", text: result.answer });
      syncRunChat();
      this.setRunStateForChat(runChatId, result.ok ? "success" : "error");
      postToRunChat({
        type: "assistantDone",
        text: result.answer,
      });
      if (this.isViewingChat(runChatId)) {
        this.postRegenerateState();
      }
      this.scheduleScmRefresh();
      if (this.isChatRunCurrent(runChatId, runRef)) {
        this.postRunFinished(runChatId, result.ok ? "success" : "error");
      }
    } catch (error) {
      if (!this.isChatRunCurrent(runChatId, runRef)) {
        return;
      }
      this.setStatusForChat(runChatId, "", true);
      if (runRef.controller.signal.aborted) {
        this.setRunStateForChat(runChatId);
        postToRunChat({ type: "idle", chatId: runChatId });
        return;
      }
      const text = error instanceof Error ? error.message : String(error);
      const answer =
        lang === "ru"
          ? `Не удалось отменить изменения: ${text}`
          : `Failed to discard changes: ${text}`;
      runUiMessages.push({ role: "error", text: answer });
      syncRunChat();
      this.setRunStateForChat(runChatId, "error");
      postToRunChat({ type: "append", role: "error", text: answer });
      this.postRunFinished(runChatId, "error");
    } finally {
      if (this.isChatRunCurrent(runChatId, runRef)) {
        this.view?.webview.postMessage({ type: "idle", chatId: runChatId });
        this.finishChatRun(runChatId, runRef);
      }
    }
  }

  private async publishReview(
    edits: FileEditStat[],
    chatId = this.store.activeChatId,
    targetUiMessages = this.uiMessages,
    isStillValid: () => boolean = () => true
  ): Promise<void> {
    // Keep every path the turn reported — including shell-side dirty files
    // whose numstat may be 0 (mode-only / binary). Empty path only is dropped.
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const unique = mergeEdits(edits)
      .map((e) => ({
        ...e,
        path: folder ? toRepoRelativePath(e.path, folder) || e.path : e.path,
      }))
      .filter((e) => Boolean(e.path));
    if (!unique.length) {
      this.setStatusForChat(chatId, "", true);
      return;
    }

    if (!isStillValid()) {
      return;
    }
    const showScm = await hasUncommittedChanges(unique.map((f) => f.path));
    // После await run мог завершиться нормально — публикуем, если чат жив и не abort.
    if (!isStillValid() || !this.store.chats[chatId]) {
      return;
    }
    const payload = JSON.stringify({ files: unique, showScm });
    targetUiMessages.push({ role: "review", text: payload });
    touchChat(this.store, chatId, {
      uiMessages: targetUiMessages.slice(-200),
    });
    if (this.isViewingChat(chatId)) {
      this.uiMessages = targetUiMessages;
    }
    void this.writeStoreOnly();
    if (this.isViewingChat(chatId)) {
      this.view?.webview.postMessage({
        type: "review",
        files: unique,
        showScm,
      });
    }
    this.setStatusForChat(chatId, "", true);
  }

  private scheduleScmRefresh(): void {
    if (this.scmRefreshTimer) {
      clearTimeout(this.scmRefreshTimer);
    }
    this.scmRefreshTimer = setTimeout(() => {
      void this.refreshReviewScmButtons();
    }, 350);
  }

  private bindGitStatusRefresh(): void {
    if (this.gitApiBound) {
      return;
    }
    this.gitApiBound = true;

    const bind = async () => {
      try {
        const ext = vscode.extensions.getExtension("vscode.git");
        if (!ext) {
          return;
        }
        const exports = ext.isActive ? ext.exports : await ext.activate();
        const api = exports?.getAPI?.(1) as
          | {
              repositories: Array<{
                state: {
                  onDidChange: (listener: () => void) => vscode.Disposable;
                };
              }>;
              onDidOpenRepository: (
                listener: (repo: {
                  state: {
                    onDidChange: (listener: () => void) => vscode.Disposable;
                  };
                }) => void
              ) => vscode.Disposable;
            }
          | undefined;
        if (!api) {
          return;
        }
        const watchRepo = (repo: {
          state: { onDidChange: (listener: () => void) => vscode.Disposable };
        }) => {
          this.disposables.push(
            repo.state.onDidChange(() => this.scheduleScmRefresh())
          );
        };
        for (const repo of api.repositories) {
          watchRepo(repo);
        }
        this.disposables.push(api.onDidOpenRepository(watchRepo));
      } catch {
        // ignore
      }
    };
    void bind();
  }

  private async refreshReviewScmButtons(): Promise<void> {
    if (!this.view || this.store.screen !== "chat") {
      return;
    }

    const reviews: {
      paths: string[];
      showScm: boolean;
      files: FileEditStat[];
    }[] = [];
    let changed = false;

    for (let i = 0; i < this.uiMessages.length; i++) {
      const msg = this.uiMessages[i];
      if (msg.role !== "review") {
        continue;
      }
      const parsed = parseReviewPayload(msg.text);
      if (!parsed.files.length) {
        continue;
      }
      const seedPaths = parsed.files.map((f) => f.path);
      const remaining = await resolveRemainingReviewFiles(seedPaths);
      const showScm = remaining.length > 0;
      // Пока есть dirty-компаньоны — в карточке/тегах показываем оставшиеся
      // пути; иначе оставляем исходный список (уже закоммиченный) без SCM.
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
        this.uiMessages[i] = {
          ...msg,
          text: JSON.stringify({ files, showScm }),
        };
      }
    }

    if (changed) {
      const chatId = this.store.activeChatId;
      if (chatId && this.store.chats[chatId]) {
        touchChat(this.store, chatId, {
          uiMessages: this.uiMessages.slice(-200),
        });
      }
      void this.writeStoreOnly();
    }

    if (reviews.length > 0) {
      this.view.webview.postMessage({ type: "scmButtons", reviews });
    }
  }

  private serializeModesForUi(): Array<{
    id: string;
    label: string;
    description: string;
    tools: AgentModeDef["tools"];
    prompt: string;
    enabled: boolean;
    builtin: boolean;
    overridden: boolean;
    placeholder: string;
  }> {
    const storedIds = new Set(getConfig().modes.map((m) => m.id));
    return getResolvedModes().map((m) => ({
      id: m.id,
      label: m.label,
      description: m.description || "",
      tools: m.tools,
      prompt: m.prompt || "",
      enabled: m.enabled !== false,
      builtin: Boolean(m.builtin),
      overridden: storedIds.has(m.id),
      placeholder: m.placeholder || "",
    }));
  }

  private postModels(): void {
    const config = getConfig();
    const models = getEnabledModels();
    if (!this.selectedModel || !models.some((m) => m.id === this.selectedModel)) {
      this.selectedModel =
        models.find((m) => m.id === config.defaultModel)?.id ??
        models[0]?.id ??
        "";
      if (this.store.activeChatId && this.store.chats[this.store.activeChatId]) {
        touchChat(this.store, this.store.activeChatId, {
          selectedModel: this.selectedModel,
        });
        this.writeStoreOnly();
      }
    }
    this.view?.webview.postMessage({
      type: "modelsUpdated",
      models,
      selectedModel: this.selectedModel,
    });
  }

  private postSettings(): void {
    const config = getConfig();
    const payload = {
      type: "settings" as const,
      settings: {
        providers: config.providers.map((p) => ({
          id: p.id,
          name: p.name || "",
          baseUrl: p.baseUrl,
          apiKey: p.apiKey || "",
          statusUrl: p.statusUrl || "",
        })),
        models: config.models.map((m) => ({
          id: m.id,
          label: m.label || "",
          providerId: m.providerId || "",
          contextWindow: m.contextWindow || undefined,
          maxOutputTokens: m.maxOutputTokens || undefined,
          enabled: m.enabled !== false,
          favorite: m.favorite === true,
          supportsVision: resolveModelSupportsVision(m),
          ...(m.reasoningEffort
            ? { reasoningEffort: m.reasoningEffort }
            : {}),
        })),
        defaultModel: config.defaultModel,
        language: config.language,
        defaultContextWindow: config.defaultContextWindow,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        rejectUnauthorized: config.rejectUnauthorized,
        caBundlePath: config.caBundlePath,
        systemPrompt: config.systemPrompt,
        maxToolRounds: config.maxToolRounds,
        maxTokens: config.maxTokens,
        maxResponseChars: config.maxResponseChars,
        soundNotificationsEnabled: config.soundNotifications.enabled,
        subagentsEnabled: config.subagents.enabled,
        parallelToolCallsEnabled: config.parallelToolCalls.enabled,
        autoCompactEnabled: config.autoCompact.enabled,
        selectionHintsEnabled: config.selectionHints.enabled,
        modes: this.serializeModesForUi(),
        commitMessagePrompt: config.commitMessage.prompt,
        commitMessageLanguage: config.commitMessage.language,
        commitMessageScope: config.commitMessage.scope,
        workspaceName:
          vscode.workspace.workspaceFolders?.[0]?.name ||
          vscode.workspace.name ||
          "",
        figmaEnabled: config.figma.enabled,
        figma: this.getFigmaStatusPayload(),
        autoglmEnabled: config.autoglm.enabled,
        autoglmBinaryPath: config.autoglm.binaryPath,
        autoglmBrowser: config.autoglm.browser,
        autoglmAutoApprove: config.autoglm.autoApprove,
        providerConnStatuses: this.getProviderConnStatusesPayload(),
      },
    };
    this.settingsPanel?.webview.postMessage(payload);
    this.ensureAllProvidersProbed();
    this.syncProviderConnPolling();
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
    this.settingsPanel?.webview.postMessage({
      type: "figmaStatus",
      status: payload,
    });
    this.postMcpServersList();
  }

  private postMcpServersList(servers?: McpServerRuntimeStatus[]): void {
    const mcp = getMcpManager();
    const list = servers || mcp?.listServerStatuses() || [];
    this.settingsPanel?.webview.postMessage({
      type: "mcpServers",
      servers: list,
    });
  }

  private async handleMcpUpsert(raw: {
    id?: string;
    name: string;
    transport: "stdio" | "http";
    command?: string;
    argsText?: string;
    envText?: string;
    cwd?: string;
    url?: string;
    bearerToken?: string;
    enabled?: boolean;
    connect?: boolean;
  }): Promise<void> {
    const mcp = getMcpManager();
    if (!mcp) {
      return;
    }
    try {
      const status = await mcp.upsertCustomServer({
        id: raw.id,
        name: raw.name,
        transport: raw.transport,
        command: raw.command,
        args: parseArgsInput(raw.argsText || ""),
        env: parseEnvLines(raw.envText || ""),
        cwd: raw.cwd,
        url: raw.url,
        bearerToken: raw.bearerToken,
        enabled: raw.enabled,
        connect: raw.connect !== false,
      });
      this.postMcpServersList();
      if (status.state === "connected") {
        void vscode.window.showInformationMessage(
          `MCP «${status.name}» connected (${status.toolCount} tools).`
        );
      } else if (status.state === "error") {
        void vscode.window.showWarningMessage(
          status.message || `Could not connect «${status.name}».`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
    }
  }

  private async handleMcpDelete(id: string): Promise<void> {
    const mcp = getMcpManager();
    if (!mcp) {
      return;
    }
    await mcp.deleteCustomServer(id);
    this.postMcpServersList();
    this.postFigmaStatus();
  }

  private async handleMcpSetEnabled(
    id: string,
    enabled: boolean
  ): Promise<void> {
    const mcp = getMcpManager();
    if (!mcp) {
      return;
    }
    await mcp.setCustomEnabled(id, enabled);
    this.postMcpServersList();
    this.postFigmaStatus();
  }

  private async handleMcpConnect(id: string): Promise<void> {
    const mcp = getMcpManager();
    if (!mcp) {
      return;
    }
    if (id === "figma") {
      await this.handleFigmaConnect();
      return;
    }
    const status = await mcp.connectCustom(id);
    this.postMcpServersList();
    if (status.state === "error") {
      void vscode.window.showWarningMessage(
        status.message || `Could not connect «${status.name}».`
      );
    }
  }

  private async refreshFigmaStatus(): Promise<void> {
    const mcp = getMcpManager();
    if (mcp) {
      await mcp.refreshSecretFlags();
      await mcp.tryQuietReconnect();
    }
    this.postFigmaStatus();
  }

  private async handleFigmaConnect(): Promise<void> {
    const mcp = getMcpManager();
    if (!mcp) {
      return;
    }
    this.postFigmaStatus({
      ...mcp.getStatus(),
      state: "connecting",
      message: "Opening Figma authorization…",
    });
    const status = await mcp.connectRemoteInteractive();
    this.postFigmaStatus(status);
    if (status.state === "connected") {
      void vscode.window.showInformationMessage(
        "Figma connected. You can paste figma.com links in chat."
      );
    } else if (status.state === "error") {
      void vscode.window.showWarningMessage(
        status.message ||
          "Remote Figma MCP failed. Use a Personal Access Token in Settings → MCP Servers."
      );
    }
  }

  private async handleFigmaDisconnect(): Promise<void> {
    const mcp = getMcpManager();
    if (!mcp) {
      return;
    }
    const status = await mcp.disconnect();
    this.postFigmaStatus(status);
  }

  private async handleFigmaConnectPat(token: string): Promise<void> {
    const mcp = getMcpManager();
    if (!mcp) {
      return;
    }
    const status = await mcp.connectWithPat(token);
    this.postFigmaStatus(status);
    if (status.state === "connected") {
      void vscode.window.showInformationMessage(
        "Figma connected via Personal Access Token."
      );
    } else if (status.state === "error") {
      void vscode.window.showWarningMessage(
        status.message || "Could not connect with this token."
      );
    }
  }

  private async saveSettings(raw: SettingsPayload): Promise<void> {
    const providers = (Array.isArray(raw.providers) ? raw.providers : [])
      .map((p) => {
        const id = String(p?.id || "").trim();
        const baseUrl = String(p?.baseUrl || "").trim().replace(/\/$/, "");
        if (!id || !baseUrl) {
          return null;
        }
        const name = String(p?.name || "").trim();
        const apiKey = String(p?.apiKey || "");
        const statusUrl = String(p?.statusUrl || "")
          .trim()
          .replace(/\/$/, "");
        const row: {
          id: string;
          name?: string;
          baseUrl: string;
          apiKey?: string;
          statusUrl?: string;
        } = { id, baseUrl };
        if (name) {
          row.name = name;
        }
        if (apiKey) {
          row.apiKey = apiKey;
        }
        if (statusUrl && statusUrl !== baseUrl) {
          row.statusUrl = statusUrl;
        }
        return row;
      })
      .filter(
        (
          p
        ): p is {
          id: string;
          name?: string;
          baseUrl: string;
          apiKey?: string;
          statusUrl?: string;
        } => Boolean(p)
      );

    if (!providers.length) {
      void vscode.window.showWarningMessage(
        "At least one provider with an id and base URL is required."
      );
      return;
    }

    const providerIds = new Set(providers.map((p) => p.id));
    const primaryId =
      providers.find((p) => p.id === "default")?.id || providers[0].id;

    const models = (Array.isArray(raw.models) ? raw.models : [])
      .map((m) => {
        const id = String(m?.id || "").trim();
        if (!id) {
          return null;
        }
        const label = String(m?.label || "").trim();
        let providerId = String(m?.providerId || "").trim();
        if (!providerId || !providerIds.has(providerId)) {
          providerId = primaryId;
        }
        const contextWindow =
          typeof m?.contextWindow === "number" &&
          Number.isFinite(m.contextWindow) &&
          m.contextWindow >= 1024
            ? Math.floor(m.contextWindow)
            : undefined;
        const maxOutputTokens =
          typeof m?.maxOutputTokens === "number" &&
          Number.isFinite(m.maxOutputTokens) &&
          m.maxOutputTokens > 0
            ? Math.floor(m.maxOutputTokens)
            : undefined;
        const row: {
          id: string;
          label?: string;
          providerId?: string;
          contextWindow?: number;
          maxOutputTokens?: number;
          enabled?: boolean;
          favorite?: boolean;
          supportsVision?: boolean;
          reasoningEffort?: string;
        } = {
          id,
          providerId,
        };
        if (label) {
          row.label = label;
        }
        if (contextWindow) {
          row.contextWindow = contextWindow;
        }
        if (maxOutputTokens) {
          row.maxOutputTokens = maxOutputTokens;
        }
        if (m?.enabled === false) {
          row.enabled = false;
        }
        if (m?.favorite === true) {
          row.favorite = true;
        }
        if (m?.supportsVision === true) {
          row.supportsVision = true;
        } else if (m?.supportsVision === false) {
          row.supportsVision = false;
        }
        const reasoningEffort = normalizeReasoningEffort(m?.reasoningEffort);
        if (reasoningEffort) {
          row.reasoningEffort = reasoningEffort;
        }
        return row;
      })
      .filter(
        (
          m
        ): m is {
          id: string;
          label?: string;
          providerId?: string;
          contextWindow?: number;
          maxOutputTokens?: number;
          enabled?: boolean;
          favorite?: boolean;
          supportsVision?: boolean;
          reasoningEffort?: string;
        } => Boolean(m)
      );

    if (!models.length) {
      void vscode.window.showWarningMessage(
        "At least one model with a non-empty id is required."
      );
      return;
    }

    const enabledModels = models.filter((m) => m.enabled !== false);
    const resolvedDefault = enabledModels[0]?.id || models[0].id;

    const clamp = (value: unknown, min: number, max: number, fallback: number) => {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) {
        return fallback;
      }
      return Math.min(max, Math.max(min, Math.floor(n)));
    };

    const primary =
      providers.find((p) => p.id === primaryId) || providers[0];

    const cfg = vscode.workspace.getConfiguration("agentPanel");
    const target = vscode.ConfigurationTarget.Global;
    const prevLanguage =
      cfg.get<"auto" | "en" | "ru">("language") === "ru"
        ? "ru"
        : cfg.get<"auto" | "en" | "ru">("language") === "en"
          ? "en"
          : "auto";
    const nextLanguage =
      raw.language === "ru" ? "ru" : raw.language === "en" ? "en" : "auto";
    const languageChanged = prevLanguage !== nextLanguage;

    await cfg.update("providers", providers, target);
    await cfg.update("models", models, target);
    await cfg.update("defaultModel", resolvedDefault, target);
    await cfg.update("language", nextLanguage, target);
    await cfg.update(
      "defaultContextWindow",
      clamp(raw.defaultContextWindow, 1024, 2_000_000, 128_000),
      target
    );
    // Legacy mirrors — чтобы старые настройки/скрипты не ломались
    await cfg.update("baseUrl", primary.baseUrl, target);
    await cfg.update("apiKey", primary.apiKey || "", target);
    await cfg.update(
      "rejectUnauthorized",
      Boolean(raw.rejectUnauthorized),
      target
    );
    await cfg.update("caBundlePath", String(raw.caBundlePath || "").trim(), target);
    const systemPromptRaw = String(raw.systemPrompt || "").trim();
    await cfg.update(
      "systemPrompt",
      isBuiltinSystemPrompt(systemPromptRaw) ? "" : systemPromptRaw,
      target
    );
    await cfg.update(
      "maxToolRounds",
      clamp(raw.maxToolRounds, 1, 60, 20),
      target
    );
    await cfg.update("maxTokens", clamp(raw.maxTokens, 64, 128_000, 4096), target);
    await cfg.update(
      "maxResponseChars",
      clamp(raw.maxResponseChars, 1000, 200_000, 64_000),
      target
    );
    await cfg.update(
      "soundNotifications.enabled",
      raw.soundNotificationsEnabled !== false,
      target
    );
    await cfg.update(
      "subagents.enabled",
      raw.subagentsEnabled !== false,
      target
    );
    await cfg.update(
      "parallelToolCalls.enabled",
      raw.parallelToolCallsEnabled !== false,
      target
    );
    await cfg.update(
      "autoCompact.enabled",
      raw.autoCompactEnabled !== false,
      target
    );
    await cfg.update(
      "selectionHints.enabled",
      raw.selectionHintsEnabled !== false,
      target
    );

    await this.saveCommitMessageSettings(raw);

    const figmaEnabled = raw.figmaEnabled === true;
    await cfg.update("figma.enabled", figmaEnabled, target);
    const mcp = getMcpManager();
    if (mcp) {
      await mcp.setEnabled(figmaEnabled);
    }

    const autoglmEnabled = raw.autoglmEnabled === true;
    const autoglmBrowser =
      String(raw.autoglmBrowser || "").trim().toLowerCase() === "edge"
        ? "edge"
        : "chrome";
    const autoglmAutoApprove = raw.autoglmAutoApprove === true;
    const autoglmBinaryPath = String(raw.autoglmBinaryPath || "").trim();
    await cfg.update("autoglm.enabled", autoglmEnabled, target);
    await cfg.update("autoglm.binaryPath", autoglmBinaryPath, target);
    await cfg.update("autoglm.browser", autoglmBrowser, target);
    await cfg.update("autoglm.autoApprove", autoglmAutoApprove, target);
    if (autoglmEnabled) {
      try {
        const { mergeOpenclawAutoglmConfig } = await import("./autoglmBrowser");
        await mergeOpenclawAutoglmConfig({
          browser: autoglmBrowser,
          auto_approve: autoglmAutoApprove,
          extension_confirmed: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showWarningMessage(
          `Could not write AutoGLM config (~/.openclaw-autoclaw/config.json): ${message}`
        );
      }
    }

    await this.writeModes(raw.modes);

    if (
      !enabledModels.some((m) => m.id === this.selectedModel)
    ) {
      this.selectedModel = resolvedDefault;
      this.saveSession();
    }

    this.postModels();
    this.postModes();
    this.postSettings();
    this.providerConnStatuses.clear();
    this.ensureProviderProbe(this.selectedModel, true);

    if (languageChanged) {
      await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
  }

  private async saveCommitMessageSettings(
    raw: SettingsPayload
  ): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("agentPanel");
    const scope =
      raw.commitMessageScope === "workspace" ? "workspace" : "global";
    const target =
      scope === "workspace"
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    const promptRaw = String(raw.commitMessagePrompt || "").trim();
    const prompt = isBuiltinCommitMessagePrompt(promptRaw) ? "" : promptRaw;
    const language =
      raw.commitMessageLanguage === "ru"
        ? "ru"
        : raw.commitMessageLanguage === "en"
          ? "en"
          : "auto";

    if (scope === "global") {
      // Сбросить workspace-override, чтобы снова действовали глобальные значения.
      await cfg.update(
        "commitMessage.prompt",
        undefined,
        vscode.ConfigurationTarget.Workspace
      );
      await cfg.update(
        "commitMessage.language",
        undefined,
        vscode.ConfigurationTarget.Workspace
      );
    }

    await cfg.update("commitMessage.prompt", prompt, target);
    await cfg.update("commitMessage.language", language, target);
  }

  private async saveModes(raw: SettingsPayload["modes"]): Promise<void> {
    await this.writeModes(raw);
    this.postModes();
  }

  private async writeModes(raw: SettingsPayload["modes"]): Promise<void> {
    const target = vscode.ConfigurationTarget.Global;
    const cfg = vscode.workspace.getConfiguration("agentPanel");
    const modes = parseCustomModes(raw)
      .map((m) => {
        const id = String(m.id || "").trim();
        const label = String(m.label || "").trim();
        if (!id || !label) {
          return null;
        }
        const row: AgentModeDef = {
          id,
          label,
          tools: m.tools === "readonly" ? "readonly" : "agent",
        };
        if (m.description) {
          row.description = m.description;
        }
        if (m.prompt) {
          row.prompt = m.prompt;
        }
        if (m.placeholder) {
          row.placeholder = m.placeholder;
        }
        if (m.enabled === false) {
          row.enabled = false;
        }
        return row;
      })
      .filter((m): m is AgentModeDef => Boolean(m));
    await cfg.update("modes", modes, target);
  }

  private postModes(): void {
    const payload = {
      type: "modesUpdated" as const,
      modes: this.serializeModesForUi(),
    };
    this.view?.webview.postMessage(payload);
    this.settingsPanel?.webview.postMessage(payload);
  }

  private async postInit(): Promise<void> {
    const config = getConfig();
    const models = getEnabledModels();
    if (!this.selectedModel || !models.some((m) => m.id === this.selectedModel)) {
      this.selectedModel =
        models.find((m) => m.id === config.defaultModel)?.id ??
        models[0]?.id ??
        "";
    }

    // Settings / legacy agents screen — sidebar always opens on chat.
    if (this.store.screen === "settings" || this.store.screen === "agents") {
      this.setScreen("chat");
      this.saveStore();
    }

    const activeAgent = this.store.agents.find(
      (a) => a.id === this.store.activeAgentId
    );
    const agentName = activeAgent
      ? getAgentDisplayName(activeAgent, getActiveChat(this.store))
      : "Agent";
    this.view?.webview.postMessage({
      type: "init",
      models,
      selectedModel: this.selectedModel,
      selectedMode: this.selectedMode,
      selectedReasoningEffort:
        this.resolveReasoningEffortForModel(this.selectedModel) || "",
      uiMessages: await this.enrichUiMessages(this.uiMessages),
      busy: this.isChatRunning(this.store.activeChatId),
      canRegenerate: this.canRegenerate(),
      screen: this.store.screen,
      agentId: this.store.activeAgentId || "",
      agentName,
      chatTitle: agentName,
      contextUsed: this.contextTokens,
      contextMax: getContextWindow(this.selectedModel),
      chatId: this.store.activeChatId || "",
      scrollTop: getActiveChat(this.store)?.scrollTop,
      status: this.chatStatusState.get(this.store.activeChatId || "") || null,
      modes: this.serializeModesForUi(),
    });

    this.postAgentsList();
    if (this.store.screen === "archive") {
      this.postArchiveList();
      this.view?.webview.postMessage({ type: "showArchive" });
    } else {
      await this.postChatScreen();
    }
    // После reload webview (focus панели) — доставить отложенную вставку.
    if (
      this.pendingComposerInsert ||
      this.pendingComposerSelection ||
      this.pendingComposerMentions.length
    ) {
      setTimeout(() => this.flushPendingComposerInsert(), 80);
    }
  }

  private getHtml(
    webview: vscode.Webview,
    surface: "panel" | "settings" = "panel"
  ): string {
    const lang = resolveUiLanguage(getConfig().language);
    const version =
      vscode.extensions.getExtension("local.vscode-agent-panel")?.packageJSON
        ?.version ?? "0";
    const bust = `${version}-${Date.now()}`;
    const cssUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "panel.css"))
      .with({ query: `v=${bust}` });
    const jsUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "panel.js"))
      .with({ query: `v=${bust}` });
    const markedUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "marked.js"))
      .with({ query: `v=${bust}` });
    const materialIconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "media",
        "fonts",
        "MaterialSymbolsOutlined-24-400.ttf"
      )
    );
    const jetbrainsMonoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "media",
        "fonts",
        "JetBrainsMono-Regular.ttf"
      )
    );
    const nonce = getNonce();
    const pageTitle =
      surface === "settings"
        ? lang === "ru"
          ? "Настройки — Harbor Agents"
          : "Settings — Harbor Agents"
        : "Harbor Agents";

    return `<!DOCTYPE html>
<html lang="${lang}" data-surface="${surface}">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data: blob:; script-src 'nonce-${nonce}';"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${cssUri}" />
  <style nonce="${nonce}">
    @font-face {
      font-family: "Material Symbols Outlined";
      font-style: normal;
      font-weight: 400;
      font-display: block;
      src: url("${materialIconsUri}") format("truetype");
    }
    @font-face {
      font-family: "JetBrains Mono";
      font-style: normal;
      font-weight: 400;
      font-display: swap;
      src: url("${jetbrainsMonoUri}") format("truetype");
    }
  </style>
  <title>${pageTitle}</title>
</head>
<body>
  <div id="workspaceShell" class="workspace-shell">
  <div id="agentsRailBackdrop" class="agents-rail-backdrop" hidden></div>
  <section id="agentsScreen" class="screen agents-rail" hidden>
    <div class="agents-top">
      <div class="agents-title">Agents</div>
      <button type="button" class="icon-btn" id="openArchiveBtn" title="Archive" aria-label="Archive">
        <span class="material-symbols-outlined" aria-hidden="true">inventory_2</span>
      </button>
      <button type="button" class="icon-btn" id="newAgentBtn" title="New Agent" aria-label="New Agent">
        <span class="material-symbols-outlined" aria-hidden="true">add</span>
      </button>
    </div>
    <div id="agentsList" class="agents-list"></div>
  </section>

  <section id="chatScreen" class="screen chat-screen" hidden>
    <div class="chat-top">
      <button type="button" class="icon-btn" id="toggleAgentsRailBtn" title="Agents" aria-label="Agents" aria-pressed="false">
        <span class="material-symbols-outlined" aria-hidden="true">menu</span>
      </button>
      <div class="chat-top-text">
        <div id="chatAgentName" class="chat-agent-name">Agent</div>
        <div id="chatTitle" class="chat-title" hidden></div>
        <div id="providerConnStatus" class="provider-conn-status" data-state="unknown" hidden>Status: Unknown</div>
      </div>
    </div>
    <div id="chatBranches" class="chat-branches" hidden role="tablist" aria-label="Conversation branches"></div>
    <div id="chatSearchPanel" class="chat-search-panel" hidden>
      <div class="chat-search-bar">
        <input
          id="chatSearchInput"
          class="chat-search-input"
          type="search"
          placeholder="Search"
          autocomplete="off"
          spellcheck="false"
          aria-label="Search chat"
        />
        <button type="button" class="icon-btn" id="closeChatSearchBtn" title="Close search" aria-label="Close search">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
    </div>
    <div id="chatSearchResults" class="chat-search-results" role="listbox" aria-label="Search results" hidden></div>
    <div id="messages"></div>
    <div class="composer-wrap" id="composerWrap">
      <div id="composerPlanActions" class="composer-plan-actions" hidden></div>
      <div id="composerScmActions" class="composer-scm-actions" hidden></div>
      <div id="mentionMenu" class="mention-menu" role="listbox" hidden></div>
      <div class="composer" id="composer" data-mode="agent">
        <div id="selectionPreview" class="selection-preview" hidden></div>
        <div id="attachPreview" class="attach-preview" hidden></div>
        <textarea id="prompt" placeholder="Task for the agent... (@ for file)" rows="3"></textarea>
        <div class="composer-footer">
          <div class="composer-footer-left">
            <div class="composer-plus" id="composerPlus">
              <button type="button" class="icon-btn" id="composerPlusBtn" title="Add" aria-label="Add" aria-haspopup="menu" aria-expanded="false">
                <span class="material-symbols-outlined" aria-hidden="true">add</span>
              </button>
              <div class="composer-plus-menu" id="composerPlusMenu" role="menu" hidden>
                <button type="button" class="composer-plus-item" data-action="image" role="menuitem">
                  <span class="material-symbols-outlined" aria-hidden="true">image</span>
                  <span>Image</span>
                </button>
              </div>
            </div>
            <div class="model-picker mode-picker" id="modePicker" data-mode="agent">
              <button type="button" class="model-trigger" id="modeTrigger" aria-haspopup="listbox" aria-expanded="false" title="Mode">
                <span class="model-label" id="modeLabel">Agent</span>
                <span class="material-symbols-outlined model-chevron" aria-hidden="true">expand_more</span>
              </button>
              <div class="model-menu" id="modeMenu" role="listbox" hidden></div>
            </div>
            <div class="model-picker" id="modelPicker">
              <button type="button" class="model-trigger" id="modelTrigger" aria-haspopup="listbox" aria-expanded="false" title="Model">
                <span class="model-label" id="modelLabel">Model</span>
                <span class="material-symbols-outlined model-chevron" aria-hidden="true">expand_more</span>
              </button>
              <div class="model-menu" id="modelMenu" role="listbox" hidden></div>
            </div>
            <div class="model-picker reason-picker" id="reasonPicker" hidden>
              <button type="button" class="model-trigger" id="reasonTrigger" aria-haspopup="listbox" aria-expanded="false" title="Intelligence">
                <span class="material-symbols-outlined reason-icon" aria-hidden="true">psychology</span>
                <span class="model-label" id="reasonLabel">Medium</span>
                <span class="material-symbols-outlined model-chevron" aria-hidden="true">expand_more</span>
              </button>
              <div class="model-menu" id="reasonMenu" role="listbox" hidden></div>
            </div>
          </div>
          <div class="composer-footer-right">
            <button class="primary" id="sendBtn" title="Send" aria-label="Send" data-mode="send">
              <span class="material-symbols-outlined icon-send" aria-hidden="true">arrow_upward</span>
              <span class="material-symbols-outlined icon-stop" aria-hidden="true">stop</span>
            </button>
          </div>
        </div>
        <div id="composerDropHint" class="composer-drop-hint" hidden>
          <span class="composer-drop-hint-text">Drop file to attach</span>
        </div>
      </div>
      <div class="composer-meta">
        <button type="button" class="context-meter" id="contextRing" aria-label="Context usage">
          <svg class="context-ring" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <circle class="context-ring-track" cx="12" cy="12" r="9" fill="none" stroke="#8a8a8a" stroke-width="3.5"/>
            <circle class="context-ring-value" cx="12" cy="12" r="9" fill="none" stroke="#3794ff" stroke-width="3.5"
              stroke-linecap="round" pathLength="100" stroke-dasharray="0 100" transform="rotate(-90 12 12)"/>
          </svg>
          <span class="context-tip" id="contextTip" role="tooltip">0 / 128k</span>
        </button>
      </div>
    </div>
  </section>
  </div>

  <section id="archiveScreen" class="screen" hidden>
    <div class="agents-top">
      <button type="button" class="icon-btn" id="backFromArchiveBtn" title="К списку агентов" aria-label="К списку агентов">
        <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
      </button>
      <div class="agents-title">Архив</div>
      <button type="button" class="text-btn archive-delete-all" id="deleteAllArchiveBtn" hidden>
        Удалить все
      </button>
    </div>
    <div id="archiveList" class="agents-list"></div>
  </section>

  <section id="settingsScreen" class="screen" hidden>
    <div id="settingsSaveStatus" class="settings-save-status" hidden>Saved</div>
    <div class="settings-layout">
      <nav class="settings-nav" id="settingsNav" aria-label="Settings categories">
        <button type="button" class="settings-nav-item is-active" data-settings-cat="models">
          <span class="material-symbols-outlined" aria-hidden="true">dns</span>
          <span class="settings-nav-label" data-i18n-nav="modelsProviders">Models &amp; providers</span>
        </button>
        <button type="button" class="settings-nav-item" data-settings-cat="modes">
          <span class="material-symbols-outlined" aria-hidden="true">tune</span>
          <span class="settings-nav-label" data-i18n-nav="modes">Modes</span>
        </button>
        <button type="button" class="settings-nav-item" data-settings-cat="language">
          <span class="material-symbols-outlined" aria-hidden="true">language</span>
          <span class="settings-nav-label" data-i18n-nav="languageSection">Language</span>
        </button>
        <button type="button" class="settings-nav-item" data-settings-cat="commit">
          <span class="material-symbols-outlined" aria-hidden="true">commit</span>
          <span class="settings-nav-label" data-i18n-nav="commitMessages">Commit messages</span>
        </button>
        <button type="button" class="settings-nav-item" data-settings-cat="mcp">
          <span class="material-symbols-outlined" aria-hidden="true">electrical_services</span>
          <span class="settings-nav-label" data-i18n-nav="mcpServers">MCP Servers</span>
        </button>
        <button type="button" class="settings-nav-item" data-settings-cat="browser">
          <span class="material-symbols-outlined" aria-hidden="true">web</span>
          <span class="settings-nav-label" data-i18n-nav="browserAgent">Browser agent</span>
        </button>
        <button type="button" class="settings-nav-item" data-settings-cat="agent">
          <span class="material-symbols-outlined" aria-hidden="true">psychology</span>
          <span class="settings-nav-label" data-i18n-nav="agentBehavior">Agent behavior</span>
        </button>
        <button type="button" class="settings-nav-item" data-settings-cat="advanced">
          <span class="material-symbols-outlined" aria-hidden="true">construction</span>
          <span class="settings-nav-label" data-i18n-nav="advancedSettings">Advanced</span>
        </button>
      </nav>
      <div class="settings-body" id="settingsBody">
        <section class="settings-panel" data-settings-panel="models">
          <h3 class="settings-section-title" id="settingsModelsProvidersTitle">Models &amp; providers</h3>
          <p class="settings-section-note" id="settingsProvidersNote">Base URL and API key for each OpenAI-compatible API. Models are grouped under their provider.</p>
          <div id="settingsProvidersModelsList" class="settings-models"></div>
          <div class="settings-add-actions">
            <button type="button" class="text-btn settings-add-model" id="addModelBtn">+ Model</button>
            <button type="button" class="text-btn settings-add-model" id="addProviderBtn">+ Provider</button>
          </div>
          <div id="settingsModelsHint" class="settings-hint" hidden></div>
          <div id="settingsProvidersHint" class="settings-hint" hidden></div>
        </section>

        <section class="settings-panel" data-settings-panel="modes" hidden>
          <h3 class="settings-section-title" id="settingsModesTitle">Modes</h3>
          <p class="settings-section-note" id="settingsModesNote">Agent, Plan, and Ask are built in and can also be edited. Custom modes can be added and removed.</p>
          <div id="settingsModesList" class="settings-models"></div>
          <button type="button" class="text-btn settings-add-model" id="addModeBtn">+ Mode</button>
        </section>

        <section class="settings-panel" data-settings-panel="language" hidden>
          <h3 class="settings-section-title" id="settingsLanguageTitle">Language</h3>
          <label class="settings-field">
            <span class="settings-label" id="settingsLanguageLabel">Plugin UI language</span>
            <select id="settingsLanguage" class="settings-input">
              <option value="auto">Auto (follow VS Code)</option>
              <option value="en">English</option>
              <option value="ru">Русский</option>
            </select>
          </label>
        </section>

        <section class="settings-panel" data-settings-panel="commit" hidden>
          <h3 class="settings-section-title" id="settingsCommitTitle">Commit messages</h3>
          <p class="settings-section-note" id="settingsCommitNote">Prompt for SCM commit message generation. Empty uses project rules, then the built-in default.</p>
          <label class="settings-field">
            <span class="settings-label" id="settingsCommitScopeLabel">Apply to</span>
            <select id="settingsCommitScope" class="settings-input">
              <option value="global">All workspaces</option>
              <option value="workspace">Workspace</option>
            </select>
          </label>
          <label class="settings-field">
            <span class="settings-label" id="settingsCommitLanguageLabel">Commit message language</span>
            <select id="settingsCommitLanguage" class="settings-input">
              <option value="auto">Auto (follow UI language)</option>
              <option value="en">English</option>
              <option value="ru">Русский</option>
            </select>
          </label>
          <label class="settings-field">
            <span class="settings-label" id="settingsCommitPromptLabel">Commit prompt / rule</span>
            <textarea id="settingsCommitPrompt" class="settings-input settings-textarea" rows="5" placeholder="Optional. Example: write short Russian commit messages focused on why."></textarea>
          </label>
        </section>

        <section class="settings-panel" data-settings-panel="mcp" hidden>
          <h3 class="settings-section-title" id="settingsMcpTitle">MCP Servers</h3>
          <p class="settings-section-note" id="settingsMcpNote">Manage MCP connections used by Harbor Agents (Figma and more).</p>
          <div class="mcp-body" id="mcpBody">
            <div class="mcp-toolbar">
              <label class="mcp-search">
                <span class="material-symbols-outlined" aria-hidden="true">search</span>
                <input id="mcpSearchInput" type="search" placeholder="Search MCP servers..." autocomplete="off" />
              </label>
              <button type="button" class="icon-btn" id="mcpAddBtn" title="Add MCP server" aria-label="Add MCP server">
                <span class="material-symbols-outlined" aria-hidden="true">add</span>
              </button>
            </div>
            <div class="mcp-presets" id="mcpPresets">
              <span class="mcp-presets-label" id="mcpPresetsLabel">Quick add</span>
              <button type="button" class="text-btn mcp-preset-btn" data-preset="playwright" id="mcpPresetPlaywright">
                <span class="material-symbols-outlined" aria-hidden="true">web</span>
                <span class="mcp-preset-btn-label">Playwright</span>
              </button>
              <button type="button" class="text-btn mcp-preset-btn" data-preset="github" id="mcpPresetGithub">
                <span class="material-symbols-outlined" aria-hidden="true">hub</span>
                <span class="mcp-preset-btn-label">GitHub</span>
              </button>
            </div>
            <p class="mcp-presets-note" id="mcpPresetsNote" hidden></p>
            <div class="mcp-section-head">
              <h3 class="mcp-section-title" id="mcpConfiguredTitle">Configured MCP servers</h3>
              <span class="mcp-section-count" id="mcpConfiguredCount">0</span>
            </div>
            <div id="mcpServersList" class="mcp-servers-list"></div>
            <div id="mcpEmpty" class="mcp-empty" hidden>No MCP servers yet.</div>
          </div>
        </section>

        <section class="settings-panel" data-settings-panel="browser" hidden>
          <h3 class="settings-section-title" id="settingsBrowserTitle">Browser agent (AutoGLM)</h3>
          <p class="settings-section-note" id="settingsBrowserNote">Multi-step tasks in your real Chrome or Edge via AutoGLM (<code>browser_task</code>). Headless <code>browser_*</code> tools stay available for localhost checks. Requires the AutoGLM CLI and browser extension.</p>
          <label class="settings-field settings-check">
            <input id="settingsAutoglmEnabled" type="checkbox" />
            <span class="settings-label" id="settingsAutoglmEnabledLabel">Enable browser_task</span>
          </label>
          <label class="settings-field">
            <span class="settings-label" id="settingsAutoglmBrowserLabel">Browser</span>
            <select id="settingsAutoglmBrowser" class="settings-input">
              <option value="chrome">Chrome</option>
              <option value="edge">Edge</option>
            </select>
          </label>
          <label class="settings-field settings-check">
            <input id="settingsAutoglmAutoApprove" type="checkbox" />
            <span class="settings-label" id="settingsAutoglmAutoApproveLabel">Auto-approve sensitive actions</span>
          </label>
          <label class="settings-field">
            <span class="settings-label" id="settingsAutoglmBinaryPathLabel">Binary path (optional)</span>
            <input id="settingsAutoglmBinaryPath" class="settings-input" type="text" autocomplete="off" placeholder="autoglm on PATH, or full path" />
          </label>
          <p class="settings-hint" id="settingsAutoglmExtensionHint">Install the AutoGLM extension for Chrome or Edge, then enable it. Saving these settings writes ~/.openclaw-autoclaw/config.json when enabled.</p>
        </section>

        <section class="settings-panel" data-settings-panel="agent" hidden>
          <h3 class="settings-section-title" id="settingsAgentTitle">Agent behavior</h3>
          <label class="settings-field">
            <span class="settings-label" id="settingsSystemPromptLabel">System prompt</span>
            <textarea id="settingsSystemPrompt" class="settings-input settings-textarea" rows="6"></textarea>
          </label>
          <label class="settings-field">
            <span class="settings-label" id="settingsMaxTokensLabel">max_tokens</span>
            <input id="settingsMaxTokens" class="settings-input" type="number" min="64" max="128000" />
          </label>
          <label class="settings-field">
            <span class="settings-label" id="settingsMaxResponseCharsLabel">Max response length (chars)</span>
            <input id="settingsMaxResponseChars" class="settings-input" type="number" min="1000" max="200000" />
          </label>
          <label class="settings-field settings-check">
            <input id="settingsSoundNotificationsEnabled" type="checkbox" />
            <span class="settings-label" id="settingsSoundNotificationsLabel">Sound notifications</span>
          </label>
          <label class="settings-field settings-check">
            <input id="settingsSubagentsEnabled" type="checkbox" />
            <span class="settings-label" id="settingsSubagentsLabel">Parallel agents</span>
          </label>
          <p class="settings-hint" id="settingsSubagentsNote">Agent, Plan, and Ask. Children follow the current mode (Plan/Ask stay read-only).</p>
          <label class="settings-field settings-check">
            <input id="settingsParallelToolCallsEnabled" type="checkbox" />
            <span class="settings-label" id="settingsParallelToolCallsLabel">Parallel tool calls</span>
          </label>
          <p class="settings-hint" id="settingsParallelToolCallsNote">Run independent tools from one model response at the same time.</p>
          <label class="settings-field settings-check">
            <input id="settingsAutoCompactEnabled" type="checkbox" />
            <span class="settings-label" id="settingsAutoCompactLabel">Auto compact</span>
          </label>
          <p class="settings-hint" id="settingsAutoCompactNote">Compress conversation context when it approaches the model input limit.</p>
          <label class="settings-field settings-check">
            <input id="settingsSelectionHintsEnabled" type="checkbox" />
            <span class="settings-label" id="settingsSelectionHintsLabel">Selection hints</span>
          </label>
        </section>

        <section class="settings-panel" data-settings-panel="advanced" hidden>
          <h3 class="settings-section-title" id="settingsAdvancedTitle">Advanced</h3>
          <label class="settings-field settings-check">
            <input id="settingsRejectUnauthorized" type="checkbox" />
            <span class="settings-label" id="settingsTlsValidateLabel">Validate TLS certificate</span>
          </label>
          <label class="settings-field">
            <span class="settings-label" id="settingsCaBundleLabel">CA bundle path</span>
            <input id="settingsCaBundle" class="settings-input" type="text" autocomplete="off" />
          </label>
        </section>
      </div>
    </div>
    <div id="modelEditModal" class="settings-modal" hidden>
      <div class="settings-modal-backdrop" data-modal-dismiss="1"></div>
      <div class="settings-modal-card" role="dialog" aria-modal="true" aria-labelledby="modelEditTitle">
        <div class="settings-modal-head">
          <h3 id="modelEditTitle" class="settings-modal-title">Model</h3>
          <button type="button" class="icon-btn" id="modelEditCloseBtn" title="Close" aria-label="Close">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
        <div class="settings-modal-tabs" id="modelEditTabs" hidden>
          <button type="button" class="settings-modal-tab is-active" data-model-mode="manual">Manual</button>
          <button type="button" class="settings-modal-tab" data-model-mode="api">From API</button>
          <button type="button" class="settings-modal-tab" data-model-mode="json">JSON</button>
        </div>
        <div class="settings-modal-body" id="modelEditProviderBlock">
          <label class="settings-field">
            <span class="settings-label" id="modelEditProviderLabel">Provider</span>
            <select id="modelEditProvider" class="settings-input"></select>
          </label>
          <div id="modelEditNewProvider" class="settings-new-provider" hidden>
            <label class="settings-field">
              <span class="settings-label" id="modelEditNewProviderIdLabel">Provider ID</span>
              <input id="modelEditNewProviderId" class="settings-input" type="text" placeholder="zai, kimi, openai…" autocomplete="off" />
            </label>
            <label class="settings-field">
              <span class="settings-label" id="modelEditNewProviderNameLabel">Provider name</span>
              <input id="modelEditNewProviderName" class="settings-input" type="text" placeholder="Z.AI" autocomplete="off" />
            </label>
            <label class="settings-field">
              <span class="settings-label" id="modelEditNewProviderUrlLabel">Base URL</span>
              <input id="modelEditNewProviderUrl" class="settings-input" type="text" placeholder="https://api.z.ai/api/paas/v4" autocomplete="off" />
            </label>
            <label class="settings-field">
              <span class="settings-label" id="modelEditNewProviderKeyLabel">API Key</span>
              <input id="modelEditNewProviderKey" class="settings-input" type="password" autocomplete="off" />
            </label>
          </div>
        </div>
        <div class="settings-modal-body" id="modelEditManualPane">
          <label class="settings-field">
            <span class="settings-label">ID</span>
            <input id="modelEditId" class="settings-input" type="text" placeholder="as in the API, e.g. gpt-4.1" />
          </label>
          <label class="settings-field">
            <span class="settings-label">Name</span>
            <input id="modelEditLabel" class="settings-input" type="text" placeholder="shown in the list" />
          </label>
          <div class="settings-model-limits">
            <label class="settings-field">
              <span class="settings-label">Context (input)</span>
              <input id="modelEditContext" class="settings-input" type="number" min="1024" step="1024" placeholder="max_input" />
            </label>
            <label class="settings-field">
              <span class="settings-label">Response (output)</span>
              <input id="modelEditOutput" class="settings-input" type="number" min="1" step="1024" placeholder="max_output" />
            </label>
          </div>
          <label class="settings-field settings-check">
            <input id="modelEditVision" type="checkbox" />
            <span class="settings-label">Supports images (vision)</span>
          </label>
        </div>
        <div class="settings-modal-body" id="modelEditJsonPane" hidden>
          <label class="settings-field">
            <span class="settings-label">Model list JSON</span>
            <textarea id="settingsModelsJson" class="settings-input settings-textarea settings-json-textarea" rows="8" placeholder='["gpt-4.1", {"model":"claude-sonnet-4-5","name":"Claude","context_window":200000}]'></textarea>
          </label>
          <div class="settings-json-actions">
            <button type="button" class="text-btn" id="exportModelsJsonBtn">Copy current list</button>
          </div>
          <div id="settingsJsonHint" class="settings-hint" hidden></div>
        </div>
        <div class="settings-modal-body" id="modelEditApiPane" hidden>
          <p class="settings-section-note" id="modelEditApiNote">Loads model ids from the provider&apos;s <code>/models</code> endpoint.</p>
          <div class="settings-json-actions">
            <button type="button" class="text-btn" id="modelEditApiFetchBtn">Fetch models</button>
            <button type="button" class="text-btn" id="modelEditApiSelectNewBtn" hidden>Select new</button>
          </div>
          <div id="modelEditApiStatus" class="settings-hint" hidden></div>
          <label class="settings-field" id="modelEditApiSearchWrap" hidden>
            <span class="settings-label" id="modelEditApiSearchLabel">Filter</span>
            <input id="modelEditApiSearch" class="settings-input" type="search" autocomplete="off" />
          </label>
          <div id="modelEditApiList" class="settings-fetch-models-list" hidden></div>
        </div>
        <div class="settings-modal-foot">
          <button type="button" class="text-btn" id="modelEditCancelBtn">Cancel</button>
          <button type="button" class="text-btn settings-modal-done" id="modelEditDoneBtn">Done</button>
        </div>
      </div>
    </div>
    <div id="fetchModelsModal" class="settings-modal" hidden>
      <div class="settings-modal-backdrop" data-fetch-models-dismiss="1"></div>
      <div class="settings-modal-card" role="dialog" aria-modal="true" aria-labelledby="fetchModelsTitle">
        <div class="settings-modal-head">
          <h3 id="fetchModelsTitle" class="settings-modal-title">Fetch models</h3>
          <button type="button" class="icon-btn" id="fetchModelsCloseBtn" title="Close" aria-label="Close">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
        <div class="settings-modal-body">
          <p class="settings-section-note" id="fetchModelsNote">Select models to add from the provider API.</p>
          <div id="fetchModelsStatus" class="settings-hint" hidden></div>
          <label class="settings-field" id="fetchModelsSearchWrap" hidden>
            <span class="settings-label" id="fetchModelsSearchLabel">Filter</span>
            <input id="fetchModelsSearch" class="settings-input" type="search" autocomplete="off" />
          </label>
          <div class="settings-json-actions" id="fetchModelsSelectWrap" hidden>
            <button type="button" class="text-btn" id="fetchModelsSelectNewBtn">Select new</button>
          </div>
          <div id="fetchModelsList" class="settings-fetch-models-list" hidden></div>
        </div>
        <div class="settings-modal-foot">
          <button type="button" class="text-btn" id="fetchModelsCancelBtn">Cancel</button>
          <button type="button" class="text-btn settings-modal-done" id="fetchModelsAddBtn">Add selected</button>
        </div>
      </div>
    </div>
    <div id="providerEditModal" class="settings-modal" hidden>
      <div class="settings-modal-backdrop" data-provider-dismiss="1"></div>
      <div class="settings-modal-card" role="dialog" aria-modal="true" aria-labelledby="providerEditTitle">
        <div class="settings-modal-head">
          <h3 id="providerEditTitle" class="settings-modal-title">Provider</h3>
          <button type="button" class="icon-btn" id="providerEditCloseBtn" title="Close" aria-label="Close">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
        <div class="settings-modal-body">
          <label class="settings-field">
            <span class="settings-label">ID</span>
            <input id="providerEditId" class="settings-input" type="text" placeholder="zai, kimi, openai…" />
          </label>
          <label class="settings-field">
            <span class="settings-label">Name</span>
            <input id="providerEditName" class="settings-input" type="text" placeholder="Z.AI" />
          </label>
          <label class="settings-field">
            <span class="settings-label">Base URL</span>
            <input id="providerEditBaseUrl" class="settings-input" type="text" placeholder="https://api.z.ai/api/paas/v4" />
          </label>
          <label class="settings-field">
            <span class="settings-label" id="providerEditStatusUrlLabel">Status URL</span>
            <input id="providerEditStatusUrl" class="settings-input" type="text" placeholder="https://…/models or /health" />
            <span class="settings-field-hint" id="providerEditStatusUrlHint">Empty = Base URL + /models</span>
          </label>
          <label class="settings-field">
            <span class="settings-label">API Key</span>
            <input id="providerEditApiKey" class="settings-input" type="password" autocomplete="off" />
          </label>
        </div>
        <div class="settings-modal-foot">
          <button type="button" class="text-btn" id="providerEditCancelBtn">Cancel</button>
          <button type="button" class="text-btn settings-modal-done" id="providerEditDoneBtn">Done</button>
        </div>
      </div>
    </div>
  </section>

  <section id="mcpScreen" class="screen" hidden></section>

  <div id="mcpEditModal" class="settings-modal" hidden>
      <div class="settings-modal-backdrop" data-mcp-dismiss="1"></div>
      <div class="settings-modal-card" role="dialog" aria-modal="true" aria-labelledby="mcpEditTitle">
        <div class="settings-modal-head">
          <h3 id="mcpEditTitle" class="settings-modal-title">Figma</h3>
          <button type="button" class="icon-btn" id="mcpEditCloseBtn" title="Close" aria-label="Close">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
        <div class="settings-modal-body">
          <p class="settings-section-note" id="mcpEditNote">Connect Figma via browser OAuth. Personal Access Token is an optional fallback.</p>
          <p class="settings-section-note" id="mcpEditStatus">Status: Disconnected</p>
          <div class="settings-figma-actions">
            <button type="button" class="text-btn" id="settingsFigmaConnectBtn">Connect Figma</button>
            <button type="button" class="text-btn" id="settingsFigmaDisconnectBtn" hidden>Disconnect</button>
          </div>
          <div id="settingsFigmaPatBlock" class="settings-figma-pat">
            <p class="settings-section-note" id="settingsFigmaPatNote">Create a token in Figma → Settings → Security → Personal access tokens.</p>
            <label class="settings-field">
              <span class="settings-label" id="settingsFigmaPatLabel">Personal Access Token</span>
              <input id="settingsFigmaPat" class="settings-input" type="password" autocomplete="off" placeholder="figd_…" />
            </label>
            <button type="button" class="text-btn" id="settingsFigmaPatConnectBtn">Connect with token</button>
            <button type="button" class="text-btn" id="settingsFigmaPatHelpBtn">Open token settings</button>
          </div>
        </div>
      </div>
    </div>
    <div id="mcpCustomEditModal" class="settings-modal" hidden>
      <div class="settings-modal-backdrop" data-mcp-custom-dismiss="1"></div>
      <div class="settings-modal-card" role="dialog" aria-modal="true" aria-labelledby="mcpCustomEditTitle">
        <div class="settings-modal-head">
          <h3 id="mcpCustomEditTitle" class="settings-modal-title">MCP Server</h3>
          <button type="button" class="icon-btn" id="mcpCustomEditCloseBtn" title="Close" aria-label="Close">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
        <div class="settings-modal-body">
          <input id="mcpCustomEditId" type="hidden" value="" />
          <label class="settings-field">
            <span class="settings-label" id="mcpCustomNameLabel">Name</span>
            <input id="mcpCustomName" class="settings-input" type="text" placeholder="My MCP server" />
          </label>
          <label class="settings-field">
            <span class="settings-label" id="mcpCustomTransportLabel">Transport</span>
            <select id="mcpCustomTransport" class="settings-input">
              <option value="stdio">stdio (command)</option>
              <option value="http">HTTP</option>
            </select>
          </label>
          <div id="mcpCustomStdioFields">
            <label class="settings-field">
              <span class="settings-label" id="mcpCustomCommandLabel">Command</span>
              <input id="mcpCustomCommand" class="settings-input" type="text" placeholder="npx" />
            </label>
            <label class="settings-field">
              <span class="settings-label" id="mcpCustomArgsLabel">Args</span>
              <input id="mcpCustomArgs" class="settings-input" type="text" placeholder="-y some-mcp-server --stdio" />
            </label>
            <label class="settings-field">
              <span class="settings-label" id="mcpCustomEnvLabel">Env (KEY=value per line)</span>
              <textarea id="mcpCustomEnv" class="settings-input settings-textarea" rows="3" placeholder="API_KEY=…"></textarea>
            </label>
            <label class="settings-field">
              <span class="settings-label" id="mcpCustomCwdLabel">Working directory (optional)</span>
              <input id="mcpCustomCwd" class="settings-input" type="text" placeholder="/path/to/cwd" />
            </label>
          </div>
          <div id="mcpCustomHttpFields" hidden>
            <label class="settings-field">
              <span class="settings-label" id="mcpCustomUrlLabel">URL</span>
              <input id="mcpCustomUrl" class="settings-input" type="text" placeholder="https://example.com/mcp" />
            </label>
            <label class="settings-field">
              <span class="settings-label" id="mcpCustomTokenLabel">Bearer token (optional)</span>
              <input id="mcpCustomToken" class="settings-input" type="password" autocomplete="off" placeholder="optional" />
            </label>
          </div>
        </div>
        <div class="settings-modal-foot">
          <button type="button" class="text-btn" id="mcpCustomEditCancelBtn">Cancel</button>
          <button type="button" class="text-btn settings-modal-done" id="mcpCustomEditSaveBtn">Save &amp; Connect</button>
        </div>
      </div>
    </div>

  <div id="modeEditModal" class="settings-modal" hidden>
    <div class="settings-modal-backdrop" data-mode-dismiss="1"></div>
    <div class="settings-modal-card" role="dialog" aria-modal="true" aria-labelledby="modeEditTitle">
      <div class="settings-modal-head">
        <h3 id="modeEditTitle" class="settings-modal-title">Mode</h3>
        <button type="button" class="icon-btn" id="modeEditCloseBtn" title="Close" aria-label="Close">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
      <div class="settings-modal-body">
        <label class="settings-field">
          <span class="settings-label">Name</span>
          <input id="modeEditLabel" class="settings-input" type="text" placeholder="e.g. Review" />
        </label>
        <label class="settings-field">
          <span class="settings-label">Description</span>
          <input id="modeEditDescription" class="settings-input" type="text" placeholder="Short tooltip text" />
        </label>
        <label class="settings-field">
          <span class="settings-label">Tools</span>
          <select id="modeEditTools" class="settings-input">
            <option value="agent">Agent — read and edit</option>
            <option value="readonly">Read only</option>
          </select>
        </label>
        <label class="settings-field">
          <span class="settings-label">Mode prompt</span>
          <textarea id="modeEditPrompt" class="settings-input settings-textarea" rows="6" placeholder="Instructions for this mode..."></textarea>
        </label>
      </div>
      <div class="settings-modal-foot">
        <button type="button" class="text-btn" id="modeEditCancelBtn">Cancel</button>
        <button type="button" class="text-btn settings-modal-done" id="modeEditDoneBtn">Done</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}" src="${markedUri}"></script>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function mergeEdits(edits: FileEditStat[]): FileEditStat[] {
  const map = new Map<string, FileEditStat>();
  for (const edit of edits) {
    const prev = map.get(edit.path);
    if (!prev) {
      map.set(edit.path, { ...edit });
      continue;
    }
    map.set(edit.path, {
      path: edit.path,
      created: prev.created || edit.created,
      added: prev.added + edit.added,
      removed: prev.removed + edit.removed,
    });
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function parseReviewPayload(text: string): {
  files: FileEditStat[];
  showScm: boolean;
} {
  try {
    const data = JSON.parse(text) as
      | FileEditStat[]
      | { files?: FileEditStat[]; showScm?: boolean };
    if (Array.isArray(data)) {
      return { files: data, showScm: false };
    }
    const files = Array.isArray(data.files) ? data.files : [];
    return { files, showScm: Boolean(data.showScm) };
  } catch {
    return { files: [], showScm: false };
  }
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
