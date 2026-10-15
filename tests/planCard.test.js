const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const panel = read("media/panel.js");
const styles = read("media/panel.css");

/** Pull the self-contained plan summary parser out of the built panel. */
function loadSummarize() {
  const defsStart = panel.indexOf("const PLAN_SECTION_DEFS = [");
  const fnEnd = panel.indexOf("// end summarizePlanMarkdown");
  assert.ok(defsStart > 0 && fnEnd > defsStart, "parser source found");
  const source = panel.slice(defsStart, fnEnd);
  return new Function(`${source}\nreturn summarizePlanMarkdown;`)();
}

const summarize = loadSummarize();

const FULL_RU = [
  "## Цель",
  "Добавить шаблон плана в режим Plan.",
  "",
  "## Контекст",
  "- `src/planImplement.ts:16` — подсказка карточки",
  "",
  "## Шаги",
  "1. Добавить функцию правил в `src/planImplement.ts`.",
  "   - вложенный пункт не считается шагом",
  "2. Подключить в `src/clineRuntime.ts`.",
  "3. Написать тесты.",
  "",
  "## Затронутые файлы",
  "- `src/planImplement.ts` — изменить",
  "- `tests/planModeRules.test.js` — создать",
  "",
  "## Проверка",
  "- `npm test`",
].join("\n");

test("summary: goal, step and file counts from the template", () => {
  const s = summarize(FULL_RU);
  assert.equal(s.goal, "Добавить шаблон плана в режим Plan.");
  assert.equal(s.steps, 3);
  assert.equal(s.files, 2);
  assert.deepEqual(s.missing, []);
});

test("summary: inline goal and missing required sections", () => {
  const s = summarize(
    ["**Goal:** Ship the card", "", "### Steps", "1. a", "2. b"].join("\n")
  );
  assert.equal(s.goal, "Ship the card");
  assert.equal(s.steps, 2);
  assert.deepEqual(s.missing, ["files", "verify"]);
});

test("summary: plan without headings counts numbered steps", () => {
  const s = summarize("Сделаю так:\n1. первое\n2. второе\n3. третье");
  assert.equal(s.steps, 3);
  assert.equal(s.goal, "");
  assert.deepEqual(s.missing, ["goal", "files", "verify"]);
});

