const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

// `config.ts` / `agentRuntime.ts` are imported by the headless host, so they
// need the same `vscode` stub the JetBrains sidecar bundle aliases in
// (scripts/bundle-sidecar.js).
const OUT = path.join(__dirname, "..", "out");
const stub = require(path.join(OUT, "vscodeHeadlessStub.js"));
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "vscode") return stub;
  return originalLoad.call(this, request, ...rest);
};

function runtimeKindWith(settings) {
  stub.HarborHeadless.install({ workspaceRoot: process.cwd(), settings });
  delete require.cache[require.resolve(path.join(OUT, "config.js"))];
  delete require.cache[require.resolve(path.join(OUT, "runtime/agentRuntime.js"))];
  return require(path.join(OUT, "runtime/agentRuntime.js")).agentRuntimeKind();
}

test("agent core defaults to pi when agentPanel.runtime is unset", () => {
  assert.equal(runtimeKindWith({}), "pi");
  assert.equal(runtimeKindWith({ agentPanel: {} }), "pi");
});

test("agentPanel.runtime=cline stays the rollback switch", () => {
  assert.equal(runtimeKindWith({ runtime: "cline" }), "cline");
  assert.equal(runtimeKindWith({ agentPanel: { runtime: "cline" } }), "cline");
});

test("agentPanel.runtime=pi is accepted explicitly", () => {
  assert.equal(runtimeKindWith({ runtime: "pi" }), "pi");
  assert.equal(runtimeKindWith({ agentPanel: { runtime: "pi" } }), "pi");
});

test("package.json ships pi as the default runtime and as a dependency", () => {
  const pkg = require(path.join(__dirname, "..", "package.json"));
  assert.equal(
    pkg.contributes.configuration.properties["agentPanel.runtime"].default,
    "pi"
  );
  assert.ok(
    pkg.dependencies["@earendil-works/pi-coding-agent"],
    "Pi SDK must be a real dependency so the chunk is always in the build"
  );
});

test("piRuntimeStatus sees the compiled chunk (silent Cline fallback only when missing)", () => {
  const { piRuntimeStatus } = require(path.join(OUT, "runtime/piTurnRunner.js"));
  const status = piRuntimeStatus();
  assert.equal(status.available, true, `chunk missing: ${status.reason || ""}`);
  assert.match(status.entry, /pi\.mjs$/);
});
