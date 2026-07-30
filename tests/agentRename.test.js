const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const panel = fs.readFileSync(
  path.resolve(__dirname, "../media/panel.js"),
  "utf8"
);

test("agent list names open chats instead of starting rename", () => {
  const listHandlerStart = panel.indexOf("if (agentsListEl) {");
  const headerHandlerStart = panel.indexOf(
    "if (chatAgentNameEl) {",
    listHandlerStart
  );
  assert.ok(listHandlerStart >= 0 && headerHandlerStart > listHandlerStart);

  const listHandler = panel.slice(listHandlerStart, headerHandlerStart);
  assert.doesNotMatch(listHandler, /startAgentRename/);
  assert.match(listHandler, /type: "openAgent"/);
});
