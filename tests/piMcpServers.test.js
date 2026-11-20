const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

// `piTurnRunner` pulls in the runtime config, which loads `vscode` — alias the
// headless stub exactly like scripts/bundle-sidecar.js does.
const OUT = path.join(__dirname, "..", "out");
const stub = require(path.join(OUT, "vscodeHeadlessStub.js"));
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "vscode") return stub;
  return originalLoad.call(this, request, ...rest);
};

const { pickExposedMcpServers } = require(path.join(
  OUT,
  "runtime/piTurnRunner.js"
));

test("native Atlassian servers reach Pi before they connect", () => {
  const ids = pickExposedMcpServers(
    [
      { id: "figma", name: "Figma", enabled: true, state: "connected", toolCount: 47 },
      { id: "jira", name: "Jira", enabled: true, state: "disconnected", toolCount: 0 },
    ],
    // Static tool list: the native client connects on the first call.
    ["jira"]
  ).map((server) => server.id);

  assert.deepEqual(ids, ["figma", "jira"]);
});

test("disabled, errored and tool-less servers stay out", () => {
  const ids = pickExposedMcpServers(
    [
      { id: "figma", name: "Figma", enabled: true, state: "connected", toolCount: 3 },
      { id: "custom", name: "Custom", enabled: true, state: "connected", toolCount: 0 },
      { id: "jira", name: "Jira", enabled: true, state: "error", toolCount: 0 },
      { id: "off", name: "Off", enabled: false, state: "connected", toolCount: 5 },
    ],
    []
  ).map((server) => server.id);

  assert.deepEqual(ids, ["figma"]);
});

test("server names fall back to the id", () => {
  assert.deepEqual(
    pickExposedMcpServers(
      [{ id: "jira", enabled: true, state: "disconnected" }],
      ["jira"]
    ),
    [{ id: "jira", name: "jira" }]
  );
});
