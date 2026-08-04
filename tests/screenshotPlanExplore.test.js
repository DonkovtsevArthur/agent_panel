const test = require("node:test");
const assert = require("node:assert/strict");

const {
  HARBOR_SCREENSHOT_EXPLORE_MARKER,
  extractOcrBriefForExplore,
  buildScreenshotExploreProbeTask,
  formatScreenshotExploreSummary,
} = require("../out/screenshotPlanExplore.js");

const SAMPLE_OCR = [
  "[Harbor vision helper · Gemini]",
  "",
  "## Visible UI (from screenshot)",
  "Title: Удостоверение",
  "Columns: ФИО, Профессия, Вид работ",
  "Actions: Скачать, Распечатать",
  "",
  "## Accompanying MCP text",
  "noise that should be dropped from brief when Visible UI exists",
].join("\n");

test("extractOcrBriefForExplore prefers Visible UI and caps length", () => {
  const brief = extractOcrBriefForExplore(SAMPLE_OCR);
  assert.match(brief, /Title: Удостоверение/);
  assert.match(brief, /Вид работ/);
  assert.doesNotMatch(brief, /Accompanying MCP/);
  assert.doesNotMatch(brief, /Harbor vision helper/);

  const long = "Title: X\n" + "Y".repeat(5_000);
  const capped = extractOcrBriefForExplore(
    `## Visible UI (from screenshot)\n${long}`,
    200
  );
  assert.ok(capped.length <= 220);
  assert.match(capped, /…$/);
});

test("buildScreenshotExploreProbeTask includes OCR Title and probe focus", () => {
  const brief = extractOcrBriefForExplore(SAMPLE_OCR);
  const ui = buildScreenshotExploreProbeTask("ui-api", brief);
  assert.match(ui, /match:full|Folder name/i);
  assert.match(ui, /Удостоверение/);
  assert.match(ui, /shared\/ui/i);
  assert.match(ui, /Do NOT write a <proposed_plan>/i);

  const pages = buildScreenshotExploreProbeTask("pages-routes", brief);
  assert.match(pages, /paths\.ts|PAGES|routes/i);

  const print = buildScreenshotExploreProbeTask("print-widgets", brief);
  assert.match(print, /journal-print|download|print/i);
});

test("formatScreenshotExploreSummary marks probes and errors", () => {
  const summary = formatScreenshotExploreSummary(
    [
      { id: "ui-api", ok: true, result: "Found src/shared/ui/table" },
      { id: "pages-routes", ok: false, result: "", error: "aborted" },
      { id: "print-widgets", ok: true, result: "journal-print.tsx" },
    ],
    100
  );
  assert.match(
    summary,
    new RegExp(HARBOR_SCREENSHOT_EXPLORE_MARKER.replace(/[[\]]/g, "\\$&"))
  );
  assert.match(summary, /Probe · ui-api/);
  assert.match(summary, /src\/shared\/ui\/table/);
  assert.match(summary, /ERROR: aborted/);
  assert.match(summary, /WHAT/);
  assert.match(summary, /уже совпадает|no new work|match/i);
  assert.match(summary, /journal-print/);
});
