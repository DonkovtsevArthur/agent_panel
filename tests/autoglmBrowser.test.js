const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  expandHomePath,
  extractProcessingFilePath,
  processingToResultPath,
  parseAutoglmProcessingStatus,
  extractScreenshotPathFromResult,
  summarizeAutoglmResult,
  looksLikeExtensionTimeout,
  resolveAutoglmBinary,
  AUTOGLM_BROWSER_HINT,
  AUTOGLM_CHROME_EXTENSION_URL,
} = require("../out/autoglmBrowser.js");

test("expandHomePath expands tilde", () => {
  assert.equal(expandHomePath("~/foo/bar"), path.join(os.homedir(), "foo/bar"));
  assert.equal(expandHomePath(""), "");
});

test("extractProcessingFilePath from labeled stdout", () => {
  const p = extractProcessingFilePath(
    "Processing file: ~/.openclaw-autoclaw/sessions/abc/task_processing.md\n"
  );
  assert.equal(
    p,
    path.join(os.homedir(), ".openclaw-autoclaw/sessions/abc/task_processing.md")
  );
});

test("processingToResultPath swaps filename", () => {
  assert.equal(
    processingToResultPath("/tmp/sessions/x/task_processing.md"),
    "/tmp/sessions/x/task_result.md"
  );
});

test("parseAutoglmProcessingStatus markers", () => {
  assert.deepEqual(parseAutoglmProcessingStatus("still going"), {
    completed: false,
    failed: false,
    configRequired: false,
  });
  assert.equal(parseAutoglmProcessingStatus("[completed]\nok").completed, true);
  assert.equal(parseAutoglmProcessingStatus("[failed] Extension").failed, true);
  assert.equal(
    parseAutoglmProcessingStatus("[config_required]\nmissing=browser")
      .configRequired,
    true
  );
});

test("extractScreenshotPathFromResult takes last image path", () => {
  const text = [
    "step1: /tmp/a.png",
    "step2: ~/shots/final.webp",
  ].join("\n");
  assert.equal(
    extractScreenshotPathFromResult(text),
    path.join(os.homedir(), "shots/final.webp")
  );
});

test("summarizeAutoglmResult truncates", () => {
  const long = "x".repeat(100);
  assert.ok(summarizeAutoglmResult(long, 40).includes("[truncated]"));
});

test("looksLikeExtensionTimeout", () => {
  assert.equal(
    looksLikeExtensionTimeout("Extension did not connect in time"),
    true
  );
  assert.equal(looksLikeExtensionTimeout("ok done"), false);
});

test("resolveAutoglmBinary prefers configured path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harbor-autoglm-"));
  const bin = path.join(dir, "autoglm");
  fs.writeFileSync(bin, "#!/bin/sh\necho ok\n");
  fs.chmodSync(bin, 0o755);
  try {
    assert.equal(resolveAutoglmBinary(bin, "", os.homedir()), bin);
    assert.equal(
      resolveAutoglmBinary("", dir, os.homedir()),
      bin
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AUTOGLM_BROWSER_HINT mentions browser_task and extension", () => {
  assert.match(AUTOGLM_BROWSER_HINT, /browser_task/);
  assert.match(AUTOGLM_BROWSER_HINT, /Chrome/);
  assert.ok(AUTOGLM_CHROME_EXTENSION_URL.includes("chromewebstore"));
});

test("browser_task is readonly and gated by includeBrowserTask (source)", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../src/mainLikeTools.ts"),
    "utf8"
  );
  assert.match(src, /"browser_task"/);
  assert.match(
    src,
    /MAIN_LIKE_READONLY_TOOL_NAMES = new Set\(\[[^]*?"browser_task"/
  );
  assert.match(src, /includeBrowserTask/);
  assert.match(src, /tool\.function\.name === "browser_task"/);
});
