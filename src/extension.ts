import * as vscode from "vscode";
import { AgentPanelProvider } from "./agentPanelProvider";
import { VsCodeHarborCore } from "./vscodeHarborCore";
import { generateCommitMessage } from "./commitMessage";
import { startEditorContextTracking } from "./editorContext";
import { startTerminalOutputTracking } from "./terminalContext";
import { registerGitDiffProvider } from "./gitDiff";
import { initMcpManager } from "./mcpBundle";
import { applyFigmaTlsCaFromSettings } from "./mcp/tlsCa";
import {
  applyHarborTlsPolicy,
  setHarborTlsTrustPrompt,
  type HarborTlsTrustRequest,
} from "./tlsPolicy";
import { getConfig } from "./config";
import { resolveUiLanguage } from "./i18n";
import { registerSelectionCodeLens } from "./selectionCodeLens";
import { ensureFigmaHostInBackground } from "./figmaHostEnsure";
import { seedDefaultHarborSkills } from "./harborSkills";

export function activate(context: vscode.ExtensionContext): void {
  applyFigmaTlsCaFromSettings();
  applyHarborTlsPolicy();
  setHarborTlsTrustPrompt(handleTlsTrustPrompt);
  // Idempotent: copies packaged defaults into ~/.harbor/skills (never overwrites).
  try {
    seedDefaultHarborSkills(context.extensionPath);
  } catch {
    /* ignore seed failures — skills remain optional */
  }
  ensureFigmaHostInBackground(context.extensionPath);
  const mcpManager = initMcpManager(context);

  // Create the HarborCore facade — session persistence, settings, workspace,
  // and turn execution all go through this port abstraction. JetBrains
  // sidecar creates the same surface via startSidecar() + HeadlessPanelHost.
  const harborCore = new VsCodeHarborCore(context, {
    getHistory: () => [],   // wired by provider after construction
    setHistory: () => {},   // wired by provider after construction
  });

  const provider = new AgentPanelProvider(
    context.extensionUri,
    context,
    harborCore
  );

  // Wire the turn runner's history accessors to the provider's live state.
  harborCore.setTurnCallbacks({
    getHistory: () => provider.getHistory(),
    setHistory: (_chatId, history) => provider.setHistory(history),
    getPriorUiMessages: (chatId) => provider.getPriorUiMessages(chatId),
    getLastAgentEditedPaths: (chatId) =>
      provider.getLastAgentEditedPaths(chatId),
  });
  harborCore.setEventHandler((event, params) => {
    provider.handleCoreEvent(event, params);
  });
  startEditorContextTracking(context.subscriptions);
  startTerminalOutputTracking(context.subscriptions);
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
    vscode.commands.registerCommand(
      "agentPanel.openCommitMessageSettings",
      () => {
        provider.openSettingsEditor({ section: "commit" });
      }
    ),
    vscode.commands.registerCommand("agentPanel.newChat", () => {
      provider.newChat();
    }),
    vscode.commands.registerCommand("agentPanel.searchChat", () => {
      void provider.openChatSearch();
    }),
    vscode.commands.registerCommand("agentPanel.toggleFullscreen", () => {
      provider.toggleFullscreenChat();
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

/**
 * Trust-on-first-use consent for internal CAs (tlsPolicy): modal with the
 * chain's identities; "Trust" pins the chain per host, strict validation
 * stays on. Declining keeps the original verification error.
 */
async function handleTlsTrustPrompt(
  req: HarborTlsTrustRequest
): Promise<boolean> {
  let ru = true;
  try {
    ru = resolveUiLanguage(getConfig().language) === "ru";
  } catch {
    /* default to Russian on config errors */
  }
  const accept = ru ? "Доверять" : "Trust";
  const title = req.changed
    ? ru
      ? `Сертификат хоста ${req.host} изменился`
      : `Certificate chain for ${req.host} changed`
    : ru
      ? "Обнаружен внутренний сертификат"
      : "Internal certificate detected";
  const rootLabel = req.rootCn || req.issuerCn;
  const detail = req.changed
    ? ru
      ? `${req.host} предъявляет новую цепочку (CA «${req.issuerCn}», корень «${rootLabel}»), которая не совпадает с сохранённой. Обновить доверие для этого хоста?`
      : `${req.host} now presents a different chain (CA "${req.issuerCn}", root "${rootLabel}") than the pinned one. Update trust for this host?`
    : ru
      ? `${req.host} использует сертификат, подписанный внутренним CA «${req.issuerCn}» (корень: ${rootLabel}), который не входит в доверенные Node. Доверять этому CA только для ${req.host}? Цепочка сохранится в ~/.harbor/certs/pinned/, проверка сертификатов останется включённой.`
      : `${req.host} presents a certificate signed by an internal CA "${req.issuerCn}" (root: ${rootLabel}) that Node does not trust. Trust this CA for ${req.host} only? The chain is pinned under ~/.harbor/certs/pinned/; certificate validation stays on.`;
  const answer = await vscode.window.showWarningMessage(title, {
    modal: true,
    detail,
  }, accept);
  return answer === accept;
}
