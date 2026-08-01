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

/**
 * Короткая явная просьба только запушить (без commit).
 * Такие запросы исполняем детерминированно — без LLM.
 */
export function looksLikeExplicitPushRequest(text: string): boolean {
  const value = String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[.!?…]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) {
    return false;
  }
  if (/^(как|почему|зачем|что)\b/.test(value)) {
    return false;
  }
  if (/(^|\s)(не|не надо|не нужно)\s+(пуш|push|запуш)/.test(value)) {
    return false;
  }
  // Commit+push — отдельный UI-тег, не этот fast-path.
  if (/(коммит|commit|закоммит)/.test(value)) {
    return false;
  }

  return (
    /^(выполни|сделай|запусти|run)\s+(git\s+)?push$/.test(value) ||
    /^(git\s+)?push$/.test(value) ||
    /^(please\s+)?push(\s+(please|it|now))?$/.test(value) ||
    /^(давай\s+)?(запушь|запушить|запушим|пушни|пуш)$/.test(value) ||
    /^git\s+push(\s+-u\s+\S+(\s+\S+)?)?$/.test(value)
  );
}

/**
 * Commit всегда только через UI-тег.
 * Push через run_command — только если пользователь явно попросил запушить.
 */
export function shouldBlockGitCommitOrPush(
  command: string,
  userText = ""
): boolean {
  if (isGitCommitCommand(command)) {
    return true;
  }
  if (isGitPushCommand(command)) {
    return !looksLikeExplicitPushRequest(userText);
  }
  return false;
}

export function isGitMutationCommand(command: string): boolean {
  return /(?:^|[;&|]\s*)git\s+(?:commit|checkout|restore|revert|reset|clean)(?:\s|$)/i.test(
    String(command || "")
  );
}

/**
 * Shell that undoes workspace edits (git discard or recursive rm).
 * Used so honestFinale does not demand write_file after a successful discard.
 */
export function isWorkspaceDiscardCommand(command: string): boolean {
  const value = String(command || "").trim();
  if (!value) {
    return false;
  }
  if (isGitMutationCommand(value)) {
    // commit/push are mutations but not discards
    if (isGitCommitCommand(value) || isGitPushCommand(value)) {
      return false;
    }
    return /(?:^|[;&|]\s*)git\s+(?:checkout|restore|revert|reset|clean)(?:\s|$)/i.test(
      value
    );
  }
  // rm -r / rm -rf / rm --recursive (common agent undo for untracked)
  return /(?:^|[;&|]\s*)rm\s+(?:-[a-zA-Z]*r[a-zA-Z]*f?[a-zA-Z]*\b|--recursive\b)/i.test(
    value
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
