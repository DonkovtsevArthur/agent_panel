import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";
import { matchSeedsToDirtyPaths } from "./repoPaths";

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

export type DirtyEntry = {
  xy: string;
  path: string;
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

function isUntrackedOrNew(xy: string): boolean {
  return xy === "??" || xy[0] === "?" || xy[0] === "A";
}

function normKey(p: string): string {
  const n = String(p || "")
    .trim()
    .replace(/\\/g, "/")
    .normalize("NFC");
  return process.platform === "darwin" || process.platform === "win32"
    ? n.toLowerCase()
    : n;
}

/** Parse porcelain lines — keep paths exactly as git printed them. */
export function parsePorcelainEntries(porcelain: string): DirtyEntry[] {
  const out: DirtyEntry[] = [];
  for (const raw of String(porcelain || "").split(/\r?\n/)) {
    const line = raw.replace(/\r$/, "");
    if (line.length < 4) {
      continue;
    }
    const xy = line.slice(0, 2);
    let rest = line.slice(3);
    const arrow = rest.includes(" -> ") ? rest.lastIndexOf(" -> ") : -1;
    if (arrow >= 0) {
      rest = rest.slice(arrow + 4);
    }
    const filePath = rest.replace(/^"|"$/g, "").replace(/\\"/g, '"').trim();
    if (!filePath) {
      continue;
    }
    out.push({ xy, path: filePath.replace(/\\/g, "/") });
  }
  return out;
}

export function classifyDiscardPathsFromStatus(
  porcelain: string,
  scopedPaths: string[],
  root?: string | null
): DiscardPathPlan {
  const entries = parsePorcelainEntries(porcelain);
  const allPaths = entries.map((e) => e.path);
  const scoped = (scopedPaths || [])
    .map((p) => String(p || "").trim().replace(/\\/g, "/"))
    .filter(Boolean);
  const keepList = scoped.length
    ? matchSeedsToDirtyPaths(scoped, allPaths, root)
    : allPaths;
  const keep = new Set(keepList);

  const restore = new Set<string>();
  const remove = new Set<string>();
  for (const e of entries) {
    if (!keep.has(e.path)) {
      continue;
    }
    if (isUntrackedOrNew(e.xy)) {
      remove.add(e.path);
    } else {
      restore.add(e.path);
    }
  }
  return { restore: [...restore], remove: [...remove] };
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

async function pathExists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Expand UI seeds into git-root-relative candidates that actually exist or are dirty.
 */
export function expandSeedsToGitRelPaths(
  seeds: string[],
  gitRoot: string,
  workspaceRoot: string
): string[] {
  const root = path.resolve(gitRoot);
  const workspace = path.resolve(workspaceRoot);
  const out = new Set<string>();

  const addIfUnderRoot = (abs: string) => {
    const resolved = path.resolve(abs);
    const rel = path.relative(root, resolved).replace(/\\/g, "/");
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      return;
    }
    out.add(rel);
  };

  for (const seed of seeds) {
    const s = String(seed || "")
      .trim()
      .replace(/\\/g, "/");
    if (!s) {
      continue;
    }
    if (path.isAbsolute(s) || /^[A-Za-z]:\//.test(s)) {
      addIfUnderRoot(s);
      continue;
    }
    out.add(s.replace(/^\.\//, ""));
    addIfUnderRoot(path.join(workspace, s));
    addIfUnderRoot(path.join(root, s));
  }
  return [...out];
}

/**
 * Prefer longer dirty paths when matching (src/app/foo.ts over foo.ts).
 */
export function pickDiscardTargets(
  seeds: string[],
  dirtyPaths: string[],
  gitRoot: string,
  workspaceRoot: string
): string[] {
  const expanded = expandSeedsToGitRelPaths(seeds, gitRoot, workspaceRoot);
  const matched = matchSeedsToDirtyPaths(
    [...seeds, ...expanded],
    dirtyPaths,
    gitRoot
  );
  // Longest path first — never keep a basename if a longer dirty path matched.
  const byBase = new Map<string, string>();
  for (const p of matched) {
    const base = p.includes("/") ? p.slice(p.lastIndexOf("/") + 1) : p;
    const key = normKey(base);
    const prev = byBase.get(key);
    if (!prev || p.length > prev.length || p.includes("/")) {
      if (!prev || p.length >= prev.length) {
        byBase.set(key, p);
      }
    }
  }
  // If expanded seed is itself dirty, always include it.
  const out = new Set<string>([...byBase.values()]);
  for (const e of expanded) {
    if (dirtyPaths.some((d) => normKey(d) === normKey(e))) {
      out.add(dirtyPaths.find((d) => normKey(d) === normKey(e)) || e);
    }
  }
  return [...out];
}

async function isTrackedByGit(
  cwd: string,
  relPath: string,
  signal?: AbortSignal
): Promise<boolean> {
  const result = await runGit(
    cwd,
    ["ls-files", "--error-unmatch", "--", relPath],
    signal
  );
  return result.ok;
}

async function deleteRepoPath(
  gitRoot: string,
  rel: string
): Promise<{ ok: boolean; error?: string; missing?: boolean }> {
  const abs = path.join(gitRoot, rel);
  const rootResolved = path.resolve(gitRoot);
  const absResolved = path.resolve(abs);
  if (
    absResolved !== rootResolved &&
    !absResolved.startsWith(rootResolved + path.sep)
  ) {
    return { ok: false, error: "path outside repo" };
  }
  if (!(await pathExists(abs))) {
    return { ok: false, missing: true, error: "file not found" };
  }
  try {
    await fs.rm(abs, { recursive: true, force: false });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Откат файлов из SCM-бара / review.
 * После операций обязательно проверяем, что path больше не dirty.
 */
export async function discardPaths(
  paths: string[],
  options?: {
    signal?: AbortSignal;
    onStep?: (step: DiscardPathsStep) => void;
    onPhase?: (detail: string) => void;
    fallbackPaths?: string[];
  }
): Promise<DiscardPathsResult> {
  const vscode = require("vscode") as typeof import("vscode");
  const { getConfig } = require("./config") as typeof import("./config");
  const { resolveUiLanguage } = require("./i18n") as typeof import("./i18n");

  const lang = resolveUiLanguage(getConfig().language);
  const steps: DiscardPathsStep[] = [];
  const folder = vscode.workspace.workspaceFolders?.[0];

  const finish = (ok: boolean, answer: string) => ({ ok, answer, steps });

  if (!folder) {
    return finish(
      false,
      lang === "ru" ? "Нет открытой папки workspace." : "No workspace folder open."
    );
  }

  const workspaceRoot = folder.uri.fsPath;
  const signal = options?.signal;
  const record = (step: DiscardPathsStep) => {
    steps.push(step);
    options?.onStep?.(step);
  };
  const run = async (cwd: string, args: string[]): Promise<DiscardPathsStep> => {
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

  const top = await runGit(
    workspaceRoot,
    ["rev-parse", "--show-toplevel"],
    signal
  );
  const gitRoot = top.ok
    ? String(top.stdout || "").trim() || workspaceRoot
    : workspaceRoot;

  const rawSeeds = [
    ...new Set(
      [...(paths || []), ...(options?.fallbackPaths || [])]
        .map(String)
        .map((p) => p.trim().replace(/\\/g, "/"))
        .filter(Boolean)
    ),
  ];
  if (!rawSeeds.length) {
    return finish(
      false,
      lang === "ru" ? "Нет путей для отмены." : "No paths to discard."
    );
  }

  const status = await run(gitRoot, [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]);
  if (!status.ok) {
    return finish(
      false,
      lang === "ru"
        ? `Не удалось проверить изменения: ${(status.stderr || "ошибка git").trim()}`
        : `Failed to check changes: ${(status.stderr || "git error").trim()}`
    );
  }
  const porcelain = status.stdout || "";
  if (!porcelain.trim()) {
    return finish(
      false,
      lang === "ru"
        ? "В workspace нет незакоммиченных изменений."
        : "No uncommitted changes in the workspace."
    );
  }

  const entries = parsePorcelainEntries(porcelain);
  const dirtyPaths = entries.map((e) => e.path);
  const targets = pickDiscardTargets(
    rawSeeds,
    dirtyPaths,
    gitRoot,
    workspaceRoot
  );

  if (!targets.length) {
    return finish(
      false,
      lang === "ru"
        ? `По файлам из этой правки нет незакоммиченных изменений.\nИскал: ${rawSeeds.slice(0, 8).join(", ")}\nСейчас dirty: ${dirtyPaths.slice(0, 8).join(", ") || "—"}`
        : `No uncommitted changes for this edit's files.\nTried: ${rawSeeds.slice(0, 8).join(", ")}\nDirty now: ${dirtyPaths.slice(0, 8).join(", ") || "—"}`
    );
  }

  const restore: string[] = [];
  const remove: string[] = [];

  for (const rel of targets) {
    const entry = entries.find((e) => normKey(e.path) === normKey(rel));
    const xy = entry?.xy || "??";
    const gitRel = entry?.path || rel;

    if (isUntrackedOrNew(xy)) {
      remove.push(gitRel);
      continue;
    }
    const tracked = await isTrackedByGit(gitRoot, gitRel, signal);
    if (tracked) {
      restore.push(gitRel);
    } else {
      remove.push(gitRel);
    }
  }

  const touched: string[] = [];

  for (const rel of [...new Set(restore)]) {
    const restoreStep = await run(gitRoot, [
      "restore",
      "--source=HEAD",
      "--staged",
      "--worktree",
      "--",
      rel,
    ]);
    if (restoreStep.ok) {
      touched.push(rel);
      continue;
    }
    const retry = await run(gitRoot, ["checkout", "HEAD", "--", rel]);
    if (retry.ok) {
      touched.push(rel);
      continue;
    }
    const pathspecFail = /pathspec|did not match/i.test(
      `${restoreStep.stderr || ""} ${retry.stderr || ""}`
    );
    if (pathspecFail) {
      remove.push(rel);
      continue;
    }
    return finish(
      false,
      lang === "ru"
        ? `Не удалось восстановить \`${rel}\`: ${(retry.stderr || restoreStep.stderr || "ошибка git").trim()}`
        : `Failed to restore \`${rel}\`: ${(retry.stderr || restoreStep.stderr || "git error").trim()}`
    );
  }

  if (remove.length) {
    options?.onPhase?.(
      lang === "ru"
        ? `Удаляю неотслеживаемые · ${[...new Set(remove)].length}`
        : `Removing untracked · ${[...new Set(remove)].length}`
    );
    const uniqueRemove = [...new Set(remove)];
    await run(gitRoot, [
      "rm",
      "-f",
      "--ignore-unmatch",
      "--cached",
      "--",
      ...uniqueRemove,
    ]);

    for (const rel of uniqueRemove) {
      if (signal?.aborted) {
        return finish(
          false,
          lang === "ru" ? "Операция отменена." : "Operation cancelled."
        );
      }
      const deleted = await deleteRepoPath(gitRoot, rel);
      record({
        command: `rm -rf -- ${shellQuote(rel)}`,
        ok: deleted.ok,
        stdout: deleted.ok ? rel : undefined,
        stderr: deleted.error,
      });
      if (deleted.missing) {
        // Don't claim success for a no-op delete — verification will catch leftover dirty.
        continue;
      }
      if (!deleted.ok) {
        return finish(
          false,
          lang === "ru"
            ? `Не удалось удалить \`${rel}\`: ${deleted.error || "ошибка"}`
            : `Failed to remove \`${rel}\`: ${deleted.error || "error"}`
        );
      }
      touched.push(rel);
    }
  }

  // Verify: targets must no longer be dirty.
  const verify = await runGit(
    gitRoot,
    [
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      ...targets,
    ],
    signal
  );
  const still = parsePorcelainEntries(verify.stdout || "").map((e) => e.path);
  // Also re-check expanded seeds in case target list used short names
  const verifySeeds = expandSeedsToGitRelPaths(
    rawSeeds,
    gitRoot,
    workspaceRoot
  );
  const verify2 =
    verifySeeds.length && verifySeeds.some((s) => !targets.includes(s))
      ? await runGit(
          gitRoot,
          [
            "status",
            "--porcelain",
            "--untracked-files=all",
            "--",
            ...verifySeeds,
          ],
          signal
        )
      : verify;
  const still2 = parsePorcelainEntries(verify2.stdout || "").map((e) => e.path);
  const stillDirty = [...new Set([...still, ...still2])];

  if (stillDirty.length) {
    // One more pass on whatever is still dirty (path was wrong the first time).
    for (const rel of stillDirty) {
      const tracked = await isTrackedByGit(gitRoot, rel, signal);
      if (tracked) {
        const r = await run(gitRoot, [
          "restore",
          "--source=HEAD",
          "--staged",
          "--worktree",
          "--",
          rel,
        ]);
        if (!r.ok) {
          await run(gitRoot, ["checkout", "HEAD", "--", rel]);
        }
      } else {
        await run(gitRoot, [
          "rm",
          "-f",
          "--ignore-unmatch",
          "--cached",
          "--",
          rel,
        ]);
        await deleteRepoPath(gitRoot, rel);
      }
    }
    const recheck = await runGit(
      gitRoot,
      [
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--",
        ...stillDirty,
      ],
      signal
    );
    const leftover = parsePorcelainEntries(recheck.stdout || "").map(
      (e) => e.path
    );
    if (leftover.length) {
      return finish(
        false,
        lang === "ru"
          ? `Не удалось отменить изменения — файлы всё ещё dirty: ${leftover.map((p) => `\`${p}\``).join(", ")}`
          : `Discard incomplete — still dirty: ${leftover.map((p) => `\`${p}\``).join(", ")}`
      );
    }
    touched.push(...stillDirty);
  }

  if (!touched.length) {
    // Ops claimed nothing but verification is clean → paths were already clean after a partial op.
    // Still ok only if targets are clean (checked above).
    return finish(
      true,
      lang === "ru"
        ? `Готово. Изменения отменены (${formatPathsForAnswer(targets)}).`
        : `Done. Changes discarded (${formatPathsForAnswer(targets)}).`
    );
  }

  return finish(
    true,
    lang === "ru"
      ? `Готово. Изменения отменены (${formatPathsForAnswer([...new Set(touched)])}).`
      : `Done. Changes discarded (${formatPathsForAnswer([...new Set(touched)])}).`
  );
}
