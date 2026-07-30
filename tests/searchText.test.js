const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  globToRegExp,
  searchTextFiles,
  sliceFileLines,
  createReadFileCache,
  extractCodeIdentifiers,
  buildSearchPrefetchMessage,
  isLikelyDefinitionLine,
} = require("../out/searchText.js");
const {
  looksLikeLocateDefinitionRequest,
  formatLocateDefinitionAnswer,
} = require("../out/localCodeNav.js");

function makeWorkspace(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "search-text-"));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
  return root;
}

test("searchTextFiles finds matches with path:line", () => {
  const root = makeWorkspace({
    "src/app.ts": "const foo = 1;\nexport function bar() {}\n",
    "src/util.ts": "// nothing here\n",
  });
  try {
    const result = searchTextFiles({ rootPath: root, query: "bar" });
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].path, "src/app.ts");
    assert.equal(result.matches[0].line, 2);
    assert.equal(result.truncated, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("searchTextFiles skips node_modules and hidden dirs", () => {
  const root = makeWorkspace({
    "node_modules/lib/index.js": "needle();\n",
    ".hidden/config": "needle\n",
    "src/ok.ts": "needle();\n",
  });
  try {
    const result = searchTextFiles({ rootPath: root, query: "needle" });
    assert.deepEqual(
      result.matches.map((m) => m.path),
      ["src/ok.ts"]
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("searchTextFiles respects include glob and pathPrefix", () => {
  const root = makeWorkspace({
    "src/a.ts": "target\n",
    "src/b.js": "target\n",
    "other/c.ts": "target\n",
  });
  try {
    const byGlob = searchTextFiles({
      rootPath: root,
      query: "target",
      include: "*.ts",
    });
    assert.deepEqual(
      byGlob.matches.map((m) => m.path).sort(),
      ["other/c.ts", "src/a.ts"]
    );
    const byPrefix = searchTextFiles({
      rootPath: root,
      query: "target",
      pathPrefix: "src",
    });
    assert.deepEqual(
      byPrefix.matches.map((m) => m.path).sort(),
      ["src/a.ts", "src/b.js"]
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("searchTextFiles regex mode and case sensitivity", () => {
  const root = makeWorkspace({
    "a.ts": "FooBar\nfoobar\n",
  });
  try {
    const re = searchTextFiles({
      rootPath: root,
      query: "^foo",
      regex: true,
      caseSensitive: false,
    });
    assert.equal(re.matches.length, 2);
    const cs = searchTextFiles({
      rootPath: root,
      query: "Foo",
      caseSensitive: true,
    });
    assert.equal(cs.matches.length, 1);
    const bad = searchTextFiles({
      rootPath: root,
      query: "([",
      regex: true,
    });
    assert.equal(bad.matches.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("searchTextFiles caps results and flags truncation", () => {
  const files = {};
  for (let i = 0; i < 10; i++) {
    files[`f${i}.txt`] = "hit\nhit\nhit\nhit\nhit\nhit\nhit\nhit\nhit\nhit\n";
  }
  const root = makeWorkspace(files);
  try {
    const result = searchTextFiles({
      rootPath: root,
      query: "hit",
      maxResults: 5,
    });
    assert.equal(result.matches.length, 5);
    assert.equal(result.truncated, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("globToRegExp handles braces and stars", () => {
  const re = globToRegExp("*.{ts,tsx}");
  assert.ok(re.test("a.ts"));
  assert.ok(re.test("b.TSX"));
  assert.ok(!re.test("c.js"));
  assert.equal(globToRegExp(""), undefined);
});

test("sliceFileLines clamps ranges 1-based inclusive", () => {
  const text = "l1\nl2\nl3\nl4\nl5";
  assert.deepEqual(sliceFileLines(text, 2, 3), {
    content: "l2\nl3",
    startLine: 2,
    endLine: 3,
    totalLines: 5,
    ranged: true,
  });
  assert.deepEqual(sliceFileLines(text, 4), {
    content: "l4\nl5",
    startLine: 4,
    endLine: 5,
    totalLines: 5,
    ranged: true,
  });
  const full = sliceFileLines(text);
  assert.equal(full.ranged, false);
  assert.equal(full.totalLines, 5);
  // Границы за пределами файла клампятся.
  const clamped = sliceFileLines(text, 10, 20);
  assert.equal(clamped.content, "l5");
  assert.equal(clamped.startLine, 5);
});

test("createReadFileCache invalidates by mtime and evicts LRU", () => {
  const cache = createReadFileCache(2);
  cache.set("/a", 1, "A");
  assert.equal(cache.get("/a", 1), "A");
  assert.equal(cache.get("/a", 2), undefined);
  cache.set("/a", 2, "A2");
  cache.set("/b", 1, "B");
  cache.get("/a", 2); // a теперь свежее b
  cache.set("/c", 1, "C");
  assert.equal(cache.get("/b", 1), undefined);
  assert.equal(cache.get("/a", 2), "A2");
  assert.equal(cache.size, 2);
  cache.invalidate("/a");
  assert.equal(cache.get("/a", 2), undefined);
});

test("createServedReadTracker blocks same path/range until edit", () => {
  const {
    createServedReadTracker,
    servedReadKey,
  } = require("../out/searchText.js");
  const tracker = createServedReadTracker();
  const key = servedReadKey("package.json");
  assert.equal(tracker.wasServed(key, 100), false);
  tracker.markServed(key, 100);
  assert.equal(tracker.wasServed(key, 100), true);
  assert.equal(tracker.wasServed(key, 200), false);
  assert.equal(
    tracker.wasServed(servedReadKey("package.json", 1, 20), 100),
    false
  );
  tracker.invalidatePath("package.json");
  assert.equal(tracker.wasServed(key, 100), false);
});

test("extractCodeIdentifiers picks code-shaped tokens only", () => {
  assert.deepEqual(
    extractCodeIdentifiers("Найди, где определяется функция resolveSpeedRouting в проекте"),
    ["resolveSpeedRouting"]
  );
  assert.deepEqual(
    extractCodeIdentifiers("почини `looksLikeUserEditRequest` и HISTORY_LIMIT"),
    ["looksLikeUserEditRequest", "HISTORY_LIMIT"]
  );
  assert.deepEqual(extractCodeIdentifiers("добавь кнопку закрытия в панель"), []);
  assert.deepEqual(extractCodeIdentifiers(""), []);
});

test("looksLikeLocateDefinitionRequest detects find-definition prompts", () => {
  assert.equal(
    looksLikeLocateDefinitionRequest(
      "найди, где определяется resolveSpeedRouting"
    ),
    true
  );
  assert.equal(
    looksLikeLocateDefinitionRequest("find where resolveSpeedRouting is defined"),
    true
  );
  assert.equal(looksLikeLocateDefinitionRequest("расскажи про проект"), false);
  assert.equal(
    looksLikeLocateDefinitionRequest("добавь кнопку закрытия"),
    false
  );
});

test("formatLocateDefinitionAnswer prefers definition lines", () => {
  const root = makeWorkspace({
    "src/routing.ts":
      "export function mySpecialRouter() {}\nconst x = mySpecialRouter();\n",
    "src/other.ts": "mySpecialRouter();\n",
  });
  try {
    const answer = formatLocateDefinitionAnswer(
      root,
      "найди, где определяется mySpecialRouter"
    );
    assert.ok(answer);
    assert.ok(answer.includes("src/routing.ts:1"));
    assert.ok(answer.includes("определение"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("isLikelyDefinitionLine recognizes common declaration shapes", () => {
  assert.equal(
    isLikelyDefinitionLine(
      "export function resolveSpeedRouting() {",
      "resolveSpeedRouting"
    ),
    true
  );
  assert.equal(
    isLikelyDefinitionLine("const x = resolveSpeedRouting();", "resolveSpeedRouting"),
    false
  );
});
