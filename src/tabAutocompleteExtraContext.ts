/**
 * Extra Tab autocomplete context: symbol definition, neighbor filenames,
 * relative imports, one sibling open tab, and a short workspace-rules digest.
 * Kept tiny — hole-fill latency and gateway token budgets matter.
 *
 * Priority for RELATED FILES (budget ~2 slots):
 *   symbol-def → neighbor by name → relative import → sibling tab
 * Rules fill remaining char budget after related snippets.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { getTabProjectMapDigest, fileShapeKey, getTabProjectMapShapeExample } from "./tabAutocompleteProjectMap";
import {
  listColocatedSourceFiles,
  resolveStructuralSameLayerFile,
  structuralFeatureStem,
  ensureStructureIndex,
} from "./tabAutocompleteStructure";
import { loadWorkspaceRules } from "./workspaceRules";

export type TabRelatedSnippet = {
  /** Workspace- or file-relative label for the prompt. */
  label: string;
  snippet: string;
};

/**
 * What the current path means for Tab: feature stem + layer marker + real siblings.
 * Evidence-based — no hardcoded "component vs model" roles.
 */
export type TabFileIdentity = {
  basename: string;
  relativePath: string;
  /** Feature stem, e.g. `cart` from `cart.model.ts` / `Cart.tsx`. */
  stem: string;
  /**
   * Layer marker from the filename: `.model`, `.tsx`, `events`, or `""`.
   * Tells the model which sibling-lane this file is, without role adjectives.
   */
  layerMarker: string;
  /** Parent folder name (often the feature folder). */
  folder: string;
  /** Other files on disk that share the stem / neighbor convention. */
  siblingsOnDisk: string[];
};

export type TabExtraContext = {
  related: TabRelatedSnippet[];
  projectRules?: string;
  /** Learned repo conventions (Tab project map cache). */
  projectMap?: string;
  fileIdentity?: TabFileIdentity;
};

const MAX_RELATED_FILES = 2;
const MAX_RELATED_EMPTY = 2;
const MAX_SNIPPET_CHARS = 360;
const MAX_SAME_SHAPE_CHARS = 480;
const MAX_RULES_CHARS = 350;
const MAX_PROJECT_MAP_CHARS = 900;
const MAX_TOTAL_EXTRA_CHARS = 1_800;
const RULES_CACHE_TTL_MS = 60_000;
const SYMBOL_RESOLVE_TIMEOUT_MS = 80;

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
];

/** Known multi-part stems: `foo.model` → stem `foo`. */
const NAME_SUFFIXES = [
  ".model",
  ".store",
  ".stores",
  ".events",
  ".event",
  ".effects",
  ".effect",
  ".api",
  ".types",
  ".type",
  ".ui",
  ".view",
  ".component",
  ".hooks",
  ".hook",
  ".selectors",
  ".selector",
];

type RulesCacheEntry = {
  key: string;
  at: number;
  text: string | undefined;
};

let rulesCache: RulesCacheEntry | undefined;

function withTimeout<T>(
  promise: Thenable<T> | Promise<T>,
  ms: number
): Promise<T | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(undefined);
      }
    }, Math.max(20, ms));
    Promise.resolve(promise).then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(undefined);
        }
      }
    );
  });
}

/** Relative `from '…'` / `require('…')` specifiers only (`./` / `../`). */
export function extractRelativeImportSpecifiers(source: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (spec: string | undefined) => {
    const s = String(spec || "").trim();
    if (!s.startsWith(".") || seen.has(s)) {
      return;
    }
    seen.add(s);
    out.push(s);
  };

  const fromRe =
    /(?:import|export)\s+(?:type\s+)?[\s\S]*?\s+from\s*['"](\.[^'"]+)['"]/g;
  const requireRe = /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(source))) {
    push(m[1]);
  }
  while ((m = requireRe.exec(source))) {
    push(m[1]);
  }
  return out;
}

