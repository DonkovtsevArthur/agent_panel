/**
 * Per-file micro-research for Tab autocomplete.
 * Runs when a file is opened / focused (not on every keystroke):
 * what the filename means, how this layer is built in the repo,
 * siblings, and the current file's own outline.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import {
  buildTabFileIdentity,
  parseTabFileStemAndLayer,
  pickExportSnippets,
  resolveSameShapeExampleFile,
  type TabFileIdentity,
} from "./tabAutocompleteExtraContext";
import {
  extractFileSkeleton,
  fileShapeKey,
  getTabProjectMapShapeExample,
} from "./tabAutocompleteProjectMap";
import {
  ensureStructureIndex,
  resolveStructuralSameLayerFile,
} from "./tabAutocompleteStructure";

const MAX_BRIEF_CHARS = 1_100;
const MAX_OUTLINE_CHARS = 360;
const MAX_EXAMPLE_CHARS = 420;
const MAX_REWRITTEN_CHARS = 380;
const CACHE_TTL_MS = 10 * 60 * 1000;
const REBUILD_DEBOUNCE_MS = 400;

export type TabFileBrief = {
  uri: string;
  fsPath: string;
  at: number;
  empty: boolean;
  identity?: TabFileIdentity;
  /** Ready-to-inject prompt block (without heading wrapper). */
  digest: string;
};

