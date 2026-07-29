const test = require("node:test");
const assert = require("node:assert/strict");

const {
  looksLikeAmbiguousRestoreRequest,
  looksLikeDiscardAllChangesRequest,
} = require("../out/discardChanges.js");

test("detects discard-all commands including common typos", () => {
  assert.equal(looksLikeDiscardAllChangesRequest("убери все изменения"), true);
  assert.equal(looksLikeDiscardAllChangesRequest("убраь все изменеия"), true);
  assert.equal(looksLikeDiscardAllChangesRequest("откати все правки"), true);
  assert.equal(looksLikeDiscardAllChangesRequest("discard all local changes"), true);
});

test("does not treat questions or negations as discard commands", () => {
  assert.equal(looksLikeDiscardAllChangesRequest("как убрать все изменения?"), false);
  assert.equal(looksLikeDiscardAllChangesRequest("не убирай все изменения"), false);
  assert.equal(looksLikeDiscardAllChangesRequest("что изменилось?"), false);
});

test("detects restore requests without a safe target", () => {
  assert.equal(looksLikeAmbiguousRestoreRequest("верни"), true);
  assert.equal(looksLikeAmbiguousRestoreRequest("Откати!"), true);
  assert.equal(looksLikeAmbiguousRestoreRequest("верни src/model.ts"), false);
  assert.equal(
    looksLikeAmbiguousRestoreRequest("убери все локальные изменения"),
    false
  );
});
