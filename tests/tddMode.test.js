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

const { harborTddModeRulesForLanguage } = require("../out/tddMode.js");

test("TDD rules require red-green-refactor in RU and EN", () => {
  const ru = harborTddModeRulesForLanguage("ru");
  const en = harborTddModeRulesForLanguage("en");
  assert.match(ru, /# Режим: TDD/);
  assert.match(en, /# Mode: TDD/);
  for (const text of [ru, en]) {
    assert.match(text, /red-green-refactor|красный/i);
    assert.match(text, /падающ|failing/i);
    assert.match(text, /зелён|зелен|green/i);
    assert.match(text, /рефактор|refactor/i);
  }
});

test("TDD rules block shipping behavior without a failing test", () => {
  const ru = harborTddModeRulesForLanguage("ru");
  const en = harborTddModeRulesForLanguage("en");
  assert.match(ru, /без теста/);
  assert.match(en, /without a test/);
  assert.match(ru, /Не ослабляй/);
  assert.match(en, /Do not weaken/);
});
