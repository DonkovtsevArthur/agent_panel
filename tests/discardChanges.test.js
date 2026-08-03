const test = require("node:test");
const assert = require("node:assert/strict");

const {
  looksLikeAmbiguousRestoreRequest,
  looksLikeDiscardAllChangesRequest,
  looksLikeDiscardAgentChangesRequest,
  resolveDiscardScope,
  buildDiscardSystemHint,
} = require("../out/discardChanges.js");

const {
  isWorkspaceDiscardCommand,
  shouldBlockBroadGitDiscard,
} = require("../out/gitCommandPolicy.js");

test("detects discard-all commands including common typos", () => {
  assert.equal(looksLikeDiscardAllChangesRequest("убери все изменения"), true);
  assert.equal(looksLikeDiscardAllChangesRequest("убраь все изменеия"), true);
  assert.equal(looksLikeDiscardAllChangesRequest("откати все правки"), true);
  assert.equal(looksLikeDiscardAllChangesRequest("отмени все изменения"), true);
  assert.equal(looksLikeDiscardAllChangesRequest("отменить все локальные изменения"), true);
  assert.equal(looksLikeDiscardAllChangesRequest("discard all local changes"), true);
  assert.equal(looksLikeDiscardAllChangesRequest("undo all changes"), true);
});

test("detects agent-only discard without «все»", () => {
  assert.equal(looksLikeDiscardAgentChangesRequest("отмени изменения"), true);
  assert.equal(looksLikeDiscardAgentChangesRequest("убери правки"), true);
  assert.equal(looksLikeDiscardAgentChangesRequest("откати свои изменения"), true);
  assert.equal(looksLikeDiscardAgentChangesRequest("discard my changes"), true);
  assert.equal(looksLikeDiscardAgentChangesRequest("отмени все изменения"), false);
});

test("does not treat questions or negations as discard commands", () => {
  assert.equal(looksLikeDiscardAllChangesRequest("как убрать все изменения?"), false);
  assert.equal(looksLikeDiscardAllChangesRequest("не убирай все изменения"), false);
  assert.equal(looksLikeDiscardAllChangesRequest("не отменяй все изменения"), false);
  assert.equal(looksLikeDiscardAllChangesRequest("что изменилось?"), false);
  assert.equal(looksLikeDiscardAgentChangesRequest("не отменяй изменения"), false);
});

test("detects restore requests without a safe target", () => {
  assert.equal(looksLikeAmbiguousRestoreRequest("верни"), true);
  assert.equal(looksLikeAmbiguousRestoreRequest("Откати!"), true);
  assert.equal(looksLikeAmbiguousRestoreRequest("отмени"), true);
  assert.equal(looksLikeAmbiguousRestoreRequest("верни src/model.ts"), false);
  assert.equal(
    looksLikeAmbiguousRestoreRequest("убери все локальные изменения"),
    false
  );
  assert.equal(
    looksLikeAmbiguousRestoreRequest("отмени все изменения"),
    false
  );
});

test("resolveDiscardScope picks all / agent / ambiguous", () => {
  assert.equal(resolveDiscardScope("отмени все изменения"), "all");
  assert.equal(resolveDiscardScope("отмени изменения"), "agent");
  assert.equal(resolveDiscardScope("отмени"), "ambiguous");
  assert.equal(resolveDiscardScope("добавь кнопку"), null);
});

test("buildDiscardSystemHint encodes scope rules", () => {
  const all = buildDiscardSystemHint({ scope: "all", agentEditedPaths: [] });
  assert.match(all, /ALL local/i);
  assert.match(all, /git restore \./i);
  assert.match(all, /STOP/i);
  assert.match(all, /Do NOT re-implement/i);
  assert.doesNotMatch(all, /request_user_input/);

  const agent = buildDiscardSystemHint({
    scope: "agent",
    agentEditedPaths: ["src/a.ts", "src/b.ts"],
  });
  assert.match(agent, /src\/a\.ts/);
  assert.match(agent, /never `git restore \.`/i);
  assert.match(agent, /write_file/);
  assert.match(agent, /STOP/i);
  assert.match(agent, /Do NOT re-implement/i);

  const amb = buildDiscardSystemHint({ scope: "ambiguous", agentEditedPaths: [] });
  assert.match(amb, /request_user_input/);
  assert.match(amb, /Only this agent's recent edits/);
  assert.doesNotMatch(amb, /Do NOT re-implement/);
});

test("isWorkspaceDiscardCommand covers git discard and rm -rf", () => {
  assert.equal(isWorkspaceDiscardCommand("git restore -- src/a.ts"), true);
  assert.equal(isWorkspaceDiscardCommand("git restore ."), true);
  assert.equal(isWorkspaceDiscardCommand("git clean -fd"), true);
  assert.equal(isWorkspaceDiscardCommand("rm -rf src/pages/foo"), true);
  assert.equal(isWorkspaceDiscardCommand("rm -r tmp"), true);
  assert.equal(isWorkspaceDiscardCommand("git status"), false);
  assert.equal(isWorkspaceDiscardCommand("git commit -m x"), false);
  assert.equal(isWorkspaceDiscardCommand("rm file.ts"), false);
});

test("broad discard still requires explicit «все» for git restore .", () => {
  assert.equal(
    shouldBlockBroadGitDiscard("git restore .", "отмени изменения"),
    true
  );
  assert.equal(
    shouldBlockBroadGitDiscard("git restore .", "отмени все изменения"),
    false
  );
});
