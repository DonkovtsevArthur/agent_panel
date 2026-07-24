import * as vscode from "vscode";
import { getConfig } from "./config";
import { runAgentTurn } from "./agentLoop";
import type { FileEditStat } from "./diffStats";
import { hasUncommittedChanges } from "./gitStatus";
import type { ChatMessage } from "./openaiClient";
import {
  AgentsStoreV2,
  UiMessage,
  buildAgentsList,
  createEmptyAgent,
  createEmptyChat,
  deleteAgentFromStore,
  deleteChatFromStore,
  formatListTime,
  getActiveChat,
  migrateToStoreV2,
  touchChat,
} from "./sessionStore";

type WebviewToHost =
  | { type: "ready" }
  | { type: "send"; text: string; model: string }
  | { type: "stop" }
  | { type: "newChat"; agentId?: string }
  | { type: "newAgent" }
  | { type: "openChat"; agentId: string; chatId: string }
  | { type: "toggleAgent"; agentId: string }
  | { type: "showAgents" }
  | { type: "renameAgent"; agentId: string; name: string }
  | { type: "deleteAgent"; agentId: string }
  | { type: "deleteChat"; agentId: string; chatId: string }
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
          this.postModels();
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
        }
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

  /** Новый чат в указанном или текущем агенте (или новый агент, если агентов нет). */
  newChat(agentId?: string): void {
    this.abort?.abort();
    this.abort = undefined;

    const config = getConfig();
    const model =
      this.selectedModel || config.defaultModel || config.models[0]?.id || "";

    let agent = agentId
      ? this.store.agents.find((a) => a.id === agentId)
      : this.store.agents.find((a) => a.id === this.store.activeAgentId);
    if (!agent) {
      const created = createEmptyAgent(model);
      this.store.agents.unshift(created.agent);
      this.store.chats[created.chat.id] = created.chat;
      this.store.activeAgentId = created.agent.id;
      this.store.activeChatId = created.chat.id;
      this.store.expandedAgentIds = [created.agent.id];
      agent = created.agent;
    } else {
      const chat = createEmptyChat(model);
      this.store.chats[chat.id] = chat;
      agent.chatIds.unshift(chat.id);
      agent.updatedAt = chat.updatedAt;
      this.store.activeAgentId = agent.id;
      this.store.activeChatId = chat.id;
      if (!this.store.expandedAgentIds.includes(agent.id)) {
        this.store.expandedAgentIds.push(agent.id);
      }
    }

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
    const globalV2 = this.context.globalState.get(STORAGE_KEY_V2);
    const workspaceV2 = this.context.workspaceState.get(STORAGE_KEY_V2);
    const workspaceV1 = this.context.workspaceState.get(STORAGE_KEY_V1);
    const raw = globalV2 ?? workspaceV2 ?? workspaceV1;
    this.store = migrateToStoreV2(raw, fallbackModel);
    if (!this.store.agents.length) {
      this.store = migrateToStoreV2(undefined, fallbackModel);
    }
    if (!this.store.activeChatId || !this.store.chats[this.store.activeChatId]) {
      const first = this.store.agents[0];
      this.store.activeAgentId = first?.id || "";
      this.store.activeChatId = first?.chatIds[0] || "";
    }
    this.hydrateActiveChat();

    // Перенос со старого workspaceState в глобальное хранилище (переживает перезагрузку ПК).
    if (!globalV2 && (workspaceV2 || workspaceV1)) {
      void this.context.globalState.update(STORAGE_KEY_V2, this.store);
      void this.context.workspaceState.update(STORAGE_KEY_V2, undefined);
      void this.context.workspaceState.update(STORAGE_KEY_V1, undefined);
    }
  }

  private hydrateActiveChat(): void {
    const chat = getActiveChat(this.store);
    if (!chat) {
      this.history = [];
      this.uiMessages = [];
      this.selectedModel = getConfig().defaultModel || "";
      return;
    }
    this.history = chat.history || [];
    this.uiMessages = chat.uiMessages || [];
    this.selectedModel = chat.selectedModel || "";
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
    });
  }

  private saveStore(): void {
    this.persistActiveChat();
    void this.context.globalState.update(STORAGE_KEY_V2, this.store);
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
      open: a.open,
      active: a.active,
      chats: a.chats.map((c) => ({
        id: c.id,
        title: c.title,
        preview: c.preview,
        time: formatListTime(c.updatedAt),
        active: c.active,
      })),
    }));
    this.view?.webview.postMessage({
      type: "agentsList",
      agents: list,
      screen: this.store.screen,
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
      chatTitle: getActiveChat(this.store)?.title || "Чат",
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
        break;
      case "newChat":
        this.newChat(message.agentId);
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
      case "toggleAgent": {
        const id = message.agentId;
        const agent = this.store.agents.find((a) => a.id === id);
        if (!agent || agent.chatIds.length === 0) {
          break;
        }
        const set = new Set(this.store.expandedAgentIds);
        if (set.has(id)) {
          set.delete(id);
        } else {
          set.add(id);
        }
        this.store.expandedAgentIds = [...set];
        this.saveStore();
        this.postAgentsList();
        break;
      }
      case "openChat":
        this.openChat(message.agentId, message.chatId);
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
      case "deleteAgent":
        await this.confirmDeleteAgent(message.agentId);
        break;
      case "deleteChat":
        await this.confirmDeleteChat(message.agentId, message.chatId);
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

  private openChat(agentId: string, chatId: string): void {
    this.abort?.abort();
    this.abort = undefined;
    this.persistActiveChat();

    const agent = this.store.agents.find((a) => a.id === agentId);
    const chat = this.store.chats[chatId];
    if (!agent || !chat || !agent.chatIds.includes(chatId)) {
      return;
    }

    this.store.activeAgentId = agentId;
    this.store.activeChatId = chatId;
    this.setScreen("chat");
    if (!this.store.expandedAgentIds.includes(agentId)) {
      this.store.expandedAgentIds.push(agentId);
    }
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
    this.store.expandedAgentIds = [
      created.agent.id,
      ...this.store.expandedAgentIds.filter((id) => id !== created.agent.id),
    ];
    this.setScreen("chat");
    this.hydrateActiveChat();
    this.saveStore();
    this.postChatScreen();
  }

  private async confirmDeleteAgent(agentId: string): Promise<void> {
    const agent = this.store.agents.find((a) => a.id === agentId);
    if (!agent) {
      return;
    }
    const chatsCount = agent.chatIds.length;
    const detail =
      chatsCount > 0
        ? `Будут удалены все чаты агента (${chatsCount}). Это действие нельзя отменить.`
        : "Это действие нельзя отменить.";
    const answer = await vscode.window.showWarningMessage(
      `Удалить агента «${agent.name}»?`,
      { modal: true, detail },
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
    this.setScreen("agents");
    this.hydrateActiveChat();
    this.saveStore();
    this.postAgentsList();
    this.view?.webview.postMessage({ type: "showAgents" });
  }

  private async confirmDeleteChat(
    agentId: string,
    chatId: string
  ): Promise<void> {
    const agent = this.store.agents.find((a) => a.id === agentId);
    const chat = this.store.chats[chatId];
    if (!agent || !chat || !agent.chatIds.includes(chatId)) {
      return;
    }
    const answer = await vscode.window.showWarningMessage(
      `Удалить чат «${chat.title || "Новый чат"}»?`,
      {
        modal: true,
        detail: "История сообщений будет удалена без возможности восстановления.",
      },
      "Удалить"
    );
    if (answer !== "Удалить") {
      return;
    }

    const wasActive = this.store.activeChatId === chatId;
    if (wasActive) {
      this.abort?.abort();
      this.abort = undefined;
    } else {
      this.persistActiveChat();
    }

    if (!deleteChatFromStore(this.store, agentId, chatId)) {
      return;
    }

    this.setScreen("agents");
    this.hydrateActiveChat();
    this.saveStore();
    this.postAgentsList();
    this.view?.webview.postMessage({ type: "showAgents" });
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
        },
      });
      this.saveSession();
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
    });

    this.postAgentsList();
    if (this.store.screen === "chat") {
      this.view?.webview.postMessage({ type: "showChat" });
      this.scheduleScmRefresh();
    } else {
      this.view?.webview.postMessage({ type: "showAgents" });
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const version =
      vscode.extensions.getExtension("local.vscode-agent-panel")?.packageJSON
        ?.version ?? String(Date.now());
    const cssUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "panel.css"))
      .with({ query: `v=${version}` });
    const jsUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "panel.js"))
      .with({ query: `v=${version}` });
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${cssUri}" />
  <title>Agent Panel</title>
