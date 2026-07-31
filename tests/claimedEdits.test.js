const test = require("node:test");
const assert = require("node:assert/strict");

const {
  looksLikeClaimedFileChanges,
  looksLikeQuestionRequest,
  looksLikeUserEditRequest,
} = require("../out/claimedEdits.js");

test("detects «Перезаписал файл» claim", () => {
  assert.equal(
    looksLikeClaimedFileChanges(
      "Перезаписал файл — `closeButton` остаётся внутри `.textContent`, как в оригинале."
    ),
    true
  );
});

test("detects Cyrillic claim about returning close button", () => {
  assert.equal(
    looksLikeClaimedFileChanges(
      "Вернул кнопку закрытия обратно внутрь .content. Переписал структуру: индикатор слева, справа .content внутри которого [heading/message] [closeButton], flex end для closeButton."
    ),
    true
  );
});

test("detects fake «Вернул пропсы» without write_file", () => {
  assert.equal(
    looksLikeClaimedFileChanges(
      "Вернул пропсы `cancelButtonText` и `onCancelClick` на место, просто кнопка отмены теперь не рендерится, если текст не передан — ничего не сломается в других местах."
    ),
    true
  );
});

test("detects «теперь не рендерится» style claims", () => {
  assert.equal(
    looksLikeClaimedFileChanges(
      "Оставил пропсы, кнопка отмены теперь не рендерится без текста."
    ),
    true
  );
});

test("detects a focused replacement claim", () => {
  assert.equal(
    looksLikeClaimedFileChanges(
      "Заменил вызов функции в файле через search_replace."
    ),
    true
  );
});

test("detects fake «Готово / исправлено» without write_file", () => {
  assert.equal(
    looksLikeClaimedFileChanges(
      "Готово. Вот что исправлено:\n1. Функция переименована"
    ),
    true
  );
  assert.equal(
    looksLikeClaimedFileChanges(
      "Готово. Sample переписан корректно:\n- Убран fn"
    ),
    true
  );
});

test("ordinary explanation is not a claim", () => {
  assert.equal(
    looksLikeClaimedFileChanges(
      "Кнопка закрытия обычно живёт внутри контейнера с текстом."
    ),
    false
  );
});

test("looksLikeQuestionRequest detects Q&A prompts", () => {
  assert.equal(looksLikeQuestionRequest("что экспортирует model.ts?"), true);
  assert.equal(looksLikeQuestionRequest("Как работает resolveSpeedRouting?"), true);
  assert.equal(looksLikeQuestionRequest("Explain this function"), true);
  assert.equal(looksLikeQuestionRequest("расскажи про agentLoop"), true);
  assert.equal(looksLikeQuestionRequest("в чём разница между Ask и Agent"), true);
  assert.equal(
    looksLikeQuestionRequest("найди, где определяется resolveSpeedRouting"),
    true
  );
  assert.equal(looksLikeQuestionRequest("find where resolveSpeedRouting is defined"), true);
});

test("looksLikeQuestionRequest ignores edit requests", () => {
  assert.equal(looksLikeQuestionRequest("добавь кнопку закрытия"), false);
  assert.equal(looksLikeQuestionRequest("исправь баг в panel.js"), false);
  assert.equal(looksLikeQuestionRequest("сделай как в Ask"), false);
  assert.equal(looksLikeUserEditRequest("добавь кнопку закрытия"), true);
});

test("looksLikeQuestionRequest ignores plain tasks without question shape", () => {
  assert.equal(
    looksLikeQuestionRequest("обнови версию в package.json и поставь расширение"),
    false
  );
});

test("looksLikeUserEditRequest catches implement / start-plan phrasing", () => {
  assert.equal(
    looksLikeUserEditRequest("давай приступик к реализации по этому плану"),
    true
  );
  assert.equal(
    looksLikeUserEditRequest("давай приступим к реализации"),
    true
  );
  assert.equal(
    looksLikeUserEditRequest("реализуй по этому плану"),
    true
  );
  assert.equal(looksLikeUserEditRequest("implement the plan"), true);
  assert.equal(
    looksLikeUserEditRequest("что экспортирует model.ts?"),
    false
  );
});
