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
  formatGitRemoteOutput,
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

test("blocks git commit always; blocks push unless user explicitly asked", () => {
  const {
    isGitCommitCommand,
    shouldBlockGitCommitOrPush,
    looksLikeExplicitPushRequest,
  } = require("../out/gitCommandPolicy.js");

  for (const command of [
    "git commit -m 'msg'",
    "git add package.json && git commit -m 'chore: bump' && git push",
  ]) {
    assert.equal(shouldBlockGitCommitOrPush(command), true, command);
    assert.equal(
      shouldBlockGitCommitOrPush(command, "выполни push"),
      true,
      command
    );
  }
  assert.equal(shouldBlockGitCommitOrPush("git push"), true);
  assert.equal(shouldBlockGitCommitOrPush("git push -u origin HEAD"), true);
  assert.equal(
    shouldBlockGitCommitOrPush("git push", "выполни push"),
    false
  );
  assert.equal(
    shouldBlockGitCommitOrPush("git push -u origin HEAD", "запушь"),
    false
  );
  assert.equal(isGitCommitCommand("git commit -m 'x'"), true);
  assert.equal(isGitCommitCommand("git status --short"), false);
  assert.equal(shouldBlockGitCommitOrPush("git status --short"), false);
  assert.equal(
    shouldBlockGitCommitOrPush("git add -- package.json"),
    false
  );

  assert.equal(looksLikeExplicitPushRequest("выполни push"), true);
  assert.equal(looksLikeExplicitPushRequest("запушь"), true);
  assert.equal(looksLikeExplicitPushRequest("давай запушим"), true);
  assert.equal(looksLikeExplicitPushRequest("push"), true);
  assert.equal(looksLikeExplicitPushRequest("git push"), true);
  assert.equal(looksLikeExplicitPushRequest("как сделать push?"), false);
  assert.equal(looksLikeExplicitPushRequest("не пушь"), false);
  assert.equal(
    looksLikeExplicitPushRequest("закоммить и запушь"),
    false
  );
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

test("formatGitRemoteOutput keeps remote MR URLs and branch lines", () => {
  const stderr = [
    "remote: ",
    "remote: To create a merge request for ASUIP-3028, visit:",
    "remote: ",
    "remote:   https://git.example.com/group/repo/-/merge_requests/new?merge_request%5Bsource_branch%5D=ASUIP-3028",
    "remote: ",
    "To https://git.example.com/group/repo.git",
    " * [new branch]      ASUIP-3028 -> ASUIP-3028",
  ].join("\n");

  const out = formatGitRemoteOutput("", stderr);
  assert.match(out, /merge_requests\/new/);
  assert.match(out, /ASUIP-3028 -> ASUIP-3028/);
  assert.match(out, /To https:\/\/git\.example\.com\/group\/repo\.git/);
});

test("formatGitRemoteOutput returns empty for blank input", () => {
  assert.equal(formatGitRemoteOutput(), "");
  assert.equal(formatGitRemoteOutput("  ", "\n"), "");
});
