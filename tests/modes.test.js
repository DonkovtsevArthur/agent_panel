const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

// modes.ts imports `vscode` (only for the UI-language lookup). Provide a tiny
// stub so the compiled module can be loaded under plain Node.
const vscodeStub = {
  env: { language: "en" },
  workspace: { getConfiguration: () => ({ get: () => undefined }) },
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") {
    return vscodeStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  BUILTIN_MODES,
  slugifyModeId,
  normalizeToolsPolicy,
  normalizeModeColor,
  parseCustomModes,
  mergeModes,
  resolveMode,
  isReadonlyPolicy,
} = require("../out/modes.js");

test("builtin modes: Agent edits, Plan/Ask are read-only", () => {
  const byId = Object.fromEntries(BUILTIN_MODES.map((m) => [m.id, m]));
  assert.deepEqual(Object.keys(byId).sort(), ["agent", "ask", "auto", "plan"]);
  assert.equal(byId.agent.tools, "agent");
  assert.equal(byId.plan.tools, "readonly");
  assert.equal(byId.ask.tools, "readonly");
  assert.ok(isReadonlyPolicy(byId.plan.tools));
  assert.ok(!isReadonlyPolicy(byId.agent.tools));
});

test("slugifyModeId transliterates Cyrillic and strips junk", () => {
  assert.equal(slugifyModeId("Code Review!"), "code-review");
  assert.equal(slugifyModeId("Ревью кода"), "revyu-koda");
  assert.match(slugifyModeId("!!!"), /^mode-/);
});

test("normalizeToolsPolicy defaults to agent", () => {
  assert.equal(normalizeToolsPolicy("readonly"), "readonly");
  assert.equal(normalizeToolsPolicy("anything"), "agent");
  assert.equal(normalizeToolsPolicy(undefined), "agent");
});

test("normalizeModeColor expands #rgb and rejects invalid", () => {
  assert.equal(normalizeModeColor("#ABC"), "#aabbcc");
  assert.equal(normalizeModeColor("#00FF7f"), "#00ff7f");
  assert.equal(normalizeModeColor("red"), undefined);
  assert.equal(normalizeModeColor(""), undefined);
});

test("parseCustomModes skips invalid rows and dedupes ids", () => {
  const modes = parseCustomModes([
    null,
    { id: "x" },
    { label: "Review", tools: "readonly", color: "#f00", prompt: "  be strict " },
    { id: "review", label: "Duplicate" },
    { id: "plan", label: "My Plan" },
  ]);
  assert.equal(modes.length, 2);
  assert.deepEqual(modes[0], {
    id: "review",
    label: "Review",
    tools: "readonly",
    prompt: "be strict",
    color: "#ff0000",
  });
  assert.equal(modes[1].builtin, true);
  assert.deepEqual(parseCustomModes("not an array"), []);
});

test("mergeModes overrides builtins, hides disabled, appends custom", () => {
  const merged = mergeModes([
    { id: "plan", label: "Планирование", tools: "readonly", color: "#123" },
    { id: "ask", label: "Ask", tools: "readonly", enabled: false },
    { id: "review", label: "Review", tools: "readonly" },
    { id: "off", label: "Off", tools: "agent", enabled: false },
  ]);
  const ids = merged.map((m) => m.id);
  assert.deepEqual(ids, ["agent", "plan", "auto", "review"]);
  const plan = merged.find((m) => m.id === "plan");
  assert.equal(plan.label, "Планирование");
  assert.equal(plan.color, "#112233");
  assert.equal(plan.builtin, true);
});

test("resolveMode falls back to Agent for unknown ids", () => {
  assert.equal(resolveMode("plan").id, "plan");
  assert.equal(resolveMode(" ask ").id, "ask");
  assert.equal(resolveMode("missing").id, "agent");
  assert.equal(resolveMode(42).id, "agent");
  assert.equal(
    resolveMode("review", [{ id: "review", label: "Review", tools: "readonly" }]).id,
    "review"
  );
});
