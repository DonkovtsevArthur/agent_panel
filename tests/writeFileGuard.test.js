const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateWriteFileAgainstExisting,
  writeFileGuardErrorJson,
  WRITE_TRUNCATE_MIN_BEFORE_CHARS,
} = require("../out/writeFileGuard.js");

test("allows creating a new file even if content is short", () => {
  assert.equal(
    validateWriteFileAgainstExisting({
      created: true,
      before: "",
      content: "export const x = 1;\n",
    }),
    null
  );
});

test("blocks empty create (no zero-byte stubs)", () => {
  const err = validateWriteFileAgainstExisting({
    created: true,
    before: "",
    content: "",
  });
  assert.match(String(err), /empty/i);
  assert.match(String(err), /FULL file contents/i);
});

test("blocks whitespace-only create", () => {
  const err = validateWriteFileAgainstExisting({
    created: true,
    before: "",
    content: "  \n\n",
  });
  assert.match(String(err), /empty/i);
});

test("blocks empty overwrite of a non-empty file", () => {
  const err = validateWriteFileAgainstExisting({
    created: false,
    before: "export function Page() { return null; }\n",
    content: "",
  });
  assert.match(String(err), /empty/i);
  assert.match(String(err), /search_replace/i);
});

test("blocks whitespace-only overwrite", () => {
  const err = validateWriteFileAgainstExisting({
    created: false,
    before: "const a = 1;\n",
    content: "   \n\n",
  });
  assert.match(String(err), /empty/i);
});

test("blocks truncated rewrite of a substantial file", () => {
  const before = "x".repeat(WRITE_TRUNCATE_MIN_BEFORE_CHARS + 200);
  const err = validateWriteFileAgainstExisting({
    created: false,
    before,
    content: "// oops\n",
  });
  assert.match(String(err), /drastically shorter/i);
});

test("allows a normal-sized rewrite", () => {
  const before = "line\n".repeat(100);
  const content = "line\n".repeat(90) + "// tweaked\n";
  assert.equal(
    validateWriteFileAgainstExisting({ created: false, before, content }),
    null
  );
});

test("writeFileGuardErrorJson marks refused destructive_write", () => {
  const parsed = JSON.parse(writeFileGuardErrorJson("nope"));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.refused, "destructive_write");
  assert.equal(parsed.error, "nope");
});
