import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as vscode from "vscode";
import { takeEditBefore } from "./editSnapshots";

const execFileAsync = promisify(execFile);

export const GIT_DIFF_SCHEME = "harbor-git-diff";

const headContentById = new Map<string, string>();
let headContentSeq = 0;

function normalizeRel(p: string): string {
  return p.trim().replace(/^\.\//, "").replace(/^\/+/, "").replace(/\\/g, "/");
}

async function readGitHeadContent(
  relativePath: string
): Promise<{ content: string; exists: boolean } | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }
  const workspaceRel = normalizeRel(relativePath);
  if (
    !workspaceRel ||
    workspaceRel.includes("\0") ||
    /(^|\/)\.\.(\/|$)/.test(workspaceRel)
  ) {
    return undefined;
  }

  const absolutePath = path.join(
    folder.uri.fsPath,
    ...workspaceRel.split("/")
  );

  let cwd = folder.uri.fsPath;
  let gitRel = workspaceRel;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd: folder.uri.fsPath, timeout: 5000, encoding: "utf8" }
    );
    const toplevel = stdout.trim();
    if (toplevel) {
      cwd = toplevel;
      const relToGit = normalizeRel(path.relative(toplevel, absolutePath));
      if (!relToGit || relToGit.startsWith("../") || path.isAbsolute(relToGit)) {
        return undefined;
      }
      gitRel = relToGit;
    }
  } catch {
    return undefined;
  }

  try {
    const { stdout } = await execFileAsync("git", ["show", `HEAD:${gitRel}`], {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
      timeout: 15000,
      encoding: "utf8",
    });
    return { content: stdout, exists: true };
  } catch {
    return { content: "", exists: false };
  }
}

export class GitHeadContentProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    return headContentById.get(uri.query) ?? "";
  }
}

export function registerGitDiffProvider(
  subscriptions: vscode.Disposable[]
): void {
  subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      GIT_DIFF_SCHEME,
      new GitHeadContentProvider()
    )
  );
}

function leftDiffUri(relativePath: string, content: string): vscode.Uri {
  const rel = normalizeRel(relativePath);
  const id = String(++headContentSeq);
  headContentById.set(id, content);
  if (headContentById.size > 40) {
    const first = headContentById.keys().next().value;
    if (first !== undefined) {
      headContentById.delete(first);
    }
  }
  return vscode.Uri.from({
    scheme: GIT_DIFF_SCHEME,
    path: `/${rel}`,
    query: id,
  });
}

/**
 * Side-by-side diff: снимок до правки агента (или HEAD) ↔ текущий файл.
 */
export async function openWorkingTreeDiff(
  relativePath: string
): Promise<boolean> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return false;
  }
  const rel = normalizeRel(relativePath);
  if (!rel) {
    return false;
  }

  const right = vscode.Uri.joinPath(folder.uri, ...rel.split("/"));
  try {
    await vscode.workspace.fs.stat(right);
  } catch {
    return false;
  }

  const snapshot = takeEditBefore(rel);
  let leftContent: string | undefined = snapshot;
  let title = `${rel} (before → after)`;

  if (leftContent === undefined) {
    const head = await readGitHeadContent(rel);
    if (!head) {
      return false;
    }
    leftContent = head.content;
    title = head.exists ? `${rel} (Working Tree)` : `${rel} (New File)`;
  } else if (snapshot === "") {
    title = `${rel} (New File)`;
  }

  const left = leftDiffUri(rel, leftContent);
  await vscode.commands.executeCommand("vscode.diff", left, right, title, {
    preview: true,
    preserveFocus: false,
  });
  return true;
}
