/**
 * VS Code backend for `code_nav` / `rename_symbol` (see `codeNav.ts`):
 * built-in `vscode.execute*Provider` commands, so every language with an
 * installed extension (TS/JS built in, Python via Pylance, Go, Java, …) works.
 */
import * as vscode from "vscode";
import type {
  CodeNavBackend,
  NavLocation,
  NavPosition,
  NavSymbol,
} from "./codeNav";

type AnyLocation = vscode.Location | vscode.LocationLink;

function toNavLocation(loc: AnyLocation): NavLocation | undefined {
  const uri = "targetUri" in loc ? loc.targetUri : loc.uri;
  const range =
    "targetUri" in loc
      ? loc.targetSelectionRange || loc.targetRange
      : loc.range;
  if (!uri || uri.scheme !== "file" || !range) {
    return undefined;
  }
  return {
    path: uri.fsPath,
    line: range.start.line + 1,
    column: range.start.character + 1,
  };
}

function toNavLocations(raw: unknown, limit = 1000): NavLocation[] {
  const list = Array.isArray(raw) ? (raw as AnyLocation[]) : raw ? [raw as AnyLocation] : [];
  const out: NavLocation[] = [];
  for (const loc of list) {
    const l = loc ? toNavLocation(loc) : undefined;
    if (l) {
      out.push(l);
      if (out.length >= limit) {
        break;
      }
    }
  }
  return out;
}

function kindName(kind: vscode.SymbolKind | undefined): string | undefined {
  if (kind === undefined) {
    return undefined;
  }
  const name = (vscode.SymbolKind as unknown as Record<number, string>)[kind];
  return typeof name === "string" ? name : undefined;
}

async function openDoc(absPath: string): Promise<vscode.TextDocument> {
  // Opening (not showing) makes the language server load the file.
  return vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
}

