import * as vscode from "vscode";

/** Последний текстовый редактор — нужен, когда фокус ушёл в webview панели. */
let lastEditor: vscode.TextEditor | undefined =
  vscode.window.activeTextEditor;

export function startEditorContextTracking(
  subscriptions: { push(...items: { dispose(): unknown }[]): void }
): void {
  lastEditor = vscode.window.activeTextEditor;
  subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        lastEditor = editor;
      }
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor === lastEditor || e.textEditor === vscode.window.activeTextEditor) {
        lastEditor = e.textEditor;
      }
    })
  );
}

function relativeOrFsPath(uri: vscode.Uri): string {
  const rel = vscode.workspace.asRelativePath(uri, false);
  return rel || uri.fsPath;
}

function resolveEditor(): vscode.TextEditor | undefined {
  return vscode.window.activeTextEditor ?? lastEditor;
}

/** Снимок окружения/редактора для system-контекста на каждый ход агента. */
export function buildEditorContextMessage(): string {
  const now = new Date();
  const folder = vscode.workspace.workspaceFolders?.[0];
  const lines: string[] = [
    "Environment context (for this request):",
    `- Current date and time: ${formatLocalDateTime(now)}`,
    `- Time zone: ${formatTimeZone(now)}`,
  ];

  if (folder) {
    lines.push(`- Workspace root: ${folder.uri.fsPath}`);
  } else {
    lines.push("- Workspace root: not open");
  }

  const editor = resolveEditor();
  if (!editor) {
    lines.push(
      "- Active file: none (no open text document)"
    );
  } else {
    const { document, selection } = editor;
    if (document.isClosed) {
      lines.push("- Active file: none (document already closed)");
    } else if (document.uri.scheme === "untitled") {
      lines.push(`- Active file: untitled (${document.languageId})`);
      lines.push(`- Language: ${document.languageId}`);
      appendCursorAndSelection(lines, document, selection);
    } else {
      lines.push(`- Active file: ${relativeOrFsPath(document.uri)}`);
      lines.push(`- Language: ${document.languageId}`);
      appendCursorAndSelection(lines, document, selection);
    }
  }

  const visible = vscode.window.visibleTextEditors
    .map((e) => e.document)
    .filter((d) => d.uri.scheme === "file" || d.uri.scheme === "untitled")
    .filter(
      (d, i, arr) =>
        arr.findIndex((x) => x.uri.toString() === d.uri.toString()) === i
    )
    .slice(0, 12)
    .map((d) =>
      d.uri.scheme === "untitled"
        ? `untitled (${d.languageId})`
        : relativeOrFsPath(d.uri)
    );

  if (visible.length > 0) {
    lines.push(`- Open/visible editors: ${visible.join(", ")}`);
  }

  lines.push(
    "Use this data for the current file, time, and editor state. Do not claim that you lack access to VS Code state or system time."
  );

  return lines.join("\n");
}

function formatLocalDateTime(date: Date): string {
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(
    date
  );
  const datePart = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
  return `${weekday}, ${datePart}, ${timePart}`;
}

function formatTimeZone(date: Date): string {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  let name = "";
  try {
    name = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    name = "";
  }
  return name ? `${name} (UTC${sign}${hh}:${mm})` : `UTC${sign}${hh}:${mm}`;
}

function appendCursorAndSelection(
  lines: string[],
  document: vscode.TextDocument,
  selection: vscode.Selection
): void {
  const line = selection.active.line + 1;
  const col = selection.active.character + 1;
  lines.push(`- Cursor: line ${line}, column ${col}`);

  if (selection.isEmpty) {
    return;
  }

  const start = selection.start.line + 1;
  const end = selection.end.line + 1;
  const selected = document.getText(selection);
  const preview =
    selected.length > 800
      ? `${selected.slice(0, 800)}\n… (truncated)`
      : selected;
  lines.push(
    start === end
      ? `- Selection: line ${start}`
      : `- Selection: lines ${start}–${end}`
  );
  if (preview.trim()) {
    lines.push("- Selected text:");
    lines.push("```");
    lines.push(preview);
    lines.push("```");
  }
}

/**
 * Выделение редактора для чипа в composer.
 * Без выделения / редактора — undefined.
 */
export function getEditorSelectionPayload():
  | {
      path: string;
      startLine: number;
      endLine: number;
      text: string;
      language: string;
    }
  | undefined {
  const editor = resolveEditor();
  if (!editor || editor.document.isClosed) {
    return undefined;
  }
  const { document, selection } = editor;
  if (selection.isEmpty) {
    return undefined;
  }
  const text = document.getText(selection);
  if (!String(text || "").trim()) {
    return undefined;
  }

  const startLine = selection.start.line + 1;
  const endLine = selection.end.line + 1;
  const path =
    document.uri.scheme === "untitled"
      ? `untitled${document.languageId ? `.${document.languageId}` : ""}`
      : relativeOrFsPath(document.uri);
  return {
    path,
    startLine,
    endLine,
    text: text.replace(/\n$/, ""),
    language: document.languageId || "",
  };
}

/** @deprecated используйте getEditorSelectionPayload + чипы */
export function getEditorSelectionSnippet(): string | undefined {
  const payload = getEditorSelectionPayload();
  if (!payload) {
    return undefined;
  }
  return `\`\`\`${payload.startLine}:${payload.endLine}:${payload.path}\n${payload.text}\n\`\`\``;
}
