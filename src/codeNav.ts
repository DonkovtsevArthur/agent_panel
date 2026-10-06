/**
 * Harbor extraTools: `code_nav` (read-only) and `rename_symbol` (edit) —
 * semantic code navigation through the IDE's own language intelligence
 * instead of text search.
 *
 * Backends (same tool contract in both IDE shells):
 * - VS Code: `vscode.execute*Provider` commands (`codeNavVscode.ts`).
 * - JetBrains / WebStorm sidecar: reverse RPC to the Kotlin host
 *   (`host.ideRequest` notification → PSI → `ide.response` method), see
 *   `createHostRpcCodeNavBackend` + `HarborCodeNav.kt`.
 *
 * This module is IDE-neutral (no `vscode` import) so it runs in the sidecar
 * and under unit tests. It resolves the model's loose input (path + line +
 * symbol name) to an exact position, so backends only deal with precise
 * 1-based line/column positions on absolute paths.
 */
import * as fs from "fs";
import * as path from "path";

type CreateTool = (config: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown, context: unknown) => Promise<unknown>;
  timeoutMs?: number;
}) => unknown;

export const CODE_NAV_TOOL = "code_nav";
export const RENAME_SYMBOL_TOOL = "rename_symbol";

export const CODE_NAV_ACTIONS = [
  "definition",
  "references",
  "implementations",
  "hover",
  "symbols",
  "outline",
] as const;
export type CodeNavAction = (typeof CODE_NAV_ACTIONS)[number];

/** Absolute path + 1-based line/column (column in UTF-16 code units). */
export type NavPosition = { path: string; line: number; column: number };

export type NavLocation = { path: string; line: number; column: number };

export type NavSymbol = {
  name: string;
  kind?: string;
  path?: string;
  line?: number;
  column?: number;
  container?: string;
  /** Nesting depth for outlines (0 = top level). */
  depth?: number;
};

export type NavRenameResult = { files: string[]; edits: number };

export interface CodeNavBackend {
  readonly id: string;
  definition(pos: NavPosition): Promise<NavLocation[]>;
  references(pos: NavPosition, limit: number): Promise<NavLocation[]>;
  implementations(pos: NavPosition, limit: number): Promise<NavLocation[]>;
  hover(pos: NavPosition): Promise<string>;
  workspaceSymbols(query: string, limit: number): Promise<NavSymbol[]>;
  documentSymbols(absPath: string): Promise<NavSymbol[]>;
  rename(pos: NavPosition, newName: string): Promise<NavRenameResult>;
}

// ---------------------------------------------------------------------------
// Backend registry
// ---------------------------------------------------------------------------

let hostBackend: CodeNavBackend | undefined;

/** Sidecar installs the RPC backend; VS Code leaves it unset. */
export function setCodeNavHostBackend(backend: CodeNavBackend | undefined): void {
  hostBackend = backend;
}

export function getCodeNavHostBackend(): CodeNavBackend | undefined {
  return hostBackend;
}

// ---------------------------------------------------------------------------
// Reverse RPC backend (sidecar → Kotlin host)
// ---------------------------------------------------------------------------

type PendingIde = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pendingIde = new Map<string, PendingIde>();
let ideSeq = 0;

export type IdeResponse = {
  requestId?: unknown;
  ok?: unknown;
  result?: unknown;
  error?: unknown;
};

/** Called by the sidecar for the `ide.response` method from the host. */
export function resolveIdeResponse(params: IdeResponse): { ok: boolean } {
  const id = String(params?.requestId || "");
  const row = pendingIde.get(id);
  if (!row) {
    return { ok: false };
  }
  pendingIde.delete(id);
  clearTimeout(row.timer);
  if (params.ok === false || params.error) {
    row.reject(new Error(String(params.error || "IDE request failed")));
  } else {
    row.resolve(params.result);
  }
  return { ok: true };
}

