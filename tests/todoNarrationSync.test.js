const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const panel = fs.readFileSync(path.join(root, "media/panel.js"), "utf8");

function loadNarrationParser() {
  const start = panel.indexOf("function narrationTodoStepNumber(");
  const end = panel.indexOf("// end narrationTodoStepNumber");
  assert.ok(start > 0 && end > start, "parser source found");
  return new Function(`${panel.slice(start, end)}\nreturn narrationTodoStepNumber;`)();
}

const parse = loadNarrationParser();

test("narration step number: Russian and English forms", () => {
  assert.equal(parse("Шаг 9 — правлю тесты."), 9);
  assert.equal(parse("Шаг 6 — модель. Смотрю импорты и структуру."), 6);
  assert.equal(parse("Готово с API. Шаг 5: маппинг"), 5);
  assert.equal(parse("Шаг 3 из 10 — UI"), 3);
  assert.equal(parse("Step 2: wire the store"), 2);
  assert.equal(parse("Этап 4. Тесты"), 4);
});

test("narration step number: ignores unrelated numbers", () => {
  assert.equal(parse("Правлю 3 файла"), 0);
  assert.equal(parse("шагов осталось 2"), 0);
  assert.equal(parse("Шаг123 — нет"), 0);
  assert.equal(parse(""), 0);
});

test("narration advances the running plan card (wiring)", () => {
  assert.match(panel, /advanceTodoPlanFromNarration\(raw\);/);
  assert.match(panel, /function advanceTodoPlanFromNarration\(text\)/);
  // Forward only and resets the «not updated» edit count.
  assert.match(panel, /target < firstOpen/);
  assert.match(panel, /card\.__harborEditIds = new Set\(\);\n\s+queueTodoDockSync\(\);/);
});

test("agent update_todo rules ask for «Шаг N — …» narration", () => {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "vscode") {
      return {
        env: { language: "en" },
        workspace: { getConfiguration: () => ({ get: () => undefined }) },
        window: {},
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const { harborTodoRulesForLanguage } = require("../out/i18n.js");
    assert.match(harborTodoRulesForLanguage("ru", "agent"), /«Шаг N — …»/);
    assert.match(harborTodoRulesForLanguage("en"), /"Step N — …"/);
    assert.doesNotMatch(harborTodoRulesForLanguage("ru", "plan"), /Шаг N/);
  } finally {
    Module._load = originalLoad;
  }
});

test("plan dock: no rebuild without changes, list scroll survives", () => {
  assert.match(panel, /dock\.__harborDockSig === signature && !dock\.hidden/);
  assert.match(panel, /const prevScroll = prevList \? prevList\.scrollTop : 0;/);
  assert.match(panel, /list\.scrollTop = prevScroll;/);
  assert.match(panel, /todoDockEl\.__harborDockSig = "";/);
});

test("Build handoff bubble: «Show plan» toggles the plan under the chip", () => {
  assert.match(panel, /<div class="plan-implement-plan msg-text">/);
  assert.match(panel, /const isPlan = el\.classList\.contains\("is-plan-implement"\);/);
  assert.match(panel, /!event\.target\.closest\("\.plan-implement-plan"\)/);
  const css = fs.readFileSync(path.join(root, "media/panel.css"), "utf8");
  assert.match(css, /\.msg\.user\.is-plan-implement\.is-long-collapsed \.plan-implement-plan \{\s*display: none;/);
  assert.match(css, /\.msg\.user\.is-plan-implement \.plan-implement-plan \{\s*flex: 1 1 100%;/);
  const ru = (panel.match(/feedShowPlan:/g) || []).length;
  assert.equal(ru, 2);
});

test("sticky question / turn map: Build handoff shows «Build plan · goal», not the marker", () => {
  assert.match(panel, /function feedUserSummary\(msg\)/);
  assert.match(panel, /const raw = feedUserSummary\(msg\);/);
  assert.match(panel, /feedUserSummary\(wrap\.querySelector\("\.msg\.user"\)\)/);
  assert.match(panel, /\\\[\\\[harbor:\[a-z_\]\+\\\]\\\]/);
});
