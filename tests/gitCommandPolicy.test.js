const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isBroadGitStageCommand,
  isBroadGitDiscardCommand,
  explicitlyRequestsAllChanges,
  shouldBlockBroadGitDiscard,
  shouldBlockBroadGitStage,
  isGitMutationCommand,
  isGitPushCommand,
  isGitStatusCommand,
} = require("../out/gitCommandPolicy.js");

test("blocks broad staging for an ordinary push request", () => {
  for (const command of [
    "git add --all",
    "git add -A",
    "git add .",
    "git commit -am 'message'",
  ]) {
    assert.equal(isBroadGitStageCommand(command), true, command);
    assert.equal(shouldBlockBroadGitStage(command, "давай запушим"), true);
  }
});

test("allows broad staging only when all changes were requested explicitly", () => {
  assert.equal(explicitlyRequestsAllChanges("закоммить все изменения"), true);
  assert.equal(
    shouldBlockBroadGitStage("git add --all", "закоммить все изменения"),
    false
  );
  assert.equal(
    shouldBlockBroadGitStage("git add -- src/a.ts src/b.ts", "давай запушим"),
    false
  );
});

test("detects git push commands", () => {
  assert.equal(isGitPushCommand("git push"), true);
  assert.equal(isGitPushCommand("git status && git push origin feature"), true);
  assert.equal(isGitPushCommand("git status --short"), false);
});

test("distinguishes mutating Git commands from status verification", () => {
  assert.equal(
    isGitMutationCommand("git restore --source=HEAD --worktree src/model.ts"),
    true
  );
  assert.equal(isGitMutationCommand("git revert abc123"), true);
  assert.equal(isGitMutationCommand("git status --short"), false);
  assert.equal(isGitStatusCommand("git status --short"), true);
  assert.equal(
    isGitStatusCommand("git restore src/model.ts && git status --short"),
    true
  );
});

test("blocks broad discard unless all changes were requested explicitly", () => {
  for (const command of [
    "git restore .",
    "git restore --staged --worktree .",
    "git clean -fd",
    "git reset --hard",
  ]) {
    assert.equal(isBroadGitDiscardCommand(command), true, command);
    assert.equal(shouldBlockBroadGitDiscard(command, "верни"), true, command);
    assert.equal(
      shouldBlockBroadGitDiscard(command, "убери все локальные изменения"),
      false,
      command
    );
  }
});