export function createHostRpcCodeNavBackend(
  notify: (method: string, params: unknown) => void,
  options: { timeoutMs?: number; renameTimeoutMs?: number } = {}
): CodeNavBackend {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const renameTimeoutMs = options.renameTimeoutMs ?? 90_000;

  const call = (op: string, params: unknown, ms = timeoutMs): Promise<unknown> =>
    new Promise((resolve, reject) => {
      ideSeq += 1;
      const requestId = `ide-${Date.now().toString(36)}-${ideSeq}`;
      const timer = setTimeout(() => {
        pendingIde.delete(requestId);
        reject(
          new Error(
            `IDE did not answer ${op} within ${Math.round(ms / 1000)}s (indexing or modal dialog?)`
          )
        );
      }, ms);
      pendingIde.set(requestId, { resolve, reject, timer });
      notify("host.ideRequest", { requestId, op, params });
    });

  const locations = (raw: unknown): NavLocation[] =>
    (Array.isArray(raw) ? raw : [])
      .map((r) => r as Partial<NavLocation>)
      .filter((r) => typeof r.path === "string" && Number(r.line) > 0)
      .map((r) => ({
        path: String(r.path),
        line: Number(r.line),
        column: Math.max(1, Number(r.column) || 1),
      }));

  const symbols = (raw: unknown): NavSymbol[] =>
    (Array.isArray(raw) ? raw : [])
      .map((r) => r as Partial<NavSymbol>)
      .filter((r) => typeof r.name === "string" && r.name)
      .map((r) => ({
        name: String(r.name),
        ...(r.kind ? { kind: String(r.kind) } : {}),
        ...(r.path ? { path: String(r.path) } : {}),
        ...(Number(r.line) > 0 ? { line: Number(r.line) } : {}),
        ...(Number(r.column) > 0 ? { column: Number(r.column) } : {}),
        ...(r.container ? { container: String(r.container) } : {}),
        ...(Number.isFinite(Number(r.depth)) ? { depth: Number(r.depth) } : {}),
      }));

  return {
    id: "jetbrains",
    definition: async (pos) => locations(await call("definition", pos)),
    references: async (pos, limit) =>
      locations(await call("references", { ...pos, limit })),
    implementations: async (pos, limit) =>
      locations(await call("implementations", { ...pos, limit })),
    hover: async (pos) => {
      const raw = (await call("hover", pos)) as { text?: unknown } | string;
      return typeof raw === "string" ? raw : String(raw?.text || "");
    },
    workspaceSymbols: async (query, limit) =>
      symbols(await call("workspaceSymbols", { query, limit })),
    documentSymbols: async (absPath) =>
      symbols(await call("documentSymbols", { path: absPath })),
    rename: async (pos, newName) => {
      const raw = (await call(
        "rename",
        { ...pos, newName },
        renameTimeoutMs
      )) as { files?: unknown; edits?: unknown };
      const files = Array.isArray(raw?.files)
        ? raw.files.map((f) => String(f)).filter(Boolean)
        : [];
      return { files, edits: Number(raw?.edits) || files.length };
    },
  };
}

// ---------------------------------------------------------------------------
// Input resolution
// ---------------------------------------------------------------------------

export type CodeNavInput = {
  action?: unknown;
  path?: unknown;
  line?: unknown;
  column?: unknown;
  symbol?: unknown;
  query?: unknown;
  limit?: unknown;
  newName?: unknown;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function posInt(v: unknown): number | undefined {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function resolveAbsPath(workspaceRoot: string, p: string): string {
  const cleaned = p.replace(/^file:\/\//i, "").replace(/^@/, "");
  return path.isAbsolute(cleaned)
    ? path.normalize(cleaned)
    : path.resolve(workspaceRoot || process.cwd(), cleaned);
}

export function displayPath(workspaceRoot: string, absPath: string): string {
  if (!workspaceRoot) {
    return absPath;
  }
  const rel = path.relative(workspaceRoot, absPath);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel)
    ? rel.split(path.sep).join("/")
    : absPath;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-identifier occurrences of `symbol` in `text` (0-based indices). */
function identifierIndices(text: string, symbol: string): number[] {
  const re = new RegExp(
    `(?<![A-Za-z0-9_$])${escapeRegExp(symbol)}(?![A-Za-z0-9_$])`,
    "g"
  );
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m.index);
    if (out.length > 200) {
      break;
    }
  }
  return out;
}

const DECLARATION_HINT =
  /\b(function|class|interface|type|enum|const|let|var|def|fun|val|struct|trait|impl|func|module|namespace|export)\b/;

/**
 * Pick the 1-based line/column of `symbol` in a file's lines.
 * - With `line`: that line first, then ±3 lines around it.
 * - Without: prefer a declaration-looking line, else the first occurrence.
 * Exported for tests.
 */
export function locateSymbolInLines(
  lines: string[],
  symbol: string,
  line?: number
): { line: number; column: number } | undefined {
  if (!symbol) {
    return undefined;
  }
  const at = (idx: number) => {
    const text = lines[idx];
    if (text === undefined) {
      return undefined;
    }
    const hits = identifierIndices(text, symbol);
    return hits.length ? { line: idx + 1, column: hits[0] + 1 } : undefined;
  };
  if (line) {
    const base = line - 1;
    const order = [0, -1, 1, -2, 2, -3, 3];
    for (const delta of order) {
      const hit = at(base + delta);
      if (hit) {
        return hit;
      }
    }
    return undefined;
  }
  let first: { line: number; column: number } | undefined;
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i];
    const hits = identifierIndices(text, symbol);
    if (!hits.length) {
      continue;
    }
    const before = text.slice(0, hits[0]);
    if (DECLARATION_HINT.test(before)) {
      return { line: i + 1, column: hits[0] + 1 };
    }
    first = first || { line: i + 1, column: hits[0] + 1 };
  }
  return first;
}

