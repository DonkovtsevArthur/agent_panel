import * as vscode from "vscode";
import { getConfig } from "./config";
import { resolveUiLanguage } from "./i18n";

const REFRESH_DELAY_MS = 75;

function shortcutLabels(): { current: string; fresh: string } {
  if (process.platform === "darwin") {
    return { current: "⇧⌘L", fresh: "⇧⌥⌘L" };
  }
  return {
    current: "Ctrl+Shift+L",
    fresh: "Ctrl+Alt+Shift+L",
  };
}

function actionTitles(): { current: string; fresh: string } {
  const shortcuts = shortcutLabels();
  if (resolveUiLanguage(getConfig().language) === "ru") {
    return {
      current: `Добавить в чат Harbor · ${shortcuts.current}`,
      fresh: `Добавить в новый чат Harbor · ${shortcuts.fresh}`,
    };
  }
  return {
    current: `Add to Chat Harbor · ${shortcuts.current}`,
    fresh: `Add to New Chat Harbor · ${shortcuts.fresh}`,
  };
}

class SelectionCodeLensProvider
  implements vscode.CodeLensProvider, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private refreshTimer?: ReturnType<typeof setTimeout>;

  readonly onDidChangeCodeLenses = this.changeEmitter.event;

  scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.changeEmitter.fire();
    }, REFRESH_DELAY_MS);
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== document.uri.toString()) {
      return [];
    }

    const selection = editor.selection;
    if (selection.isEmpty || !document.getText(selection).trim()) {
      return [];
    }

    const position = selection.start;
    const range = new vscode.Range(position, position);
    const titles = actionTitles();
    return [
      new vscode.CodeLens(range, {
        title: titles.current,
        command: "agentPanel.addSelectionToChat",
      }),
      new vscode.CodeLens(range, {
        title: titles.fresh,
        command: "agentPanel.addSelectionToNewChat",
      }),
    ];
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.changeEmitter.dispose();
  }
}

export function registerSelectionCodeLens(
  subscriptions: { push(...items: vscode.Disposable[]): void }
): void {
  const provider = new SelectionCodeLensProvider();
  subscriptions.push(
    provider,
    vscode.languages.registerCodeLensProvider(
      [{ scheme: "file" }, { scheme: "untitled" }],
      provider
    ),
    vscode.window.onDidChangeTextEditorSelection(() =>
      provider.scheduleRefresh()
    ),
    vscode.window.onDidChangeActiveTextEditor(() => provider.scheduleRefresh()),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === vscode.window.activeTextEditor?.document) {
        provider.scheduleRefresh();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("agentPanel.language")) {
        provider.scheduleRefresh();
      }
    })
  );
}
