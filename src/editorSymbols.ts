/**
 * Enclosing symbol at the cursor for the agent turn (function / class / method).
 */
import * as vscode from "vscode";

export type EnclosingSymbolSnapshot = {
  name: string;
  kind?: string;
  line?: number;
  detail?: string;
};

type SymbolLike = {
  name?: string;
  detail?: string;
  kind?: number | string;
  range?: { start?: { line?: number }; end?: { line?: number } };
  selectionRange?: { start?: { line?: number }; end?: { line?: number } };
  children?: SymbolLike[];
};

const KIND_LABEL: Record<number, string> = {
  4: "class",
  5: "method",
  10: "enum",
  11: "function",
  12: "variable",
  22: "struct",
};

function kindLabel(kind: number | string | undefined): string {
  if (typeof kind === "string" && kind.trim()) {
    return kind.trim();
  }
  if (typeof kind === "number" && KIND_LABEL[kind]) {
    return KIND_LABEL[kind];
  }
  return "symbol";
}

function containsLine(symbol: SymbolLike, line: number): boolean {
  const start =
    symbol.range?.start?.line ?? symbol.selectionRange?.start?.line;
  const end = symbol.range?.end?.line ?? symbol.selectionRange?.end?.line;
  if (typeof start !== "number" || typeof end !== "number") {
    return false;
  }
  return line >= start && line <= end;
}

function flattenContaining(
  symbols: SymbolLike[] | undefined,
  line: number,
  into: SymbolLike[]
): void {
  if (!Array.isArray(symbols)) {
    return;
  }
  for (const symbol of symbols) {
    if (!symbol || !containsLine(symbol, line)) {
      continue;
    }
    into.push(symbol);
    flattenContaining(symbol.children, line, into);
  }
}

export function formatEnclosingSymbolMessage(
  snapshot: EnclosingSymbolSnapshot | undefined
): string {
  const name = String(snapshot?.name || "").trim();
  if (!name) {
    return "";
  }
  const kind = kindLabel(snapshot?.kind);
  const line =
    typeof snapshot?.line === "number" && Number.isFinite(snapshot.line)
      ? snapshot.line + 1
      : undefined;
  const detail = String(snapshot?.detail || "").trim();
  const bits = [`- Enclosing ${kind}: ${name}`];
  if (line) {
    bits[0] += ` (line ${line})`;
  }
  if (detail) {
    bits.push(`- Signature: ${detail.slice(0, 240)}`);
  }
  return ["Cursor scope:", ...bits].join("\n");
}

export async function buildEnclosingSymbolMessage(): Promise<string> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.isClosed) {
    return "";
  }
  const line = editor.selection.active.line;
  try {
    const raw = await Promise.race([
      vscode.commands.executeCommand(
        "vscode.executeDocumentSymbolProvider",
        editor.document.uri
      ) as Promise<unknown>,
      new Promise((resolve) => setTimeout(() => resolve(undefined), 250)),
    ]);
    const list = Array.isArray(raw) ? (raw as SymbolLike[]) : [];
    const containing: SymbolLike[] = [];
    flattenContaining(list, line, containing);
    const best = containing[containing.length - 1];
    const name = String(best?.name || "").trim();
    if (!name) {
      return "";
    }
    return formatEnclosingSymbolMessage({
      name,
      kind: kindLabel(best?.kind),
      line: best?.selectionRange?.start?.line ?? best?.range?.start?.line,
      detail: best?.detail,
    });
  } catch {
    return "";
  }
}
