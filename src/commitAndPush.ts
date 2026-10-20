import { spawn } from "child_process";
import * as vscode from "vscode";
import {
  collectCommitDiff,
  composeCommitMessageText,
  fallbackCommitMessage,
  isCommitMessageModelNotConfiguredError,
} from "./commitMessage";
import { getConfig } from "./config";
import {
  formatGitRemoteOutput,
  formatHookFailureOutput,
  gitEnvWithUtf8Locale,
  lastHookOutputLine,
} from "./gitCommandPolicy";
import { resolveUiLanguage } from "./i18n";
import { toRepoRelativePaths } from "./repoPaths";

export type CommitAndPushStep = {
  command: string;
  ok: boolean;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  durationMs?: number;
};

/** Сколько вывода упавшей команды класть в карточку шага. */
const STEP_ERROR_PREVIEW_CHARS = 400;

/**
 * Шаг «Закоммитить» как одна карточка инструмента в ленте (как шаги агента):
 * `run_command` + статус + длительность. Раньше вывод git шёл отдельными
 * tool-сообщениями без имени, и панель рисовала их пустыми строками «Tool».
 */
export function commitStepToUiMessage(
  step: CommitAndPushStep,
  seq: number
): {
  role: "tool";
  text: string;
  step: {
    stepId: string;
    kind: "tool";
    name: string;
    argsPreview: string;
    status: "done" | "error";
    resultPreview?: string;
    durationMs?: number;
  };
} {
  const argsPreview = JSON.stringify({ command: step.command });
  const output = [step.stderr, step.stdout].filter(Boolean).join("\n").trim();
  const resultPreview =
    !step.ok && output
      ? output.length > STEP_ERROR_PREVIEW_CHARS
        ? `…${output.slice(-STEP_ERROR_PREVIEW_CHARS)}`
        : output
      : undefined;
  return {
    role: "tool",
    text: `⚙ run_command(${argsPreview})`,
    step: {
      stepId: `commit-${Date.now().toString(36)}-${seq}`,
      kind: "tool",
      name: "run_command",
      argsPreview,
      status: step.ok ? "done" : "error",
      ...(resultPreview ? { resultPreview } : {}),
      ...(typeof step.durationMs === "number"
        ? { durationMs: step.durationMs }
        : {}),
    },
  };
}

export type CommitAndPushResult = {
  ok: boolean;
  answer: string;
  commitMessage?: string;
  steps: CommitAndPushStep[];
  /** Offer UI action to open Settings → Commit messages. */
  openCommitMessageSettings?: boolean;
  /**
   * С `backgroundPush`: коммит уже создан, `git push` идёт в фоне — хост
   * освобождает чат сразу и показывает итог push, когда промис завершится.
   */
  push?: Promise<CommitPushOutcome>;
};

export type CommitPushOutcome = {
  ok: boolean;
  answer: string;
  step: CommitAndPushStep;
};

/**
 * Коммит отклонён из-за текста сообщения (commit-msg хук), а не из-за lint /
 * тестов в pre-commit: при падении pre-commit commit-msg не запускается.
 */
export function isCommitMessageRejected(stderr: string): boolean {
  return /commit[ -]?msg|commit message|сообщени\w* коммит|subject|header|первая строка|first line|длиннее|too long|conventional|commitlint/i.test(
    stderr
  );
}

/** Чужой git (встроенный Git VS Code, обновление SCM) держит index.lock. */
function isIndexLockError(stderr: string): boolean {
  return /index\.lock'?:? File exists/i.test(stderr);
}

const INDEX_LOCK_RETRY_DELAYS_MS = [250, 500, 1000, 1500, 2000];

/** Обычные git-команды (status / add / diff) — быстрые. */
const GIT_TIMEOUT_MS = 60_000;
/**
 * commit и push запускают хуки (pre-commit с tsc / eslint по всему проекту,
 * pre-push с тестами) — минуты на большом репозитории. С 60 с хук убивался
 * посреди вывода, и в ответе были только первые warnings.
 */
const GIT_HOOK_TIMEOUT_MS = 10 * 60_000;
/** Как часто обновлять статус строкой из вывода хука. */
const LIVE_OUTPUT_THROTTLE_MS = 300;

