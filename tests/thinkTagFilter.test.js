const test = require("node:test");
const assert = require("node:assert/strict");

const {
  stripThinkTagBlock,
  createThinkTagStreamFilter,
} = require("../out/thinkTagFilter.js");

// Две поддерживаемые пары тегов. Конкатенация — чтобы рендеринг не путал теги.
const THINK_OPEN = "<" + "think" + ">"; // ⏐think⏐
const THINK_CLOSE = "<" + "/think" + ">"; // ⏐/think⏐
const THOUGHT_OPEN = "<" + "thought" + ">"; // <thought>
const THOUGHT_CLOSE = "<" + "/thought" + ">"; // </thought>

// ----- stripThinkTagBlock (one-shot) -----

test("stripThinkTagBlock removes a leading <thought> block and extracts reasoning", () => {
  const input = THOUGHT_OPEN + "\nI should read package.json.\n" + THOUGHT_CLOSE + "\nВерсия: 0.0.21";
  const out = stripThinkTagBlock(input);
  assert.equal(out.text, "Версия: 0.0.21");
  assert.equal(out.reasoning, "I should read package.json.");
});

test("stripThinkTagBlock removes a leading ⏐think⏐ block (DeepSeek-R1 native)", () => {
  const input = THINK_OPEN + "думаю" + THINK_CLOSE + "ответ";
  const out = stripThinkTagBlock(input);
  assert.equal(out.text, "ответ");
  assert.equal(out.reasoning, "думаю");
});

test("stripThinkTagBlock passes text through when no think block present", () => {
  const out = stripThinkTagBlock("Просто ответ без тегов.");
  assert.equal(out.text, "Просто ответ без тегов.");
  assert.equal(out.reasoning, null);
});

test("stripThinkTagBlock treats unclosed leading <thought> as all-reasoning", () => {
  const out = stripThinkTagBlock(THOUGHT_OPEN + "размышления без закрытия");
  assert.equal(out.text, "");
  assert.equal(out.reasoning, "размышления без закрытия");
});

test("stripThinkTagBlock does NOT strip a <thought> tag that is not leading", () => {
  const input = "Вот пример: `" + THOUGHT_OPEN + "` — не трогать.";
  const out = stripThinkTagBlock(input);
  assert.equal(out.text, input);
  assert.equal(out.reasoning, null);
});

test("stripThinkTagBlock tolerates leading whitespace before opening tag", () => {
  const out = stripThinkTagBlock("  " + THOUGHT_OPEN + "размышления" + THOUGHT_CLOSE + "ответ");
  assert.equal(out.text, "ответ");
  assert.equal(out.reasoning, "размышления");
});

// ----- createThinkTagStreamFilter (streaming) -----

test("stream filter routes a single-chunk <thought> block correctly", () => {
  const f = createThinkTagStreamFilter();
  const out = f.consume(THOUGHT_OPEN + "думаю" + THOUGHT_CLOSE + "ответ");
  assert.equal(out.visible, "ответ");
  assert.equal(out.reasoning, "думаю");
});

test("stream filter routes a single-chunk ⏐think⏐ block correctly", () => {
  const f = createThinkTagStreamFilter();
  const out = f.consume(THINK_OPEN + "думаю" + THINK_CLOSE + "ответ");
  assert.equal(out.visible, "ответ");
  assert.equal(out.reasoning, "думаю");
});

test("stream filter handles <thought> tag split across chunks", () => {
  const f = createThinkTagStreamFilter();
  const a = f.consume(THOUGHT_OPEN + "ду");
  const b = f.consume("маю" + THOUGHT_CLOSE + "о");
  const c = f.consume("твет");
  assert.equal(a.visible, "");
  assert.equal(a.reasoning, "ду");
  assert.equal(b.visible, "о");
  assert.equal(b.reasoning, "маю");
  assert.equal(c.visible, "твет");
  assert.equal(c.reasoning, "");
});

test("stream filter handles <thought> opening tag split mid-tag (leading position)", () => {
  const f = createThinkTagStreamFilter();
  const a = f.consume(THOUGHT_OPEN.slice(0, 4)); // "<tho"
  const b = f.consume(THOUGHT_OPEN.slice(4) + "ду"); // "ught>ду"
  assert.equal(a.visible, "");
  assert.equal(a.reasoning, "");
  assert.equal(b.visible, "");
  assert.equal(b.reasoning, "ду");
});