function toPosition(doc: vscode.TextDocument, pos: NavPosition): vscode.Position {
  const line = Math.min(Math.max(0, pos.line - 1), Math.max(0, doc.lineCount - 1));
  const text = doc.lineAt(line).text;
  const character = Math.min(Math.max(0, pos.column - 1), text.length);
  return new vscode.Position(line, character);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Language servers (tsserver especially) answer empty right after a cold
 * open — retry once after a short pause.
 */
async function withWarmup<T>(
  run: () => Promise<T>,
  isEmpty: (v: T) => boolean
): Promise<T> {
  const first = await run();
  if (!isEmpty(first)) {
    return first;
  }
  await sleep(1500);
  return run();
}

function hoverToText(hovers: vscode.Hover[] | undefined): string {
  if (!Array.isArray(hovers)) {
    return "";
  }
  const parts: string[] = [];
  for (const h of hovers) {
    for (const c of h.contents || []) {
      if (typeof c === "string") {
        parts.push(c);
      } else if (c && typeof (c as vscode.MarkdownString).value === "string") {
        const v = (c as vscode.MarkdownString | { language?: string; value: string });
        const lang = (v as { language?: string }).language;
        parts.push(lang ? `\`\`\`${lang}\n${v.value}\n\`\`\`` : v.value);
      }
    }
  }
  return parts.join("\n\n").trim();
}

function flattenDocumentSymbols(
  raw: Array<vscode.DocumentSymbol | vscode.SymbolInformation> | undefined,
  absPath: string
): NavSymbol[] {
  const out: NavSymbol[] = [];
  if (!Array.isArray(raw)) {
    return out;
  }
  const walk = (s: vscode.DocumentSymbol, depth: number) => {
    out.push({
      name: s.name,
      kind: kindName(s.kind),
      path: absPath,
      line: s.selectionRange.start.line + 1,
      column: s.selectionRange.start.character + 1,
      depth,
    });
    for (const child of s.children || []) {
      walk(child, depth + 1);
    }
  };
  for (const s of raw) {
    if ("children" in s && "selectionRange" in s) {
      walk(s as vscode.DocumentSymbol, 0);
    } else {
      const info = s as vscode.SymbolInformation;
      out.push({
        name: info.name,
        kind: kindName(info.kind),
        path: absPath,
        line: info.location.range.start.line + 1,
        column: info.location.range.start.character + 1,
        container: info.containerName || undefined,
        depth: info.containerName ? 1 : 0,
      });
    }
  }
  return out;
}

export function createVscodeCodeNavBackend(): CodeNavBackend {
  const locate = async (
    command: string,
    pos: NavPosition,
    limit = 1000
  ): Promise<NavLocation[]> => {
    const doc = await openDoc(pos.path);
    const p = toPosition(doc, pos);
    return withWarmup(
      async () =>
        toNavLocations(
          await vscode.commands.executeCommand<unknown>(command, doc.uri, p),
          limit
        ),
      (v) => v.length === 0
    );
  };

  return {
    id: "vscode",
    definition: async (pos) => {
      const defs = await locate("vscode.executeDefinitionProvider", pos);
      if (defs.length) {
        return defs;
      }
      // Some servers only implement declaration (e.g. C/C++ headers).
      return locate("vscode.executeDeclarationProvider", pos);
    },
    references: (pos, limit) =>
      locate("vscode.executeReferenceProvider", pos, limit),
    implementations: (pos, limit) =>
      locate("vscode.executeImplementationProvider", pos, limit),
    hover: async (pos) => {
      const doc = await openDoc(pos.path);
      const p = toPosition(doc, pos);
      return withWarmup(
        async () =>
          hoverToText(
            await vscode.commands.executeCommand<vscode.Hover[]>(
              "vscode.executeHoverProvider",
              doc.uri,
              p
            )
          ),
        (v) => !v
      );
    },
    workspaceSymbols: async (query, limit) => {
      const raw = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        "vscode.executeWorkspaceSymbolProvider",
        query
      );
      const list = Array.isArray(raw) ? raw : [];
      const q = query.toLowerCase();
      // Exact names first, then prefix, then the rest (server order).
      const rank = (n: string) =>
        n === query ? 0 : n.toLowerCase() === q ? 1 : n.toLowerCase().startsWith(q) ? 2 : 3;
      return list
        .filter((s) => s?.location?.uri?.scheme === "file")
        .map((s, i) => ({ s, i }))
        .sort((a, b) => rank(a.s.name) - rank(b.s.name) || a.i - b.i)
        .slice(0, limit)
        .map(({ s }) => ({
          name: s.name,
          kind: kindName(s.kind),
          path: s.location.uri.fsPath,
          line: s.location.range.start.line + 1,
          column: s.location.range.start.character + 1,
          container: s.containerName || undefined,
        }));
    },
    documentSymbols: async (absPath) => {
      const doc = await openDoc(absPath);
      return withWarmup(
        async () =>
          flattenDocumentSymbols(
            await vscode.commands.executeCommand<
              Array<vscode.DocumentSymbol | vscode.SymbolInformation>
            >("vscode.executeDocumentSymbolProvider", doc.uri),
            absPath
          ),
        (v) => v.length === 0
      );
    },
    rename: async (pos, newName) => {
      const doc = await openDoc(pos.path);
      const p = toPosition(doc, pos);
      const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
        "vscode.executeDocumentRenameProvider",
        doc.uri,
        p,
        newName
      );
      if (!edit || edit.size === 0) {
        return { files: [], edits: 0 };
      }
      let edits = 0;
      const uris: vscode.Uri[] = [];
      for (const [uri, list] of edit.entries()) {
        uris.push(uri);
        edits += list.length;
      }
      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) {
        throw new Error("VS Code refused to apply the rename edit");
      }
      // Persist so git / run_commands / the next read_files see the change.
      for (const uri of uris) {
        const d = vscode.workspace.textDocuments.find(
          (t) => t.uri.toString() === uri.toString()
        );
        if (d?.isDirty) {
          await d.save();
        }
      }
      return {
        files: uris.filter((u) => u.scheme === "file").map((u) => u.fsPath),
        edits,
      };
    },
  };
}
