const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isMostlyCjk,
  needsReplyLanguageRewrite,
  stripQuotedMaterial,
  appendReplyLanguageRuntimeNudge,
  replyLanguageRewritePrompt,
} = require("../out/replyLanguage.js");

const CHINESE_FINALE = [
  "实现完成：在草图页面（`?blank=1`）上，点击「应用」不再发送 PUT，而是请求带有当前表单值的新打印表单。",
  "",
  "变更内容",
  "- `model.ts` — `saveProtocolData` 按页面进行分支：在协议页面上仍然执行 PUT，在草图上则执行 `getDraftPrintFormFx`。",
  "- `model.test.ts` — 两个新测试。",
  "",
  "提交未进行（根据规则，通过面板）。",
].join("\n");

test("Chinese finale from a ru turn needs a rewrite", () => {
  assert.equal(isMostlyCjk(CHINESE_FINALE), true);
  assert.equal(
    needsReplyLanguageRewrite(
      CHINESE_FINALE,
      "ProtocolDraftPrintForm вызывается несколько раз",
      "ru"
    ),
    true
  );
});

test("Russian / English replies are left alone", () => {
  const ru =
    "Готово: в `model.ts` ветка для черновика вызывает `getDraftPrintFormFx`, PUT больше не уходит. Тесты прошли.";
  const en = "Done: `model.ts` now calls `getDraftPrintFormFx` on the draft page.";
  assert.equal(needsReplyLanguageRewrite(ru, "почини", "ru"), false);
  assert.equal(needsReplyLanguageRewrite(en, "fix it", "en"), false);
});

test("Chinese inside code / paths does not trigger a rewrite", () => {
  const reply = [
    "Исправил строку локализации в `src/i18n/zh.json`:",
    "```json",
    '{ "apply": "应用", "reset": "重置", "print": "打印草图表单内容" }',
    "```",
    "Остальные ключи не трогал.",
  ].join("\n");
  assert.equal(stripQuotedMaterial(reply).includes("应用"), false);
  assert.equal(needsReplyLanguageRewrite(reply, "поправь перевод", "ru"), false);
});

test("a user writing Chinese gets a Chinese answer", () => {
  assert.equal(
    needsReplyLanguageRewrite(CHINESE_FINALE, "为什么调用了两次？", "ru"),
    false
  );
});

test("a few CJK characters in a Russian reply are not a drift", () => {
  const reply =
    "Кнопка называется «应用» в китайской локали, в русской — «Применить». Остальное без изменений, тесты зелёные, коммит через панель.";
  assert.equal(needsReplyLanguageRewrite(reply, "что за кнопка", "ru"), false);
});

test("runtime nudge and rewrite prompt follow the UI language", () => {
  const ru = appendReplyLanguageRuntimeNudge("почини", "ru");
  assert.match(ru, /^почини\n\n\[Harbor\].*на русском/);
  assert.match(appendReplyLanguageRuntimeNudge("", "en"), /^\[Harbor\].*in English/);
  assert.match(replyLanguageRewritePrompt("ru"), /на русском/);
  assert.match(replyLanguageRewritePrompt("en"), /in English/);
});