function timeoutForGitArgs(args: string[]): number {
  return args[0] === "commit" || args[0] === "push"
    ? GIT_HOOK_TIMEOUT_MS
    : GIT_TIMEOUT_MS;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

/**
 * git с повтором, пока index.lock занят параллельным процессом: VS Code
 * регулярно запускает `git status`, и наш `git add` / `commit` с ним
 * сталкивался («Unable to create index.lock: File exists»).
 */
async function runGit(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
  onOutput?: (chunk: string) => void
): Promise<GitRunResult> {
  let result = await runGitOnce(cwd, args, signal, onOutput);
  for (const ms of INDEX_LOCK_RETRY_DELAYS_MS) {
    if (result.ok || signal?.aborted || !isIndexLockError(result.stderr)) {
      break;
    }
    await delay(ms, signal);
    if (signal?.aborted) {
      break;
    }
    result = await runGitOnce(cwd, args, signal, onOutput);
  }
  return result;
}

type GitRunResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** Процесс убит по таймауту (не отмена пользователем). */
  timedOut?: boolean;
};

/** Сколько вывода git держать в памяти на поток (хвост важнее начала). */
const GIT_OUTPUT_CAP_CHARS = 8 * 1024 * 1024;

function appendCapped(buffer: string, chunk: string): string {
  const next = buffer + chunk;
  return next.length > GIT_OUTPUT_CAP_CHARS
    ? next.slice(-GIT_OUTPUT_CAP_CHARS)
    : next;
}

/**
 * spawn вместо execFile: вывод хуков (pre-commit с tsc / eslint) отдаётся по
 * мере появления — хост показывает его в статусе, а не молчит минуту.
 */
function runGitOnce(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
  onOutput?: (chunk: string) => void
): Promise<GitRunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (ok: boolean, errorText?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve({
        ok,
        stdout,
        stderr: ok ? stderr : stderr || errorText || "git failed",
        ...(timedOut && !signal?.aborted ? { timedOut: true } : {}),
      });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("git", args, {
        cwd,
        // Хуки (husky и т.п.) считают длину / ищут кириллицу через sh и grep:
        // без UTF-8 локали русская строка в 80 символов «длиннее 100».
        env: gitEnvWithUtf8Locale(process.env),
        signal,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      settle(false, error instanceof Error ? error.message : String(error));
      return;
    }
    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutForGitArgs(args));
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout = appendCapped(stdout, chunk);
      onOutput?.(chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr = appendCapped(stderr, chunk);
      onOutput?.(chunk);
    });
    child.on("error", (error) => settle(false, error.message));
    child.on("close", (code) => settle(code === 0 && !timedOut));
  });
}

