/**
 * Project-structure discovery for Tab — works without filename-suffix dictionaries.
 *
 * Idea: feature folders that contain the same set of basenames are "twins".
 * An empty `features/order/ui.tsx` learns from `features/cart/ui.tsx` because
 * both dirs share `{ui.tsx, model.ts, index.ts}`, not because we know `.model`.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
]);

const SKIP_DIR_RE =
  /^(node_modules|dist|out|build|coverage|vendor|\.git|\.next|storybook-static|__mocks__|__tests__|\.turbo|\.cache)$/i;

const SKIP_FILE_RE = /\.(test|spec|stories|story|mock)\.|\.d\.ts$/i;

export type DirFingerprint = {
  dir: string;
  /** Relative posix path from workspace root. */
  rel: string;
  basenames: string[];
  set: Set<string>;
};

export type StructureTwin = {
  dir: string;
  rel: string;
  /** Jaccard similarity of basenames vs target dir. */
  score: number;
  shared: string[];
};

type StructureIndex = {
  root: string;
  at: number;
  dirs: DirFingerprint[];
};

const INDEX_TTL_MS = 5 * 60 * 1000;
let indexCache: StructureIndex | undefined;
let indexInflight: Promise<StructureIndex | undefined> | undefined;

function isSourceFile(name: string): boolean {
  if (SKIP_FILE_RE.test(name)) {
    return false;
  }
  const ext = path.extname(name).toLowerCase();
  return SOURCE_EXTENSIONS.has(ext);
}

function relativePosix(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) {
      inter++;
    }
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

async function listSourceBasenames(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const names: string[] = [];
    for (const ent of entries) {
      if (!ent.isFile()) {
        continue;
      }
      if (!isSourceFile(ent.name)) {
        continue;
      }
      names.push(ent.name);
    }
    return names.sort();
  } catch {
    return [];
  }
}

/**
 * Build / refresh an index of directories that look like feature modules
 * (2+ source files). Cheap findFiles + per-dir basename read.
 */
export async function ensureStructureIndex(
  root: string,
  options?: { force?: boolean }
): Promise<StructureIndex | undefined> {
  if (
    indexCache &&
    indexCache.root === root &&
    !options?.force &&
    Date.now() - indexCache.at < INDEX_TTL_MS
  ) {
    return indexCache;
  }
  if (indexInflight) {
    return indexInflight;
  }

  indexInflight = (async () => {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
    const pattern = new vscode.RelativePattern(
      folder ?? vscode.Uri.file(root),
      "**/*.{ts,tsx,js,jsx,mts,cts}"
    );
    const uris = await vscode.workspace.findFiles(
      pattern,
      "**/{node_modules,dist,out,build,coverage,vendor,.git,.next,storybook-static,__mocks__,__tests__}/**",
      400
    );

    const dirSet = new Set<string>();
    for (const u of uris) {
      if (u.scheme !== "file") {
        continue;
      }
      dirSet.add(path.dirname(u.fsPath));
    }

    const dirs: DirFingerprint[] = [];
    for (const dir of dirSet) {
      const base = path.basename(dir);
      if (SKIP_DIR_RE.test(base)) {
        continue;
      }
      const basenames = await listSourceBasenames(dir);
      // Need at least 2 files to be a useful "module" fingerprint.
      // Also keep single-file dirs that are leaves under a shared parent — handled later via basename match.
      if (basenames.length < 2) {
        continue;
      }
      dirs.push({
        dir,
        rel: relativePosix(root, dir),
        basenames,
        set: new Set(basenames),
      });
    }

    const index: StructureIndex = { root, at: Date.now(), dirs };
    indexCache = index;
    return index;
  })().finally(() => {
    indexInflight = undefined;
  });

  return indexInflight;
}

/** Co-located source files in the same directory (any naming scheme). */
export async function listColocatedSourceFiles(
  filePath: string
): Promise<string[]> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const names = await listSourceBasenames(dir);
  return names.filter((n) => n !== base).slice(0, 12);
}

/**
 * Directories whose file-set overlaps the target dir (Jaccard on basenames).
 */
export async function findTwinDirectories(
  root: string,
  filePath: string,
  options?: { limit?: number; minScore?: number }
): Promise<StructureTwin[]> {
  const index = await ensureStructureIndex(root);
  if (!index) {
    return [];
  }
  const targetDir = path.dirname(filePath);
  const targetNames = await listSourceBasenames(targetDir);
  // For nearly-empty new folders, fingerprint may be tiny — include the new file basename.
  const base = path.basename(filePath);
  if (!targetNames.includes(base)) {
    targetNames.push(base);
    targetNames.sort();
  }
  const targetSet = new Set(targetNames);
  if (targetSet.size === 0) {
    return [];
  }

  const minScore = options?.minScore ?? 0.34;
  const limit = options?.limit ?? 6;
  const targetRel = relativePosix(root, targetDir);
  const targetParent = path.dirname(targetDir);
  const twins: StructureTwin[] = [];

  for (const d of index.dirs) {
    if (d.dir === targetDir) {
      continue;
    }
    const score = jaccard(targetSet, d.set);
    if (score < minScore) {
      continue;
    }
    const shared = [...targetSet].filter((n) => d.set.has(n));
    // Boost twins under the same parent (features/cart vs features/order).
    let boosted = score;
    if (path.dirname(d.dir) === targetParent) {
      boosted += 0.15;
    }
    // Slight boost for similar depth / shared path prefix.
    const a = targetRel.split("/");
    const b = d.rel.split("/");
    let common = 0;
    for (let i = 0; i < Math.min(a.length, b.length) - 1; i++) {
      if (a[i] === b[i]) {
        common++;
      } else {
        break;
      }
    }
    boosted += Math.min(0.12, common * 0.04);

    twins.push({
      dir: d.dir,
      rel: d.rel,
      score: Math.min(1, boosted),
      shared,
    });
  }

  twins.sort((x, y) => y.score - x.score || x.rel.localeCompare(y.rel));
  return twins.slice(0, limit);
}

