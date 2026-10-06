const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

// Configurable `vscode` stub: tests mutate `settings` to drive getConfig().
const settings = {};
const vscodeStub = {
  env: { language: "en" },
  workspace: {
    getConfiguration: () => ({
      get: (key) => settings[key],
      inspect: () => undefined,
    }),
    workspaceFolders: undefined,
  },
  window: {},
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") {
    return vscodeStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { getConfig } = require("../out/config.js");
const {
  harborSubagentsRulesForLanguage,
  appendSubagentsRuntimeNudge,
} = require("../out/i18n.js");
const {
  harborToolApprovalGroup,
  isToolAutoApproved,
  harborClineToolPolicies,
} = require("../out/toolApproval.js");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function withSettings(values, fn) {
  const keys = Object.keys(values);
  for (const k of keys) settings[k] = values[k];
  try {
    return fn();
  } finally {
    for (const k of keys) delete settings[k];
  }
}

test("subagents: enabled by default in package.json and getConfig", () => {
  const pkg = JSON.parse(read("package.json"));
  const prop =
    pkg.contributes.configuration.properties?.["agentPanel.subagents.enabled"] ??
    [].concat(pkg.contributes.configuration)
      .map((c) => c.properties?.["agentPanel.subagents.enabled"])
      .find(Boolean);
  assert.ok(prop, "agentPanel.subagents.enabled must be contributed");
  assert.equal(prop.default, true);
  assert.equal(getConfig().subagents.enabled, true);
  withSettings({ "subagents.enabled": false }, () => {
    assert.equal(getConfig().subagents.enabled, false);
  });
});

test("subagents: rules mention spawn_agent in ru and en", () => {
  for (const lang of ["ru", "en"]) {
    const rules = harborSubagentsRulesForLanguage(lang);
    assert.match(rules, /spawn_agent/);
  }
});

test("subagents: runtime nudge only when enabled", () => {
  assert.equal(appendSubagentsRuntimeNudge("hi", false, "en"), "hi");
  const on = appendSubagentsRuntimeNudge("hi", true, "en");
  assert.ok(on.startsWith("hi\n\n"));
  assert.match(on, /spawn_agent/);
  assert.match(appendSubagentsRuntimeNudge("", true, "ru"), /spawn_agent/);
});

test("subagents: spawn_agent uses the subagents approval group", () => {
  assert.equal(harborToolApprovalGroup("spawn_agent"), "subagents");
  // master on, no override → auto
  assert.equal(isToolAutoApproved("spawn_agent"), true);
  // explicit override wins over master
  withSettings({ "tools.approvals": { subagents: false } }, () => {
    assert.equal(isToolAutoApproved("spawn_agent"), false);
    assert.deepEqual(harborClineToolPolicies().spawn_agent, {
      enabled: true,
      autoApprove: false,
    });
  });
  withSettings(
    { "tools.autoApprove": false, "tools.approvals": { subagents: true } },
    () => {
      assert.equal(isToolAutoApproved("spawn_agent"), true);
      assert.equal(isToolAutoApproved("run_commands"), false);
    }
  );
});

test("subagents: clineRuntime wires the setting into Cline config", () => {
  const js = read("out/clineRuntime.js");
  assert.match(js, /enableSpawnAgent\s*=\s*config\.subagents\.enabled\s*!==\s*false/);
  assert.match(js, /enableSpawnAgent,\s*\n?\s*enableAgentTeams:/);
  assert.match(js, /harborSubagentsRulesForLanguage\)?\s*\(/);
  assert.match(js, /appendSubagentsRuntimeNudge\)?\s*\(/);
});

test("subagents: bundled Cline ships spawn_agent with Harbor extraTools patch", () => {
  const bundle = read("out/clineBundle.js");
  assert.match(bundle, /["']spawn_agent["']/);
  assert.match(bundle, /onSubAgentEvent/);
  // Harbor patch: children get host extraTools (MCP, Figma) concatenated.
  assert.match(
    bundle,
    /Array\.isArray\(\w+\.extraTools\)\s*\?\s*\w+\.extraTools\s*:\s*\[\]/,
    "spawn-tool extraTools patch missing — rebuild after vendor/cline update?"
  );
});
