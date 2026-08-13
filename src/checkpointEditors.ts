/**
 * After a git checkpoint restore, force VS Code buffers to match disk.
 *
 * Closing a tab does not drop the TextDocument: hot-exit / in-memory backup
 * can reopen the pre-restore (agent-edited) text even though git already
 * rewound the file. Open editors often auto-reload from the file watcher,
 * so the bug shows up mainly for closed files.
 */
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

function isWorkspaceFile(uri: vscode.Uri): boolean {
  if (uri.scheme !== "file") {
    return false;
  }
  const folders = vscode.workspace.workspaceFolders || [];
  return folders.some((folder) => {
    const root = folder.uri.fsPath;
    return (
      uri.fsPath === root || uri.fsPath.startsWith(root + path.sep)
    );
  });
}

function resolveWorkspaceUri(raw: string): vscode.Uri | undefined {
  const value = String(raw || "").trim();
  if (!value) {
    return undefined;
  }
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    return vscode.Uri.file(value);
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }
  return vscode.Uri.joinPath(folder.uri, ...value.split("/"));
}

async function closeTabs(uri: vscode.Uri): Promise<void> {
  const target = uri.toString();
  const tabs: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (
        input instanceof vscode.TabInputText &&
        input.uri.toString() === target
      ) {
        tabs.push(tab);
      }
    }
  }
  if (tabs.length) {
    await vscode.window.tabGroups.close(tabs, true);
  }
}

async function fileExists(fsPath: string): Promise<boolean> {
  try {
    await fs.access(fsPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Replace an in-memory document with bytes from disk (Node fs, not the
 * VS Code file model — that one can still be the hot-exit backup).
 */
async function syncUriFromDisk(
  uri: vscode.Uri
): Promise<"restored" | "deleted" | "unchanged"> {
  if (!(await fileExists(uri.fsPath))) {
    await closeTabs(uri);
    return "deleted";
  }
  let disk: string;
  try {
    disk = await fs.readFile(uri.fsPath, "utf8");
  } catch {
    return "unchanged";
  }
  const doc = vscode.workspace.textDocuments.find(
    (item) => item.uri.toString() === uri.toString()
  );
  if (!doc) {
    return "unchanged";
  }
  if (doc.getText() === disk) {
    if (doc.isDirty) {
      await doc.save();
    }
    return "unchanged";
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    uri,
    new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
    disk
  );
  await vscode.workspace.applyEdit(edit);
  if (doc.isDirty) {
    await doc.save();
  }
  return "restored";
}

export async function reloadEditorsAfterCheckpointRestore(
  editedPaths: string[]
): Promise<void> {
  const seen = new Set<string>();
  const uris: vscode.Uri[] = [];
  const add = (uri: vscode.Uri | undefined) => {
    if (!uri || uri.scheme !== "file" || seen.has(uri.toString())) {
      return;
    }
    seen.add(uri.toString());
    uris.push(uri);
  };
  for (const raw of editedPaths) {
    add(resolveWorkspaceUri(raw));
  }
  for (const doc of vscode.workspace.textDocuments) {
    if (isWorkspaceFile(doc.uri)) {
      add(doc.uri);
    }
  }
  for (const uri of uris) {
    await syncUriFromDisk(uri);
  }

  const reopen = editedPaths
    .map(resolveWorkspaceUri)
    .filter((uri): uri is vscode.Uri => Boolean(uri));
  for (const uri of reopen.slice(0, 8)) {
    if (!(await fileExists(uri.fsPath))) {
      await closeTabs(uri);
      continue;
    }
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await syncUriFromDisk(uri);
      await vscode.window.showTextDocument(doc, {
        preview: false,
        preserveFocus: true,
      });
    } catch {
      /* ignore missing / binary */
    }
  }
}