function formatFallbackNote(
  reason: string | undefined,
  lang: string
): string {
  if (reason === undefined) {
    return "";
  }
  const detail = reason.trim();
  return lang === "ru"
    ? `\n\nСообщение коммита взято из шаблона: модель не сгенерировала его${detail ? ` (${detail})` : ""}. Проверьте модель в Settings → Commit messages.`
    : `\n\nThe commit message is a template: the model did not generate one${detail ? ` (${detail})` : ""}. Check the model in Settings → Commit messages.`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function formatCommand(args: string[]): string {
  return `git ${args.map(shellQuote).join(" ")}`;
}

function formatPathsForAnswer(paths: string[]): string {
  return paths.map((path) => `\`${path}\``).join(", ");
}

/**
 * Детерминированный commit+push только указанных путей — без agent loop.
 * Stage строго `git add -- <paths>`, затем сообщение, commit и push.
 */
export async function commitAndPushPaths(
  paths: string[],
  options?: {
    signal?: AbortSignal;
    onStep?: (step: CommitAndPushStep) => void;
    onPhase?: (detail: string) => void;
    /**
     * Не ждать `git push`: вернуть результат сразу после коммита, а push
     * отдать промисом в `result.push` (без `signal` — «Стоп» чата его не рвёт).
     */
    backgroundPush?: boolean;
  }
): Promise<CommitAndPushResult> {
  const lang = resolveUiLanguage(getConfig().language);
  const steps: CommitAndPushStep[] = [];
  const folder = vscode.workspace.workspaceFolders?.[0];

  const finish = (
    ok: boolean,
    answer: string,
    commitMessage?: string,
    extras?: { openCommitMessageSettings?: boolean }
  ): CommitAndPushResult => ({
    ok,
    answer,
    commitMessage,
    steps,
    ...(extras?.openCommitMessageSettings
      ? { openCommitMessageSettings: true }
      : {}),
  });

  if (!folder) {
    return finish(
      false,
      lang === "ru" ? "Нет открытой папки workspace." : "No workspace folder open."
    );
  }
  const cwd = folder.uri.fsPath;
  const scoped = toRepoRelativePaths(paths, cwd);
  if (!scoped.length) {
    return finish(
      false,
      lang === "ru" ? "Нет путей для коммита." : "No paths to commit."
    );
  }
  const signal = options?.signal;
  const record = (step: CommitAndPushStep) => {
    steps.push(step);
    options?.onStep?.(step);
  };
  const run = async (
    args: string[],
    runOptions?: {
      /** Подпись фазы для живого вывода хуков: «pre-commit хук · <строка>». */
      liveLabel?: string;
      signal?: AbortSignal | null;
      record?: boolean;
    }
  ): Promise<CommitAndPushStep> => {
    const command = formatCommand(args);
    const startPhase =
      lang === "ru" ? `Запускает · ${command}` : `Running · ${command}`;
    options?.onPhase?.(startPhase);
    let pending = "";
    let lastShownAt = 0;
    const liveLabel = runOptions?.liveLabel;
    const onOutput = liveLabel
      ? (chunk: string) => {
          pending += chunk;
          const now = Date.now();
          if (now - lastShownAt < LIVE_OUTPUT_THROTTLE_MS) {
            return;
          }
          const line = lastHookOutputLine(pending);
          pending = pending.slice(-4096);
          if (line) {
            lastShownAt = now;
            options?.onPhase?.(`${liveLabel} · ${line}`);
          }
        }
      : undefined;
    const startedAt = Date.now();
    const result = await runGit(
      cwd,
      args,
      runOptions?.signal === null ? undefined : signal,
      onOutput
    );
    const step: CommitAndPushStep = {
      command,
      ok: result.ok,
      stdout: result.stdout.trim() || undefined,
      stderr: result.stderr.trim() || undefined,
      ...(result.timedOut ? { timedOut: true } : {}),
      durationMs: Date.now() - startedAt,
    };
    if (runOptions?.record !== false) {
      record(step);
    }
    return step;
  };

  const status = await run([
    "status",
    "--short",
    "--untracked-files=normal",
    "--",
    ...scoped,
  ]);
  if (!status.ok) {
    return finish(
      false,
      lang === "ru"
        ? `Не удалось проверить изменения: ${(status.stderr || "ошибка git").trim()}`
        : `Failed to check changes: ${(status.stderr || "git error").trim()}`
    );
  }
  if (!(status.stdout || "").trim()) {
    return finish(
      false,
      lang === "ru"
        ? "По этим файлам нет незакоммиченных изменений."
        : "No uncommitted changes for these files."
    );
  }

  const add = await run(["add", "--", ...scoped]);
  if (!add.ok) {
    return finish(
      false,
      lang === "ru"
        ? `Не удалось добавить файлы в индекс: ${(add.stderr || "ошибка git").trim()}`
        : `Failed to stage files: ${(add.stderr || "git error").trim()}`
    );
  }

  const staged = await run(["diff", "--cached", "--name-only", "--", ...scoped]);
  if (!staged.ok || !(staged.stdout || "").trim()) {
    return finish(
      false,
      lang === "ru"
        ? "После git add в индексе нет изменений по этим путям."
        : "Nothing staged for these paths after git add."
    );
  }

  options?.onPhase?.(
    lang === "ru" ? "Генерирую сообщение коммита…" : "Generating commit message…"
  );
  let commitMessage = "";
  /** Модель не дала сообщение — коммит с шаблоном; причину показываем. */
  let usedFallbackReason: string | undefined;
  let collected: Awaited<ReturnType<typeof collectCommitDiff>>;
  try {
    collected = await collectCommitDiff(cwd, scoped);
    commitMessage = await composeCommitMessageText(
      cwd,
      collected,
      signal,
      scoped
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || /aborted/i.test(error.message))
    ) {
      return finish(
        false,
        lang === "ru" ? "Операция отменена." : "Operation cancelled."
      );
    }
    if (isCommitMessageModelNotConfiguredError(error)) {
      return finish(false, error.message, undefined, {
        openCommitMessageSettings: true,
      });
    }
    commitMessage = fallbackCommitMessage(scoped, lang);
    usedFallbackReason =
      error instanceof Error ? error.message : String(error || "");
  }
  if (!commitMessage.trim()) {
    commitMessage = fallbackCommitMessage(scoped, lang);
    usedFallbackReason = lang === "ru" ? "пустой ответ модели" : "empty model reply";
  }

  const commitLiveLabel =
    lang === "ru" ? "Хуки git commit" : "git commit hooks";
  let commit = await run(["commit", "-m", commitMessage], {
    liveLabel: commitLiveLabel,
  });
  if (
    !commit.ok &&
    !signal?.aborted &&
    isCommitMessageRejected(commit.stderr || "")
  ) {
    // commit-msg хук отклонил текст (длина, формат, язык): один повтор с
    // выводом хука в промпте. Файлы уже в индексе, pre-commit прогонится снова.
    options?.onPhase?.(
      lang === "ru"
        ? "Хук отклонил сообщение — генерирую новое…"
        : "Hook rejected the message — regenerating…"
    );
    let retryMessage = "";
    try {
      retryMessage = await composeCommitMessageText(
        cwd,
        collected,
        signal,
        scoped,
        { message: commitMessage, output: commit.stderr || "" }
      );
    } catch {
      retryMessage = "";
    }
    if (retryMessage.trim() && retryMessage.trim() !== commitMessage.trim()) {
      commitMessage = retryMessage;
      commit = await run(["commit", "-m", commitMessage], {
        liveLabel: commitLiveLabel,
      });
    }
  }
  if (!commit.ok) {
    const output = formatHookFailureOutput(
      commit.stdout || "",
      commit.stderr || ""
    );
    const minutes = Math.round(GIT_HOOK_TIMEOUT_MS / 60_000);
    const head = commit.timedOut
      ? lang === "ru"
        ? `Не удалось создать коммит: git commit (вместе с pre-commit хуком) не уложился в ${minutes} мин и был остановлен.`
        : `Failed to commit: git commit (including the pre-commit hook) did not finish within ${minutes} min and was stopped.`
      : lang === "ru"
        ? "Не удалось создать коммит:"
        : "Failed to commit:";
    return finish(
      false,
      output
        ? `${head}\n\n${output}`
        : `${head}${commit.timedOut ? "" : lang === "ru" ? " ошибка git" : " git error"}`,
      commitMessage
    );
  }

  const filesLabel = formatPathsForAnswer(scoped);
  const runPush = async (
    background: boolean
  ): Promise<CommitPushOutcome> => {
    const push = await run(["push"], {
      liveLabel: lang === "ru" ? "git push" : "git push",
      // Фоновый push живёт дольше прогона чата: его AbortSignal не трогаем.
      ...(background ? { signal: null, record: false } : {}),
    });
    if (!push.ok) {
      const detail = push.timedOut
        ? lang === "ru"
          ? `git push (вместе с pre-push хуком) не уложился в ${Math.round(GIT_HOOK_TIMEOUT_MS / 60_000)} мин и был остановлен.`
          : `git push (including the pre-push hook) did not finish within ${Math.round(GIT_HOOK_TIMEOUT_MS / 60_000)} min and was stopped.`
        : formatGitRemoteOutput(push.stdout, push.stderr);
      return {
        ok: false,
        step: push,
        answer:
          lang === "ru"
            ? `Коммит создан, но push не удался:${detail ? `\n\n${detail}` : ` ${(push.stderr || "ошибка git").trim()}`}`
            : `Commit created, but push failed:${detail ? `\n\n${detail}` : ` ${(push.stderr || "git error").trim()}`}`,
      };
    }
    const remoteOut = formatGitRemoteOutput(push.stdout, push.stderr);
    const summary = background
      ? lang === "ru"
        ? `Push выполнен (${filesLabel}).`
        : `Push done (${filesLabel}).`
      : lang === "ru"
        ? `Готово. Изменения (${filesLabel}) закоммичены и запушены.`
        : `Done. Changes (${filesLabel}) committed and pushed.`;
    return {
      ok: true,
      step: push,
      answer: remoteOut ? `${summary}\n\n${remoteOut}` : summary,
    };
  };

  if (options?.backgroundPush) {
    const subject = commitMessage.split(/\r?\n/, 1)[0]?.trim() || "";
    const committed =
      lang === "ru"
        ? `Коммит создан (${filesLabel})${subject ? `: «${subject}»` : ""}. Push выполняется в фоне…`
        : `Commit created (${filesLabel})${subject ? `: “${subject}”` : ""}. Pushing in the background…`;
    const fallbackNote = formatFallbackNote(usedFallbackReason, lang);
    return {
      ...finish(true, `${committed}${fallbackNote}`, commitMessage),
      push: runPush(true),
    };
  }

  const pushed = await runPush(false);
  return finish(
    pushed.ok,
    `${pushed.answer}${formatFallbackNote(usedFallbackReason, lang)}`,
    commitMessage
  );
}
