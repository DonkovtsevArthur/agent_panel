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
import { getConfig, getContextWindow, getEnabledModels, resolveModelEndpoint } from "./config";
import { runAgentTurn } from "./agentLoop";
import type { AgentPhase } from "./agentLoop";
import type { FileEditStat } from "./diffStats";
import { hasUncommittedChanges } from "./gitStatus";
import type { ChatMessage } from "./openaiClient";
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
  getActiveChat,
  migrateToStoreV2,
  restoreAgentInStore,
  touchChat,
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
  }>;
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
};

type WebviewToHost =
  | { type: "ready" }
  | {
      type: "send";
      text: string;
      model: string;
      attachments?: IncomingAttachment[];
    }
  | { type: "regenerate" }
  | {
      type: "editUserMessage";
      index: number;
      text: string;
      model: string;
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
  | { type: "renameAgent"; agentId: string; name: string }
  | { type: "archiveAgent"; agentId: string }
  | { type: "restoreAgent"; agentId: string }
  | { type: "deleteAgent"; agentId: string }
  | { type: "modelChanged"; model: string }
  | { type: "openFile"; path: string }
  | { type: "openScm" }
  | { type: "openExternal"; url: string }
  | { type: "pickModel" }
  | { type: "pickAttachments" }
  | { type: "attachUris"; uris: string[] }
  | { type: "attachFiles"; files: IncomingAttachment[] }
  | { type: "copyText"; text: string };

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
  private abort?: AbortController;
  private readonly disposables: vscode.Disposable[] = [];
  private scmRefreshTimer?: ReturnType<typeof setTimeout>;
  private gitApiBound = false;
  private pendingScmReturnRefresh = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {
    this.loadStore();
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

  /** Новый чат теперь всегда создаёт нового агента. */
  newChat(): void {
    this.abort?.abort();
    this.abort = undefined;

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
    this.abort?.abort();
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

  async pickAttachmentsFromUi(): Promise<void> {
    try {
      const picked = await pickWorkspaceAttachments();
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

  private saveStore(): void {
    this.persistActiveChat();
    if (!this.hasWorkspaceFolder()) {
      return;
    }
    void this.context.workspaceState.update(STORAGE_KEY_V2, this.store);
  }

  private reloadStoreForWorkspace(): void {
    this.abort?.abort();
    this.abort = undefined;
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

  private setStatus(text: string, hidden = false, phase?: AgentPhase): void {
    this.view?.webview.postMessage({ type: "status", text, hidden, phase });
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

  private async postChatScreen(): Promise<void> {
    const config = getConfig();
    const models = getEnabledModels();
    if (!this.selectedModel || !models.some((m) => m.id === this.selectedModel)) {
      this.selectedModel =
        models.find((m) => m.id === config.defaultModel)?.id ??
        models[0]?.id ??
        "";
    }
    const agent = this.store.agents.find((a) => a.id === this.store.activeAgentId);
    this.view?.webview.postMessage({
      type: "showChat",
      models,
      selectedModel: this.selectedModel,
      uiMessages: await this.enrichUiMessages(this.uiMessages),
      canRegenerate: this.canRegenerate(),
      agentId: agent?.id || "",
      agentName: agent?.name || "Агент",
      chatTitle: agent?.name || "Агент",
      contextUsed: this.contextTokens,
      contextMax: getContextWindow(this.selectedModel),
    });
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
        this.abort?.abort();
        this.abort = undefined;
        this.persistActiveChat();
        this.setScreen("agents");
        this.saveStore();
        this.postAgentsList();
        this.view?.webview.postMessage({ type: "showAgents" });
        break;
      case "showArchive":
        this.abort?.abort();
        this.abort = undefined;
        this.persistActiveChat();
        this.setScreen("archive");
        this.saveStore();
        this.postArchiveList();
        this.view?.webview.postMessage({ type: "showArchive" });
        break;
      case "showSettings":
        this.abort?.abort();
        this.abort = undefined;
        this.persistActiveChat();
        this.setScreen("settings");
        this.saveStore();
        this.postSettings();
        this.view?.webview.postMessage({ type: "showSettings" });
        break;
      case "saveSettings":
        await this.saveSettings(message.settings);
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
        this.abort?.abort();
        this.abort = undefined;
        this.setStatus("", true);
        this.postRegenerateState();
        this.view?.webview.postMessage({ type: "stopped" });
        break;
      case "regenerate":
        await this.handleRegenerate();
        break;
      case "editUserMessage":
        await this.handleEditUserMessage(
          Number(message.index),
          String(message.text || ""),
          String(message.model || ""),
          message.attachments
        );
        break;
      case "pickAttachments":
        await this.pickAttachmentsFromUi();
        break;
      case "attachUris":
        try {
          const fromUris = await attachmentsFromUris(
            Array.isArray(message.uris) ? message.uris : []
          );
          if (fromUris.length) {
            const persisted = await persistIncomingAttachments(
              fromUris,
              this.storageUri()
            );
            await this.postAttachments(persisted);
          }
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          void vscode.window.showErrorMessage(text);
        }
        break;
      case "attachFiles":
        try {
          const persisted = await persistIncomingAttachments(
            Array.isArray(message.files) ? message.files : [],
            this.storageUri()
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
      case "pickModel":
        await this.pickModel();
        break;
      case "send":
        await this.handleSend(message.text, message.model, {
          attachments: message.attachments,
        });
        break;
    }
  }

  private openAgent(agentId: string): void {
    this.abort?.abort();
    this.abort = undefined;
    this.persistActiveChat();

    const agent = this.store.agents.find((a) => a.id === agentId);
    const chat = agent ? this.store.chats[agent.chatId] : undefined;
    if (
      !agent ||
      !chat ||
      agent.archivedAt ||
      chat.archivedAt
    ) {
      return;
    }

    this.store.activeAgentId = agentId;
    this.store.activeChatId = agent.chatId;
    this.setScreen("chat");
    this.hydrateActiveChat();
    this.saveStore();
    this.postChatScreen();
  }

  private async createAgent(): Promise<void> {
    const name = await vscode.window.showInputBox({
      title: "Новый агент",
      prompt: "Имя агента",
      value: "Новый агент",
      ignoreFocusOut: true,
    });
    if (name === undefined) {
      return;
    }

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
    created.agent.name = name.trim() || "Новый агент";
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
      `Архивировать агента «${agent.name}»?`,
      {
        modal: true,
        detail: "Агента можно будет восстановить из архива позже.",
      },
      "В архив"
    );
    if (answer !== "В архив") {
      return;
    }

    this.abort?.abort();
    this.abort = undefined;
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
    const chat = this.store.chats[agent.chatId];
    const empty = !chatHasMessages(chat?.uiMessages);
    const answer = await vscode.window.showWarningMessage(
      empty
        ? `Удалить пустого агента «${agent.name}»?`
        : `Удалить «${agent.name}» безвозвратно?`,
      {
        modal: true,
        detail: empty
          ? "Сообщений нет — агент будет удалён без архива."
          : "История сообщений будет удалена без возможности восстановления.",
      },
      "Удалить"
    );
    if (answer !== "Удалить") {
      return;
    }

    this.abort?.abort();
    this.abort = undefined;
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
        "Нет включённых моделей. Включите модели в настройках Agent Panel."
      );
      return;
    }

    const items = models.map((m) => ({
      label: `${m.favorite === true ? "$(heart-filled) " : ""}${m.label || m.id}`,
      description: m.id === this.selectedModel ? "текущая" : m.id,
      id: m.id,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      title: "Модель агента",
      placeHolder: "Выберите модель",
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
        `Не удалось открыть ${relativePath}: ${text}`
      );
    }
  }

  private async handleSend(
    text: string,
    model: string,
    options?: { appendUser?: boolean; attachments?: IncomingAttachment[] }
  ): Promise<void> {
    const config = getConfig();
    const enabledModels = getEnabledModels();
    if (!enabledModels.length) {
      this.pushUi(
        "error",
        "Нет включённых моделей. Включите модели в настройках Agent Panel."
      );
      this.view?.webview.postMessage({ type: "idle" });
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
      this.pushUi("error", messageText);
      this.view?.webview.postMessage({ type: "idle" });
      return;
    }

    const trimmed = String(text || "").trim();
    if (!trimmed && !attachments.length) {
      this.view?.webview.postMessage({ type: "idle" });
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
    this.selectedModel = chosen;
    this.saveSession();

    const endpoint = resolveModelEndpoint(chosen);
    if (!endpoint.baseUrl) {
      this.pushUi(
        "error",
        `Не задан base URL для «${endpoint.providerName}». Добавьте провайдера в настройках.`
      );
      this.view?.webview.postMessage({ type: "idle" });
      return;
    }

    if (options?.appendUser !== false) {
      const uiMsg: UiMessage = { role: "user", text: trimmed };
      if (attachments.length) {
        uiMsg.attachments = attachments.map(stripAttachmentPayload);
      }
      this.uiMessages.push(uiMsg);
      this.saveSession();
    }

    this.abort?.abort();
    this.abort = new AbortController();
    this.setStatus("Думает…", false, "thinking");

    const turnEdits: FileEditStat[] = [];

    try {
      this.history = await runAgentTurn({
        model: chosen,
        history: this.history,
        userText: trimmed,
        attachments,
        storageUri: this.storageUri(),
        signal: this.abort.signal,
        callbacks: {
          onPhase: (phase, detail) => {
            const fallback =
              phase === "done"
                ? "Надумал"
                : phase === "editing"
                  ? "Редактирует…"
                  : phase === "reading"
                    ? "Читает…"
                    : phase === "listing"
                      ? "Смотрит…"
                      : phase === "running"
                        ? "Запускает…"
                        : "Думает…";
            this.setStatus(detail || fallback, false, phase);
          },
          onTool: (toolText) => this.pushUi("tool", toolText),
          onFileEdit: (edit) => {
            turnEdits.push(edit);
          },
          onAssistant: (assistantText) => {
            this.lastTurnModel = chosen;
            this.uiMessages.push({ role: "assistant", text: assistantText });
            this.saveSession();
            this.view?.webview.postMessage({
              type: "assistantDone",
              text: assistantText,
            });
            this.postRegenerateState();
          },
          onReview: (edits) => {
            void this.publishReview(edits.length ? edits : turnEdits);
          },
          onUsage: (usage) => {
            this.contextTokens = usage.used;
            this.saveSession();
            this.postContextUsage();
          },
        },
      });
      this.saveSession();
      this.postContextUsage();
    } catch (error) {
      this.setStatus("", true);
      if (
        this.abort.signal.aborted ||
        (error instanceof Error && error.message === "aborted")
      ) {
        this.postRegenerateState();
        this.view?.webview.postMessage({ type: "stopped" });
        return;
      }
      const messageText =
        error instanceof Error ? error.message : String(error);
      this.pushUi("error", messageText);
      this.postRegenerateState();
      this.view?.webview.postMessage({ type: "idle" });
    } finally {
      this.abort = undefined;
    }
  }

  private async handleRegenerate(): Promise<void> {
    const state = this.getRegenerateState();
    if (!state) {
      this.postRegenerateState();
      this.view?.webview.postMessage({ type: "idle" });
      return;
    }

    this.abort?.abort();
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
    });
  }

  private async handleEditUserMessage(
    index: number,
    text: string,
    model: string,
    incomingAttachments?: IncomingAttachment[]
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
      this.view?.webview.postMessage({ type: "idle" });
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
      this.pushUi("error", messageText);
      this.view?.webview.postMessage({ type: "idle" });
      return;
    }

    if (!nextText && !attachments.length) {
      this.postRegenerateState();
      this.view?.webview.postMessage({ type: "idle" });
      return;
    }

    let userOrdinal = 0;
    for (let i = 0; i < index; i++) {
      if (this.uiMessages[i]?.role === "user") {
        userOrdinal += 1;
      }
    }

    this.abort?.abort();
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
    });
  }

  private async publishReview(edits: FileEditStat[]): Promise<void> {
    const unique = mergeEdits(edits).filter((e) => Boolean(e.path));
    if (!unique.length) {
      this.setStatus("", true);
      return;
    }

    const showScm = await hasUncommittedChanges(unique.map((f) => f.path));
    const payload = JSON.stringify({ files: unique, showScm });
    this.uiMessages.push({ role: "review", text: payload });
    this.saveSession();
    this.view?.webview.postMessage({
      type: "review",
      files: unique,
      showScm,
    });
    this.setStatus("", true);
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
        })),
        defaultModel: config.defaultModel,
        defaultContextWindow: config.defaultContextWindow,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        rejectUnauthorized: config.rejectUnauthorized,
        caBundlePath: config.caBundlePath,
        systemPrompt: config.systemPrompt,
        maxToolRounds: config.maxToolRounds,
        maxTokens: config.maxTokens,
        maxResponseChars: config.maxResponseChars,
      },
    });
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
        "Нужен хотя бы один провайдер с id и base URL."
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
        } => Boolean(m)
      );

    if (!models.length) {
      void vscode.window.showWarningMessage(
        "Нужна хотя бы одна модель с непустым id."
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

    if (
      !enabledModels.some((m) => m.id === this.selectedModel)
    ) {
      this.selectedModel = resolvedDefault;
      this.saveSession();
    }

    this.postModels();
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
      canRegenerate: this.canRegenerate(),
      screen: this.store.screen,
      agentId: this.store.activeAgentId || "",
      agentName:
        this.store.agents.find((a) => a.id === this.store.activeAgentId)?.name ||
        "Агент",
      chatTitle: getActiveChat(this.store)?.title || "Чат",
      contextUsed: this.contextTokens,
      contextMax: getContextWindow(this.selectedModel),
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
  }

  private getHtml(webview: vscode.Webview): string {
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
<html lang="ru">
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
  <title>Agent Panel</title>
</head>
<body>
  <section id="agentsScreen" class="screen" hidden>
    <div class="agents-top">
      <div class="agents-title">Агенты</div>
      <button type="button" class="icon-btn" id="openSettingsBtn" title="Настройки" aria-label="Настройки">
        <span class="material-symbols-outlined" aria-hidden="true">settings</span>
      </button>
      <button type="button" class="icon-btn" id="openArchiveBtn" title="Архив" aria-label="Архив">
        <span class="material-symbols-outlined" aria-hidden="true">inventory_2</span>
      </button>
      <button type="button" class="icon-btn" id="newAgentBtn" title="Новый агент" aria-label="Новый агент">
        <span class="material-symbols-outlined" aria-hidden="true">add</span>
      </button>
    </div>
    <div id="agentsList" class="agents-list"></div>
  </section>

  <section id="archiveScreen" class="screen" hidden>
    <div class="agents-top">
      <button type="button" class="icon-btn" id="backFromArchiveBtn" title="К списку агентов" aria-label="К списку агентов">
        <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
      </button>
      <div class="agents-title">Архив</div>
    </div>
    <div id="archiveList" class="agents-list"></div>
  </section>

  <section id="settingsScreen" class="screen" hidden>
    <div class="agents-top">
      <button type="button" class="icon-btn" id="backFromSettingsBtn" title="К списку агентов" aria-label="К списку агентов">
        <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
      </button>
      <div class="agents-title">Настройки</div>
      <div id="settingsSaveStatus" class="settings-save-status" hidden>Сохранено</div>
    </div>
    <div class="settings-body" id="settingsBody">
      <section class="settings-section">
        <h3 class="settings-section-title">Провайдеры</h3>
        <p class="settings-section-note">Base URL и API key для каждого OpenAI-compatible API. Модель выбирает провайдера в карточке.</p>
        <div id="settingsProvidersList" class="settings-models"></div>
        <button type="button" class="text-btn settings-add-model" id="addProviderBtn">+ Провайдер</button>
        <div id="settingsProvidersHint" class="settings-hint" hidden></div>
      </section>

      <section class="settings-section">
        <h3 class="settings-section-title">Модели</h3>
        <label class="settings-field">
          <span class="settings-label">Модель по умолчанию</span>
          <select id="settingsDefaultModel" class="settings-input"></select>
        </label>

        <div id="settingsModelsList" class="settings-models"></div>
        <button type="button" class="text-btn settings-add-model" id="addModelBtn">+ Добавить</button>
        <div id="settingsModelsHint" class="settings-hint" hidden></div>
      </section>

      <section class="settings-section">
        <h3 class="settings-section-title">TLS</h3>
        <label class="settings-field settings-check">
          <input id="settingsRejectUnauthorized" type="checkbox" />
          <span class="settings-label">Проверять TLS-сертификат</span>
        </label>
        <label class="settings-field">
          <span class="settings-label">CA bundle path</span>
          <input id="settingsCaBundle" class="settings-input" type="text" autocomplete="off" />
        </label>
      </section>

      <section class="settings-section">
        <h3 class="settings-section-title">Поведение агента</h3>
        <label class="settings-field">
          <span class="settings-label">Системный промпт</span>
          <textarea id="settingsSystemPrompt" class="settings-input settings-textarea" rows="6"></textarea>
        </label>
        <label class="settings-field">
          <span class="settings-label">Макс. раундов tools</span>
          <input id="settingsMaxToolRounds" class="settings-input" type="number" min="1" max="50" />
        </label>
        <label class="settings-field">
          <span class="settings-label">max_tokens</span>
          <input id="settingsMaxTokens" class="settings-input" type="number" min="64" max="128000" />
        </label>
        <label class="settings-field">
          <span class="settings-label">Макс. длина ответа (символы)</span>
          <input id="settingsMaxResponseChars" class="settings-input" type="number" min="1000" max="200000" />
        </label>
      </section>
    </div>
    <div id="modelEditModal" class="settings-modal" hidden>
      <div class="settings-modal-backdrop" data-modal-dismiss="1"></div>
      <div class="settings-modal-card" role="dialog" aria-modal="true" aria-labelledby="modelEditTitle">
        <div class="settings-modal-head">
          <h3 id="modelEditTitle" class="settings-modal-title">Модель</h3>
          <button type="button" class="icon-btn" id="modelEditCloseBtn" title="Закрыть" aria-label="Закрыть">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
        <div class="settings-modal-tabs" id="modelEditTabs" hidden>
          <button type="button" class="settings-modal-tab is-active" data-model-mode="manual">Вручную</button>
          <button type="button" class="settings-modal-tab" data-model-mode="json">JSON</button>
        </div>
        <div class="settings-modal-body" id="modelEditManualPane">
          <label class="settings-field">
            <span class="settings-label">ID</span>
            <input id="modelEditId" class="settings-input" type="text" placeholder="как в API, напр. gpt-4.1" />
          </label>
          <label class="settings-field">
            <span class="settings-label">Название</span>
            <input id="modelEditLabel" class="settings-input" type="text" placeholder="как видно в списке" />
          </label>
          <label class="settings-field">
            <span class="settings-label">Провайдер</span>
            <select id="modelEditProvider" class="settings-input"></select>
          </label>
          <div class="settings-model-limits">
            <label class="settings-field">
              <span class="settings-label">Контекст (вход)</span>
              <input id="modelEditContext" class="settings-input" type="number" min="1024" step="1024" placeholder="max_input" />
            </label>
            <label class="settings-field">
              <span class="settings-label">Ответ (выход)</span>
              <input id="modelEditOutput" class="settings-input" type="number" min="1" step="1024" placeholder="max_output" />
            </label>
          </div>
        </div>
        <div class="settings-modal-body" id="modelEditJsonPane" hidden>
          <label class="settings-field">
            <span class="settings-label">JSON список моделей</span>
            <textarea id="settingsModelsJson" class="settings-input settings-textarea settings-json-textarea" rows="8" placeholder='["gpt-4.1", {"model":"claude-sonnet-4-5","name":"Claude","context_window":200000}]'></textarea>
          </label>
          <div class="settings-json-actions">
            <button type="button" class="text-btn" id="exportModelsJsonBtn">Скопировать текущий список</button>
          </div>
          <div id="settingsJsonHint" class="settings-hint" hidden></div>
        </div>
        <div class="settings-modal-foot">
          <button type="button" class="text-btn" id="modelEditCancelBtn">Отмена</button>
          <button type="button" class="text-btn settings-modal-done" id="modelEditDoneBtn">Готово</button>
        </div>
      </div>
    </div>
    <div id="providerEditModal" class="settings-modal" hidden>
      <div class="settings-modal-backdrop" data-provider-dismiss="1"></div>
      <div class="settings-modal-card" role="dialog" aria-modal="true" aria-labelledby="providerEditTitle">
        <div class="settings-modal-head">
          <h3 id="providerEditTitle" class="settings-modal-title">Провайдер</h3>
          <button type="button" class="icon-btn" id="providerEditCloseBtn" title="Закрыть" aria-label="Закрыть">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
        <div class="settings-modal-body">
          <label class="settings-field">
            <span class="settings-label">ID</span>
            <input id="providerEditId" class="settings-input" type="text" placeholder="zai, kimi, openai…" />
          </label>
          <label class="settings-field">
            <span class="settings-label">Название</span>
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
          <button type="button" class="text-btn" id="providerEditCancelBtn">Отмена</button>
          <button type="button" class="text-btn settings-modal-done" id="providerEditDoneBtn">Готово</button>
        </div>
      </div>
    </div>
  </section>

  <section id="chatScreen" class="screen chat-screen" hidden>
    <div class="chat-top">
      <button type="button" class="icon-btn" id="backToAgentsBtn" title="К списку агентов" aria-label="К списку агентов">
        <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
      </button>
      <div class="chat-top-text">
        <div id="chatAgentName" class="chat-agent-name">Агент</div>
        <div id="chatTitle" class="chat-title" hidden></div>
      </div>
    </div>
    <div id="messages"></div>
    <div class="composer-wrap" id="composerWrap">
      <div class="composer" id="composer">
        <div id="attachPreview" class="attach-preview" hidden></div>
        <textarea id="prompt" placeholder="Задача для агента..." rows="3"></textarea>
        <div class="composer-footer">
          <div class="composer-footer-left">
            <button class="icon-btn" id="attachBtn" title="Прикрепить файл" aria-label="Прикрепить файл">
              <span class="material-symbols-outlined" aria-hidden="true">attach_file</span>
            </button>
            <button class="icon-btn" id="newChatBtn" title="Новый агент" aria-label="Новый агент">
              <span class="material-symbols-outlined" aria-hidden="true">add</span>
            </button>
            <div class="model-picker" id="modelPicker">
              <button type="button" class="model-trigger" id="modelTrigger" aria-haspopup="listbox" aria-expanded="false" title="Модель">
                <span class="model-label" id="modelLabel">Модель</span>
                <span class="material-symbols-outlined model-chevron" aria-hidden="true">expand_more</span>
              </button>
              <div class="model-menu" id="modelMenu" role="listbox" hidden></div>
            </div>
          </div>
          <div class="composer-footer-right">
            <button class="primary" id="sendBtn" title="Отправить" aria-label="Отправить" data-mode="send">
              <span class="material-symbols-outlined icon-send" aria-hidden="true">arrow_upward</span>
              <span class="material-symbols-outlined icon-stop" aria-hidden="true">stop</span>
            </button>
          </div>
        </div>
        <div id="composerDropHint" class="composer-drop-hint" hidden>
          <span class="composer-drop-hint-text">Отпустите файл, чтобы прикрепить</span>
        </div>
      </div>
      <div class="composer-meta">
        <button type="button" class="context-meter" id="contextRing" aria-label="Использование контекста">
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