test("stream filter: non-leading <thought> block is preserved as visible (leading-only design)", () => {
  const f = createThinkTagStreamFilter();
  const out = f.consume("префикс" + THOUGHT_OPEN + "думаю" + THOUGHT_CLOSE + "хвост");
  assert.equal(out.visible, "префикс" + THOUGHT_OPEN + "думаю" + THOUGHT_CLOSE + "хвост");
  assert.equal(out.reasoning, "");
});

test("stream filter: after <thought> closes, subsequent tags in code are NOT stripped", () => {
  const f = createThinkTagStreamFilter();
  const a = f.consume(THOUGHT_OPEN + "думаю" + THOUGHT_CLOSE + "вот код: ");
  const b = f.consume("```html" + THOUGHT_CLOSE + "``` конец");
  assert.equal(a.visible, "вот код: ");
  assert.equal(a.reasoning, "думаю");
  assert.equal(b.visible, "```html" + THOUGHT_CLOSE + "``` конец");
  assert.equal(b.reasoning, "");
});

test("stream filter: plain text with no tags passes through as visible", () => {
  const f = createThinkTagStreamFilter();
  const out = f.consume("обычный ответ без тегов");
  assert.equal(out.visible, "обычный ответ без тегов");
  assert.equal(out.reasoning, "");
});

// ----- Stray leading close tag (platform extracted reasoning into reasoning_content) -----

test("stripThinkTagBlock strips a stray leading </welcome> close tag with no open tag", () => {
  const input = THINK_CLOSE + "Вот актуальная информация:";
  const out = stripThinkTagBlock(input);
  assert.equal(out.text, "Вот актуальная информация:");
  assert.equal(out.reasoning, null);
});

test("stripThinkTagBlock strips a stray leading </thought> close tag with no open tag", () => {
  const input = THOUGHT_CLOSE + "ответ без reasoning";
  const out = stripThinkTagBlock(input);
  assert.equal(out.text, "ответ без reasoning");
  assert.equal(out.reasoning, null);
});

test("stripThinkTagBlock strips leading whitespace before a stray close tag", () => {
  const out = stripThinkTagBlock("  " + THINK_CLOSE + "ответ");
  assert.equal(out.text, "ответ");
  assert.equal(out.reasoning, null);
});

test("stripThinkTagBlock does NOT strip a stray close tag that is not leading", () => {
  const input = "префикс " + THINK_CLOSE + " хвост";
  const out = stripThinkTagBlock(input);
  assert.equal(out.text, input);
  assert.equal(out.reasoning, null);
});

test("stream filter strips a single-chunk stray leading </welcome> close tag", () => {
  const f = createThinkTagStreamFilter();
  const out = f.consume(THINK_CLOSE + "Вот актуальная информация:");
  assert.equal(out.visible, "Вот актуальная информация:");
  assert.equal(out.reasoning, "");
});

test("stream filter strips a stray leading </welcome> split across chunks", () => {
  const f = createThinkTagStreamFilter();
  const a = f.consume(THINK_CLOSE.slice(0, 4)); // "</we"
  const b = f.consume(THINK_CLOSE.slice(4) + "Вот"); // "lcome>Вот"
  const c = f.consume(" актуальная информация:");
  assert.equal(a.visible, "");
  assert.equal(a.reasoning, "");
  assert.equal(b.visible, "Вот");
  assert.equal(b.reasoning, "");
  assert.equal(c.visible, " актуальная информация:");
  assert.equal(c.reasoning, "");
});

test("stream filter: stray leading close then a later close inside code is preserved", () => {
  const f = createThinkTagStreamFilter();
  const a = f.consume(THINK_CLOSE + "вот код: ");
  const b = f.consume("```" + THINK_CLOSE + "``` конец");
  assert.equal(a.visible, "вот код: ");
  assert.equal(a.reasoning, "");
  assert.equal(b.visible, "```" + THINK_CLOSE + "``` конец");
  assert.equal(b.reasoning, "");
});

test("stream filter: stray leading </thought> close tag is stripped", () => {
  const f = createThinkTagStreamFilter();
  const out = f.consume(THOUGHT_CLOSE + "ответ");
  assert.equal(out.visible, "ответ");
  assert.equal(out.reasoning, "");
});
