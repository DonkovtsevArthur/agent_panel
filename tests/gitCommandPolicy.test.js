const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatHookFailureOutput,
  gitEnvWithUtf8Locale,
  lastHookOutputLine,
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
  assert.equal(isGitMutationCommand("git checkout -- AGENTS.md package.json"), true);
  assert.equal(isGitMutationCommand("git checkout main"), true);
  assert.equal(isGitMutationCommand("git checkout -b feature"), true);
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

test("auto-approved commands allow git commit / push only on an explicit request", () => {
  const { shouldBlockGitCommitOrPush } = require("../out/gitCommandPolicy.js");
  const {
    harborBlockedGitCommandReason,
  } = require("../out/gitCommandGuardExtension.js");

  // Задача без просьбы закоммитить — даже с автоподтверждением блок.
  const task = "так давай решим задачу ASUIP-3238 но ответвится от дев";
  assert.equal(shouldBlockGitCommitOrPush("git commit -m 'x'", task, true), true);
  assert.equal(shouldBlockGitCommitOrPush("git commit -m 'x'", "", true), true);
  assert.equal(shouldBlockGitCommitOrPush("git push -u origin HEAD", "", true), true);
  assert.equal(shouldBlockGitCommitOrPush("git push", "поправь и отправь", true), true);
  assert.match(
    String(harborBlockedGitCommandReason("git commit -m 'x'", task, true)),
    /blocks `git commit`.*explicitly asked to commit/
  );

  // Явная просьба + автоподтверждение — пропускаем.
  assert.equal(shouldBlockGitCommitOrPush("git commit -m 'x'", "закоммить", true), false);
  assert.equal(
    shouldBlockGitCommitOrPush("git commit -m 'x'", "почини тест и сделай коммит", true),
    false
  );
  assert.equal(
    shouldBlockGitCommitOrPush(
      "git add src/a.ts && git commit -m 'x' && git push",
      "закоммить и запушь",
      true
    ),
    false
  );
  assert.equal(harborBlockedGitCommandReason("git push", "запушь ветку в origin", true), undefined);

  // Commit разрешён, push — нет: блок по push-части цепочки.
  assert.match(
    String(
      harborBlockedGitCommandReason("git commit -m 'x' && git push", "закоммить", true)
    ),
    /blocks `git push`/
  );

  // Без автоподтверждения commit через shell закрыт всегда.
  assert.equal(shouldBlockGitCommitOrPush("git commit -m 'x'", "закоммить", false), true);
  assert.equal(shouldBlockGitCommitOrPush("git push", "поправь и отправь", false), true);
  assert.match(
    String(harborBlockedGitCommandReason("git push", "", false)),
    /blocks `git push`/
  );
  assert.equal(
    harborBlockedGitCommandReason("git add -A && git commit -m 'x'", "закоммить", true) !== undefined,
    true
  );
});

test("userRequestsGitCommit / userRequestsGitPush: вопросы и отрицания — не просьба", () => {
  const {
    userRequestsGitCommit,
    userRequestsGitPush,
  } = require("../out/gitCommandPolicy.js");

  assert.equal(userRequestsGitCommit("закоммить изменения"), true);
  assert.equal(userRequestsGitCommit("Закоммитим?"), true);
  assert.equal(userRequestsGitCommit("коммитни это"), true);
  assert.equal(userRequestsGitCommit("please commit this"), true);
  assert.equal(userRequestsGitCommit("почему закоммитил если я не просил?"), false);
  assert.equal(userRequestsGitCommit("поправь, но не коммить"), false);
  assert.equal(userRequestsGitCommit("сделай без коммита"), false);
  assert.equal(userRequestsGitCommit("don't commit yet"), false);
  assert.equal(userRequestsGitCommit("напиши commit message"), false);
  assert.equal(userRequestsGitCommit("реши задачу ASUIP-3238"), false);

  assert.equal(userRequestsGitPush("закоммить и запушь"), true);
  assert.equal(userRequestsGitPush("push it"), true);
  assert.equal(userRequestsGitPush("закоммить, но не пушь"), false);
  assert.equal(userRequestsGitPush("как запушить ветку?"), false);
  assert.equal(userRequestsGitPush("поправь и отправь"), false);
});

test("formatHookFailureOutput: stderr + stdout в fenced-блоке", () => {
  const out = formatHookFailureOutput(
    "src/a.ts\n  1:1  error  boom",
    "> type-check:build"
  );
  assert.equal(
    out,
    "```\n> type-check:build\nsrc/a.ts\n  1:1  error  boom\n```"
  );
  assert.equal(formatHookFailureOutput("", "  "), "");
});

test("formatHookFailureOutput: только хвост длинного вывода", () => {
  const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
  const out = formatHookFailureOutput(lines.join("\n"), "");
  assert.match(out, /^```\n…\n/);
  assert.match(out, /line 199\n```$/);
  assert.doesNotMatch(out, /line 100\n/);
});

test("formatHookFailureOutput: fence длиннее бэктиков в выводе", () => {
  const out = formatHookFailureOutput("", "see ```code```");
  assert.match(out, /^````\n/);
  assert.match(out, /\n````$/);
});

test("gitEnvWithUtf8Locale: без локали добавляет UTF-8 LC_CTYPE", () => {
  assert.equal(gitEnvWithUtf8Locale({ PATH: "/bin" }, "darwin").LC_CTYPE, "en_US.UTF-8");
  assert.equal(gitEnvWithUtf8Locale({ LANG: "C" }, "linux").LC_CTYPE, "C.UTF-8");
  const utf = { LANG: "ru_RU.UTF-8" };
  assert.equal(gitEnvWithUtf8Locale(utf, "darwin"), utf);
  const explicit = { LC_ALL: "C" };
  assert.equal(gitEnvWithUtf8Locale(explicit, "darwin"), explicit);
});

test("lastHookOutputLine: последняя непустая строка без ANSI", () => {
  assert.equal(
    lastHookOutputLine("> lint\n\u001b[33m  12:1  warning  x\u001b[39m\n\n"),
    "12:1 warning x"
  );
  assert.equal(lastHookOutputLine("progress 10%\rprogress 90%"), "progress 90%");
  assert.equal(lastHookOutputLine(" \n "), "");
  assert.ok(lastHookOutputLine("x".repeat(500)).length <= 140);
});
