const test = require("node:test");
const assert = require("node:assert/strict");

const { applySearchReplace } = require("../out/patchApply.js");

test("replaces one unique exact match by default", () => {
  assert.deepEqual(
    applySearchReplace("before old after", "old", "new"),
    {
      ok: true,
      content: "before new after",
      replacements: 1,
    }
  );
});

test("rejects empty and missing old_string with structured errors", () => {
  const empty = applySearchReplace("text", "", "new");
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, "EMPTY_OLD_STRING");
  assert.equal(empty.error.matchCount, 0);

  const missing = applySearchReplace("text", "absent", "new");
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "NO_MATCH");
  assert.equal(missing.error.matchCount, 0);
});

test("requires uniqueness unless replace_all is enabled", () => {
  const ambiguous = applySearchReplace("old / old", "old", "new");
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.error.code, "MULTIPLE_MATCHES");
  assert.equal(ambiguous.error.matchCount, 2);

  assert.deepEqual(applySearchReplace("old / old", "old", "new", true), {
    ok: true,
    content: "new / new",
    replacements: 2,
  });
});

test("detects replacements that make no change", () => {
  const result = applySearchReplace("same", "same", "same");
  assert.equal(result.ok, false);
  assert.equal(result.unchanged, true);
  assert.equal(result.error.code, "NO_CHANGE");
});

test("matches LF snippets in CRLF files and preserves CRLF", () => {
  const result = applySearchReplace(
    "const a = 1;\r\nconst b = 2;\r\n",
    "const a = 1;\nconst b = 2;",
    "const a = 3;\nconst b = 4;"
  );
  assert.deepEqual(result, {
    ok: true,
    content: "const a = 3;\r\nconst b = 4;\r\n",
    replacements: 1,
  });
});

test("does not rewrite unrelated mixed line endings", () => {
  const result = applySearchReplace(
    "first\r\nold\nlast\r\n",
    "old",
    "new\nline"
  );
  assert.equal(result.ok, true);
  assert.equal(result.content, "first\r\nnew\r\nline\nlast\r\n");
});