</head>
<body>
  <section id="agentsScreen" class="screen" hidden>
    <div class="agents-top">
      <div class="agents-title">Агенты</div>
      <button type="button" class="icon-btn" id="newAgentBtn" title="Новый агент" aria-label="Новый агент">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <input id="agentsSearch" class="agents-search" type="search" placeholder="Поиск агентов и чатов…" />
    <div id="agentsList" class="agents-list"></div>
  </section>

  <section id="chatScreen" class="screen chat-screen" hidden>
    <div class="chat-top">
      <button type="button" class="icon-btn" id="backToAgentsBtn" title="К списку агентов" aria-label="К списку агентов">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <div class="chat-top-text">
        <div id="chatAgentName" class="chat-agent-name">Агент</div>
        <div id="chatTitle" class="chat-title">Чат</div>
      </div>
    </div>
    <div id="messages"></div>
    <div class="composer-wrap">
      <div id="agentStatus" class="agent-status" hidden></div>
      <div class="composer">
        <textarea id="prompt" placeholder="Задача для агента..." rows="3"></textarea>
        <div class="composer-footer">
          <div class="composer-footer-left">
            <button class="icon-btn" id="newChatBtn" title="Новый чат" aria-label="Новый чат">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </button>
            <div class="model-picker" id="modelPicker">
              <button type="button" class="model-trigger" id="modelTrigger" aria-haspopup="listbox" aria-expanded="false" title="Модель">
                <span class="model-label" id="modelLabel">Модель</span>
                <svg class="model-chevron" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                  <path d="M3 4.5L6 7.5L9 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <div class="model-menu" id="modelMenu" role="listbox" hidden></div>
            </div>
          </div>
          <div class="composer-footer-right">
            <button class="primary" id="sendBtn" title="Отправить" aria-label="Отправить" data-mode="send">
              <svg class="icon-send" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M8 12.5V3.5M8 3.5L4 7.5M8 3.5l4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <svg class="icon-stop" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <rect x="4.5" y="4.5" width="7" height="7" rx="1.2" fill="currentColor"/>
              </svg>
            </button>
          </div>
        </div>
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
