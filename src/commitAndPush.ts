import { execFile } from "child_process";
import { promisify } from "util";
import * as vscode from "vscode";
import {
  collectCommitDiff,
  composeCommitMessageText,
  fallbackCommitMessage,
} from "./commitMessage";
import { getConfig } from "./config";
import { formatGitRemoteOutput } from "./gitCommandPolicy";
import { resolveUiLanguage } from "./i18n";
import { toRepoRelativePaths } from "./repoPaths";

const execFileAsync = promisify(execFile);

export type CommitAndPushStep = {
  command: string;
  ok: boolean;
  stdout?: string;
  stderr?: string;
};

export type CommitAndPushResult = {
  ok: boolean;
  answer: string;
  commitMessage?: string;
  steps: CommitAndPushStep[];
};

async function runGit(
  cwd: string,
  args: string[],
  signal?: AbortSignal
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 60_000,
      signal,
    });
    return {
      ok: true,
      stdout: String(stdout || ""),
      stderr: String(stderr || ""),
    };
  } catch (error) {
    const err = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    return {
      ok: false,
      stdout: String(err.stdout || ""),
      stderr: String(err.stderr || err.message || "git failed"),
    };
  }
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
  }
): Promise<CommitAndPushResult> {
  const lang = resolveUiLanguage(getConfig().language);
  const steps: CommitAndPushStep[] = [];
  const folder = vscode.workspace.workspaceFolders?.[0];

  const finish = (ok: boolean, answer: string, commitMessage?: string) => ({
    ok,
    answer,
    commitMessage,
    steps,
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
  const run = async (args: string[]): Promise<CommitAndPushStep> => {
    const command = formatCommand(args);
    options?.onPhase?.(
      lang === "ru" ? `Запускает · ${command}` : `Running · ${command}`
    );
    const result = await runGit(cwd, args, signal);
    const step: CommitAndPushStep = {
      command,
      ok: result.ok,
      stdout: result.stdout.trim() || undefined,
      stderr: result.stderr.trim() || undefined,
    };
    record(step);
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
  try {
    const collected = await collectCommitDiff(cwd, scoped);
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
    commitMessage = fallbackCommitMessage(scoped, lang);
  }
  if (!commitMessage.trim()) {
    commitMessage = fallbackCommitMessage(scoped, lang);
  }

  const commit = await run(["commit", "-m", commitMessage]);
  if (!commit.ok) {
    return finish(
      false,
      lang === "ru"
        ? `Не удалось создать коммит: ${(commit.stderr || "ошибка git").trim()}`
        : `Failed to commit: ${(commit.stderr || "git error").trim()}`,
      commitMessage
    );
  }

  const push = await run(["push"]);
  if (!push.ok) {
    const detail = formatGitRemoteOutput(push.stdout, push.stderr);
    return finish(
      false,
      lang === "ru"
        ? `Коммит создан, но push не удался:${detail ? `\n\n${detail}` : ` ${(push.stderr || "ошибка git").trim()}`}`
        : `Commit created, but push failed:${detail ? `\n\n${detail}` : ` ${(push.stderr || "git error").trim()}`}`,
      commitMessage
    );
  }

  const filesLabel = formatPathsForAnswer(scoped);
  const remoteOut = formatGitRemoteOutput(push.stdout, push.stderr);
  const summary =
    lang === "ru"
      ? `Готово. Изменения (${filesLabel}) закоммичены и запушены.`
      : `Done. Changes (${filesLabel}) committed and pushed.`;
  return finish(
    true,
    remoteOut ? `${summary}\n\n${remoteOut}` : summary,
    commitMessage
  );
}
