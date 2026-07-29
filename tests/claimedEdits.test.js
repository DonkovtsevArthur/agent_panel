const test = require("node:test");
const assert = require("node:assert/strict");

const { looksLikeClaimedFileChanges } = require("../out/claimedEdits.js");

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
