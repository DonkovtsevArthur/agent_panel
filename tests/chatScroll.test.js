const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const panelSource = fs.readFileSync(
  path.resolve(__dirname, "../media/panel.js"),
  "utf8"
);

function functionBody(name, nextName) {
  const start = panelSource.indexOf(`function ${name}(`);
  const end = panelSource.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start);
  return panelSource.slice(start, end);
}

test("opening and closing message editing preserve chat scroll position", () => {
  const startEditing = functionBody(
    "startEditingUserMessage",
    "cancelEditingUserMessage"
  );
  const cancelEditing = functionBody(
    "cancelEditingUserMessage",
    "submitEditedUserMessage"
  );

  for (const body of [startEditing, cancelEditing]) {
    assert.match(body, /const preservedScrollTop = messagesEl\.scrollTop/);
    assert.match(
      body,
      /renderMessages\(uiMessagesCache, "restore", preservedScrollTop\)/
    );
  }
});