/**
 * Identifier under / just before the caret (includes `$store`-style names).
 */
export function extractIdentifierAt(
  lineText: string,
  character: number
): string | undefined {
  const line = String(lineText || "");
  const pos = Math.max(0, Math.min(character, line.length));
  const isId = (ch: string) => /[A-Za-z0-9_$]/.test(ch);

  let start = pos;
  let end = pos;
  // If caret is mid-identifier or just after it, expand.
  if (pos > 0 && isId(line.charAt(pos - 1))) {
    start = pos - 1;
    end = pos;
  }
  if (pos < line.length && isId(line.charAt(pos))) {
    end = pos + 1;
  }
  while (start > 0 && isId(line.charAt(start - 1))) {
    start -= 1;
  }
  while (end < line.length && isId(line.charAt(end))) {
    end += 1;
  }
  const id = line.slice(start, end);
  if (!id || id.length < 2) {
    return undefined;
  }
  // Skip tiny / keyword-ish tokens.
  if (
    /^(?:const|let|var|function|class|import|export|from|return|await|async|type|interface)$/.test(
      id
    )
  ) {
    return undefined;
  }
  return id;
}

/**
 * Prefer exported / Effector unit lines; fall back to import+export skeleton only.
 * Never dump a raw file head — that pollutes Tab with unrelated bodies.
 */
