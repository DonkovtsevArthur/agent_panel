const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const panel = fs.readFileSync(path.join(root, "media/panel.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "media/panel.css"), "utf8");

test("file code blocks start collapsed and expose an accessible toggle", () => {
  assert.match(panel, /has-lines is-collapsible is-collapsed/);
  assert.match(panel, /showLines \? " md-pre-toggle" : ""/);
  assert.match(panel, /aria-expanded="false"/);
  assert.match(panel, /function toggleCodeBlock\(toggle\)/);
  assert.match(styles, /\.md-pre-wrap\.is-collapsed \.md-pre\s*\{/);
});

test("code blocks render syntax token colors", () => {
  assert.match(panel, /class="syntax-\$\{kind\}"/);
  for (const token of [
    "keyword",
    "literal",
    "string",
    "number",
    "comment",
    "type",
    "function",
    "variable",
    "property",
  ]) {
    assert.match(styles, new RegExp(`\\.syntax-${token}(?:,|\\s*\\{)`));
  }
});
