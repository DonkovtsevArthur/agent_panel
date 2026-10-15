const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const panel = fs.readFileSync(path.join(root, "media/panel.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "media/panel.css"), "utf8");
const build = fs.readFileSync(path.join(root, "scripts/build-panel.js"), "utf8");

test("feed UX module is part of the panel bundle", () => {
  assert.match(build, /"21-feed-ux\.js"/);
  for (const fn of [
    "maybeInsertTimeSeparator",
    "maybeCollapseLongUserMessage",
    "paintAssistantMeta",
    "onFeedTurnKey",
    "updateFeed",
  ]) {
    assert.match(panel, new RegExp(`function ${fn}\\(`));
  }
});

test("feed UX is wired into message rendering and the router", () => {
  assert.match(panel, /maybeCollapseLongUserMessage\(el, text\)/);
  assert.match(panel, /maybeInsertTimeSeparator\(turnEl, index, shouldScroll\)/);
  assert.match(panel, /paintAssistantMeta\(index\);/);
  assert.match(panel, /paintLatestAssistantMeta\(\);/);
});

test("feed UX styles exist", () => {
  for (const cls of [
    "feed-jump",
    "feed-sticky-question",
    "feed-turn-map",
    "feed-time-sep",
    "msg-meta",
    "msg-expand",
  ]) {
    assert.match(styles, new RegExp(`\\.${cls}\\s*\\{`));
  }
  assert.match(styles, /\.msg\.user\.is-long-collapsed \.msg-body\s*\{/);
});

const {
  backfillLegacyMessageTimes,
  migrateToStoreV2,
  createDefaultStore,
} = require("../out/sessionStore.js");

test("backfillLegacyMessageTimes anchors first prompt and last message of old chats", () => {
  const chat = {
    createdAt: 1000,
    updatedAt: 9000,
    uiMessages: [
      { role: "user", text: "q1" },
      { role: "assistant", text: "a1" },
      { role: "tool", text: "" },
      { role: "user", text: "q2" },
      { role: "assistant", text: "a2" },
      { role: "review", text: "{}" },
    ],
  };
  assert.equal(backfillLegacyMessageTimes(chat), true);
  assert.equal(chat.uiMessages[0].ts, 1000);
  assert.equal(chat.uiMessages[4].ts, 9000);
  assert.equal(chat.uiMessages[1].ts, undefined);
  assert.equal(chat.uiMessages[3].ts, undefined);
  // Idempotent: once any message has a time, nothing changes.
  assert.equal(backfillLegacyMessageTimes(chat), false);
});

test("backfillLegacyMessageTimes leaves chats with real times alone", () => {
  const chat = {
    createdAt: 1000,
    updatedAt: 9000,
    uiMessages: [
      { role: "user", text: "q", ts: 5000 },
      { role: "assistant", text: "a" },
    ],
  };
  assert.equal(backfillLegacyMessageTimes(chat), false);
  assert.equal(chat.uiMessages[1].ts, undefined);
});

test("store migration backfills legacy message times", () => {
  const store = createDefaultStore("m");
  const chat = store.chats[store.agents[0].chatId];
  chat.createdAt = 2000;
  chat.updatedAt = 7000;
  chat.uiMessages = [
    { role: "user", text: "q" },
    { role: "assistant", text: "a" },
  ];
  const migrated = migrateToStoreV2(JSON.parse(JSON.stringify(store)), "m");
  const out = migrated.chats[chat.id].uiMessages;
  assert.equal(out[0].ts, 2000);
  assert.equal(out[1].ts, 7000);
});

test("turn map ticks sit right next to the 10px chat scrollbar", () => {
  assert.match(styles, /#messages::-webkit-scrollbar \{\s*width: 10px;/);
  assert.match(styles, /\.feed-turn-map \{[^}]*right: 10px;[^}]*width: 10px;/);
  assert.match(styles, /\.feed-turn-tick \{[^}]*left: 1px;[^}]*width: 8px;/);
  // Compact stack at an even step, vertically centered — not by scroll offset.
  assert.match(panel, /const FEED_TICK_STEP = 8;/);
  assert.match(panel, /const stackTop = Math\.max\(0, \(track - stackHeight\) \/ 2\);/);
  assert.match(panel, /stackTop \+ i \* step/);
});

test("turn tick hover popup is our own element, not a native title", () => {
  assert.match(panel, /feedTipEl\.className = "feed-turn-tip";/);
  assert.match(panel, /data-tip="\$\{escapeHtml\(raw\)\}"/);
  assert.doesNotMatch(panel, /class="feed-turn-tick[^`]*title=/);
  assert.match(styles, /\.feed-turn-tip \{[^}]*pointer-events: none;/);
});

test("turn map re-centers on window resize, reveal and stale hover", () => {
  assert.match(panel, /window\.addEventListener\("resize", scheduleFeedUpdate\);/);
  assert.match(panel, /document\.visibilityState === "visible"\) \{\n\s+scheduleFeedUpdate\(\);/);
  assert.match(panel, /const mapHeight = Math\.round\(mRect\.height\) \|\| messagesEl\.clientHeight;/);
  assert.match(panel, /const showMap = wraps\.length >= 3 && scrollable && !tooLow;/);
  assert.match(panel, /feedMapRetryTimer = setTimeout\(scheduleFeedUpdate, 300\);/);
});

test("turn ticks are positioned via CSSOM (VS Code CSP drops inline style attrs)", () => {
  assert.doesNotMatch(panel, /class="feed-turn-tick[^`]*style="/);
  assert.match(panel, /tick\.style\.top = `\$\{tickTops\[i\] \|\| 0\}px`;/);
});