export function pickExportSnippets(text: string, maxChars: number): string {
  const cap = Math.max(80, Math.floor(maxChars) || MAX_SNIPPET_CHARS);
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const interesting: string[] = [];
  let size = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || "";
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      continue;
    }
    const isInteresting =
      /^\s*import\b/.test(line) ||
      /^\s*export\s+/.test(line) ||
      /\bcreate(?:Store|Event|Effect|Domain)\b/.test(line) ||
      /^\s*(?:export\s+)?(?:type|interface|enum)\s+/.test(line) ||
      /^\s*(?:export\s+)?(?:async\s+)?function\b/.test(line) ||
      /^\s*(?:export\s+)?(?:const|let)\s+\w+.*=\s*(?:\(|async\b|function\b|<)/.test(
        line
      );
    if (!isInteresting) {
      continue;
    }
    const chunk = [line];
    const next = lines[i + 1] || "";
    if (/^\s*[.({`]/.test(next) || /=>$/.test(line.trim())) {
      chunk.push(next);
    }
    const add = chunk.join("\n");
    if (size + add.length + 1 > cap && interesting.length > 0) {
      break;
    }
    interesting.push(add);
    size += add.length + 1;
    if (interesting.length >= 12 || size >= cap) {
      break;
    }
  }

  if (interesting.length > 0) {
    return interesting.join("\n").slice(0, cap).trimEnd();
  }

  // Minimal fallback: first few non-comment lines only (not a 35-line dump).
  const head: string[] = [];
  for (const line of lines.slice(0, 24)) {
    const t = line.trim();
    if (!t || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) {
      continue;
    }
    head.push(line);
    if (head.length >= 6) {
      break;
    }
  }
  return head.join("\n").slice(0, Math.min(cap, 280)).trimEnd();
}

export function parseTabFileStemAndLayer(filePath: string): {
  basename: string;
  stem: string;
  layerMarker: string;
} {
  const basename = path.basename(filePath);
  const ext = path.extname(basename);
  const name = ext ? basename.slice(0, -ext.length) : basename;

  // Prefer structure-based feature stem (parent folder / basename) so projects
  // without `.model` / `events` suffixes still get a meaningful stem.
  const structuralStem = structuralFeatureStem(filePath);

  for (const suffix of NAME_SUFFIXES) {
    if (name.endsWith(suffix) && name.length > suffix.length) {
      return {
        basename,
        stem: name.slice(0, -suffix.length) || structuralStem,
        layerMarker: suffix + ext,
      };
    }
  }
  const lower = name.toLowerCase();
  if (
    lower === "events" ||
    lower === "stores" ||
    lower === "effects" ||
    lower === "model" ||
    lower === "units" ||
    lower === "hooks" ||
    lower === "types" ||
    lower === "api" ||
    lower === "ui" ||
    lower === "view" ||
    lower === "index"
  ) {
    return {
      basename,
      stem: structuralStem,
      layerMarker: lower + ext,
    };
  }
  // Cart.tsx → stem from basename; layer is the extension / full name marker.
  return {
    basename,
    stem: structuralStem || name,
    layerMarker: ext || name,
  };
}

/**
 * List real same-folder / neighbor files that define the feature around this path.
 * Primary: all co-located sources (any naming). Boost: stem/suffix neighbors.
 */
export async function listStemSiblingsOnDisk(
  filePath: string
): Promise<string[]> {
  const found = new Set<string>();

  // 1) Everything sitting in this folder — works for any project layout.
  for (const name of await listColocatedSourceFiles(filePath)) {
    found.add(name);
  }

  const { stem } = parseTabFileStemAndLayer(filePath);
  const stemLower = stem.toLowerCase();
  const dir = path.dirname(filePath);

  // 2) Classic stem/suffix neighbors (optional boost when conventions match).
  try {
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
      if (entry === path.basename(filePath)) {
        continue;
      }
      if (!SOURCE_EXTENSIONS.some((e) => entry.endsWith(e))) {
        continue;
      }
      if (/\.(test|spec|stories|story|mock)\./i.test(entry) || /\.d\.ts$/i.test(entry)) {
        continue;
      }
      const ext = path.extname(entry);
      const name = ext ? entry.slice(0, -ext.length) : entry;
      const nameLower = name.toLowerCase();
      if (
        nameLower === stemLower ||
        nameLower.startsWith(stemLower + ".") ||
        stemLower.startsWith(nameLower + ".")
      ) {
        found.add(entry);
      }
    }
  } catch {
    // ignore
  }

  for (const candidate of neighborPathCandidates(filePath).slice(0, 20)) {
    if (await pathExists(candidate)) {
      found.add(path.basename(candidate));
    }
  }

  return [...found].slice(0, 12);
}

export async function buildTabFileIdentity(
  document: vscode.TextDocument
): Promise<TabFileIdentity | undefined> {
  if (document.uri.scheme !== "file") {
    return undefined;
  }
  const filePath = document.uri.fsPath;
  const { basename, stem, layerMarker } = parseTabFileStemAndLayer(filePath);
  const siblingsOnDisk = await listStemSiblingsOnDisk(filePath);
  const folder = path.basename(path.dirname(filePath));
  return {
    basename,
    relativePath: workspaceRelativeLabel(filePath),
    stem,
    layerMarker,
    folder,
    siblingsOnDisk,
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Resolve `./foo` → concrete file on disk (tries extensions + index). */
export async function resolveRelativeImportFile(
  fromFile: string,
  specifier: string
): Promise<string | undefined> {
  const baseDir = path.dirname(fromFile);
  const joined = path.resolve(baseDir, specifier);
  if (await pathExists(joined)) {
    const st = await fs.stat(joined);
    if (st.isFile()) {
      return joined;
    }
    if (st.isDirectory()) {
      for (const ext of SOURCE_EXTENSIONS) {
        const indexPath = path.join(joined, `index${ext}`);
        if (await pathExists(indexPath)) {
          return indexPath;
        }
      }
    }
  }
  if (path.extname(joined)) {
    return undefined;
  }
  for (const ext of SOURCE_EXTENSIONS) {
    const withExt = joined + ext;
    if (await pathExists(withExt)) {
      return withExt;
    }
  }
  for (const ext of SOURCE_EXTENSIONS) {
    const indexPath = path.join(joined, `index${ext}`);
    if (await pathExists(indexPath)) {
      return indexPath;
    }
  }
  return undefined;
}

/**
 * Candidate sibling paths by filename convention
 * (`foo.model.ts` ↔ `foo.tsx`, `events.ts` ↔ `stores.ts`).
 */
export function neighborPathCandidates(filePath: string): string[] {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const ext = path.extname(base);
  const name = ext ? base.slice(0, -ext.length) : base;
  if (!name) {
    return [];
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const pushName = (n: string) => {
    const clean = String(n || "").trim();
    if (!clean || clean === name) {
      return;
    }
    for (const e of SOURCE_EXTENSIONS) {
      const p = path.join(dir, clean + e);
      if (p === filePath || seen.has(p)) {
        continue;
      }
      seen.add(p);
      out.push(p);
    }
  };

  let stem = name;
  let matchedSuffix = "";
  for (const suffix of NAME_SUFFIXES) {
    if (name.endsWith(suffix) && name.length > suffix.length) {
      stem = name.slice(0, -suffix.length);
      matchedSuffix = suffix;
      break;
    }
  }

  if (matchedSuffix) {
    // foo.model → foo / foo.ui / foo.types / foo.view
    pushName(stem);
    pushName(`${stem}.ui`);
    pushName(`${stem}.view`);
    pushName(`${stem}.types`);
  } else if (name === "events" || name === "event") {
    pushName("stores");
    pushName("store");
    pushName("effects");
    pushName("units");
    pushName("model");
  } else if (name === "stores" || name === "store") {
    pushName("events");
    pushName("effects");
    pushName("units");
    pushName("model");
  } else if (name === "effects" || name === "effect") {
    pushName("events");
    pushName("stores");
    pushName("units");
  } else if (name === "units" || name === "model") {
    pushName("events");
    pushName("stores");
    pushName("effects");
  } else {
    // foo.tsx / foo.ts → foo.model / foo.store / foo.events / …
    pushName(`${name}.model`);
    pushName(`${name}.store`);
    pushName(`${name}.stores`);
    pushName(`${name}.events`);
    pushName(`${name}.types`);
    pushName(`${name}.api`);
    pushName(`${name}.hooks`);
  }

  return out;
}

/** First existing neighbor file on disk (capped checks). */
export async function resolveNeighborFile(
  filePath: string
): Promise<string | undefined> {
  const candidates = neighborPathCandidates(filePath).slice(0, 24);
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      try {
        const st = await fs.stat(candidate);
        if (st.isFile()) {
          return candidate;
        }
      } catch {
        // continue
      }
    }
  }
  return undefined;
}

function locationUri(
  loc: vscode.Location | vscode.LocationLink
): vscode.Uri | undefined {
  if ("targetUri" in loc && loc.targetUri) {
    return loc.targetUri;
  }
  if ("uri" in loc && loc.uri) {
    return loc.uri;
  }
  return undefined;
}

/**
 * Resolve a different file that defines / owns the symbol at the caret.
 * Uses definition provider first, then workspace symbols (hard timeout).
 */
export async function resolveFileForSymbolAtCaret(
  document: vscode.TextDocument,
  position: vscode.Position,
  symbol: string
): Promise<string | undefined> {
  const self = document.uri.fsPath;

  const defs = await withTimeout(
    vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      "vscode.executeDefinitionProvider",
      document.uri,
      position
    ),
    SYMBOL_RESOLVE_TIMEOUT_MS
  );
  for (const d of defs || []) {
    const uri = locationUri(d);
    if (uri?.scheme === "file" && uri.fsPath && uri.fsPath !== self) {
      return uri.fsPath;
    }
  }

  if (symbol.length < 2) {
    return undefined;
  }

  const query = symbol.startsWith("$") ? symbol.slice(1) || symbol : symbol;
  const symbols = await withTimeout(
    vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      "vscode.executeWorkspaceSymbolProvider",
      query
    ),
    SYMBOL_RESOLVE_TIMEOUT_MS
  );
  if (!symbols || symbols.length === 0) {
    return undefined;
  }

  const score = (s: vscode.SymbolInformation): number => {
    const name = s.name || "";
    if (name === symbol || name === query) {
      return 3;
    }
    if (name === `$${query}` || `$${name}` === symbol) {
      return 2;
    }
    if (name.includes(query)) {
      return 1;
    }
    return 0;
  };

  const ranked = symbols
    .map((s) => ({ s, score: score(s) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const { s } of ranked) {
    const uri = s.location?.uri;
    if (uri?.scheme === "file" && uri.fsPath && uri.fsPath !== self) {
      return uri.fsPath;
    }
  }
  return undefined;
}

function workspaceRelativeLabel(filePath: string): string {
  const folders = vscode.workspace.workspaceFolders || [];
  for (const folder of folders) {
    const root = folder.uri.fsPath;
    if (filePath === root || filePath.startsWith(root + path.sep)) {
      return path.relative(root, filePath).split(path.sep).join("/");
    }
  }
  return path.basename(filePath);
}

function currentWorkspaceRoot(
  document: vscode.TextDocument
): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (folder) {
    return folder.uri.fsPath;
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function loadSnippetFromDisk(
  filePath: string,
  maxChars: number
): Promise<TabRelatedSnippet | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (!raw.trim()) {
      return undefined;
    }
    const snippet = pickExportSnippets(raw, maxChars);
    if (!snippet.trim()) {
      return undefined;
    }
    return { label: workspaceRelativeLabel(filePath), snippet };
  } catch {
    return undefined;
  }
}

function pickSiblingOpenDocument(
  current: vscode.TextDocument
): vscode.TextDocument | undefined {
  const currentUri = current.uri.toString();
  const docs = vscode.window.visibleTextEditors
    .map((e) => e.document)
    .filter(
      (d) =>
        d.uri.scheme === "file" &&
        d.uri.toString() !== currentUri &&
        !d.isUntitled
    );

  const sameLang = docs.find((d) => d.languageId === current.languageId);
  if (sameLang) {
    return sameLang;
  }
  return docs[0];
}

async function loadProjectRulesDigest(
  root: string,
  targetRelativePath: string
): Promise<string | undefined> {
  const key = `${root}::${targetRelativePath}`;
  const now = Date.now();
  if (
    rulesCache &&
    rulesCache.key === key &&
    now - rulesCache.at < RULES_CACHE_TTL_MS
  ) {
    return rulesCache.text;
  }

  const text = await loadWorkspaceRules(root, {
    targetPaths: [targetRelativePath],
    charCap: MAX_RULES_CHARS,
  });
  const capped = text ? text.slice(0, MAX_RULES_CHARS).trim() : undefined;
  rulesCache = { key, at: now, text: capped };
  return capped;
}

type RelatedCollector = {
  related: TabRelatedSnippet[];
  usedPaths: Set<string>;
  budget: number;
};

async function tryPushRelatedFile(
  state: RelatedCollector,
  filePath: string,
  options?: { labelPrefix?: string; maxChars?: number }
): Promise<boolean> {
  const limit = MAX_RELATED_FILES;
  if (state.related.length >= limit || state.budget < 120) {
    return false;
  }
  if (!filePath || state.usedPaths.has(filePath)) {
    return false;
  }
  const base = path.basename(filePath).toLowerCase();
  if (
    /\.(test|spec|stories|story|mock)\./i.test(base) ||
    /\.d\.ts$/i.test(base)
  ) {
    return false;
  }
  state.usedPaths.add(filePath);
  const maxChars = options?.maxChars ?? MAX_SNIPPET_CHARS;
  const item = await loadSnippetFromDisk(
    filePath,
    Math.min(maxChars, state.budget)
  );
  if (!item || !item.snippet.trim()) {
    return false;
  }
  if (options?.labelPrefix) {
    item.label = `${options.labelPrefix}${item.label}`;
  }
  state.related.push(item);
  state.budget -= item.snippet.length + item.label.length + 24;
  return true;
}

function shapeSearchGlob(shape: string): string {
  // `*.model.ts` → `**/*.model.ts`; `events.ts` → `**/events.ts`
  if (shape.startsWith("*")) {
    return `**/${shape}`;
  }
  return `**/${shape}`;
}

/**
 * Same-layer example for Tab few-shot — any project layout.
 * Priority:
 *   1) twin directories (shared basenames) / same basename elsewhere
 *   2) filename-shape glob (optional convention boost)
 *   3) project-map cached example
 */
export async function resolveSameShapeExampleFile(
  root: string,
  filePath: string
): Promise<string | undefined> {
  // Warm structure index in the background for subsequent lookups.
  void ensureStructureIndex(root);

  const structural = await resolveStructuralSameLayerFile(root, filePath);
  if (structural) {
    return structural.path;
  }

  const shape = fileShapeKey(filePath);
  const targetParts = relativePosixPath(root, filePath).split("/");
  const targetParent = path.basename(path.dirname(filePath)).toLowerCase();
  const targetDepth = targetParts.length;

  const mapped = getTabProjectMapShapeExample(root, filePath);

  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
  const pattern = new vscode.RelativePattern(
    folder ?? vscode.Uri.file(root),
    shapeSearchGlob(shape)
  );
  const uris = await vscode.workspace.findFiles(
    pattern,
    "**/{node_modules,dist,out,build,coverage,vendor,.git,.next,storybook-static,__mocks__,__tests__}/**",
    40
  );

  const score = (p: string): number => {
    const base = path.basename(p).toLowerCase();
    const rel = relativePosixPath(root, p).split("/");
    let s = 0;
    if (base.startsWith("index.")) {
      s -= 8;
    }
    if (/\.(test|spec|stories|story|mock)\./i.test(p)) {
      s -= 20;
    }
    const n = Math.min(rel.length, targetParts.length) - 1;
    for (let i = 0; i < n; i++) {
      if (rel[i] === targetParts[i]) {
        s += 6;
      } else {
        break;
      }
    }
    if (path.basename(path.dirname(p)).toLowerCase() === targetParent) {
      s += 10;
    }
    s -= Math.abs(rel.length - targetDepth) * 2;
    s -= Math.max(0, rel.length - 6);
    return s;
  };

  const ranked = uris
    .map((u) => u.fsPath)
    .filter((p) => p !== filePath)
    .filter((p) => !/\.(test|spec|stories|story|mock)\./i.test(p))
    .sort((a, b) => score(b) - score(a));

  for (const candidate of ranked.slice(0, 16)) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      if (raw.trim().length < 40) {
        continue;
      }
      return candidate;
    } catch {
      // continue
    }
  }

  if (mapped?.example) {
    const abs = path.join(root, mapped.example.split("/").join(path.sep));
    if (abs !== filePath && (await pathExists(abs))) {
      return abs;
    }
  }
  return undefined;
}

function relativePosixPath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

/**
 * Gather related-file snippets + rules digest for Tab prompts.
 * Pass `position` so symbol-at-caret and neighbors can rank higher than imports.
 */
export async function buildTabExtraContext(
  document: vscode.TextDocument,
  position?: vscode.Position
): Promise<TabExtraContext> {
  if (document.uri.scheme !== "file") {
    return { related: [] };
  }

  const nearlyEmpty = document.getText().trim().length < 80;
  const fileIdentity = await buildTabFileIdentity(document);
  const root = currentWorkspaceRoot(document);

  const state: RelatedCollector = {
    related: [],
    usedPaths: new Set<string>([document.uri.fsPath]),
    budget: MAX_TOTAL_EXTRA_CHARS,
  };

  const pushNeighbor = async (labelPrefix?: string) => {
    if (state.related.length >= MAX_RELATED_FILES || state.budget < 120) {
      return;
    }
    const neighbor = await resolveNeighborFile(document.uri.fsPath);
    if (neighbor) {
      await tryPushRelatedFile(state, neighbor, {
        labelPrefix,
        maxChars: nearlyEmpty ? 280 : MAX_SNIPPET_CHARS,
      });
    }
  };

  // Empty / new file: SAME LAYER example first, then one OTHER LAYER sibling.
  if (nearlyEmpty) {
    if (root) {
      const sameShape = await resolveSameShapeExampleFile(
        root,
        document.uri.fsPath
      );
      if (sameShape) {
        await tryPushRelatedFile(state, sameShape, {
          labelPrefix: "SAME LAYER (mirror this): ",
          maxChars: MAX_SAME_SHAPE_CHARS,
        });
      }
    }
    // Sibling = other layer of this feature (stem/naming only — do not copy).
    await pushNeighbor("OTHER LAYER sibling (naming only, do not copy): ");
    if (
      fileIdentity &&
      state.related.length < MAX_RELATED_EMPTY &&
      state.budget >= 120
    ) {
      const dir = path.dirname(document.uri.fsPath);
      for (const sib of fileIdentity.siblingsOnDisk) {
        if (state.related.length >= MAX_RELATED_EMPTY) {
          break;
        }
        await tryPushRelatedFile(state, path.join(dir, sib), {
          labelPrefix: "OTHER LAYER sibling (naming only, do not copy): ",
          maxChars: 240,
        });
      }
    }
  }

  // Symbol under caret (mid-file).
  if (position && !nearlyEmpty) {
    const lineText = document.lineAt(position.line).text;
    const symbol = extractIdentifierAt(lineText, position.character);
    if (symbol) {
      const symbolFile = await resolveFileForSymbolAtCaret(
        document,
        position,
        symbol
      );
      if (symbolFile) {
        await tryPushRelatedFile(state, symbolFile);
      }
    }
  }

  // Neighbor by filename (if not already filled for empty files).
  if (!nearlyEmpty) {
    await pushNeighbor();
  }

  // Relative imports (mid-file / non-empty).
  if (!nearlyEmpty) {
    const source = document.getText();
    const specs = extractRelativeImportSpecifiers(source).slice(0, 6);
    for (const spec of specs) {
      if (state.related.length >= MAX_RELATED_FILES || state.budget < 120) {
        break;
      }
      const resolved = await resolveRelativeImportFile(
        document.uri.fsPath,
        spec
      );
      if (!resolved) {
        continue;
      }
      await tryPushRelatedFile(state, resolved);
    }
  }

  // One other visible editor — skip on empty files (too much cross-file noise).
  if (!nearlyEmpty && state.related.length < MAX_RELATED_FILES && state.budget >= 120) {
    const sibling = pickSiblingOpenDocument(document);
    if (sibling && !state.usedPaths.has(sibling.uri.fsPath)) {
      state.usedPaths.add(sibling.uri.fsPath);
      const snippet = pickExportSnippets(
        sibling.getText(),
        Math.min(MAX_SNIPPET_CHARS, state.budget)
      );
      if (snippet.trim()) {
        state.related.push({
          label: workspaceRelativeLabel(sibling.uri.fsPath),
          snippet,
        });
        state.budget -= snippet.length + 24;
      }
    }
  }

  let projectRules: string | undefined;
  let projectMap: string | undefined;
  // Empty files: skip AGENTS.md — use SAME LAYER example + map instead.
  if (root && state.budget >= 120) {
    const map = getTabProjectMapDigest(root, document.uri.fsPath, {
      mode: nearlyEmpty ? "full" : "focused",
    });
    if (map) {
      const cap = nearlyEmpty
        ? Math.min(MAX_PROJECT_MAP_CHARS, Math.max(state.budget, 400))
        : Math.min(420, state.budget);
      projectMap = map.slice(0, cap);
    }
  }

  return {
    related: state.related,
    projectRules,
    projectMap,
    fileIdentity,
  };
}
