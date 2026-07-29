const test = require("node:test");
const assert = require("node:assert/strict");

const { looksLikeHedgeOrUnfinishedAction } = require("../out/hedgeReplies.js");

test("detects TypeScript hedge / rebuild promises", () => {
  assert.equal(
    looksLikeHedgeOrUnfinishedAction(
      "Если TypeScript ругается — возможно, index.ts ещё не подхватился. Попробую пересобрать, чтобы проверить:"
    ),
    true
  );
  assert.equal(
    looksLikeHedgeOrUnfinishedAction(
      "If TypeScript complains, the file may not have been picked up. I'll try to rebuild to check:"
    ),
    true
  );
});

test("does not flag normal factual replies", () => {
  assert.equal(
    looksLikeHedgeOrUnfinishedAction(
      "TypeScript компилируется без ошибок. Импорт исправлен на @shared/ui."
    ),
    false
  );
});
