import * as vscode from "vscode";
import { AgentPanelProvider } from "./agentPanelProvider";
import { generateCommitMessage } from "./commitMessage";
import { startEditorContextTracking } from "./editorContext";
import { registerGitDiffProvider } from "./gitDiff";
import { initMcpManager } from "./mcpBundle";
import { applyFigmaTlsCaFromSettings } from "./mcp/tlsCa";
import { registerSelectionCodeLens } from "./selectionCodeLens";

export function activate(context: vscode.ExtensionContext): void {
  applyFigmaTlsCaFromSettings();
  const mcpManager = initMcpManager(context);
  const provider = new AgentPanelProvider(context.extensionUri, context);
  startEditorContextTracking(context.subscriptions);
  registerGitDiffProvider(context.subscriptions);
  registerSelectionCodeLens(context.subscriptions);

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
    vscode.commands.registerCommand("agentPanel.openSettings", () => {
      provider.openSettingsEditor();
    }),
    vscode.commands.registerCommand("agentPanel.newChat", () => {
      provider.newChat();
    }),
    vscode.commands.registerCommand("agentPanel.clearChat", () => {
      provider.newChat();
    }),
    vscode.commands.registerCommand("agentPanel.pickAttachments", () =>
      provider.pickAttachmentsFromUi()
    ),
    vscode.commands.registerCommand("agentPanel.addSelectionToChat", () =>
      provider.addSelectionToChat()
    ),
    vscode.commands.registerCommand("agentPanel.addSelectionToNewChat", () =>
      provider.addSelectionToNewChat()
    ),
    vscode.commands.registerCommand(
      "agentPanel.addFileToChat",
      (uri?: vscode.Uri, uris?: vscode.Uri[]) => provider.addFileToChat(uri, uris)
    ),
    vscode.commands.registerCommand(
      "agentPanel.addFileToNewChat",
      (uri?: vscode.Uri, uris?: vscode.Uri[]) =>
        provider.addFileToNewChat(uri, uris)
    ),
    vscode.commands.registerCommand(
      "agentPanel.generateCommitMessage",
      (...args: unknown[]) => generateCommitMessage(args[0])
    ),
    { dispose: () => mcpManager.dispose() },
    { dispose: () => provider.dispose() }
  );

  void mcpManager.refreshSecretFlags().then(() => {
    void mcpManager.tryQuietReconnect();
  });
}

export function deactivate(): void {}