/**
 * Same-layer counterpart via structure: prefer same basename in a twin directory.
 * Falls back to the only file with the same extension in the twin dir.
 */
export async function resolveStructuralCounterpart(
  root: string,
  filePath: string
): Promise<{ path: string; twinRel: string; via: "basename" | "ext" } | undefined> {
  const twins = await findTwinDirectories(root, filePath, {
    limit: 8,
    minScore: 0.3,
  });
  if (twins.length === 0) {
    return undefined;
  }

  const base = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  for (const twin of twins) {
    const sameName = path.join(twin.dir, base);
    try {
      const st = await fs.stat(sameName);
      if (st.isFile() && st.size > 20) {
        return { path: sameName, twinRel: twin.rel, via: "basename" };
      }
    } catch {
      // try ext-unique below
    }

    // If this basename isn't in the twin yet (brand-new file), but twin has
    // exactly one source file with the same extension among shared patterns,
    // use that as the layer template.
    try {
      const names = await listSourceBasenames(twin.dir);
      const sameExt = names.filter(
        (n) => path.extname(n).toLowerCase() === ext && n !== base
      );
      // Prefer a shared basename that exists in both fingerprints with same ext.
      const sharedSameExt = twin.shared.filter(
        (n) => path.extname(n).toLowerCase() === ext
      );
      const pick = sharedSameExt[0] || (sameExt.length === 1 ? sameExt[0] : undefined);
      if (pick) {
        const abs = path.join(twin.dir, pick);
        const st = await fs.stat(abs);
        if (st.isFile() && st.size > 20) {
          return { path: abs, twinRel: twin.rel, via: "ext" };
        }
      }
    } catch {
      // continue
    }
  }

  return undefined;
}

/**
 * Same basename elsewhere in the repo (Component.tsx in another feature).
 * Useful when dirs aren't multi-file twins yet.
 */
export async function resolveSameBasenameExample(
  root: string,
  filePath: string
): Promise<string | undefined> {
  const base = path.basename(filePath);
  if (!base || /^index\./i.test(base)) {
    // index.* is too generic — skip basename-only match.
    return undefined;
  }
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
  const pattern = new vscode.RelativePattern(
    folder ?? vscode.Uri.file(root),
    `**/${base}`
  );
  const uris = await vscode.workspace.findFiles(
    pattern,
    "**/{node_modules,dist,out,build,coverage,vendor,.git,.next,storybook-static}/**",
    20
  );
  const targetParent = path.basename(path.dirname(filePath)).toLowerCase();
  const ranked = uris
    .map((u) => u.fsPath)
    .filter((p) => p !== filePath)
    .sort((a, b) => {
      const score = (p: string) => {
        let s = 0;
        if (path.basename(path.dirname(p)).toLowerCase() === targetParent) {
          s += 5;
        }
        s -= path.relative(root, p).split(path.sep).length;
        return s;
      };
      return score(b) - score(a);
    });

  for (const p of ranked.slice(0, 8)) {
    try {
      const raw = await fs.readFile(p, "utf8");
      if (raw.trim().length >= 40) {
        return p;
      }
    } catch {
      // continue
    }
  }
  return undefined;
}

/**
 * Primary any-project same-layer resolver:
 * 1) twin-directory counterpart
 * 2) same basename elsewhere
 */
export async function resolveStructuralSameLayerFile(
  root: string,
  filePath: string
): Promise<
  | { path: string; reason: string }
  | undefined
> {
  const twin = await resolveStructuralCounterpart(root, filePath);
  if (twin) {
    return {
      path: twin.path,
      reason: `twin dir ${twin.twinRel} (${twin.via})`,
    };
  }
  const sameBase = await resolveSameBasenameExample(root, filePath);
  if (sameBase) {
    return {
      path: sameBase,
      reason: `same basename ${path.basename(filePath)}`,
    };
  }
  return undefined;
}

/** Feature stem guess without suffix dictionaries: parent folder, else basename. */
export function structuralFeatureStem(filePath: string): string {
  const base = path.basename(filePath);
  const ext = path.extname(base);
  const name = ext ? base.slice(0, -ext.length) : base;
  const parent = path.basename(path.dirname(filePath));
  if (/^index$/i.test(name) && parent && parent !== "." && parent !== "") {
    return parent;
  }
  // Prefer parent when it looks like a feature id and file is a role name
  // (ui.tsx / model.ts / styles.ts) — detected by short lowercase name.
  if (
    parent &&
    parent !== "." &&
    /^[a-z][\w-]*$/i.test(parent) &&
    /^[a-z][\w-]*$/i.test(name) &&
    name.length <= 16 &&
    !name.includes(".")
  ) {
    // If parent is more specific than generic src/lib, use parent as stem.
    if (!/^(src|lib|app|pages|components|hooks|utils|helpers|types|api)$/i.test(parent)) {
      return parent;
    }
  }
  return name;
}