test("plan card markup: header facts, actions and states", () => {
  for (const marker of [
    "proposed-plan-goal",
    "proposed-plan-meta",
    "data-plan-action=\"copy\"",
    "data-plan-action=\"build\"",
    "data-plan-action=\"continue\"",
    "proposed-plan-truncated-chip",
    "proposed-plan-edited-chip",
    "proposed-plan-pill",
    "data-plan-action=\"edit\"",
    "data-plan-action=\"complete\"",
    'setAttribute("data-plan-action", "fold")',
  ]) {
    assert.ok(panel.includes(marker), marker);
  }
  assert.match(panel, /renderProposedPlanCard\(String\(body \|\| ""\)\.trim\(\), \{ partial: true \}\)/);
  assert.match(panel, /function syncPlanCardStates\(\)/);
  assert.match(panel, /function setComposerPlanBuild\(planText, show\) \{\n\s+syncPlanCardStates\(\);/);
  assert.match(panel, /case "livePlanStatus":\s+applyLivePlanStatus/);
  assert.match(panel, /decoratePlanSections\(root\);/);
});

test("plan card i18n keys exist in both languages", () => {
  for (const key of [
    "proposedPlanStepsCount",
    "proposedPlanFilesCount",
    "proposedPlanMissing",
    "proposedPlanTruncated",
    "proposedPlanContinue",
    "proposedPlanContinuePrompt",
    "proposedPlanEdited",
    "proposedPlanStatusDone",
    "proposedPlanStatusSuperseded",
    "proposedPlanCopy",
    "proposedPlanStatusReady",
    "proposedPlanContextCount",
    "proposedPlanCompletePrompt",
    "proposedPlanFootHint",
  ]) {
    const hits = panel.match(new RegExp(`\\b${key}:`, "g")) || [];
    assert.equal(hits.length, 2, key);
  }
});

test("ruPlural picks the right Russian form", () => {
  const start = panel.indexOf("function ruPlural(");
  const end = panel.indexOf("const t = (key", start);
  const ruPlural = new Function(`${panel.slice(start, end)}\nreturn ruPlural;`)();
  const forms = ["шаг", "шага", "шагов"];
  assert.equal(ruPlural(1, ...forms), "шаг");
  assert.equal(ruPlural(3, ...forms), "шага");
  assert.equal(ruPlural(5, ...forms), "шагов");
  assert.equal(ruPlural(12, ...forms), "шагов");
  assert.equal(ruPlural(21, ...forms), "шаг");
});

test("plan card styles exist", () => {
  for (const cls of [
    "proposed-plan-goal",
    "proposed-plan-chip",
    "proposed-plan-build",
    "proposed-plan-steps",
    "proposed-plan-files",
  ]) {
    assert.match(styles, new RegExp(`\\.${cls}[\\s,{]`), cls);
  }
});

test("both hosts answer requestLivePlanStatus", () => {
  assert.match(read("src/agentPanelProvider.ts"), /case "requestLivePlanStatus":/);
  assert.match(
    read("jetbrains/src/main/kotlin/com/harbor/agents/HarborHostBridge.kt"),
    /"requestLivePlanStatus" ->/
  );
});

test("todo reminder: Plan mode asks for an exploration checklist", () => {
  const {
    createTodoReminderState,
    todoReminderText,
  } = require("../out/todoReminder.js");
  assert.equal(createTodoReminderState(true, "ru", "plan").planMode, true);
  assert.equal(createTodoReminderState(true, "ru", "agent").planMode, false);
  assert.match(todoReminderText("ru", true), /чек-листом исследования/);
  assert.match(todoReminderText("en", true), /<proposed_plan>/);
  assert.doesNotMatch(todoReminderText("en"), /exploration checklist/);
});

test("plan card v2: sections, path chips, line jump, Edit keeps Plan.md edits", () => {
  for (const fn of ["decoratePlanSections", "chipifyPlanPaths", "groupPlanFiles", "planFileChipHtml", "sendPlanComplete"]) {
    assert.match(panel, new RegExp(`function ${fn}\\(`), fn);
  }
  assert.match(panel, /line > 0 \? \{ type: "openFile", path, line \}/);
  assert.match(panel, /keepExisting,\n/);
  const provider = read("src/agentPanelProvider.ts");
  assert.match(provider, /keepExisting: message\.keepExisting === true/);
  assert.match(provider, /selection: new vscode\.Range\(position, position\)/);
  const kt = read("jetbrains/src/main/kotlin/com/harbor/agents/HarborHostBridge.kt");
  assert.match(kt, /OpenFileDescriptor\(project, vf, line - 1, 0\)/);
  assert.match(read("jetbrains/src/main/kotlin/com/harbor/agents/HarborPlan.kt"), /keepExisting: Boolean = false/);
  for (const cls of ["proposed-plan-sec", "proposed-plan-foot", "plan-file-chip", "proposed-plan-missing", "proposed-plan-files-folder"]) {
    assert.match(styles, new RegExp(`\\.${cls}[\\s,{.:]`), cls);
  }
});

test("path regex splits path and line range", () => {
  const start = panel.indexOf("const PLAN_PATH_LINE_RE =");
  const end = panel.indexOf(";", panel.indexOf("/;", start) ) + 1;
  const re = new Function(`${panel.slice(start, end)}\nreturn PLAN_PATH_LINE_RE;`)();
  const m = re.exec("src/entities/x/model.ts:198-235");
  assert.equal(m[1], "src/entities/x/model.ts");
  assert.equal(m[2], "198");
  assert.equal(m[3], "235");
  assert.equal(re.exec("types.ts")[2], undefined);
});
