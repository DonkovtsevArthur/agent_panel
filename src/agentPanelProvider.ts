import * as vscode from "vscode";
import { getConfig } from "./config";
import { runAgentTurn } from "./agentLoop";
import type { FileEditStat } from "./diffStats";
import { hasUncommittedChanges } from "./gitStatus";
import type { ChatMessage } from "./openaiClient";

type WebviewToHost =
  | { type: "ready" }
  | { type: "send"; text: string; model: string }
  | { type: "stop" }
  | { type: "newChat" }
  | { type: "modelChanged"; model: string }
  | { type: "openFile"; path: string }
  | { type: "openScm" }
  | { type: "openExternal"; url: string }
  | { type: "pickModel" };

interface UiMessage {
  role: "user" | "assistant" | "system" | "tool" | "error" | "review";
  text: string;
}

interface PersistedSession {
  selectedModel: string;
  history: ChatMessage[];
  uiMessages: UiMessage[];
  updatedAt: number;
}

const STORAGE_KEY = "agentPanel.session.v1";

export class AgentPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "agentPanel.chat";

  private view?: vscode.WebviewView;
  private history: ChatMessage[] = [];
  private uiMessages: UiMessage[] = [];
  private selectedModel = "";
  private abort?: AbortController;
  private readonly disposables: vscode.Disposable[] = [];
  private scmRefreshTimer?: ReturnType<typeof setTimeout>;
  private gitApiBound = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {
    this.loadSession();
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

    // Важно: слушатель ДО html, иначе webview успеет послать ready вникуда
    this.disposables.push(
      webviewView.webview.onDidReceiveMessage(async (raw) => {
        const message = raw as WebviewToHost;
        await this.onMessage(message);
      }),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          // не перерисовывать историю — иначе пропадает карточка изменённых файлов
          this.postModels();
          this.scheduleScmRefresh();
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
    // Подстраховка, если ready уже был пропущен
    void this.postInit();
  }

  newChat(): void {
    this.abort?.abort();
    this.abort = undefined;
    this.history = [];
    this.uiMessages = [];
    this.saveSession();
    this.view?.webview.postMessage({ type: "status", text: "", hidden: true });
    this.view?.webview.postMessage({ type: "cleared" });
  }

  clearChat(): void {
    this.newChat();
  }

  dispose(): void {
    this.abort?.abort();
    if (this.scmRefreshTimer) {
      clearTimeout(this.scmRefreshTimer);
    }
    this.saveSession();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private loadSession(): void {
    const stored = this.context.workspaceState.get<PersistedSession>(STORAGE_KEY);
    if (!stored) {
      return;
    }
    this.selectedModel = stored.selectedModel || "";
    this.history = Array.isArray(stored.history) ? stored.history : [];
    this.uiMessages = Array.isArray(stored.uiMessages) ? stored.uiMessages : [];
  }

  private saveSession(): void {
    const session: PersistedSession = {
      selectedModel: this.selectedModel,
      history: this.history,
      uiMessages: this.uiMessages.slice(-200),
      updatedAt: Date.now(),
    };
    void this.context.workspaceState.update(STORAGE_KEY, session);
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
        this.newChat();
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
      void vscode.window.showErrorMessage(`Не удалось открыть ${relativePath}: ${text}`);
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
            this.setStatus(detail || (phase === "editing" ? "Редактирует…" : "Думает…"));
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
                state: { onDidChange: (listener: () => void) => vscode.Disposable };
              }>;
              onDidOpenRepository: (
                listener: (repo: {
                  state: { onDidChange: (listener: () => void) => vscode.Disposable };
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
        // git extension unavailable — visibility/focus refresh still works
      }
    };
    void bind();
  }

  private async refreshReviewScmButtons(): Promise<void> {
    if (!this.view) {
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
    });

    this.scheduleScmRefresh();
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
