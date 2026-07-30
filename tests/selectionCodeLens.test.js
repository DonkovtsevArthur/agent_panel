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
  assert.ok(manifest.activationEvents.includes("onStartupFinished"));

  const editorCommands = new Set(
    manifest.contributes.menus["editor/context"].map((item) => item.command)
  );
  assert.ok(editorCommands.has("agentPanel.addSelectionToChat"));
  assert.ok(editorCommands.has("agentPanel.addSelectionToNewChat"));

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
