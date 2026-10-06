const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  cleanHoverText,
  createHostRpcCodeNavBackend,
  locateSymbolInLines,
  resolveIdeResponse,
  runCodeNav,
  runRenameSymbol,
} = require("../out/codeNav.js");

function tmpWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harbor-codenav-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(
    path.join(root, "src", "a.ts"),
    [
      'import { helper } from "./b";',
      "",
      "export function main() {",
      "  return helper(1) + helper(2);",
      "}",
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(root, "src", "b.ts"),
    ["// helper docs", "export function helper(n: number) {", "  return n;", "}"].join("\n")
  );
  return root;
}

function fakeBackend(root, overrides = {}) {
  const calls = [];
  const b = path.join(root, "src", "b.ts");
  const a = path.join(root, "src", "a.ts");
  return {
    calls,
    backend: {
      id: "fake",
      definition: async (pos) => {
        calls.push(["definition", pos]);
        return [{ path: b, line: 2, column: 17 }];
      },
      references: async (pos, limit) => {
        calls.push(["references", pos, limit]);
        return [
          { path: a, line: 4, column: 10 },
          { path: a, line: 4, column: 22 },
          { path: a, line: 4, column: 22 },
          { path: a, line: 1, column: 10 },
        ];
      },
      implementations: async () => [],
      hover: async () => "<b>function</b> helper(n: number): number",
      workspaceSymbols: async (query) => {
        calls.push(["symbols", query]);
        return [{ name: "helper", kind: "Function", path: b, line: 2 }];
      },
      documentSymbols: async () => [
        { name: "helper", kind: "Function", path: b, line: 2, depth: 0 },
      ],
      rename: async (pos, newName) => {
        calls.push(["rename", pos, newName]);
        return { files: [a, b], edits: 4 };
      },
      ...overrides,
    },
  };
}

test("locateSymbolInLines: prefers the given line, then declarations", () => {
  const lines = ["const x = foo();", "function foo() {}", "foo2(); foo();"];
  assert.deepEqual(locateSymbolInLines(lines, "foo", 3), { line: 3, column: 9 });
  assert.deepEqual(locateSymbolInLines(lines, "foo"), { line: 2, column: 10 });
  // Near-miss line still finds it within ±3.
  assert.deepEqual(locateSymbolInLines(lines, "foo", 1), { line: 1, column: 11 });
  assert.equal(locateSymbolInLines(lines, "bar", 2), undefined);
  // Whole identifiers only: foo2 is not foo; $ counts as identifier char.
  assert.deepEqual(locateSymbolInLines(["$foo; foo"], "foo"), { line: 1, column: 7 });
});

