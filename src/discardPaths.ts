import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";
import { toRepoRelativePath, toRepoRelativePaths } from "./repoPaths";

const execFileAsync = promisify(execFile);

export type DiscardPathsStep = {
  command: string;
  ok: boolean;
  stdout?: string;
  stderr?: string;
};

export type DiscardPathsResult = {
  ok: boolean;
  answer: string;
  steps: DiscardPathsStep[];
};

export type DiscardPathPlan = {
  restore: string[];
  remove: string[];
};

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
  return paths.map((p) => `\`${p}\``).join(", ");
}

/**
 * Parse `git status --porcelain` for scoped paths into restore vs remove.
 * Untracked (`??`) → remove; everything else dirty → restore (index+worktree).
 * vscode-free — unit-tested.
 */
export function classifyDiscardPathsFromStatus(
  porcelain: string,
  scopedPaths: string[],
  cwd?: string | null
): DiscardPathPlan {
  const scoped = new Set(toRepoRelativePaths(scopedPaths, cwd));
  const restore = new Set<string>();
  const remove = new Set<string>();

  const lines = String(porcelain || "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean);

  for (const line of lines) {
    if (line.length < 4) {
      continue;
    }
    const xy = line.slice(0, 2);
    let rest = line.slice(3);
    // Renames: `R  old -> new` or quoted variants — take the final path.
    const arrow = rest.includes(" -> ") ? rest.lastIndexOf(" -> ") : -1;
    if (arrow >= 0) {
      rest = rest.slice(arrow + 4);
    }
    const filePath = rest.replace(/^"|"$/g, "").replace(/\\"/g, '"').trim();
    if (!filePath) {
      continue;
    }
    const norm = toRepoRelativePath(filePath, cwd);
    if (!norm) {
      continue;
    }
    // If scoped list is non-empty, only touch paths in that set (or nested under).
    if (scoped.size) {
      const inScope = [...scoped].some(
        (s) => norm === s || norm.startsWith(`${s}/`) || s.startsWith(`${norm}/`)
      );
      if (!inScope) {
        continue;
      }
    }
    if (xy === "??") {
      remove.add(norm);
    } else {
      restore.add(norm);
    }
  }

  return {
    restore: [...restore],
    remove: [...remove],
  };
}

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

/**
 * Детерминированный откат только указанных путей — без agent loop.
 * Tracked dirty → `git restore --staged --worktree`; untracked → rm.
 */
export async function discardPaths(
  paths: string[],
  options?: {
    signal?: AbortSignal;
    onStep?: (step: DiscardPathsStep) => void;
    onPhase?: (detail: string) => void;
  }
): Promise<DiscardPathsResult> {
  // Lazy vscode — keep classifyDiscardPathsFromStatus importable in unit tests.
  const vscode = require("vscode") as typeof import("vscode");
  const { getConfig } = require("./config") as typeof import("./config");
  const { resolveUiLanguage } = require("./i18n") as typeof import("./i18n");

  const lang = resolveUiLanguage(getConfig().language);
  const steps: DiscardPathsStep[] = [];
  const folder = vscode.workspace.workspaceFolders?.[0];

  const finish = (ok: boolean, answer: string) => ({
    ok,
    answer,
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
      lang === "ru" ? "Нет путей для отмены." : "No paths to discard."
    );
  }
  const signal = options?.signal;
  const record = (step: DiscardPathsStep) => {
    steps.push(step);
    options?.onStep?.(step);
  };
  const run = async (args: string[]): Promise<DiscardPathsStep> => {
    const command = formatCommand(args);
    options?.onPhase?.(
      lang === "ru" ? `Запускает · ${command}` : `Running · ${command}`
    );
    const result = await runGit(cwd, args, signal);
    const step: DiscardPathsStep = {
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
    "--porcelain",
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

  const plan = classifyDiscardPathsFromStatus(status.stdout || "", scoped, cwd);
  if (!plan.restore.length && !plan.remove.length) {
    return finish(
      false,
      lang === "ru"
        ? "По этим файлам нет незакоммиченных изменений."
        : "No uncommitted changes for these files."
    );
  }

  if (plan.restore.length) {
    const restore = await run([
      "restore",
      "--source=HEAD",
      "--staged",
      "--worktree",
      "--",
      ...plan.restore,
    ]);
    if (!restore.ok) {
      return finish(
        false,
        lang === "ru"
          ? `Не удалось восстановить файлы: ${(restore.stderr || "ошибка git").trim()}`
          : `Failed to restore files: ${(restore.stderr || "git error").trim()}`
      );
    }
  }

  if (plan.remove.length) {
    options?.onPhase?.(
      lang === "ru"
        ? `Удаляю неотслеживаемые · ${plan.remove.length}`
        : `Removing untracked · ${plan.remove.length}`
    );
    const removed: string[] = [];
    const failed: string[] = [];
    for (const rel of plan.remove) {
      if (signal?.aborted) {
        return finish(
          false,
          lang === "ru" ? "Операция отменена." : "Operation cancelled."
        );
      }
      const abs = path.join(cwd, rel);
      const rootResolved = path.resolve(cwd);
      const absResolved = path.resolve(abs);
      if (
        absResolved !== rootResolved &&
        !absResolved.startsWith(rootResolved + path.sep)
      ) {
        failed.push(rel);
        continue;
      }
      try {
        await fs.rm(abs, { recursive: true, force: true });
        removed.push(rel);
      } catch {
        failed.push(rel);
      }
    }
    record({
      command: `rm -rf -- ${plan.remove.map(shellQuote).join(" ")}`,
      ok: failed.length === 0,
      stdout: removed.length
        ? lang === "ru"
          ? `Удалено: ${removed.join(", ")}`
          : `Removed: ${removed.join(", ")}`
        : undefined,
      stderr: failed.length
        ? lang === "ru"
          ? `Не удалось удалить: ${failed.join(", ")}`
          : `Failed to remove: ${failed.join(", ")}`
        : undefined,
    });
    if (failed.length) {
      return finish(
        false,
        lang === "ru"
          ? `Часть файлов не удалось удалить: ${failed.map((p) => `\`${p}\``).join(", ")}`
          : `Failed to remove some files: ${failed.map((p) => `\`${p}\``).join(", ")}`
      );
    }
  }

  const touched = [...plan.restore, ...plan.remove];
  const filesLabel = formatPathsForAnswer(touched);
  return finish(
    true,
    lang === "ru"
      ? `Готово. Изменения отменены (${filesLabel}).`
      : `Done. Changes discarded (${filesLabel}).`
  );
}
