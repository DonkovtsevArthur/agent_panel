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
    "Контекст окружения (актуально на этот запрос):",
    `- Текущие дата и время: ${formatLocalDateTime(now)}`,
    `- Часовой пояс: ${formatTimeZone(now)}`,
  ];

  if (folder) {
    lines.push(`- Корень workspace: ${folder.uri.fsPath}`);
  } else {
    lines.push("- Корень workspace: не открыт");
  }

  const editor = resolveEditor();
  if (!editor) {
    lines.push(
      "- Активный файл: нет (нет открытого текстового документа)"
    );
  } else {
    const { document, selection } = editor;
    if (document.isClosed) {
      lines.push("- Активный файл: нет (документ уже закрыт)");
    } else if (document.uri.scheme === "untitled") {
      lines.push(`- Активный файл: untitled (${document.languageId})`);
      lines.push(`- Язык: ${document.languageId}`);
      appendCursorAndSelection(lines, document, selection);
    } else {
      lines.push(`- Активный файл: ${relativeOrFsPath(document.uri)}`);
      lines.push(`- Язык: ${document.languageId}`);
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
    lines.push(`- Открытые/видимые редакторы: ${visible.join(", ")}`);
  }

  lines.push(
    "Используй эти данные для текущего файла, времени и т.п. Не утверждай, что у тебя нет доступа к состоянию VS Code или к системному времени."
  );

  return lines.join("\n");
}

function formatLocalDateTime(date: Date): string {
  const weekday = new Intl.DateTimeFormat("ru-RU", { weekday: "long" }).format(
    date
  );
  const datePart = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("ru-RU", {
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
  lines.push(`- Курсор: строка ${line}, колонка ${col}`);

  if (selection.isEmpty) {
    return;
  }

  const start = selection.start.line + 1;
  const end = selection.end.line + 1;
  const selected = document.getText(selection);
  const preview =
    selected.length > 800
      ? `${selected.slice(0, 800)}\n… (обрезано)`
      : selected;
  lines.push(
    start === end
      ? `- Выделение: строка ${start}`
      : `- Выделение: строки ${start}–${end}`
  );
  if (preview.trim()) {
    lines.push("- Текст выделения:");
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
