const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseScreenshotHttpUrl,
  isFigmaDesignUrl,
  formatScreenshotUrlToolText,
  formatScreenshotUrlError,
  SCREENSHOT_BROWSER_CHANNELS,
  listSystemBrowserExecutablePaths,
  resolveExistingBrowserExecutable,
  resolveManagedChromiumExecutable,
  playwrightBrowsersDir,
} = require("../out/screenshotUrl.js");

test("parseScreenshotHttpUrl accepts http(s) and rejects other schemes", () => {
  assert.equal(
    parseScreenshotHttpUrl("https://example.com/a").href,
    "https://example.com/a"
  );
  assert.throws(() => parseScreenshotHttpUrl(""), /Пустой URL/);
  assert.throws(() => parseScreenshotHttpUrl("not a url"), /Некорректный URL/);
  assert.throws(
    () => parseScreenshotHttpUrl("file:///tmp/x"),
    /только http и https/
  );
});

test("isFigmaDesignUrl detects figma hosts", () => {
  assert.equal(
    isFigmaDesignUrl(
      "https://www.figma.com/design/abc/Foo?node-id=1-2"
    ),
    true
  );
  assert.equal(isFigmaDesignUrl("https://example.com/figma.com/x"), false);
  assert.equal(isFigmaDesignUrl("https://docs.google.com/x"), false);
});

test("formatScreenshotUrlToolText includes title and visible text", () => {
  const text = formatScreenshotUrlToolText({
    url: "https://example.com",
    finalUrl: "https://example.com/",
    title: "Example",
    text: "Hello world",
    note: "test note",
  });
  assert.match(text, /ok: true/);
  assert.match(text, /title: Example/);
  assert.match(text, /Hello world/);
  assert.match(text, /test note/);
  assert.match(text, /Visible page text/);
});

test("formatScreenshotUrlError mentions Chrome/Arc and Figma MCP", () => {
  const raw = formatScreenshotUrlError("boom", "https://example.com");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.url, "https://example.com");
  assert.match(parsed.error, /boom/);
  assert.match(parsed.note, /Chrome|Edge|Arc|Brave|Chromium/i);
  assert.match(parsed.note, /Figma MCP|fetch_url/);
});

test("screenshot browser channels prefer chrome then edge then chromium", () => {
  assert.deepEqual([...SCREENSHOT_BROWSER_CHANNELS], [
    "chrome",
    "msedge",
    "chromium",
  ]);
});

test("listSystemBrowserExecutablePaths includes Chrome/Edge/Brave on macOS", () => {
  const paths = listSystemBrowserExecutablePaths("darwin", "/Users/me");
  assert.ok(paths.some((p) => p.includes("Google Chrome.app")));
  assert.ok(paths.some((p) => p.includes("Microsoft Edge.app")));
  assert.ok(paths.some((p) => p.includes("Brave Browser.app")));
  // Arc omitted — unreliable in headless mode
  assert.equal(
    paths.some((p) => p.includes("Arc.app")),
    false
  );
});

test("resolveExistingBrowserExecutable returns first existing path", () => {
  const hit = resolveExistingBrowserExecutable(
    "darwin",
    "/Users/me",
    (p) => p.includes("Brave Browser.app")
  );
  assert.match(String(hit || ""), /Brave Browser\.app/);
  const miss = resolveExistingBrowserExecutable("darwin", "/Users/me", () => false);
  assert.equal(miss, undefined);
});

test("resolveManagedChromiumExecutable finds Google Chrome for Testing layout", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harbor-pw-"));
  const exe = path.join(
    tmp,
    "chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
  );
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, "");
  assert.equal(resolveManagedChromiumExecutable(tmp), exe);
  assert.equal(resolveManagedChromiumExecutable(tmp, () => false), undefined);
  assert.match(playwrightBrowsersDir("/Users/me"), /\.harbor-agents/);
});

test("mainLikeTools expose screenshot_url as readonly + parallel-safe", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const toolsSrc = fs.readFileSync(
    path.join(__dirname, "../src/mainLikeTools.ts"),
    "utf8"
  );
  assert.match(toolsSrc, /name: "screenshot_url"/);
  assert.match(toolsSrc, /MAIN_LIKE_READONLY_TOOL_NAMES[\s\S]*"screenshot_url"/);

  const { isParallelSafeTool } = require("../out/toolParallel.js");
  assert.equal(isParallelSafeTool("screenshot_url"), true);

  const { filterToolsForContext } = require("../out/toolFilter.js");
  const fakeTools = [
    { type: "function", function: { name: "read_file", parameters: {} } },
    { type: "function", function: { name: "screenshot_url", parameters: {} } },
    { type: "function", function: { name: "fetch_url", parameters: {} } },
  ];
  const withoutUrl = filterToolsForContext(fakeTools, { hasUrl: false });
  assert.deepEqual(
    withoutUrl.map((t) => t.function.name),
    ["read_file"]
  );
  const withUrl = filterToolsForContext(fakeTools, { hasUrl: true });
  assert.equal(withUrl.length, 3);
});

test("agentLoopMainLike wires screenshot_url through deliverVisionMedia", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(
    path.join(__dirname, "../src/agentLoopMainLike.ts"),
    "utf8"
  );
  assert.match(src, /captureUrlScreenshot/);
  assert.match(src, /deliverVisionMedia/);
  assert.match(src, /name === "screenshot_url"/);
  assert.match(src, /vision_page_screenshot/);
  assert.match(src, /fetch_url AND screenshot_url/);
});
