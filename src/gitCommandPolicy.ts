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

function normalizeGitRequestText(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

/** «Почему закоммитил?» / «как запушить?» — вопрос, а не просьба. */
function startsAsQuestion(value: string): boolean {
  // `\b` в JS не видит границ кириллических слов — граница явная.
  return /^(как|почему|зачем|что|когда|где|нужно ли|надо ли|стоит ли|why|how|what|when|should)(?=$|[\s,.?!])/.test(
    value
  );
}

const COMMIT_INTENT =
  /(закоммит|коммитн|(?:сделай|сделать|создай|создать|оформи|оформить)\s+коммит|\bcommit\b(?!\s+messages?\b))/;
const COMMIT_NEGATION =
  /(^|[\s,.;:!])(не|без|не надо|не нужно|не стоит|никаких)\s+(?:\S+\s+)?(закоммит|коммит|commit)|\b(?:don'?t|do not|no|without)\s+(?:\S+\s+)?commit/;
const PUSH_INTENT = /(запуш|пушн|пушь|\bpush\b)/;
const PUSH_NEGATION =
  /(^|[\s,.;:!])(не|без|не надо|не нужно|не стоит)\s+(?:\S+\s+)?(запуш|пуш|push)|\b(?:don'?t|do not|no|without)\s+(?:\S+\s+)?push/;

/** В сообщении пользователя есть явная просьба закоммитить (не вопрос и не отрицание). */
export function userRequestsGitCommit(text: string): boolean {
  const value = normalizeGitRequestText(text);
  if (!value || startsAsQuestion(value) || COMMIT_NEGATION.test(value)) {
    return false;
  }
  return COMMIT_INTENT.test(value);
}

/** В сообщении пользователя есть явная просьба запушить (не вопрос и не отрицание). */
export function userRequestsGitPush(text: string): boolean {
  const value = normalizeGitRequestText(text);
  if (!value || startsAsQuestion(value) || PUSH_NEGATION.test(value)) {
    return false;
  }
  return PUSH_INTENT.test(value);
}

/** `git commit` через shell заблокирован для этого хода. */
export function shouldBlockGitCommit(
  command: string,
  userText = "",
  allowShellGit = false
): boolean {
  return (
    isGitCommitCommand(command) &&
    !(allowShellGit && userRequestsGitCommit(userText))
  );
}

/** `git push` через shell заблокирован для этого хода. */
export function shouldBlockGitPush(
  command: string,
  userText = "",
  allowShellGit = false
): boolean {
  if (!isGitPushCommand(command) || looksLikeExplicitPushRequest(userText)) {
    return false;
  }
  return !(allowShellGit && userRequestsGitPush(userText));
}

/**
 * Commit и push через run_command — только по явной просьбе в текущем
 * сообщении пользователя. Автоподтверждение команд в Settings (`allowShellGit`)
 * само по себе их не разрешает: без него commit только через UI-тег,
 * а push — только по короткой просьбе «запушь».
 */
export function shouldBlockGitCommitOrPush(
  command: string,
  userText = "",
  allowShellGit = false
): boolean {
  return (
    shouldBlockGitCommit(command, userText, allowShellGit) ||
    shouldBlockGitPush(command, userText, allowShellGit)
  );
}

export function isGitMutationCommand(command: string): boolean {
  return /(?:^|[;&|]\s*)git\s+(?:commit|checkout|restore|revert|reset|clean)(?:\s|$)/i.test(
    String(command || "")
  );
}

/**
 * Shell that undoes workspace edits (git discard or recursive rm).
 * Used so discard success messaging does not demand a follow-up write_file.
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

/** Сколько хвоста вывода хука показывать в ответе: ошибки обычно в конце. */
const HOOK_OUTPUT_TAIL_LINES = 60;
const HOOK_OUTPUT_TAIL_CHARS = 6000;

/**
 * Вывод упавшего `git commit` для ответа: stderr + stdout (eslint и tsc
 * печатают ошибки в stdout), только хвост, в fenced-блоке — иначе markdown
 * съедает glob-паттерны вроде `**\/*.spec.ts`.
 */
export function formatHookFailureOutput(stdout: string, stderr: string): string {
  const combined = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
  if (!combined) {
    return "";
  }
  let lines = combined.split(/\r?\n/);
  let truncated = false;
  if (lines.length > HOOK_OUTPUT_TAIL_LINES) {
    lines = lines.slice(-HOOK_OUTPUT_TAIL_LINES);
    truncated = true;
  }
  let text = lines.join("\n");
  if (text.length > HOOK_OUTPUT_TAIL_CHARS) {
    text = text.slice(-HOOK_OUTPUT_TAIL_CHARS);
    truncated = true;
  }
  const longestTicks = Math.max(
    2,
    ...(text.match(/`+/g) || []).map((run) => run.length)
  );
  const fence = "`".repeat(longestTicks + 1);
  return `${fence}\n${truncated ? "…\n" : ""}${text}\n${fence}`;
}

/**
 * Окружение для git из хоста: процесс расширений VS Code (и sidecar из
 * WebStorm) часто стартует без LANG / LC_*, и хуки на sh считают `${#line}`
 * в байтах, а grep не видит кириллицу. Добавляем только LC_CTYPE — язык
 * сообщений git (LC_MESSAGES) не меняется. Явный LC_ALL пользователя не трогаем.
 */
export function gitEnvWithUtf8Locale(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  if (env.LC_ALL) {
    return env;
  }
  const ctype = env.LC_CTYPE || env.LANG || "";
  if (/utf-?8/i.test(ctype)) {
    return env;
  }
  return {
    ...env,
    LC_CTYPE: platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8",
  };
}

const ANSI_ESCAPE_RE = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g;
const LIVE_LINE_MAX_CHARS = 140;

/** Последняя непустая строка потокового вывода хука — для строки статуса. */
export function lastHookOutputLine(output: string): string {
  const lines = output.replace(ANSI_ESCAPE_RE, "").split(/\r\n|\r|\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].replace(/\s+/g, " ").trim();
    if (line) {
      return line.length > LIVE_LINE_MAX_CHARS
        ? `${line.slice(0, LIVE_LINE_MAX_CHARS - 1)}…`
        : line;
    }
  }
  return "";
}