test("code_nav definition resolves path+symbol+line to an exact position", async () => {
  const root = tmpWorkspace();
  const { backend, calls } = fakeBackend(root);
  const out = await runCodeNav(backend, root, {
    action: "definition",
    path: "src/a.ts",
    symbol: "helper",
    line: 4,
  });
  assert.deepEqual(calls[0][1], {
    path: path.join(root, "src", "a.ts"),
    line: 4,
    column: 10,
  });
  assert.match(out, /Definition\(s\) of symbol at src\/a\.ts:4:10/);
  assert.match(out, /src\/b\.ts\n {2}2:17 {2}export function helper\(n: number\) \{/);
});

test("code_nav with symbol only goes through the workspace symbol index", async () => {
  const root = tmpWorkspace();
  const { backend, calls } = fakeBackend(root);
  const out = await runCodeNav(backend, root, { action: "references", symbol: "helper" });
  assert.deepEqual(calls[0], ["symbols", "helper"]);
  assert.equal(calls[1][0], "references");
  assert.deepEqual(calls[1][1], {
    path: path.join(root, "src", "b.ts"),
    line: 2,
    column: 17,
  });
  // Deduped (3 unique) and grouped by file, sorted by line.
  assert.match(out, /\(3 in 1 file\(s\)\)/);
  assert.match(out, /src\/a\.ts\n {2}1:10 .*\n {2}4:10 .*\n {2}4:22 /);
});

test("code_nav reports helpful errors and empty results", async () => {
  const root = tmpWorkspace();
  const { backend } = fakeBackend(root, { implementations: async () => [] });
  assert.match(
    await runCodeNav(backend, root, { action: "nope" }),
    /unknown action/
  );
  assert.match(
    await runCodeNav(backend, root, { action: "definition", path: "src/missing.ts", symbol: "x" }),
    /File not found/
  );
  assert.match(
    await runCodeNav(backend, root, { action: "definition", path: "src/a.ts", symbol: "nothere", line: 1 }),
    /not found on or near line 1/
  );
  assert.match(
    await runCodeNav(backend, root, { action: "implementations", path: "src/b.ts", symbol: "helper" }),
    /none found.*search_codebase/
  );
});

test("code_nav hover / symbols / outline formatting", async () => {
  const root = tmpWorkspace();
  const { backend } = fakeBackend(root);
  assert.match(
    await runCodeNav(backend, root, { action: "hover", path: "src/b.ts", symbol: "helper" }),
    /Type\/signature at src\/b\.ts:2:17:\nfunction helper\(n: number\): number/
  );
  assert.match(
    await runCodeNav(backend, root, { action: "symbols", query: "help" }),
    /function helper {2}src\/b\.ts:2/
  );
  assert.match(
    await runCodeNav(backend, root, { action: "outline", path: "src/b.ts" }),
    /Outline of src\/b\.ts:\nfunction helper {2}:2/
  );
});

test("rename_symbol validates input and reports changed files", async () => {
  const root = tmpWorkspace();
  const { backend, calls } = fakeBackend(root);
  assert.match(
    await runRenameSymbol(backend, root, { path: "src/b.ts", symbol: "helper", newName: "1bad" }),
    /valid identifier/
  );
  assert.equal(calls.length, 0);
  const changed = [];
  const out = await runRenameSymbol(
    backend,
    root,
    { path: "src/b.ts", symbol: "helper", line: 2, newName: "assist" },
    (paths) => changed.push(...paths)
  );
  assert.deepEqual(calls[0], [
    "rename",
    { path: path.join(root, "src", "b.ts"), line: 2, column: 17 },
    "assist",
  ]);
  assert.match(out, /Renamed "helper" → "assist": 4 edit\(s\) in 2 file\(s\)/);
  assert.deepEqual(changed, [path.join(root, "src", "a.ts"), path.join(root, "src", "b.ts")]);
});

test("host RPC backend round-trips through host.ideRequest / ide.response", async () => {
  const sent = [];
  const backend = createHostRpcCodeNavBackend((method, params) => sent.push({ method, params }));
  const pending = backend.references({ path: "/w/a.ts", line: 3, column: 5 }, 10);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, "host.ideRequest");
  assert.equal(sent[0].params.op, "references");
  assert.deepEqual(sent[0].params.params, { path: "/w/a.ts", line: 3, column: 5, limit: 10 });
  resolveIdeResponse({
    requestId: sent[0].params.requestId,
    ok: true,
    result: [{ path: "/w/b.ts", line: 7, column: 2 }, { bogus: true }],
  });
  assert.deepEqual(await pending, [{ path: "/w/b.ts", line: 7, column: 2 }]);

  const failing = backend.hover({ path: "/w/a.ts", line: 1, column: 1 });
  resolveIdeResponse({ requestId: sent[1].params.requestId, ok: false, error: "indexing" });
  await assert.rejects(failing, /indexing/);
  // Unknown / duplicate responses are ignored.
  assert.deepEqual(resolveIdeResponse({ requestId: sent[1].params.requestId }), { ok: false });
});

test("host RPC backend times out when the IDE never answers", async () => {
  const backend = createHostRpcCodeNavBackend(() => {}, { timeoutMs: 20 });
  await assert.rejects(
    backend.definition({ path: "/w/a.ts", line: 1, column: 1 }),
    /did not answer definition/
  );
});

test("cleanHoverText strips HTML from JetBrains documentation", () => {
  assert.equal(
    cleanHoverText("<div class='definition'><pre>fun <b>x</b>(): Int</pre></div><p>Docs &amp; more</p>"),
    "fun x(): Int\n\nDocs & more"
  );
});