type CacheEntry = {
  brief: TabFileBrief;
  /** Content length fingerprint to invalidate cheaply. */
  contentLen: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<TabFileBrief | undefined>>();
let debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
let logger: ((message: string, extra?: unknown) => void) | undefined;

export function setTabFileBriefLogger(
  fn: ((message: string, extra?: unknown) => void) | undefined
): void {
  logger = fn;
}

function log(message: string, extra?: unknown): void {
  if (logger) {
    logger(message, extra);
    return;
  }
  if (extra !== undefined) {
    console.log(`[Harbor Tab fileBrief] ${message}`, extra);
  } else {
    console.log(`[Harbor Tab fileBrief] ${message}`);
  }
}

function workspaceRootFor(doc: vscode.TextDocument): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  if (folder) {
    return folder.uri.fsPath;
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function relativePosix(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function toPascal(stem: string): string {
  const s = String(stem || "");
  if (!s) {
    return s;
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function toCamel(stem: string): string {
  const s = String(stem || "");
  if (!s) {
    return s;
  }
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Rewrite example identifiers from one feature stem to another
 * (Cart/cart/$cart → Order/order/$order). Best-effort for empty-file starts.
 */
export function rewriteStemInSnippet(
  snippet: string,
  fromStem: string,
  toStem: string
): string {
  const from = String(fromStem || "").trim();
  const to = String(toStem || "").trim();
  if (!snippet || from.length < 2 || to.length < 2) {
    return snippet;
  }
  if (from.toLowerCase() === to.toLowerCase()) {
    return snippet;
  }

  const fromPascal = toPascal(from);
  const toPascalStem = toPascal(to);
  const fromCamel = toCamel(from);
  const toCamelStem = toCamel(to);
  const fromLower = from.toLowerCase();
  const toLower = to.toLowerCase();

  let out = snippet;
  const replaceWord = (src: string, dst: string) => {
    if (!src || src === dst) {
      return;
    }
    const re = new RegExp(`\\b${src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    out = out.replace(re, dst);
  };

  // Longest / most specific first.
  replaceWord(`$${fromPascal}`, `$${toPascalStem}`);
  replaceWord(`$${fromCamel}`, `$${toCamelStem}`);
  replaceWord(`$${fromLower}`, `$${toLower}`);
  replaceWord(`${fromPascal}Fx`, `${toPascalStem}Fx`);
  replaceWord(`${fromCamel}Fx`, `${toCamelStem}Fx`);
  replaceWord(`${fromLower}Fx`, `${toLower}Fx`);
  replaceWord(fromPascal, toPascalStem);
  if (fromCamel !== fromPascal) {
    replaceWord(fromCamel, toCamelStem);
  }
  if (fromLower !== fromCamel && fromLower !== fromPascal) {
    replaceWord(fromLower, toLower);
  }

  return out;
}

/** Evidence-based cues from a real same-layer snippet (not filename role enums). */
export function layerCuesFromSnippet(snippet: string): string[] {
  const s = String(snippet || "");
  const cues: string[] = [];
  if (
    /\bcreate(?:Store|Event|Effect|Domain)\b|\bsample\s*\(/.test(s) ||
    /from ['"]effector/.test(s)
  ) {
    cues.push("effector units/wiring");
  }
  if (
    /from ['"]react['"]/.test(s) ||
    /\b(?:useState|useEffect|useMemo|useCallback)\b/.test(s) ||
    /(?:export\s+)?(?:default\s+)?function\s+[A-Z]/.test(s) ||
    /=\s*\([^)]*\)\s*=>\s*\(/.test(s)
  ) {
    cues.push("React UI");
  }
  if (/\bcreateSlice\b|\bcreateApi\b|@reduxjs\/toolkit/.test(s)) {
    cues.push("Redux Toolkit");
  }
  if (/\bz\.object\b|from ['"]zod['"]/.test(s)) {
    cues.push("zod schemas");
  }
  if (/^\s*export\s+type\b|^\s*export\s+interface\b/m.test(s)) {
    cues.push("types/interfaces");
  }
  return cues.slice(0, 3);
}

async function loadSameLayerSnippet(
  root: string,
  filePath: string
): Promise<
  | {
      label: string;
      snippet: string;
      exampleStem: string;
      cues: string[];
      reason?: string;
    }
  | undefined
> {
  let examplePath: string | undefined;
  let reason: string | undefined;
  const structural = await resolveStructuralSameLayerFile(root, filePath);
  if (structural) {
    examplePath = structural.path;
    reason = structural.reason;
  } else {
    examplePath = await resolveSameShapeExampleFile(root, filePath);
    if (examplePath) {
      reason = "filename shape / map";
    }
  }
  if (examplePath) {
    try {
      const raw = await fs.readFile(examplePath, "utf8");
      const snippet =
        pickExportSnippets(raw, MAX_EXAMPLE_CHARS) ||
        extractFileSkeleton(raw, MAX_EXAMPLE_CHARS);
      if (snippet.trim()) {
        const exampleStem = parseTabFileStemAndLayer(examplePath).stem;
        return {
          label: relativePosix(root, examplePath),
          snippet: snippet.trim(),
          exampleStem,
          cues: layerCuesFromSnippet(snippet),
          reason,
        };
      }
    } catch {
      // fall through to map skeleton
    }
  }

  const mapped = getTabProjectMapShapeExample(root, filePath);
  if (mapped?.skeleton) {
    const exampleStem = mapped.example
      ? parseTabFileStemAndLayer(mapped.example).stem
      : "";
    return {
      label: mapped.example || mapped.shape,
      snippet: mapped.skeleton.slice(0, MAX_EXAMPLE_CHARS),
      exampleStem,
      cues: layerCuesFromSnippet(mapped.skeleton),
      reason: "project map",
    };
  }
  return undefined;
}

async function siblingPeeks(
  dir: string,
  siblings: string[]
): Promise<string[]> {
  const peeks: string[] = [];
  for (const sib of siblings.slice(0, 3)) {
    try {
      const raw = await fs.readFile(path.join(dir, sib), "utf8");
      const snip = pickExportSnippets(raw, 140);
      const first = snip
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      if (first) {
        peeks.push(
          `\`${sib}\`: ${first.length > 100 ? first.slice(0, 97) + "…" : first}`
        );
      } else {
        peeks.push(`\`${sib}\``);
      }
    } catch {
      peeks.push(`\`${sib}\``);
    }
  }
  return peeks;
}

function outlineCurrentFile(text: string): string {
  const skeleton = extractFileSkeleton(text, MAX_OUTLINE_CHARS);
  if (skeleton.trim()) {
    return skeleton.trim();
  }
  return pickExportSnippets(text, MAX_OUTLINE_CHARS).trim();
}

function formatBriefDigest(args: {
  identity: TabFileIdentity;
  empty: boolean;
  shape: string;
  sameLayer?: {
    label: string;
    snippet: string;
    exampleStem: string;
    cues: string[];
    reason?: string;
  };
  rewritten?: string;
  siblingPeeks?: string[];
  outline?: string;
}): string {
  const {
    identity,
    empty,
    shape,
    sameLayer,
    rewritten,
    siblingPeeks: peeks,
    outline,
  } = args;
  const lines: string[] = [];
  lines.push(
    `File \`${identity.relativePath}\` — stem \`${identity.stem}\`, layer \`${identity.layerMarker || "plain"}\`, shape \`${shape}\`.`
  );
  if (identity.folder && identity.folder !== ".") {
    lines.push(`Folder: \`${identity.folder}\`.`);
  }
  if (peeks && peeks.length > 0) {
    lines.push("Feature siblings (OTHER LAYER — naming only):");
    for (const p of peeks) {
      lines.push(`- ${p}`);
    }
  } else if (identity.siblingsOnDisk.length > 0) {
    lines.push(
      `Feature siblings on disk: ${identity.siblingsOnDisk
        .map((s) => `\`${s}\``)
        .join(", ")} (other layers — naming only).`
    );
  }

  if (sameLayer) {
    if (sameLayer.reason) {
      lines.push(`Matched via: ${sameLayer.reason}.`);
    }
    if (sameLayer.cues.length > 0) {
      lines.push(
        `How this layer looks in-repo (from example): ${sameLayer.cues.join(", ")}.`
      );
    }
    lines.push(
      `SAME LAYER example \`${sameLayer.label}\` (mirror structure; rename stem \`${sameLayer.exampleStem || "?"}\` → \`${identity.stem}\`):`
    );
    lines.push(sameLayer.snippet);
    if (rewritten && rewritten.trim() && rewritten !== sameLayer.snippet) {
      lines.push(
        `Suggested start for THIS file (example rewritten to stem \`${identity.stem}\` — adapt, do not dump blindly):`
      );
      lines.push(rewritten.trim());
    }
  } else {
    lines.push(
      `No SAME LAYER example found yet — stay inside layer \`${identity.layerMarker || shape}\` and do not invent a foreign architecture.`
    );
  }

  if (empty) {
    lines.push(
      `Status: EMPTY. Start only this layer (imports + first export/component). Do not emit sibling-layer code.`
    );
  } else if (outline) {
    lines.push("Current file outline (continue in this style):");
    lines.push(outline);
  }

  return lines.join("\n").slice(0, MAX_BRIEF_CHARS).trim();
}

/**
 * Build a fresh micro-research brief for the document.
 */
export async function buildTabFileBrief(
  document: vscode.TextDocument
): Promise<TabFileBrief | undefined> {
  if (document.uri.scheme !== "file") {
    return undefined;
  }
  const fsPath = document.uri.fsPath;
  const root = workspaceRootFor(document);
  if (!root) {
    return undefined;
  }

  const identity = await buildTabFileIdentity(document);
  if (!identity) {
    return undefined;
  }

  const text = document.getText();
  const empty = text.trim().length < 80;
  const shape = fileShapeKey(fsPath);
  const sameLayer = await loadSameLayerSnippet(root, fsPath);
  const outline = empty ? undefined : outlineCurrentFile(text);
  const peeks =
    identity.siblingsOnDisk.length > 0
      ? await siblingPeeks(path.dirname(fsPath), identity.siblingsOnDisk)
      : [];

  let rewritten: string | undefined;
  if (empty && sameLayer?.snippet && sameLayer.exampleStem) {
    rewritten = rewriteStemInSnippet(
      sameLayer.snippet,
      sameLayer.exampleStem,
      identity.stem
    ).slice(0, MAX_REWRITTEN_CHARS);
  }

  const digest = formatBriefDigest({
    identity,
    empty,
    shape,
    sameLayer,
    rewritten,
    siblingPeeks: peeks,
    outline,
  });

  const brief: TabFileBrief = {
    uri: document.uri.toString(),
    fsPath,
    at: Date.now(),
    empty,
    identity,
    digest,
  };

  cache.set(brief.uri, { brief, contentLen: text.length });
  log("brief ready", {
    path: identity.relativePath,
    empty,
    shape,
    sameLayer: sameLayer?.label,
    matchVia: sameLayer?.reason,
    cues: sameLayer?.cues,
    rewritten: Boolean(rewritten && rewritten !== sameLayer?.snippet),
    digestChars: digest.length,
  });
  return brief;
}

/** Sync read of cached brief (may be stale/missing). */
export function getCachedTabFileBrief(
  uri: string | vscode.Uri
): TabFileBrief | undefined {
  const key = typeof uri === "string" ? uri : uri.toString();
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }
  if (Date.now() - entry.brief.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.brief;
}

/**
 * Ensure a brief exists for this document. Coalesces concurrent builds.
 */
export async function ensureTabFileBrief(
  document: vscode.TextDocument,
  options?: { force?: boolean }
): Promise<TabFileBrief | undefined> {
  if (document.uri.scheme !== "file") {
    return undefined;
  }
  const key = document.uri.toString();
  const existing = cache.get(key);
  if (
    existing &&
    !options?.force &&
    Date.now() - existing.brief.at <= CACHE_TTL_MS &&
    existing.contentLen === document.getText().length
  ) {
    return existing.brief;
  }

  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }

  const promise = buildTabFileBrief(document).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

/** Debounced rebuild after edits (empty→non-empty, big outline changes). */
export function scheduleTabFileBriefRefresh(
  document: vscode.TextDocument
): void {
  if (document.uri.scheme !== "file") {
    return;
  }
  const key = document.uri.toString();
  const prev = debounceTimers.get(key);
  if (prev) {
    clearTimeout(prev);
  }
  const timer = setTimeout(() => {
    debounceTimers.delete(key);
    void ensureTabFileBrief(document, { force: true });
  }, REBUILD_DEBOUNCE_MS);
  debounceTimers.set(key, timer);
}

/**
 * Register open/focus listeners. Returns a disposable aggregate.
 */
export function startTabFileBriefTracking(
  subscriptions: vscode.Disposable[]
): void {
  const warm = (editor: vscode.TextEditor | undefined) => {
    if (!editor || editor.document.uri.scheme !== "file") {
      return;
    }
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (folder) {
      void ensureStructureIndex(folder.uri.fsPath);
    }
    void ensureTabFileBrief(editor.document);
  };

  warm(vscode.window.activeTextEditor);

  subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      warm(editor);
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.uri.scheme === "file") {
        void ensureTabFileBrief(doc);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.scheme !== "file") {
        return;
      }
      const cached = cache.get(e.document.uri.toString());
      // Rebuild when crossing empty↔non-empty or first edits after open.
      const nowEmpty = e.document.getText().trim().length < 80;
      if (!cached || cached.brief.empty !== nowEmpty) {
        scheduleTabFileBriefRefresh(e.document);
        return;
      }
      // Occasional refresh on larger edits so outline stays honest.
      if (Math.abs(e.document.getText().length - cached.contentLen) > 120) {
        scheduleTabFileBriefRefresh(e.document);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      cache.delete(doc.uri.toString());
      const t = debounceTimers.get(doc.uri.toString());
      if (t) {
        clearTimeout(t);
        debounceTimers.delete(doc.uri.toString());
      }
    })
  );
}
