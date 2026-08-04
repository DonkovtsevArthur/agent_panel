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
