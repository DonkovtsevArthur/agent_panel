const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  LEARNED_ERRORS_RELATIVE_PATH,
  lessonFromPlanQualityReason,
  lessonsFromPlanQualityReasons,
  lessonFromVerificationFailure,
  lessonsFromFutureRuleProse,
  lessonsFromUserCorrection,
  lessonFromDirectiveFix,
  parseLearnedErrorsMarkdown,
  formatLearnedErrorsMarkdown,
  formatLearnedErrorsForSystem,
  mergeLearnedErrors,
  appendLearnedErrors,
  loadLearnedErrors,
} = require("../out/learnedErrors.js");

test("lessonFromPlanQualityReason maps known codes", () => {
  const entry = lessonFromPlanQualityReason("missing_implementation");
  assert.equal(entry.key, "plan_quality:missing_implementation");
  assert.match(entry.lesson, /Implementation/i);
});

test("lessonsFromPlanQualityReasons dedups", () => {
  const lessons = lessonsFromPlanQualityReasons([
    "missing_path_read",
    "missing_path_read",
    "missing_analogue_quote",
  ]);
  assert.equal(lessons.length, 2);
  assert.equal(lessons[0].key, "plan_quality:missing_path_read");
});

test("lessonFromVerificationFailure fingerprints TS codes", () => {
  const a = lessonFromVerificationFailure({
    source: "diagnostics",
    errors: ["src/foo.ts:10: Cannot find name 'x'. TS2304"],
    paths: ["src/foo.ts"],
  });
  const b = lessonFromVerificationFailure({
    source: "diagnostics",
    errors: ["src/foo.ts:99: Cannot find name 'y'. TS2304"],
    paths: ["src/foo.ts"],
  });
  assert.ok(a);
  assert.ok(b);
  assert.equal(a.key, b.key);
  assert.match(a.lesson, /diagnostics/i);
});

test("parse + format round-trip keeps keys", () => {
  const entries = lessonsFromPlanQualityReasons([
    "missing_figma_tools",
    "implementation_api_mismatch",
  ]);
  const md = formatLearnedErrorsMarkdown(entries);
  assert.match(md, /Learned errors/);
  const parsed = parseLearnedErrorsMarkdown(md);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].key, entries[0].key);
  assert.equal(parsed[1].lesson, entries[1].lesson);
});

test("mergeLearnedErrors prefers incoming and caps", () => {
  const older = lessonsFromPlanQualityReasons([
    "missing_steps",
    "missing_grounded_path",
  ]);
  const newer = lessonsFromPlanQualityReasons(["missing_steps"]);
  newer[0] = { ...newer[0], lesson: "UPDATED missing steps lesson" };
  const merged = mergeLearnedErrors(older, newer, { maxEntries: 10 });
  const steps = merged.find((e) => e.key === "plan_quality:missing_steps");
  assert.equal(steps.lesson, "UPDATED missing steps lesson");
  assert.ok(merged.some((e) => e.key === "plan_quality:missing_grounded_path"));
});

test("formatLearnedErrorsForSystem respects charCap", () => {
  const many = lessonsFromPlanQualityReasons([
    "missing_implementation",
    "missing_analogue_quote",
    "missing_path_read",
    "missing_figma_tools",
    "checklist_coverage",
  ]);
  const text = formatLearnedErrorsForSystem(many, 420);
  assert.match(text, /Learned errors/);
  assert.ok(text.length <= 420);
  assert.ok(text.split("\n").length >= 2);
  const tight = formatLearnedErrorsForSystem(many, 40);
  assert.equal(tight, "");
});

test("appendLearnedErrors writes .harbor/learned-errors.md", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "harbor-learned-"));
  try {
    const incoming = lessonsFromPlanQualityReasons([
      "missing_component_api_read",
    ]);
    await appendLearnedErrors(root, incoming);
    const filePath = path.join(root, LEARNED_ERRORS_RELATIVE_PATH);
    const raw = await fs.readFile(filePath, "utf8");
    assert.match(raw, /missing_component_api_read/);
    const loaded = await loadLearnedErrors(root);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].key, "plan_quality:missing_component_api_read");

    await appendLearnedErrors(root, incoming);
    const again = await loadLearnedErrors(root);
    assert.equal(again.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("lessonsFromFutureRuleProse captures labeled rules and mass-format", () => {
  const fromRu = lessonsFromFutureRuleProse(
    "✅ Готово!\n\n**Правило для будущего:** Буду форматировать только конкретный изменённый файл, не весь проект."
  );
  assert.ok(fromRu.length >= 1);
  assert.equal(fromRu[0].kind, "correction");
  assert.match(fromRu[0].lesson, /форматир|Format|Correction/i);

  const fromRollback = lessonsFromFutureRuleProse(
    "Откатил все 330+ файлов после prettier по всему проекту. Больше так не буду."
  );
  assert.ok(
    fromRollback.some((e) =>
      /no-mass-format|Format\/lint only/i.test(e.key + e.lesson)
    )
  );

  assert.deepEqual(lessonsFromFutureRuleProse("Просто ответил без правил."), []);
});

test("lessonsFromUserCorrection captures format-scope complaints", () => {
  const lessons = lessonsFromUserCorrection(
    "Не форматируй весь проект — только изменённый файл"
  );
  assert.ok(lessons.length >= 1);
  assert.ok(lessons.some((e) => e.kind === "correction"));
  assert.ok(
    lessons.some((e) =>
      /Format\/lint only|не форматируй|Correction/i.test(e.lesson)
    )
  );
  const wrap = lessonsFromUserCorrection(
    "не нужно оборачивать layout content он уже есть внутри таблицы"
  );
  assert.ok(
    wrap.some((e) =>
      /no-layoutcontent-around-table|LayoutContent|Do not wrap Table/i.test(
        e.key + e.lesson
      )
    )
  );
  assert.deepEqual(lessonsFromUserCorrection("как работает Agent?"), []);
  assert.deepEqual(lessonsFromUserCorrection("напиши тесты на форму"), []);
});

test("lessonFromDirectiveFix stores arbitrary short user text", () => {
  const entry = lessonFromDirectiveFix(
    "не нужно оборачивать layout content он уже есть внутри таблицы"
  );
  assert.ok(entry);
  assert.equal(entry.kind, "correction");
  assert.match(entry.lesson, /Correction:|оборачив/i);
  assert.equal(lessonFromDirectiveFix(""), null);
});
