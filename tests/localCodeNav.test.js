const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  looksLikeLocalCodeNavRequest,
  looksLikeFindUsagesRequest,
  looksLikeLocateDefinitionRequest,
  refersToActiveEditorSymbol,
  resolveLocalCodeNavTargets,
  formatLocalCodeNavAnswer,
} = require("../out/localCodeNav.js");

function makeWorkspace(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "local-nav-"));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");
  }
  return root;
}

test("detects definition, usages, and this-component prompts", () => {
  assert.equal(
    looksLikeLocateDefinitionRequest(
      "найди, где определяется resolveSpeedRouting"
    ),
    true
  );
  assert.equal(
    looksLikeFindUsagesRequest("где используется компонент этот в проекте?"),
    true
  );
  assert.equal(
    refersToActiveEditorSymbol("где используется компонент этот в проекте?"),
    true
  );
  assert.equal(
    looksLikeLocalCodeNavRequest("где используется компонент этот в проекте?"),
    true
  );
  assert.equal(
    looksLikeLocalCodeNavRequest("найди Modal в проекте"),
    true
  );
  assert.equal(looksLikeLocalCodeNavRequest("добавь кнопку"), false);
});

test("find intent and short «хочу найти» use history Modal", () => {
  const {
    looksLikeFindIntent,
    looksLikeFindFollowUp,
    extractComponentLikeNames,
    looksLikeLocalCodeNavRequest,
    resolveLocalCodeNavTargets,
  } = require("../out/localCodeNav.js");

  assert.equal(
    looksLikeFindIntent("нужно было найти компонент реактовский"),
    true
  );
  assert.equal(looksLikeFindFollowUp("хочу найти"), true);
  assert.deepEqual(extractComponentLikeNames("найди компонент Modal"), [
    "Modal",
  ]);
  assert.equal(
    looksLikeLocalCodeNavRequest("хочу найти", ["Modal"]),
    true
  );
  const targets = resolveLocalCodeNavTargets("хочу найти", undefined, [
    "Modal",
  ]);
  assert.ok(targets.some((t) => t.query === "Modal"));
  assert.ok(targets.every((t) => t.kind === "definition"));
});

test("resolveLocalCodeNavTargets uses active file for this-component", () => {
  const targets = resolveLocalCodeNavTargets(
    "где используется этот компонент?",
    "src/shared/ui/Modal/Modal.tsx"
  );
  assert.ok(targets.some((t) => t.query === "Modal"));
  assert.ok(targets.every((t) => t.kind === "usages"));
  assert.ok(
    targets.some((t) => t.excludePath === "src/shared/ui/Modal/Modal.tsx")
  );
});

test("extractRecentCodeIdentifiersFromHistory recovers names from prior turns", () => {
  const {
    extractRecentCodeIdentifiersFromHistory,
    resolveLocalCodeNavTargets,
  } = require("../out/localCodeNav.js");

  const hints = extractRecentCodeIdentifiersFromHistory([
    { role: "user", content: "разбери компонент Modal из svs-react-ui" },
    { role: "assistant", content: "Modal рендерит оверлей." },
    { role: "user", content: "где используется компонент этот в проекте?" },
  ]);
  assert.ok(hints.includes("Modal"));

  const targets = resolveLocalCodeNavTargets(
    "где используется компонент этот в проекте?",
    undefined,
    hints
  );
  assert.ok(targets.some((t) => t.query === "Modal"));
  assert.ok(targets.every((t) => t.kind === "usages"));
});

