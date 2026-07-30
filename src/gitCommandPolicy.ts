const BROAD_GIT_ADD =
  /(?:^|[;&|]\s*)git\s+add\s+[^;&|]*(?:--all|-A|["']?\.["']?)(?=\s|$|[;&|])/i;
const BROAD_GIT_COMMIT =
  /(?:^|[;&|]\s*)git\s+commit\b[^;&|]*(?:\s-a[a-z]*|\s--all)(?=\s|$|[;&|])/i;
const BROAD_GIT_RESTORE =
  /(?:^|[;&|]\s*)git\s+restore\b[^;&|]*(?:^|\s)["']?\.["']?(?=\s|$|[;&|])/i;
const BROAD_GIT_CLEAN =
  /(?:^|[;&|]\s*)git\s+clean\b[^;&|]*-[a-z]*f[a-z]*(?=\s|$|[;&|])/i;
const HARD_GIT_RESET =
  /(?:^|[;&|]\s*)git\s+reset\b[^;&|]*--hard(?=\s|$|[;&|])/i;

export function isBroadGitStageCommand(command: string): boolean {
  const value = String(command || "").trim();
  return BROAD_GIT_ADD.test(value) || BROAD_GIT_COMMIT.test(value);
}

export function explicitlyRequestsAllChanges(userText: string): boolean {
  const value = String(userText || "").toLowerCase();
  return (
    /(?:все|всё)\s+(?:локальн[а-яё]*\s+)?(?:изменени[а-яё]*|файл[а-яё]*)/i.test(
      value
    ) ||
    /закоммит[а-яё]*\s+(?:все|всё)/i.test(value) ||
    /\b(?:stage\s+all|commit\s+(?:all|everything)|all\s+(?:changes|files))\b/i.test(
      value
    )
  );
}

export function shouldBlockBroadGitStage(
  command: string,
  userText: string
): boolean {
  return (
    isBroadGitStageCommand(command) &&
    !explicitlyRequestsAllChanges(userText)
  );
}

export function isBroadGitDiscardCommand(command: string): boolean {
  const value = String(command || "").trim();
  return (
    BROAD_GIT_RESTORE.test(value) ||
    BROAD_GIT_CLEAN.test(value) ||
    HARD_GIT_RESET.test(value)
  );
}

export function shouldBlockBroadGitDiscard(
  command: string,
  userText: string
): boolean {
  return (
    isBroadGitDiscardCommand(command) &&
    !explicitlyRequestsAllChanges(userText)
  );
}

export function isGitPushCommand(command: string): boolean {
  return /(?:^|[;&|]\s*)git\s+push(?:\s|$)/i.test(String(command || ""));
}

export function isGitCommitCommand(command: string): boolean {
  return /(?:^|[;&|]\s*)git\s+commit(?:\s|$)/i.test(String(command || ""));
}

/** Commit/push только через UI-тег — агент не должен делать их через run_command. */
export function shouldBlockGitCommitOrPush(command: string): boolean {
  return isGitCommitCommand(command) || isGitPushCommand(command);
}

export function isGitMutationCommand(command: string): boolean {
  return /(?:^|[;&|]\s*)git\s+(?:commit|restore|revert|reset|clean)(?:\s|$)/i.test(
    String(command || "")
  );
}

export function isGitStatusCommand(command: string): boolean {
  return /(?:^|[;&|]\s*)git\s+status(?:\s|$)/i.test(String(command || ""));
}

/** Вывод push с remote-ссылками (MR и т.п.) — для кликабельного ответа в чате. */
export function formatGitRemoteOutput(
  stdout?: string,
  stderr?: string
): string {
  const text = [stderr, stdout]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!text) {
    return "";
  }
  const lines = text.split(/\r?\n/);
  const useful = lines.filter((line) => {
    const value = line.trim();
    return (
      /https?:\/\//i.test(value) ||
      /^remote:/i.test(value) ||
      /^To\s+\S+/i.test(value) ||
      /\*\s+\[[^\]]+\]/i.test(value) ||
      /\b[0-9a-f]{7,}\.\.[0-9a-f]{7,}\b/i.test(value)
    );
  });
  return (useful.length ? useful : lines).join("\n").trim();
}
