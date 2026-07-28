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
  resolveModelSupportsVision,
} from "./config";
import { resolveUiLanguage } from "./i18n";
import { runAgentTurn } from "./agentLoop";
import type { AgentPhase } from "./agentLoop";
import type { FileEditStat } from "./diffStats";
import { getEditorSelectionPayload } from "./editorContext";
import { searchWorkspaceFiles } from "./fileMentions";
import { hasUncommittedChanges } from "./gitStatus";
import {
  modeThinkingLabel,
  parseCustomModes,
  type AgentModeDef,
} from "./modes";
import type { ChatMessage } from "./openaiClient";
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
  createEmptyAgent,
  deleteAgentFromStore,
  ensureActiveVisible,
  formatListTime,
  findAgentByChatId,
  getActiveChat,
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
  modes: AgentModeDef[];
  commitMessagePrompt?: string;
  commitMessageLanguage?: string;
  commitMessageScope?: "global" | "workspace";
  figmaEnabled?: boolean;
};

type WebviewToHost =
  | { type: "ready" }
  | {
      type: "send";
      text: string;
      model: string;
      agentMode?: string;
      attachments?: IncomingAttachment[];
    }
  | { type: "regenerate"; agentMode?: string }
  | {
      type: "editUserMessage";
      index: number;
      text: string;
      model: string;
      agentMode?: string;
      attachments?: IncomingAttachment[];
    }
  | { type: "stop" }
  | { type: "newChat" }
  | { type: "newAgent" }
  | { type: "openAgent"; agentId: string }
  | { type: "showAgents" }
  | { type: "showArchive" }
  | { type: "showSettings" }
  | { type: "saveSettings"; settings: SettingsPayload }
  | { type: "saveModes"; modes: SettingsPayload["modes"] }
  | { type: "renameAgent"; agentId: string; name: string }
  | { type: "archiveAgent"; agentId: string }
  | { type: "restoreAgent"; agentId: string }
  | { type: "deleteAgent"; agentId: string }
  | { type: "modelChanged"; model: string }
  | { type: "openFile"; path: string }
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
  | { type: "mcpConnectServer"; id: string };

const STORAGE_KEY_V1 = "agentPanel.session.v1";
const STORAGE_KEY_V2 = "agentPanel.session.v2";

