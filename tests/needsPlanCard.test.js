const test = require("node:test");
const assert = require("node:assert/strict");
const { needsPlanCard } = require("../out/autoMode");

test("short work requests keep the plan card", () => {
  assert.equal(needsPlanCard("сделай ревью кода измененых файлов"), true);
  assert.equal(needsPlanCard("сделай ревью кода изменённых файлов"), true);
  assert.equal(needsPlanCard("review the diff"), true);
  assert.equal(needsPlanCard("отрефактори sessionStore"), true);
  assert.equal(needsPlanCard("почини импорт"), true);
  assert.equal(needsPlanCard("давай обновим"), true);
});

test("short questions and small talk skip the plan card", () => {
  assert.equal(needsPlanCard("что такое ревью?"), false);
  assert.equal(needsPlanCard("объясни этот diff?"), false);
  assert.equal(needsPlanCard("спасибо"), false);
  assert.equal(needsPlanCard("ок, спасибо!"), false);
  assert.equal(needsPlanCard("thanks"), false);
});
