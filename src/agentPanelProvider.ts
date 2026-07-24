import * as vscode from "vscode";
import { getConfig, getContextWindow } from "./config";
import { runAgentTurn } from "./agentLoop";
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
  models: Array<{ id: string; label?: string; contextWindow?: number }>;
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
  | { type: "send"; text: string; model: string }
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
  | { type: "pickModel" };

const STORAGE_KEY_V1 = "agentPanel.session.v1";
const STORAGE_KEY_V2 = "agentPanel.session.v2";

export class AgentPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "agentPanel.chat";

  private view?: vscode.WebviewView;
  private store!: AgentsStoreV2;
  private history: ChatMessage[] = [];
  private uiMessages: UiMessage[] = [];
  private selectedModel = "";
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
          if (this.store.screen === "settings") {
            this.postSettings();
          }
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
    const model =
      this.selectedModel || config.defaultModel || config.models[0]?.id || "";

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
    const fallbackModel = config.defaultModel || config.models[0]?.id || "";
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
      const model =
        fallbackModel ||
        this.selectedModel ||
        config.defaultModel ||
        config.models[0]?.id ||
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
      this.contextTokens = 0;
      return;
    }
    this.history = chat.history || [];
    this.uiMessages = chat.uiMessages || [];
    this.selectedModel = chat.selectedModel || "";
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
    touchChat(this.store, chatId, {
      selectedModel: this.selectedModel,
      history: this.history,
      uiMessages: this.uiMessages.slice(-200),
      contextTokens: this.contextTokens,
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

  private setStatus(text: string, hidden = false): void {
    this.view?.webview.postMessage({ type: "status", text, hidden });
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

  private postChatScreen(): void {
    const config = getConfig();
    const models = config.models;
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
      uiMessages: this.uiMessages,
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
        this.view?.webview.postMessage({ type: "stopped" });
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
      case "pickModel":
        await this.pickModel();
        break;
      case "send":
        await this.handleSend(message.text, message.model);
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
    const model =
      this.selectedModel || config.defaultModel || config.models[0]?.id || "";
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
    const config = getConfig();
    if (!config.models.length) {
      void vscode.window.showWarningMessage(
        "Список моделей пуст. Добавьте agentPanel.models в Settings."
      );
      return;
    }

    const items = config.models.map((m) => ({
      label: m.label || m.id,
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
      models: config.models,
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

  private async handleSend(text: string, model: string): Promise<void> {
    const config = getConfig();
    if (!config.models.length) {
      this.pushUi("error", "Добавьте модели в settings: agentPanel.models");
      this.view?.webview.postMessage({ type: "idle" });
      return;
    }

    const chosen =
      model ||
      this.selectedModel ||
      config.defaultModel ||
      config.models[0].id;
    this.selectedModel = chosen;
    this.saveSession();

    if (!config.baseUrl) {
      this.pushUi("error", "Укажите agentPanel.baseUrl");
      this.view?.webview.postMessage({ type: "idle" });
      return;
    }

    this.uiMessages.push({ role: "user", text });
    this.saveSession();

    this.abort?.abort();
    this.abort = new AbortController();
    this.setStatus("Думает…");

    const turnEdits: FileEditStat[] = [];

    try {
      this.history = await runAgentTurn({
        model: chosen,
        history: this.history,
        userText: text,
        signal: this.abort.signal,
        callbacks: {
          onPhase: (phase, detail) => {
            if (phase === "done") {
              this.setStatus(detail || "Надумал");
              return;
            }
            this.setStatus(
              detail || (phase === "editing" ? "Редактирует…" : "Думает…")
            );
          },
          onTool: (toolText) => this.pushUi("tool", toolText),
          onFileEdit: (edit) => {
            turnEdits.push(edit);
          },
          onAssistant: (assistantText) => {
            this.uiMessages.push({ role: "assistant", text: assistantText });
            this.saveSession();
            this.view?.webview.postMessage({
              type: "assistantDone",
              text: assistantText,
            });
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
        this.view?.webview.postMessage({ type: "stopped" });
        return;
      }
      const messageText =
        error instanceof Error ? error.message : String(error);
      this.pushUi("error", messageText);
      this.view?.webview.postMessage({ type: "idle" });
    } finally {
      this.abort = undefined;
    }
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
    const models = config.models;
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
        models: config.models.map((m) => ({
          id: m.id,
          label: m.label || "",
          contextWindow: m.contextWindow || undefined,
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
    const models = (Array.isArray(raw.models) ? raw.models : [])
      .map((m) => {
        const id = String(m?.id || "").trim();
        if (!id) {
          return null;
        }
        const label = String(m?.label || "").trim();
        const contextWindow =
          typeof m?.contextWindow === "number" &&
          Number.isFinite(m.contextWindow) &&
          m.contextWindow >= 1024
            ? Math.floor(m.contextWindow)
            : undefined;
        const row: { id: string; label?: string; contextWindow?: number } = {
          id,
        };
        if (label) {
          row.label = label;
        }
        if (contextWindow) {
          row.contextWindow = contextWindow;
        }
        return row;
      })
      .filter((m): m is { id: string; label?: string; contextWindow?: number } =>
        Boolean(m)
      );

    if (!models.length) {
      void vscode.window.showWarningMessage(
        "Нужна хотя бы одна модель с непустым id."
      );
      return;
    }

    const defaultModel = String(raw.defaultModel || "").trim();
    const resolvedDefault = models.some((m) => m.id === defaultModel)
      ? defaultModel
      : models[0].id;

    const clamp = (value: unknown, min: number, max: number, fallback: number) => {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) {
        return fallback;
      }
      return Math.min(max, Math.max(min, Math.floor(n)));
    };

    const cfg = vscode.workspace.getConfiguration("agentPanel");
    const target = vscode.ConfigurationTarget.Global;
    await cfg.update("models", models, target);
    await cfg.update("defaultModel", resolvedDefault, target);
    await cfg.update(
      "defaultContextWindow",
      clamp(raw.defaultContextWindow, 1024, 2_000_000, 128_000),
      target
    );
    await cfg.update("baseUrl", String(raw.baseUrl || "").trim().replace(/\/$/, ""), target);
    await cfg.update("apiKey", String(raw.apiKey || ""), target);
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

    if (!models.some((m) => m.id === this.selectedModel)) {
      this.selectedModel = resolvedDefault;
      this.saveSession();
    }

    this.postModels();
    this.postSettings();
    void vscode.window.showInformationMessage("Настройки Agent Panel сохранены.");
  }

  private async postInit(): Promise<void> {
    const config = getConfig();
    const models = config.models;
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
      uiMessages: this.uiMessages,
      screen: this.store.screen,
      agentName:
        this.store.agents.find((a) => a.id === this.store.activeAgentId)?.name ||
        "Агент",
      chatTitle: getActiveChat(this.store)?.title || "Чат",
      contextUsed: this.contextTokens,
      contextMax: getContextWindow(this.selectedModel),
    });

    this.postAgentsList();
    if (this.store.screen === "chat") {
      this.postChatScreen();
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
    content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
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
      <button type="button" class="text-btn" id="saveSettingsBtn">Сохранить</button>
    </div>
    <div class="settings-body" id="settingsBody">
      <section class="settings-section">
        <h3 class="settings-section-title">Модели</h3>
        <label class="settings-field">
          <span class="settings-label">Модель по умолчанию</span>
          <select id="settingsDefaultModel" class="settings-input"></select>
        </label>
        <label class="settings-field">
          <span class="settings-label">Контекст по умолчанию (токены)</span>
          <input id="settingsDefaultContext" class="settings-input" type="number" min="1024" step="1024" />
        </label>
        <div id="settingsModelsList" class="settings-models"></div>
        <button type="button" class="text-btn settings-add-model" id="addModelBtn">+ Добавить модель</button>
      </section>

      <section class="settings-section">
        <h3 class="settings-section-title">Подключение</h3>
        <label class="settings-field">
          <span class="settings-label">Base URL</span>
          <input id="settingsBaseUrl" class="settings-input" type="text" autocomplete="off" />
        </label>
        <label class="settings-field">
          <span class="settings-label">API Key</span>
          <input id="settingsApiKey" class="settings-input" type="password" autocomplete="off" />
        </label>
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
    <div class="composer-wrap">
      <div id="agentStatus" class="agent-status" hidden></div>
      <div class="composer">
        <textarea id="prompt" placeholder="Задача для агента..." rows="3"></textarea>
        <div class="composer-footer">
          <div class="composer-footer-left">
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
