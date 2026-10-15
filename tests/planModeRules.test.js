const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const vscodeStub = {
  env: { language: "en" },
  workspace: {
    getConfiguration: () => ({ get: () => undefined, inspect: () => undefined }),
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

const { harborPlanModeRulesForLanguage } = require("../out/planImplement.js");
const {
  harborTodoRulesForLanguage,
  harborTodoUserNudgeForLanguage,
  appendTodoRuntimeNudge,
} = require("../out/i18n.js");

test("Plan rules point to Build instead of the Act toggle", () => {
  const ru = harborPlanModeRulesForLanguage("ru");
  const en = harborPlanModeRulesForLanguage("en");
  assert.match(ru, /«Собрать»/);
  assert.match(en, /"Build"/);
  for (const text of [ru, en]) {
    assert.match(text, /toggle to Act mode/);
    assert.match(text, /<proposed_plan>/);
  }
});

test("Plan rules carry the required template sections", () => {
  const ru = harborPlanModeRulesForLanguage("ru");
  for (const heading of ["## Цель", "## Шаги", "## Затронутые файлы", "## Проверка"]) {
    assert.ok(ru.includes(`\`${heading}\` (обязательно)`), heading);
  }
  const en = harborPlanModeRulesForLanguage("en");
  for (const heading of ["## Goal", "## Steps", "## Affected files", "## Verification"]) {
    assert.ok(en.includes(`\`${heading}\` (required)`), heading);
  }
  assert.match(ru, /path:line/);
  assert.match(ru, /короткого заголовка жирным/);
  assert.match(en, /short bold title/);
  assert.match(en, /self-contained/);
});

test("update_todo rules: Plan keeps the plan in <proposed_plan>", () => {
  const plan = harborTodoRulesForLanguage("ru", "plan");
  assert.match(plan, /<proposed_plan>/);
  assert.doesNotMatch(plan, /НЕ дублируй его текстом/);
  const agent = harborTodoRulesForLanguage("ru", "agent");
  assert.match(agent, /НЕ дублируй его текстом/);
  assert.equal(harborTodoRulesForLanguage("en"), harborTodoRulesForLanguage("en", "agent"));
});

test("update_todo nudge: Plan does not say «execute immediately»", () => {
  assert.doesNotMatch(harborTodoUserNudgeForLanguage("en", "plan"), /execute immediately/);
  assert.match(harborTodoUserNudgeForLanguage("en"), /execute immediately/);
  const out = appendTodoRuntimeNudge("task", true, "ru", "plan");
  assert.ok(out.startsWith("task\n\n[Harbor]"));
  assert.match(out, /исследования/);
});
