const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("selection chat commands are contributed with menus and keybindings", () => {
  const manifest = JSON.parse(read("package.json"));
  const commands = new Set(
    manifest.contributes.commands.map((item) => item.command)
  );
  assert.ok(commands.has("agentPanel.addSelectionToChat"));
  assert.ok(commands.has("agentPanel.addSelectionToNewChat"));
  assert.ok(commands.has("agentPanel.addFileToChat"));
  assert.ok(commands.has("agentPanel.addFileToNewChat"));
  assert.ok(manifest.activationEvents.includes("onStartupFinished"));

  const editorCommands = new Set(
    manifest.contributes.menus["editor/context"].map((item) => item.command)
  );
  assert.ok(editorCommands.has("agentPanel.addSelectionToChat"));
  assert.ok(editorCommands.has("agentPanel.addSelectionToNewChat"));
  assert.ok(editorCommands.has("agentPanel.addFileToChat"));
  assert.ok(editorCommands.has("agentPanel.addFileToNewChat"));

  const explorerCommands = new Set(
    manifest.contributes.menus["explorer/context"].map((item) => item.command)
  );
  assert.ok(explorerCommands.has("agentPanel.addFileToChat"));
  assert.ok(explorerCommands.has("agentPanel.addFileToNewChat"));

  const keybindings = new Map(
    manifest.contributes.keybindings.map((item) => [item.command, item])
  );
  assert.equal(
    keybindings.get("agentPanel.addSelectionToChat").mac,
    "cmd+shift+l"
  );
  assert.equal(
    keybindings.get("agentPanel.addSelectionToNewChat").mac,
    "cmd+alt+shift+l"
  );
  assert.equal(
    keybindings.get("agentPanel.addFileToChat").mac,
    "cmd+shift+h"
  );
  assert.equal(
    keybindings.get("agentPanel.addFileToNewChat").mac,
    "cmd+alt+shift+h"
  );
});

test("selection CodeLens exposes current and new chat actions", () => {
  const source = read("src/selectionCodeLens.ts");
  assert.match(source, /registerCodeLensProvider/);
  assert.match(source, /agentPanel\.addSelectionToChat/);
  assert.match(source, /agentPanel\.addSelectionToNewChat/);
  assert.match(source, /onDidChangeTextEditorSelection/);
});

test("new chat action captures selection before creating the agent", () => {
  const source = read("src/agentPanelProvider.ts");
  const method = source.match(
    /async addSelectionToNewChat\(\): Promise<void> \{([\s\S]*?)\n  \}/
  );
  assert.ok(method);
  const body = method[1];
  const captureAt = body.indexOf("getEditorSelectionPayload()");
  const newChatAt = body.indexOf("this.newChat()");
  const queueAt = body.indexOf("this.queueSelectionForComposer(selection)");
  assert.ok(captureAt >= 0);
  assert.ok(newChatAt > captureAt);
  assert.ok(queueAt > newChatAt);
});

test("add file to chat attaches any on-disk file and captures before new chat", () => {
  const source = read("src/agentPanelProvider.ts");
  assert.match(source, /async addFileToChat\(/);
  assert.match(source, /async addFileToNewChat\(/);
  assert.match(source, /resolveFilesForHarbor/);
  assert.match(source, /attachUrisFromDrop/);
  assert.match(source, /queueFileMentionsForComposer/);

  const method = source.match(
    /async addFileToNewChat\([\s\S]*?\): Promise<void> \{([\s\S]*?)\n  \}/
  );
  assert.ok(method);
  const body = method[1];
  const captureAt = body.indexOf("resolveFilesForHarbor(");
  const newChatAt = body.indexOf("this.newChat()");
  const queueAt = body.indexOf("this.addResolvedFilesToChat(resolved)");
  assert.ok(captureAt >= 0);
  assert.ok(newChatAt > captureAt);
  assert.ok(queueAt > newChatAt);
});

test("editorContext resolves any file URI for Harbor attachments", () => {
  const source = read("src/editorContext.ts");
  assert.match(source, /export function resolveFilesForHarbor/);
  assert.match(source, /fileUris/);
  assert.match(source, /mentionPaths/);
  assert.match(source, /untitled\.\$\{/);
});

test("webview still supports composer file mentions for untitled", () => {
  const source = read("media/panel.js");
  assert.match(source, /function insertComposerMentions/);
  assert.match(source, /case "insertComposerMentions"/);
});