test("history prefers Modal over effector noise for component usages", () => {
  const {
    extractRecentCodeIdentifiersFromHistory,
    resolveLocalCodeNavTargets,
    isNoiseHistoryIdentifier,
  } = require("../out/localCodeNav.js");

  assert.equal(isNoiseHistoryIdentifier("$isOpenModalEdit"), true);
  assert.equal(isNoiseHistoryIdentifier("createEvent"), true);
  assert.equal(isNoiseHistoryIdentifier("Modal"), false);

  const history = [
    { role: "user", content: "найди компонент Modal" },
    { role: "assistant", content: "Смотрю `Modal` из ui-kit." },
    {
      role: "assistant",
      content:
        "Нашёл `$isOpenModalEdit`, `createEvent`, `createStore` в model.ts",
    },
    {
      role: "user",
      content: "найди где используется компонент",
    },
  ];

  const hints = extractRecentCodeIdentifiersFromHistory(history, {
    preferComponents: true,
  });
  assert.ok(hints.includes("Modal"), `hints=${JSON.stringify(hints)}`);
  assert.equal(hints.includes("$isOpenModalEdit"), false);
  assert.equal(hints.includes("createEvent"), false);
  assert.equal(hints.includes("createStore"), false);

  const targets = resolveLocalCodeNavTargets(
    "найди где используется компонент",
    undefined,
    hints
  );
  assert.deepEqual(
    targets.map((t) => t.query),
    ["Modal"]
  );
  assert.ok(targets.every((t) => t.kind === "usages"));
});

test("extractRecentCodeIdentifiersFromHistory reads file path stems", () => {
  const { extractRecentCodeIdentifiersFromHistory } = require("../out/localCodeNav.js");
  const hints = extractRecentCodeIdentifiersFromHistory([
    {
      role: "user",
      content: "посмотри src/shared/ui/work-status/WorkStatus.tsx",
    },
  ]);
  assert.ok(hints.includes("WorkStatus"));
});

test("usages request detects «используется» and filters component noise", () => {
  const {
    looksLikeFindUsagesRequest,
    resolveLocalCodeNavTargets,
    isWholeIdentifierMatch,
    isLikelyComponentUsageLine,
    isNoiseSearchPath,
    formatLocalCodeNavAnswer,
  } = require("../out/localCodeNav.js");

  assert.equal(
    looksLikeFindUsagesRequest(
      "найти в каких компонентах используется компонент Modal"
    ),
    true
  );
  const targets = resolveLocalCodeNavTargets(
    "найти в каких компонентах используется компонент Modal"
  );
  assert.ok(targets.some((t) => t.query === "Modal" && t.kind === "usages"));

  assert.equal(isWholeIdentifierMatch("import { Modal } from 'ui'", "Modal"), true);
  assert.equal(
    isWholeIdentifierMatch("<UnsavedChangesLeaveModal />", "Modal"),
    false
  );
  assert.equal(
    isLikelyComponentUsageLine("import { Modal } from '@svs/ui'", "Modal"),
    true
  );
  assert.equal(
    isLikelyComponentUsageLine("const x = $isOpenModalEdit", "Modal"),
    false
  );
  assert.equal(isNoiseSearchPath("package-lock.json"), true);
  assert.equal(isNoiseSearchPath("src/ui/Modal.tsx"), false);

  const root = makeWorkspace({
    "package.json": '{ "dependencies": { "react-responsive-modal": "1.0.0" } }',
    "package-lock.json": '"react-responsive-modal"',
    "README.md": "- **Modal** - windows",
    "src/a.tsx": "import { Modal } from 'kit'\nexport const A = () => <Modal open />\n",
    "src/b.tsx": "import { UnsavedChangesLeaveModal } from 'x'\n<UnsavedChangesLeaveModal />\n",
    "src/model.ts": "export const $isOpenModalEdit = createStore(false)\n",
  });
  const answer = formatLocalCodeNavAnswer(
    root,
    "найти в каких компонентах используется компонент Modal"
  );
  assert.ok(answer, "expected answer");
  assert.match(answer, /использования/);
  assert.match(answer, /src\/a\.tsx/);
  assert.doesNotMatch(answer, /package-lock/);
  assert.doesNotMatch(answer, /UnsavedChangesLeaveModal/);
  assert.doesNotMatch(answer, /\$isOpenModalEdit/);
  assert.doesNotMatch(answer, /README/);
});
