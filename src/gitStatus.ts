import { execFile } from "child_process";
import { promisify } from "util";
import * as vscode from "vscode";
import { toRepoRelativePaths } from "./repoPaths";

const execFileAsync = promisify(execFile);

/** Есть ли незакоммиченные изменения по указанным путям (или в целом по workspace). */
export async function hasUncommittedChanges(
  relativePaths: string[] = []
): Promise<boolean> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return false;
  }

  const cwd = folder.uri.fsPath;
  const raw = (relativePaths || []).map(String).filter(Boolean);
  const paths = toRepoRelativePaths(raw, cwd);

  // Caller passed paths but none normalized → do NOT fall back to whole-repo
  // status (that kept the SCM bar visible for stale/mangled review paths).
  if (raw.length > 0 && paths.length === 0) {
    return false;
  }

  try {
    const args = [
      "status",
      "--porcelain",
      "--untracked-files=normal",
      ...(paths.length ? (["--", ...paths] as string[]) : []),
    ];
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 8000,
    });
    return stdout.trim().length > 0;
  } catch {
    // Не git-репозиторий / git недоступен — кнопку SCM не показываем без явных dirty-файлов
    return false;
  }
}

const GIT_SNAPSHOT_MAX_LINES = 40;

/** Compact branch + porcelain status for the agent turn (not a substitute for git tools). */
export async function buildGitSnapshotMessage(): Promise<string> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return "";
  }
  const cwd = folder.uri.fsPath;
  try {
    const [
      { stdout: branchOut },
      { stdout: statusOut },
      headMeta,
      aheadBehind,
    ] = await Promise.all([
      execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd,
        maxBuffer: 64 * 1024,
        timeout: 5000,
      }),
      execFileAsync(
        "git",
        ["status", "--porcelain", "--untracked-files=normal"],
        {
          cwd,
          maxBuffer: 512 * 1024,
          timeout: 8000,
        }
      ),
      execFileAsync(
        "git",
        ["log", "-1", "--format=%h %s"],
        { cwd, maxBuffer: 64 * 1024, timeout: 5000 }
      ).catch(() => ({ stdout: "" })),
      execFileAsync(
        "git",
        ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
        { cwd, maxBuffer: 16 * 1024, timeout: 5000 }
      ).catch(() => ({ stdout: "" })),
    ]);
    const branch = String(branchOut || "").trim() || "(unknown)";
    const detached = branch === "HEAD";
    const headLine = String(headMeta.stdout || "").trim();
    const counts = String(aheadBehind.stdout || "")
      .trim()
      .split(/\s+/);
    const behind = Number(counts[0]);
    const ahead = Number(counts[1]);
    const lines = String(statusOut || "")
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    const extra = Math.max(0, lines.length - GIT_SNAPSHOT_MAX_LINES);
    const shown = lines.slice(0, GIT_SNAPSHOT_MAX_LINES);
    const tracking =
      Number.isFinite(ahead) && Number.isFinite(behind)
        ? ahead === 0 && behind === 0
          ? "in sync with upstream"
          : `ahead ${ahead}, behind ${behind}`
        : "";
    const body = [
      "Git snapshot (may be stale — use run_command for exact status/diff):",
      detached ? "- Branch: detached HEAD" : `- Branch: ${branch}`,
      tracking ? `- Upstream: ${tracking}` : "",
      headLine ? `- HEAD: ${headLine}` : "",
      shown.length
        ? `- Dirty (${lines.length} path${lines.length === 1 ? "" : "s"}):`
        : "- Working tree: clean",
      ...shown.map((line) => `  ${line}`),
      extra > 0 ? `  … +${extra} more` : "",
    ].filter(Boolean);
    return body.join("\n");
  } catch {
    return "";
  }
}