/** First non-space column on a line (1-based) — fallback when no symbol. */
function firstCodeColumn(lineText: string | undefined): number {
  if (!lineText) {
    return 1;
  }
  const m = /[A-Za-z_$]/.exec(lineText);
  return m ? m.index + 1 : 1;
}

class FileLines {
  private cache = new Map<string, string[] | null>();
  get(absPath: string): string[] | null {
    if (this.cache.has(absPath)) {
      return this.cache.get(absPath) ?? null;
    }
    let lines: string[] | null = null;
    try {
      const stat = fs.statSync(absPath);
      if (stat.isFile() && stat.size <= 4_000_000) {
        lines = fs.readFileSync(absPath, "utf8").split(/\r?\n/);
      }
    } catch {
      lines = null;
    }
    this.cache.set(absPath, lines);
    return lines;
  }
  preview(absPath: string, line: number): string {
    const text = this.get(absPath)?.[line - 1];
    if (!text) {
      return "";
    }
    const trimmed = text.trim();
    return trimmed.length > 160 ? `${trimmed.slice(0, 157)}…` : trimmed;
  }
}

type Resolved =
  | { ok: true; pos: NavPosition; note?: string }
  | { ok: false; error: string };

async function resolvePosition(
  backend: CodeNavBackend,
  workspaceRoot: string,
  input: CodeNavInput,
  files: FileLines
): Promise<Resolved> {
  const rawPath = str(input.path);
  const symbol = str(input.symbol);
  const line = posInt(input.line);
  const column = posInt(input.column);

  if (rawPath) {
    const abs = resolveAbsPath(workspaceRoot, rawPath);
    const lines = files.get(abs);
    if (!lines) {
      return { ok: false, error: `File not found or unreadable: ${rawPath}` };
    }
    if (line && column) {
      return { ok: true, pos: { path: abs, line, column } };
    }
    if (symbol) {
      const hit = locateSymbolInLines(lines, symbol, line);
      if (!hit) {
        return {
          ok: false,
          error: line
            ? `"${symbol}" not found on or near line ${line} of ${rawPath}. Check the line (read_files) or omit it.`
            : `"${symbol}" not found in ${rawPath}.`,
        };
      }
      return { ok: true, pos: { path: abs, ...hit } };
    }
    if (line) {
      return {
        ok: true,
        pos: { path: abs, line, column: firstCodeColumn(lines[line - 1]) },
      };
    }
    return {
      ok: false,
      error: "Give `symbol` (and ideally `line`) to point at an identifier in that file.",
    };
  }

  if (!symbol) {
    return {
      ok: false,
      error: "Give `path` + `symbol` (optionally `line`), or at least `symbol` to look it up project-wide.",
    };
  }
  // Symbol only: locate its declaration through the workspace symbol index.
  const found = await backend.workspaceSymbols(symbol, 20);
  const exact = found.filter((s) => s.name === symbol && s.path && s.line);
  const pick = exact[0] || found.find((s) => s.path && s.line);
  if (!pick || !pick.path || !pick.line) {
    return {
      ok: false,
      error: `No symbol named "${symbol}" in the workspace index. Pass \`path\` (+ \`line\`) where it is used.`,
    };
  }
  let col = pick.column;
  if (!col) {
    const lines = files.get(pick.path);
    const hit = lines ? locateSymbolInLines(lines, symbol, pick.line) : undefined;
    col = hit?.column || firstCodeColumn(lines?.[pick.line - 1]);
  }
  const others = exact.length > 1 ? exact.length - 1 : 0;
  return {
    ok: true,
    pos: { path: pick.path, line: pick.line, column: col },
    note: others
      ? `Note: ${others} other symbol(s) named "${symbol}" exist; used ${displayPath(workspaceRoot, pick.path)}:${pick.line}. Pass \`path\` to disambiguate.`
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function dedupeLocations(locs: NavLocation[]): NavLocation[] {
  const seen = new Set<string>();
  const out: NavLocation[] = [];
  for (const l of locs) {
    const key = `${path.normalize(l.path)}:${l.line}:${l.column}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(l);
    }
  }
  return out;
}

/** Group locations by file with line previews. Exported for tests. */
export function formatLocations(
  workspaceRoot: string,
  locs: NavLocation[],
  files: { preview(absPath: string, line: number): string },
  limit: number
): string {
  const unique = dedupeLocations(locs);
  const shown = unique.slice(0, limit);
  const byFile = new Map<string, NavLocation[]>();
  for (const l of shown) {
    const key = l.path;
    const list = byFile.get(key) || [];
    list.push(l);
    byFile.set(key, list);
  }
  const blocks: string[] = [];
  for (const [file, list] of byFile) {
    list.sort((a, b) => a.line - b.line || a.column - b.column);
    blocks.push(
      [
        displayPath(workspaceRoot, file),
        ...list.map((l) => {
          const preview = files.preview(file, l.line);
          return `  ${l.line}:${l.column}${preview ? `  ${preview}` : ""}`;
        }),
      ].join("\n")
    );
  }
  const more =
    unique.length > shown.length
      ? `\n… ${unique.length - shown.length} more (raise \`limit\` or narrow the query).`
      : "";
  return `${blocks.join("\n")}${more}`;
}

export function formatSymbols(
  workspaceRoot: string,
  symbols: NavSymbol[],
  limit: number,
  outline: boolean
): string {
  const shown = symbols.slice(0, limit);
  const lines = shown.map((s) => {
    const indent = outline ? "  ".repeat(Math.min(8, Math.max(0, s.depth || 0))) : "";
    const kind = s.kind ? `${s.kind.toLowerCase()} ` : "";
    const where = outline
      ? s.line
        ? `  :${s.line}`
        : ""
      : s.path
        ? `  ${displayPath(workspaceRoot, s.path)}${s.line ? `:${s.line}` : ""}`
        : "";
    const container = !outline && s.container ? `  (in ${s.container})` : "";
    return `${indent}${kind}${s.name}${where}${container}`;
  });
  const more =
    symbols.length > shown.length
      ? `\n… ${symbols.length - shown.length} more.`
      : "";
  return `${lines.join("\n")}${more}`;
}

const HOVER_MAX_CHARS = 4_000;

export function cleanHoverText(raw: string): string {
  let text = String(raw || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|pre|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > HOVER_MAX_CHARS) {
    text = `${text.slice(0, HOVER_MAX_CHARS)}…`;
  }
  return text;
}

const EMPTY_HINT =
  "The IDE language service returned nothing here (language plugin missing, still indexing, or the position is not on an identifier). Fall back to search_codebase / read_files.";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export type CodeNavToolOptions = {
  workspaceRoot: string;
  /** Lazily resolved so the VS Code backend is only built when used. */
  getBackend: () => CodeNavBackend | undefined;
  /** Called with absolute paths changed by rename_symbol. */
  onFilesChanged?: (absPaths: string[]) => void;
};

function clampLimit(v: unknown, def: number, max: number): number {
  const n = posInt(v);
  return n ? Math.min(n, max) : def;
}

/** Shared execute for `code_nav` — exported for tests. */
export async function runCodeNav(
  backend: CodeNavBackend,
  workspaceRoot: string,
  input: CodeNavInput
): Promise<string> {
  const action = str(input.action).toLowerCase() as CodeNavAction;
  if (!CODE_NAV_ACTIONS.includes(action)) {
    return `code_nav: unknown action "${str(input.action)}". Use one of: ${CODE_NAV_ACTIONS.join(", ")}.`;
  }
  const files = new FileLines();

  if (action === "symbols") {
    const query = str(input.query) || str(input.symbol);
    if (!query) {
      return "code_nav symbols: pass `query` (symbol name or part of it).";
    }
    const limit = clampLimit(input.limit, 30, 100);
    const found = await backend.workspaceSymbols(query, limit);
    if (!found.length) {
      return `code_nav symbols "${query}": no matches. ${EMPTY_HINT}`;
    }
    return `Workspace symbols matching "${query}":\n${formatSymbols(workspaceRoot, found, limit, false)}`;
  }

  if (action === "outline") {
    const rawPath = str(input.path);
    if (!rawPath) {
      return "code_nav outline: pass `path`.";
    }
    const abs = resolveAbsPath(workspaceRoot, rawPath);
    if (!files.get(abs)) {
      return `code_nav outline: file not found: ${rawPath}`;
    }
    const limit = clampLimit(input.limit, 200, 500);
    const found = await backend.documentSymbols(abs);
    if (!found.length) {
      return `code_nav outline ${rawPath}: no symbols. ${EMPTY_HINT}`;
    }
    return `Outline of ${displayPath(workspaceRoot, abs)}:\n${formatSymbols(workspaceRoot, found, limit, true)}`;
  }

  const resolved = await resolvePosition(backend, workspaceRoot, input, files);
  if (!resolved.ok) {
    return `code_nav ${action}: ${resolved.error}`;
  }
  const { pos } = resolved;
  const at = `${displayPath(workspaceRoot, pos.path)}:${pos.line}:${pos.column}`;
  const note = resolved.note ? `\n${resolved.note}` : "";

  if (action === "hover") {
    const text = cleanHoverText(await backend.hover(pos));
    return text
      ? `Type/signature at ${at}:\n${text}${note}`
      : `code_nav hover at ${at}: nothing. ${EMPTY_HINT}${note}`;
  }

  if (action === "definition") {
    const locs = await backend.definition(pos);
    if (!locs.length) {
      return `code_nav definition at ${at}: nothing. ${EMPTY_HINT}${note}`;
    }
    return `Definition(s) of symbol at ${at}:\n${formatLocations(workspaceRoot, locs, files, 20)}${note}`;
  }

  const limit = clampLimit(input.limit, 100, 500);
  const locs =
    action === "references"
      ? await backend.references(pos, limit + 1)
      : await backend.implementations(pos, limit + 1);
  if (!locs.length) {
    return `code_nav ${action} at ${at}: none found. ${action === "references" ? "The symbol may be unused, or " : ""}${EMPTY_HINT}${note}`;
  }
  const label = action === "references" ? "References" : "Implementations";
  const fileCount = new Set(locs.map((l) => l.path)).size;
  return `${label} of symbol at ${at} (${dedupeLocations(locs).length} in ${fileCount} file(s)):\n${formatLocations(workspaceRoot, locs, files, limit)}${note}`;
}

export function createCodeNavTool(
  createTool: CreateTool,
  options: CodeNavToolOptions
): unknown {
  return createTool({
    name: CODE_NAV_TOOL,
    description: [
      "Semantic code navigation via the IDE language service (resolves imports, re-exports, aliases, overloads — unlike text search).",
      "Actions: definition (where a symbol is declared), references (every real usage — use before changing a signature), implementations (of an interface/abstract member),",
      "hover (type / signature / docs), symbols (find declarations by name across the project; `query`), outline (classes/functions in a file; `path`).",
      "Point at a symbol with `path` + `symbol` (+ `line` from read_files to disambiguate). With only `symbol`, the project symbol index is used.",
      "Prefer this over search_codebase when you need where something is defined or used. If it returns nothing, fall back to search_codebase.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [...CODE_NAV_ACTIONS],
          description: "What to look up.",
        },
        path: {
          type: "string",
          description: "File containing the symbol (workspace-relative or absolute). Required for outline.",
        },
        symbol: {
          type: "string",
          description: "Identifier to look up, exactly as written in the code (e.g. createHttpTool).",
        },
        line: {
          type: "integer",
          description: "1-based line where `symbol` appears in `path` (recommended).",
        },
        column: {
          type: "integer",
          description: "1-based column; only if you know it exactly (otherwise give `symbol`).",
        },
        query: {
          type: "string",
          description: "For action=symbols: name or fragment to search.",
        },
        limit: {
          type: "integer",
          description: "Max results (references default 100, symbols 30).",
        },
      },
      required: ["action"],
    },
    execute: async (input: unknown) => {
      const backend = options.getBackend();
      if (!backend) {
        return "code_nav: IDE language service is not available in this host. Use search_codebase.";
      }
      try {
        return await runCodeNav(
          backend,
          options.workspaceRoot,
          (input || {}) as CodeNavInput
        );
      } catch (e) {
        return `code_nav failed: ${errorText(e)}. Fall back to search_codebase.`;
      }
    },
    timeoutMs: 45_000,
  });
}

const IDENTIFIER_RE = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;

/** Shared execute for `rename_symbol` — exported for tests. */
export async function runRenameSymbol(
  backend: CodeNavBackend,
  workspaceRoot: string,
  input: CodeNavInput,
  onFilesChanged?: (absPaths: string[]) => void
): Promise<string> {
  const newName = str(input.newName);
  const symbol = str(input.symbol);
  if (!symbol) {
    return "rename_symbol: pass `symbol` (current name) plus `path` (+ `line`).";
  }
  if (!newName || !IDENTIFIER_RE.test(newName)) {
    return `rename_symbol: \`newName\` must be a valid identifier (got "${newName}").`;
  }
  if (newName === symbol) {
    return "rename_symbol: newName equals the current name — nothing to do.";
  }
  const files = new FileLines();
  const resolved = await resolvePosition(backend, workspaceRoot, input, files);
  if (!resolved.ok) {
    return `rename_symbol: ${resolved.error}`;
  }
  const result = await backend.rename(resolved.pos, newName);
  if (!result.files.length) {
    return `rename_symbol: the IDE produced no changes for "${symbol}" (not renamable here, or language service unavailable). Do not fall back to blind text replace across files — use code_nav references and edit each site.`;
  }
  onFilesChanged?.(result.files);
  const listed = result.files
    .slice(0, 40)
    .map((f) => `  ${displayPath(workspaceRoot, f)}`)
    .join("\n");
  const more = result.files.length > 40 ? `\n  … ${result.files.length - 40} more` : "";
  return [
    `Renamed "${symbol}" → "${newName}": ${result.edits} edit(s) in ${result.files.length} file(s) (saved to disk):`,
    `${listed}${more}`,
    resolved.note || "",
    "Run verify_edits before finishing.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function createRenameSymbolTool(
  createTool: CreateTool,
  options: CodeNavToolOptions
): unknown {
  return createTool({
    name: RENAME_SYMBOL_TOOL,
    description: [
      "Rename a symbol (variable, function, class, method, property, type) everywhere it is used, via the IDE rename refactoring.",
      "Safer than editing each usage by hand: follows imports/re-exports and skips unrelated identifiers with the same name. Files are saved to disk.",
      "Point at the declaration or any usage with `path` + `symbol` (+ `line`). Call verify_edits afterwards.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File where the symbol appears (workspace-relative or absolute).",
        },
        symbol: {
          type: "string",
          description: "Current name, exactly as written.",
        },
        line: {
          type: "integer",
          description: "1-based line where `symbol` appears in `path` (recommended).",
        },
        newName: {
          type: "string",
          description: "New identifier.",
        },
      },
      required: ["symbol", "newName"],
    },
    execute: async (input: unknown) => {
      const backend = options.getBackend();
      if (!backend) {
        return "rename_symbol: IDE refactoring is not available in this host. Use code_nav references + editor.";
      }
      try {
        return await runRenameSymbol(
          backend,
          options.workspaceRoot,
          (input || {}) as CodeNavInput,
          options.onFilesChanged
        );
      } catch (e) {
        return `rename_symbol failed: ${errorText(e)}. No files were reported changed; check with verify_edits / git diff before retrying.`;
      }
    },
    timeoutMs: 120_000,
  });
}
