import * as vscode from "vscode";
import { AgentPanelProvider } from "./agentPanelProvider";
import { startEditorContextTracking } from "./editorContext";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new AgentPanelProvider(context.extensionUri, context);
  startEditorContextTracking(context.subscriptions);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AgentPanelProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    ),
    vscode.commands.registerCommand("agentPanel.open", async () => {
      await vscode.commands.executeCommand("agentPanel.chat.focus");
    }),
    vscode.commands.registerCommand("agentPanel.newChat", () => {
      provider.newChat();
    }),
    vscode.commands.registerCommand("agentPanel.clearChat", () => {
      provider.newChat();
    }),
    { dispose: () => provider.dispose() }
  );
}

export function deactivate(): void {}
