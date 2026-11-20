const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const panelSource = fs.readFileSync(
  path.resolve(__dirname, "../media/panel.js"),
  "utf8"
);

/** Body of one top-level panel function, up to the next top-level function. */
function functionBody(name) {
  const start = panelSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name}() not found in media/panel.js`);
  const next = panelSource.indexOf("\n  function ", start + 1);
  assert.ok(next > start, `no boundary after function ${name}()`);
  return panelSource.slice(start, next);
}

test("live stopwatch survives a timeline sealed mid-run", () => {
  // Intermediate model text seals the timeline while the run keeps going —
  // the clock must fall back to that working group instead of vanishing.
  const liveGroup = functionBody("getLiveStopwatchGroup");
  assert.match(liveGroup, /getActiveToolGroup\(\)/);
  assert.match(liveGroup, /\.tool-group\.is-run-working/);

  const stopwatch = functionBody("updateLiveStopwatch");
  assert.match(stopwatch, /getLiveStopwatchGroup\(\)/);

  // The group summary must not wipe the running clock on every step.
  const summary = functionBody("updateToolGroupSummary");
  assert.match(summary, /paintLiveStopwatch\(group\)/);
  assert.ok(
    !/durationEl\.hidden = true;/.test(stopwatch),
    "the live stopwatch must never hide its own clock"
  );
});

test("stop press is never swallowed by the edit-save debounce", () => {
  const activate = functionBody("activateSendButton");
  // The shared harborEditSaveAt stamp belongs to edit-save / regenerate /
  // branch: reusing it made Stop inert right after one of those clicks.
  assert.ok(
    !/Date\.now\(\) - harborEditSaveAt < 450/.test(activate),
    "activateSendButton must not reuse the edit-save debounce"
  );
  assert.match(activate, /Date\.now\(\) - lastSendActivateAt < 450/);
});

test("stop names the chat and always reaches the host", () => {
  const activate = functionBody("activateSendButton");
  assert.match(activate, /type: "stop", chatId: activeChatId/);
  // Queueing the draft only counts when it really dispatched — otherwise the
  // press must fall through to stop instead of doing nothing at all.
  assert.match(activate, /composerHasContent\(\) && sendPrompt\(\)/);

  const send = functionBody("sendPrompt");
  assert.match(send, /return false;/);
  assert.match(send, /return true;/);
});

test("IDE composer inserts do not flip a running chat to idle", () => {
  const sync = functionBody("syncIdleAfterComposerInsert");
  assert.match(sync, /if \(busy\) \{/);
  for (const marker of [
    'case "insertComposerText"',
    'case "insertComposerMentions"',
    'case "insertComposerSelection"',
  ]) {
    const at = panelSource.indexOf(marker);
    assert.ok(at >= 0, `${marker} not found`);
    const handler = panelSource.slice(at, panelSource.indexOf("break;", at));
    assert.match(handler, /syncIdleAfterComposerInsert\(\)/);
    assert.ok(
      !/setBusy\(false\)/.test(handler),
      `${marker} must not clear the running state`
    );
  }
});