export class AgentPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "agentPanel.chat";

  private view?: vscode.WebviewView;
  private store!: AgentsStoreV2;
  private history: ChatMessage[] = [];
  private uiMessages: UiMessage[] = [];
  private selectedModel = "";
  private lastTurnModel = "";
  private contextTokens = 0;
  private readonly chatRuns = new Map<string, AbortController>();
  private readonly agentRunState = new Map<
    string,
    "running" | "success" | "error"
  >();
  private readonly chatStatusState = new Map<
    string,
    { text: string; hidden: boolean; phase?: AgentPhase }
  >();
  private readonly disposables: vscode.Disposable[] = [];
  private scmRefreshTimer?: ReturnType<typeof setTimeout>;
  private gitApiBound = false;
  private pendingScmReturnRefresh = false;
  private pendingComposerInsert = "";
  private pendingComposerSelection:
    | {
        path: string;
        startLine: number;
        endLine: number;
        text: string;
        language: string;
      }
    | undefined;

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

    this.disposables.push(
      webviewView.webview.onDidReceiveMessage(async (raw) => {
        const message = raw as WebviewToHost;
        await this.onMessage(message);
      }),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          // Принудительно обновляем HTML — иначе retainContextWhenHidden
          // может держать старую разметку без индикатора контекста.
          webviewView.webview.html = this.getHtml(webviewView.webview);
          void this.postInit();
          this.scheduleScmRefresh();
          if (this.pendingScmReturnRefresh) {
            this.pendingScmReturnRefresh = false;
            setTimeout(() => this.scheduleScmRefresh(), 700);
          }
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("agentPanel")) {
          this.postModels();
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
    this.bindGitStatusRefresh();

    webviewView.webview.html = this.getHtml(webviewView.webview);
    void this.postInit();
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

    this.pendingComposerSelection = selection;
    this.pendingComposerInsert = "";
    this.setScreen("chat");
    this.saveStore();
    const wasVisible = Boolean(this.view?.visible);
    await vscode.commands.executeCommand("agentPanel.chat.focus");
    // Если панель уже была открыта — HTML не перезагрузится, вставляем сразу.
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
      this.view.webview.postMessage({
        type: "insertComposerSelection",
        selection,
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

  clearChat(): void {
    this.newChat();
  }

  dispose(): void {
    this.abortAllRuns();
    if (this.scmRefreshTimer) {
      clearTimeout(this.scmRefreshTimer);
    }
    this.persistActiveChat();
    this.saveStore();
    for (const d of this.disposables) {
      d.dispose();
    }
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
    this.ensureChatReady(fallbackModel);
    this.hydrateActiveChat();

    if (seededFromGlobal && this.hasWorkspaceFolder()) {
      void this.context.workspaceState.update(STORAGE_KEY_V2, this.store);
      void this.context.globalState.update(STORAGE_KEY_V2, undefined);
    } else if (this.hasWorkspaceFolder()) {
      // Сохраняем screen=chat и автосозданного агента.
      void this.context.workspaceState.update(STORAGE_KEY_V2, this.store);
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
      this.lastTurnModel = "";
      this.contextTokens = 0;
      return;
    }
    this.history = chat.history || [];
    this.uiMessages = chat.uiMessages || [];
    this.selectedModel = chat.selectedModel || "";
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
      lastTurnModel: this.lastTurnModel,
      history: this.history,
      uiMessages: this.uiMessages.slice(-200),
      contextTokens: this.contextTokens,
    });
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

  private selectedModelSupportsVision(): boolean {
    return resolveModelSupportsVision(this.selectedModel);
  }

  private filterAttachmentsForVision(
    attachments: MessageAttachment[]
  ): MessageAttachment[] {
    if (this.selectedModelSupportsVision()) {
      return attachments;
    }
    const kept = attachments.filter((a) => a.kind !== "image");
    if (kept.length < attachments.length) {
      void vscode.window.showWarningMessage(
        "The current model does not support images. Image attachments were skipped."
      );
    }
    return kept;
  }

  async pickAttachmentsFromUi(options?: { imagesOnly?: boolean }): Promise<void> {
    try {
      if (options?.imagesOnly && !this.selectedModelSupportsVision()) {
        void vscode.window.showWarningMessage(
          "The current model does not support images."
        );
        return;
      }
      const picked = await pickWorkspaceAttachments({
        imagesOnly: Boolean(options?.imagesOnly),
      });
      if (picked.length) {
        const persisted = this.filterAttachmentsForVision(
          await persistIncomingAttachments(picked, this.storageUri())
        );
        if (persisted.length) {
          await this.postAttachments(persisted);
        }
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
      const persisted = this.filterAttachmentsForVision(
        await persistIncomingAttachments(fromUris, this.storageUri())
      );
      if (persisted.length) {
        await this.postAttachments(persisted);
      }
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

  private saveStore(): void {
    this.persistActiveChat();
    this.writeStoreOnly();
  }

  private writeStoreOnly(): void {
    if (!this.hasWorkspaceFolder()) {
      return;
    }
    void this.context.workspaceState.update(STORAGE_KEY_V2, this.store);
  }

  private isViewingChat(chatId: string): boolean {
    return this.store.screen === "chat" && this.store.activeChatId === chatId;
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
    const agentId = findAgentByChatId(this.store, chatId)?.id;
    if (!agentId) {
      return;
    }
    if (state) {
      this.agentRunState.set(agentId, state);
    } else {
      this.agentRunState.delete(agentId);
    }
    this.postAgentsList();
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
    controller.abort();
  }

  private abortAllRuns(): void {
    for (const [chatId, controller] of this.chatRuns.entries()) {
      this.chatRuns.delete(chatId);
      controller.abort();
    }
  }

  private reloadStoreForWorkspace(): void {
    this.abortAllRuns();
    this.saveStore();
    this.loadStore();
    void this.postInit();
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
      this.pushUi(role, text);
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
    phase?: AgentPhase
  ): void {
    if (!chatId) {
      return;
    }
    const nextHidden = Boolean(hidden || !text);
    if (nextHidden) {
      this.chatStatusState.delete(chatId);
    } else {
      this.chatStatusState.set(chatId, { text, hidden: false, phase });
    }
    if (this.isViewingChat(chatId)) {
      this.view?.webview.postMessage({
        type: "status",
        chatId,
        text,
        hidden: nextHidden,
        phase,
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

  private postAgentsList(): void {
    const list = buildAgentsList(this.store).map((a) => ({
      id: a.id,
      name: a.name,
      model: this.modelLabel(a.model) || a.model || "—",
      preview: a.preview,
      time: formatListTime(a.updatedAt),
      active: a.active,
      empty: a.empty,
      runState: this.agentRunState.get(a.id) || "",
    }));
    this.view?.webview.postMessage({
      type: "agentsList",
      agents: list,
      screen: this.store.screen,
    });
  }

  private postArchiveList(): void {
    const archive = buildArchiveList(this.store);
    this.view?.webview.postMessage({
      type: "archiveList",
      agents: archive.map((a) => ({
        id: a.id,
        name: a.name,
        preview: a.preview,
        time: formatListTime(a.archivedAt),
      })),
      screen: "archive",
    });
  }

  private async postChatScreen(highlightMessageIndex?: number): Promise<void> {
    const config = getConfig();
    const models = getEnabledModels();
    if (!this.selectedModel || !models.some((m) => m.id === this.selectedModel)) {
      this.selectedModel =
        models.find((m) => m.id === config.defaultModel)?.id ??
        models[0]?.id ??
        "";
    }
    const agent = this.store.agents.find((a) => a.id === this.store.activeAgentId);
    const branches = agent ? buildBranchesList(this.store, agent.id) : [];
    const payload: Record<string, unknown> = {
      type: "showChat",
      models,
      selectedModel: this.selectedModel,
      uiMessages: await this.enrichUiMessages(this.uiMessages),
      busy: this.isChatRunning(this.store.activeChatId),
      canRegenerate: this.canRegenerate(),
      agentId: agent?.id || "",
      agentName: agent?.name || "Agent",
      chatTitle: agent?.name || "Agent",
      chatId: this.store.activeChatId || "",
      branches,
      contextUsed: this.contextTokens,
      contextMax: getContextWindow(this.selectedModel),
      scrollTop: this.store.chats[this.store.activeChatId || ""]?.scrollTop,
      status: this.chatStatusState.get(this.store.activeChatId || "") || null,
    };
    if (
      typeof highlightMessageIndex === "number" &&
      Number.isInteger(highlightMessageIndex) &&
      highlightMessageIndex >= 0
    ) {
      payload.highlightMessageIndex = highlightMessageIndex;
    }
    this.view?.webview.postMessage(payload);
    this.scheduleScmRefresh();
  }

  private async onMessage(message: WebviewToHost): Promise<void> {
    switch (message.type) {
      case "ready":
        void this.postInit();
        break;
      case "modelChanged":
        this.selectedModel = message.model;
        this.saveSession();
        this.postContextUsage();
        this.postRegenerateState();
        break;
      case "newChat":
        this.newChat();
        break;
      case "newAgent":
        await this.createAgent();
        break;
      case "showAgents":
        this.persistActiveChat();
        this.setScreen("agents");
        this.saveStore();
        this.postAgentsList();
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
        this.persistActiveChat();
        this.setScreen("settings");
        this.saveStore();
        this.postSettings();
        this.view?.webview.postMessage({
          type: "showSettings",
          busy: this.isChatRunning(this.store.activeChatId),
        });
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
        await this.confirmArchiveAgent(message.agentId);
        break;
      case "restoreAgent":
        this.restoreAgent(message.agentId);
        break;
      case "deleteAgent":
        await this.confirmDeleteAgent(message.agentId);
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
        await this.handleRegenerate(getModeById(message.agentMode).id);
        break;
      case "editUserMessage":
        await this.handleEditUserMessage(
          Number(message.index),
          String(message.text || ""),
          String(message.model || ""),
          message.attachments,
          getModeById(message.agentMode).id
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
          time: formatListTime(hit.updatedAt),
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
          const persisted = this.filterAttachmentsForVision(
            await persistIncomingAttachments(
              Array.isArray(message.files) ? message.files : [],
              this.storageUri()
            )
          );
          if (persisted.length) {
            await this.postAttachments(persisted);
          }
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          void vscode.window.showErrorMessage(text);
        }
        break;
      case "openFile":
        await this.openWorkspaceFile(message.path);
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
    this.hydrateActiveChat();
    this.saveStore();
    void this.postChatScreen(
      Number.isInteger(highlightMessageIndex) &&
        (highlightMessageIndex as number) >= 0
        ? (highlightMessageIndex as number)
        : undefined
    );
  }

  private branchFromMessage(messageIndex: number): void {
    if (this.isChatRunning(this.store.activeChatId)) {
      void vscode.window.showWarningMessage(
        "Wait for the current response to finish, then create a branch."
      );
      return;
    }
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
    this.postChatScreen();
  }

  private async confirmArchiveAgent(agentId: string): Promise<void> {
    const agent = this.store.agents.find((a) => a.id === agentId);
    if (!agent || agent.archivedAt) {
      return;
    }
    const answer = await vscode.window.showWarningMessage(
      `Archive agent "${agent.name}"?`,
      {
        modal: true,
        detail: "You can restore this agent from the archive later.",
      },
      "Archive"
    );
    if (answer !== "Archive") {
      return;
    }

    for (const chatId of getAgentChatIds(agent)) {
      this.abortChatRun(chatId);
    }
    this.persistActiveChat();
    if (!archiveAgentInStore(this.store, agentId)) {
      return;
    }
    this.setScreen("agents");
    this.hydrateActiveChat();
    this.saveStore();
    this.postAgentsList();
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
    const answer = await vscode.window.showWarningMessage(
      empty
        ? `Delete empty agent "${agent.name}"?`
        : `Delete "${agent.name}" permanently?`,
      {
        modal: true,
        detail: empty
          ? "This agent has no messages and will be deleted without archiving."
          : "Message history will be deleted permanently.",
      },
      "Delete"
    );
    if (answer !== "Delete") {
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
      this.setScreen("agents");
      this.postAgentsList();
      this.view?.webview.postMessage({ type: "showAgents" });
    }
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
  }

  private async openWorkspaceFile(relativePath: string): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const normalized = relativePath
      .trim()
      .replace(/^\.\//, "")
      .replace(/^\/+/, "");
    const uri = vscode.Uri.joinPath(folder.uri, normalized);
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

  private async handleSend(
    text: string,
    model: string,
    options?: {
      appendUser?: boolean;
      attachments?: IncomingAttachment[] | MessageAttachment[];
      agentMode?: string;
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

    const chosen =
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
    if (!runChatId || !this.store.chats[runChatId]) {
      this.view?.webview.postMessage({ type: "idle", chatId: runChatId });
      return;
    }
    let runHistory = this.history;
    let runUiMessages = this.uiMessages;
    let runLastTurnModel = this.lastTurnModel || "";
    let runContextTokens = this.contextTokens;
    const syncRunChat = (): void => {
      touchChat(this.store, runChatId, {
        selectedModel: chosen,
        lastTurnModel: runLastTurnModel,
        history: runHistory,
        uiMessages: runUiMessages.slice(-200),
        contextTokens: runContextTokens,
      });
      this.syncActiveSnapshotFromChat(runChatId, {
        history: runHistory,
        uiMessages: runUiMessages,
        selectedModel: chosen,
        lastTurnModel: runLastTurnModel,
        contextTokens: runContextTokens,
      });
      this.writeStoreOnly();
    };
    const postToRunChat = (message: Record<string, unknown>): void => {
      if (this.isViewingChat(runChatId)) {
        this.view?.webview.postMessage(message);
      }
    };
    this.selectedModel = chosen;
    this.saveSession();

    if (!resolveModelSupportsVision(chosen)) {
      const withoutImages = attachments.filter((a) => a.kind !== "image");
      if (withoutImages.length < attachments.length) {
        this.pushUiToChat(
          runChatId,
          "error",
          "This model does not support images, so image attachments were removed from the message."
        );
        attachments = withoutImages;
        if (!trimmed && !attachments.length) {
          this.view?.webview.postMessage({ type: "idle", chatId: runChatId });
          return;
        }
      }
    }

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

    if (options?.appendUser !== false) {
      const uiMsg: UiMessage = { role: "user", text: trimmed };
      if (attachments.length) {
        uiMsg.attachments = attachments.map(stripAttachmentPayload);
      }
      runUiMessages.push(uiMsg);
      syncRunChat();
    }

    this.abortChatRun(runChatId);
    const currentRun = new AbortController();
    this.chatRuns.set(runChatId, currentRun);
    this.setRunStateForChat(runChatId, "running");
    const mode = getModeById(options?.agentMode);
    const agentMode = mode.id;
    this.setStatusForChat(runChatId, modeThinkingLabel(mode), false, "thinking");

    const turnEdits: FileEditStat[] = [];

    try {
      runHistory = await runAgentTurn({
        model: chosen,
        history: runHistory,
        userText: trimmed,
        attachments,
        storageUri: this.storageUri(),
        signal: currentRun.signal,
        agentMode,
        callbacks: {
          onPhase: (phase, detail) => {
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
            this.setStatusForChat(runChatId, detail || fallback, false, phase);
          },
          onTool: (toolText) => {
            runUiMessages.push({ role: "tool", text: toolText });
            syncRunChat();
            postToRunChat({ type: "append", role: "tool", text: toolText });
          },
          onFileEdit: (edit) => {
            turnEdits.push(edit);
          },
          onAssistant: (assistantText) => {
            runLastTurnModel = chosen;
            runUiMessages.push({ role: "assistant", text: assistantText });
            syncRunChat();
            this.setRunStateForChat(runChatId, "success");
            postToRunChat({
              type: "assistantDone",
              text: assistantText,
            });
            if (this.isViewingChat(runChatId)) {
              this.postRegenerateState();
            }
          },
          onReview: (edits) => {
            void this.publishReview(
              edits.length ? edits : turnEdits,
              runChatId,
              runUiMessages
            );
          },
          onUsage: (usage) => {
            runContextTokens = usage.used;
            syncRunChat();
            if (this.isViewingChat(runChatId)) {
              this.postContextUsage();
            }
          },
          onFigmaNeedsConnect: () => {
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
          },
        },
      });
      syncRunChat();
      if (this.isViewingChat(runChatId)) {
        this.postContextUsage();
      }
    } catch (error) {
      this.setStatusForChat(runChatId, "", true);
      if (
        !currentRun ||
        currentRun.signal.aborted ||
        (error instanceof Error && error.message === "aborted")
      ) {
        this.setRunStateForChat(runChatId);
        if (this.isViewingChat(runChatId)) {
          this.postRegenerateState();
        }
        this.view?.webview.postMessage({ type: "stopped", chatId: runChatId });
        return;
      }
      const messageText =
        error instanceof Error ? error.message : String(error);
      runUiMessages.push({ role: "error", text: messageText });
      syncRunChat();
      this.setRunStateForChat(runChatId, "error");
      postToRunChat({ type: "append", role: "error", text: messageText });
      if (this.isViewingChat(runChatId)) {
        this.postRegenerateState();
      }
      this.view?.webview.postMessage({ type: "idle", chatId: runChatId });
    } finally {
      if (this.chatRuns.get(runChatId) === currentRun) {
        this.chatRuns.delete(runChatId);
      }
    }
  }

  private async handleRegenerate(agentMode = "agent"): Promise<void> {
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
    });
  }

  private async handleEditUserMessage(
    index: number,
    text: string,
    model: string,
    incomingAttachments?: IncomingAttachment[],
    agentMode = "agent"
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
    const uiMsg: UiMessage = { role: "user", text: nextText };
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
    });
  }

  private async publishReview(
    edits: FileEditStat[],
    chatId = this.store.activeChatId,
    targetUiMessages = this.uiMessages
  ): Promise<void> {
    const unique = mergeEdits(edits).filter((e) => Boolean(e.path));
    if (!unique.length) {
      this.setStatusForChat(chatId, "", true);
      return;
    }

    const showScm = await hasUncommittedChanges(unique.map((f) => f.path));
    const payload = JSON.stringify({ files: unique, showScm });
    targetUiMessages.push({ role: "review", text: payload });
    touchChat(this.store, chatId, {
      uiMessages: targetUiMessages.slice(-200),
    });
    if (this.isViewingChat(chatId)) {
      this.uiMessages = targetUiMessages;
    }
    this.writeStoreOnly();
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

    const reviews: { paths: string[]; showScm: boolean }[] = [];
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
      const showScm = await hasUncommittedChanges(
        parsed.files.map((f) => f.path)
      );
      reviews.push({
        paths: parsed.files.map((f) => f.path),
        showScm,
      });
      if (parsed.showScm !== showScm) {
        changed = true;
        this.uiMessages[i] = {
          ...msg,
          text: JSON.stringify({ files: parsed.files, showScm }),
        };
      }
    }

    if (changed) {
      this.saveSession();
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
    }
    this.view?.webview.postMessage({
      type: "modelsUpdated",
      models,
      selectedModel: this.selectedModel,
    });
  }

  private postSettings(): void {
    const config = getConfig();
    this.view?.webview.postMessage({
      type: "settings",
      settings: {
        providers: config.providers.map((p) => ({
          id: p.id,
          name: p.name || "",
          baseUrl: p.baseUrl,
          apiKey: p.apiKey || "",
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
      },
    });
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
    this.view?.webview.postMessage({ type: "figmaStatus", status: payload });
    this.postMcpServersList();
  }

  private postMcpServersList(servers?: McpServerRuntimeStatus[]): void {
    const mcp = getMcpManager();
    const list = servers || mcp?.listServerStatuses() || [];
    this.view?.webview.postMessage({
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
        const row: {
          id: string;
          name?: string;
          baseUrl: string;
          apiKey?: string;
        } = { id, baseUrl };
        if (name) {
          row.name = name;
        }
        if (apiKey) {
          row.apiKey = apiKey;
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
        } => Boolean(m)
      );

    if (!models.length) {
      void vscode.window.showWarningMessage(
        "At least one model with a non-empty id is required."
      );
      return;
    }

    const enabledModels = models.filter((m) => m.enabled !== false);
    const defaultModel = String(raw.defaultModel || "").trim();
    const resolvedDefault = enabledModels.some((m) => m.id === defaultModel)
      ? defaultModel
      : enabledModels[0]?.id || models[0].id;

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
    await cfg.update("providers", providers, target);
    await cfg.update("models", models, target);
    await cfg.update("defaultModel", resolvedDefault, target);
    await cfg.update(
      "language",
      raw.language === "ru" ? "ru" : raw.language === "en" ? "en" : "auto",
      target
    );
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
    await cfg.update("systemPrompt", String(raw.systemPrompt || ""), target);
    await cfg.update(
      "maxToolRounds",
      clamp(raw.maxToolRounds, 1, 50, 20),
      target
    );
    await cfg.update("maxTokens", clamp(raw.maxTokens, 64, 128_000, 4096), target);
    await cfg.update(
      "maxResponseChars",
      clamp(raw.maxResponseChars, 1000, 200_000, 12_000),
      target
    );

    await this.saveCommitMessageSettings(raw);

    const figmaEnabled = raw.figmaEnabled !== false;
    await cfg.update("figma.enabled", figmaEnabled, target);
    const mcp = getMcpManager();
    if (mcp) {
      await mcp.setEnabled(figmaEnabled);
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
    const prompt = String(raw.commitMessagePrompt || "").trim();
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
    this.view?.webview.postMessage({
      type: "modesUpdated",
      modes: this.serializeModesForUi(),
    });
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

    this.view?.webview.postMessage({
      type: "init",
      models,
      selectedModel: this.selectedModel,
      uiMessages: await this.enrichUiMessages(this.uiMessages),
      busy: this.isChatRunning(this.store.activeChatId),
      canRegenerate: this.canRegenerate(),
      screen: this.store.screen,
      agentId: this.store.activeAgentId || "",
      agentName:
        this.store.agents.find((a) => a.id === this.store.activeAgentId)?.name ||
        "Agent",
      chatTitle: getActiveChat(this.store)?.title || "Chat",
      contextUsed: this.contextTokens,
      contextMax: getContextWindow(this.selectedModel),
      chatId: this.store.activeChatId || "",
      scrollTop: getActiveChat(this.store)?.scrollTop,
      status: this.chatStatusState.get(this.store.activeChatId || "") || null,
      modes: this.serializeModesForUi(),
    });

    this.postAgentsList();
    if (this.store.screen === "chat") {
      await this.postChatScreen();
    } else if (this.store.screen === "archive") {
      this.postArchiveList();
      this.view?.webview.postMessage({ type: "showArchive" });
    } else if (this.store.screen === "settings") {
      this.postSettings();
      this.view?.webview.postMessage({ type: "showSettings" });
    } else {
      this.view?.webview.postMessage({ type: "showAgents" });
    }
    // После reload webview (focus панели) — доставить отложенную вставку.
    if (this.pendingComposerInsert || this.pendingComposerSelection) {
      setTimeout(() => this.flushPendingComposerInsert(), 80);
    }
  }

  private getHtml(webview: vscode.Webview): string {
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
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="${lang}">
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
  </style>
  <title>Harbor Agents</title>
</head>
<body>
  <section id="agentsScreen" class="screen" hidden>
    <div class="agents-top">
      <div class="agents-title">Agents</div>
      <button type="button" class="icon-btn" id="openSettingsBtn" title="Settings" aria-label="Settings">
        <span class="material-symbols-outlined" aria-hidden="true">settings</span>
      </button>
      <button type="button" class="icon-btn" id="openArchiveBtn" title="Archive" aria-label="Archive">
        <span class="material-symbols-outlined" aria-hidden="true">inventory_2</span>
      </button>
      <button type="button" class="icon-btn" id="newAgentBtn" title="New Agent" aria-label="New Agent">
        <span class="material-symbols-outlined" aria-hidden="true">add</span>
      </button>
    </div>
    <div id="agentsList" class="agents-list"></div>
  </section>

  <section id="archiveScreen" class="screen" hidden>
    <div class="agents-top">
      <button type="button" class="icon-btn" id="backFromArchiveBtn" title="Back to agents" aria-label="Back to agents">
        <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
      </button>
      <div class="agents-title">Archive</div>
    </div>
    <div id="archiveList" class="agents-list"></div>
  </section>

  <section id="settingsScreen" class="screen" hidden>
    <div class="agents-top">
      <button type="button" class="icon-btn" id="backFromSettingsBtn" title="Back to agents" aria-label="Back to agents">
        <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
      </button>
      <div class="agents-title">Settings</div>
      <div id="settingsSaveStatus" class="settings-save-status" hidden>Saved</div>
    </div>
    <div class="settings-body" id="settingsBody">
      <section class="settings-section">
        <h3 class="settings-section-title">Providers</h3>
        <p class="settings-section-note">Base URL and API key for each OpenAI-compatible API. Each model picks its provider in the model card.</p>
        <div id="settingsProvidersList" class="settings-models"></div>
        <button type="button" class="text-btn settings-add-model" id="addProviderBtn">+ Provider</button>
        <div id="settingsProvidersHint" class="settings-hint" hidden></div>
      </section>

      <section class="settings-section">
        <h3 class="settings-section-title">Models</h3>
        <label class="settings-field">
          <span class="settings-label">Default model</span>
          <select id="settingsDefaultModel" class="settings-input"></select>
        </label>

        <div id="settingsModelsList" class="settings-models"></div>
        <button type="button" class="text-btn settings-add-model" id="addModelBtn">+ Add</button>
        <div id="settingsModelsHint" class="settings-hint" hidden></div>
      </section>

      <section class="settings-section">
        <h3 class="settings-section-title">Modes</h3>
        <p class="settings-section-note">Agent, Plan, and Ask are built in and can also be edited. Custom modes can be added and removed.</p>
        <div id="settingsModesList" class="settings-models"></div>
        <button type="button" class="text-btn settings-add-model" id="addModeBtn">+ Mode</button>
      </section>

      <section class="settings-section">
        <h3 class="settings-section-title">Language</h3>
        <label class="settings-field">
          <span class="settings-label">Plugin UI language</span>
          <select id="settingsLanguage" class="settings-input">
            <option value="auto">Auto (follow VS Code)</option>
            <option value="en">English</option>
            <option value="ru">Русский</option>
          </select>
        </label>
      </section>

      <section class="settings-section">
        <h3 class="settings-section-title">Commit messages</h3>
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

      <section class="settings-section">
        <h3 class="settings-section-title" id="settingsMcpTitle">MCP Servers</h3>
        <p class="settings-section-note" id="settingsMcpNote">Manage MCP connections used by Harbor Agents (Figma and more).</p>
        <button type="button" class="mcp-settings-entry" id="openMcpServersBtn">
          <span class="mcp-settings-entry-icon" aria-hidden="true">
            <span class="material-symbols-outlined">electrical_services</span>
          </span>
          <span class="mcp-settings-entry-text">
            <span class="mcp-settings-entry-title" id="settingsMcpEntryTitle">MCP Servers</span>
            <span class="mcp-settings-entry-sub" id="settingsMcpEntrySub">Open connection list</span>
          </span>
          <span class="material-symbols-outlined mcp-settings-entry-chevron" aria-hidden="true">chevron_right</span>
        </button>
      </section>

      <section class="settings-section">
        <h3 class="settings-section-title">TLS</h3>
        <label class="settings-field settings-check">
          <input id="settingsRejectUnauthorized" type="checkbox" />
          <span class="settings-label">Validate TLS certificate</span>
        </label>
        <label class="settings-field">
          <span class="settings-label">CA bundle path</span>
          <input id="settingsCaBundle" class="settings-input" type="text" autocomplete="off" />
        </label>
      </section>

      <section class="settings-section">
        <h3 class="settings-section-title">Agent behavior</h3>
        <label class="settings-field">
          <span class="settings-label">System prompt</span>
          <textarea id="settingsSystemPrompt" class="settings-input settings-textarea" rows="6"></textarea>
        </label>
        <label class="settings-field">
          <span class="settings-label">Max tool rounds</span>
          <input id="settingsMaxToolRounds" class="settings-input" type="number" min="1" max="50" />
        </label>
        <label class="settings-field">
          <span class="settings-label">max_tokens</span>
          <input id="settingsMaxTokens" class="settings-input" type="number" min="64" max="128000" />
        </label>
        <label class="settings-field">
          <span class="settings-label">Max response length (chars)</span>
          <input id="settingsMaxResponseChars" class="settings-input" type="number" min="1000" max="200000" />
        </label>
      </section>
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
          <button type="button" class="settings-modal-tab" data-model-mode="json">JSON</button>
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
          <label class="settings-field">
            <span class="settings-label">Provider</span>
            <select id="modelEditProvider" class="settings-input"></select>
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
        <div class="settings-modal-foot">
          <button type="button" class="text-btn" id="modelEditCancelBtn">Cancel</button>
          <button type="button" class="text-btn settings-modal-done" id="modelEditDoneBtn">Done</button>
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

  <section id="mcpScreen" class="screen" hidden>
    <div class="agents-top">
      <button type="button" class="icon-btn" id="backFromMcpBtn" title="Back to settings" aria-label="Back to settings">
        <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
      </button>
      <div class="agents-title" id="mcpScreenTitle">MCP Servers</div>
    </div>
    <div class="mcp-body" id="mcpBody">
      <p class="mcp-subtitle" id="mcpSubtitle">Manage MCP server configurations used by Harbor Agents.</p>
      <div class="mcp-toolbar">
        <label class="mcp-search">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input id="mcpSearchInput" type="search" placeholder="Search MCP servers..." autocomplete="off" />
        </label>
        <button type="button" class="icon-btn" id="mcpAddBtn" title="Add MCP server" aria-label="Add MCP server">
          <span class="material-symbols-outlined" aria-hidden="true">add</span>
        </button>
      </div>
      <div class="mcp-section-head">
        <h3 class="mcp-section-title" id="mcpConfiguredTitle">Configured MCP servers</h3>
        <span class="mcp-section-count" id="mcpConfiguredCount">0</span>
      </div>
      <div id="mcpServersList" class="mcp-servers-list"></div>
      <div id="mcpEmpty" class="mcp-empty" hidden>No MCP servers yet.</div>
    </div>
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
          <p class="settings-section-note" id="mcpEditNote">Remote OAuth may be blocked for Harbor Agents. Prefer a Personal Access Token.</p>
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
  </section>

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

  <section id="chatScreen" class="screen chat-screen" hidden>
    <div class="chat-top">
      <button type="button" class="icon-btn" id="backToAgentsBtn" title="Back to agents" aria-label="Back to agents">
        <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
      </button>
      <div class="chat-top-text">
        <div id="chatAgentName" class="chat-agent-name">Agent</div>
        <div id="chatTitle" class="chat-title" hidden></div>
      </div>
      <button type="button" class="icon-btn" id="openChatSearchBtn" title="Search chat" aria-label="Search chat">
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
      </button>
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
      <div id="mentionMenu" class="mention-menu" role="listbox" hidden></div>
      <div class="composer" id="composer">
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
