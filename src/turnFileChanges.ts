import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import type { FileEditStat } from "./diffStats";
import { lineDiffStats } from "./diffStats";

const execFileAsync = promisify(execFile);

function normalizeRel(filePath: string): string {
  return filePath
    .trim()
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\\/g, "/");
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 12_000,
  });
  return String(stdout || "");
}

function workspaceCwd(): string | undefined {
  try {
    // Lazy require so unit tests can import pure helpers without vscode.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vscode = require("vscode") as typeof import("vscode");
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  } catch {
    return undefined;
  }
}

/**
 * Пути из `git status --porcelain=v1` (modified / added / untracked / renames).
 * Rename даёт новый путь; ignored файлы не попадают.
 */
export function parsePorcelainPaths(stdout: string): string[] {
  const paths: string[] = [];
  for (const rawLine of String(stdout || "").split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, "");
    if (line.length < 4) {
      continue;
    }
    // XY<space>path  or  XY<space>old -> new
    const body = line.slice(3);
    if (!body) {
      continue;
    }
    const renameSep = " -> ";
    const sep = body.lastIndexOf(renameSep);
    const pathPart =
      sep >= 0 && /^R/.test(line.slice(0, 2))
        ? body.slice(sep + renameSep.length)
        : body;
    const rel = normalizeRel(pathPart);
    if (rel) {
      paths.push(rel);
    }
  }
  return [...new Set(paths)];
}

/** Файлы, ставшие dirty относительно baseline хода. */
export function pathsNewlyDirty(
  baseline: Iterable<string>,
  current: Iterable<string>
): string[] {
  const base = new Set([...baseline].map(normalizeRel).filter(Boolean));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const filePath of current) {
    const rel = normalizeRel(filePath);
    if (!rel || base.has(rel) || seen.has(rel)) {
      continue;
    }
    seen.add(rel);
    out.push(rel);
  }
  return out;
}

function stem(filePath: string): string {
  let base = path.posix.basename(normalizeRel(filePath));
  base = base.replace(/\.snap$/i, "");
  base = base.replace(/\.(test|spec)\.[^.]+$/i, "");
  base = base.replace(/\.[^.]+$/, "");
  return base;
}

function isTestLikePath(rel: string): boolean {
  const base = path.posix.basename(rel);
  return (
    /\.(test|spec)\./i.test(base) ||
    /\.snap$/i.test(base) ||
    /\/__snapshots__\//i.test(rel) ||
    /\/__tests__\//i.test(rel)
  );
}

/**
 * Dirty-компаньоны правок: только тесты/snapshot'ы рядом с файлами,
 * которые уже трогал write_file/search_replace. Нужны, когда ожидание
 * обновили через shell или файл уже был dirty до хода.
 */
export function relatedDirtyCompanions(
  editedPaths: Iterable<string>,
  dirtyPaths: Iterable<string>
): string[] {
  const edited = [...editedPaths].map(normalizeRel).filter(Boolean);
  if (!edited.length) {
    return [];
  }

  const editedSet = new Set(edited);
  const dirs = new Set(edited.map((p) => path.posix.dirname(p)));
  const stems = new Set(edited.map(stem).filter(Boolean));

  const out: string[] = [];
  for (const filePath of dirtyPaths) {
    const rel = normalizeRel(filePath);
    if (!rel || editedSet.has(rel) || !isTestLikePath(rel)) {
      continue;
    }
    const dir = path.posix.dirname(rel);
    const underEditedTree = [...dirs].some(
      (d) =>
        dir === d ||
        dir === `${d}/__snapshots__` ||
        dir === `${d}/__tests__`
    );
    if (underEditedTree || stems.has(stem(rel))) {
      out.push(rel);
    }
  }
  return out;
}

export async function listDirtyPaths(
  cwd = workspaceCwd()
): Promise<string[]> {
  if (!cwd) {
    return [];
  }
  try {
    const stdout = await runGit(cwd, [
      "status",
      "--porcelain=v1",
      "--untracked-files=normal",
    ]);
    return parsePorcelainPaths(stdout);
  } catch {
    return [];
  }
}

function parseNumstat(
  stdout: string
): Map<string, { added: number; removed: number }> {
  const map = new Map<string, { added: number; removed: number }>();
  for (const line of String(stdout || "").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    // added\tremoved\tpath   (binary: -\t-\tpath)
    const parts = line.split("\t");
    if (parts.length < 3) {
      continue;
    }
    const addedRaw = parts[0];
    const removedRaw = parts[1];
    const rel = normalizeRel(parts.slice(2).join("\t"));
    if (!rel) {
      continue;
    }
    const added = addedRaw === "-" ? 0 : Number(addedRaw) || 0;
    const removed = removedRaw === "-" ? 0 : Number(removedRaw) || 0;
    const prev = map.get(rel);
    if (prev) {
      map.set(rel, {
        added: prev.added + added,
        removed: prev.removed + removed,
      });
    } else {
      map.set(rel, { added, removed });
    }
  }
  return map;
}

async function lineCount(filePath: string): Promise<number> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    if (!text) {
      return 0;
    }
    return lineDiffStats("", text).added;
  } catch {
    return 1;
  }
}

async function statsForPaths(
  cwd: string,
  paths: string[]
): Promise<Map<string, FileEditStat>> {
  const result = new Map<string, FileEditStat>();
  const scoped = [...new Set(paths.map(normalizeRel).filter(Boolean))];
  if (!scoped.length) {
    return result;
  }

  try {
    const [vsHead, status] = await Promise.all([
      runGit(cwd, ["diff", "--numstat", "HEAD", "--", ...scoped]),
      runGit(cwd, [
        "status",
        "--porcelain=v1",
        "--untracked-files=normal",
        "--",
        ...scoped,
      ]),
    ]);

    const combined = parseNumstat(vsHead);
    const untracked = new Set<string>();
    for (const rawLine of status.split(/\r?\n/)) {
      const line = rawLine.replace(/\r$/, "");
      if (line.startsWith("?? ")) {
        const rel = normalizeRel(line.slice(3));
        if (rel) {
          untracked.add(rel);
        }
      }
    }

    for (const rel of scoped) {
      if (untracked.has(rel)) {
        const added = await lineCount(path.join(cwd, rel));
        result.set(rel, {
          path: rel,
          created: true,
          added: Math.max(1, added),
          removed: 0,
        });
        continue;
      }
      const hit = combined.get(rel);
      result.set(rel, {
        path: rel,
        created: false,
        added: hit?.added || 0,
        removed: hit?.removed || 0,
      });
    }
  } catch {
    for (const rel of scoped) {
      result.set(rel, {
        path: rel,
        created: false,
        added: 0,
        removed: 0,
      });
    }
  }
  return result;
}

/**
 * Какие файлы из review (и связанные тесты/snapshot'ы) ещё dirty в git.
 * Seeds — исходные пути карточки, даже если часть уже закоммичена:
 * так после partial commit теги не пропадают из‑за оставшегося теста.
 */
export async function resolveRemainingReviewFiles(
  reviewPaths: string[],
  cwd = workspaceCwd()
): Promise<FileEditStat[]> {
  if (!cwd) {
    return [];
  }

  let dirty: string[];
  try {
    dirty = await listDirtyPaths(cwd);
  } catch {
    return [];
  }

  const dirtySet = new Set(dirty.map(normalizeRel).filter(Boolean));
  const seeds = [
    ...new Set(reviewPaths.map(normalizeRel).filter(Boolean)),
  ];
  if (!seeds.length) {
    return [];
  }

  const keep = new Set<string>();
  for (const rel of seeds) {
    if (dirtySet.has(rel)) {
      keep.add(rel);
    }
  }
  for (const filePath of relatedDirtyCompanions(seeds, dirty)) {
    const rel = normalizeRel(filePath);
    if (rel && dirtySet.has(rel)) {
      keep.add(rel);
    }
  }
  if (!keep.size) {
    return [];
  }

  const stats = await statsForPaths(cwd, [...keep]);
  return [...keep]
    .map(
      (rel) =>
        stats.get(rel) || {
          path: rel,
          created: false,
          added: 0,
          removed: 0,
        }
    )
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Добавляет в карту правок файлы, которые стали dirty за ход или связаны
 * с уже отредактированными (тесты/snapshot'ы рядом) — в т.ч. правки через
 * shell вроде `vitest -u`, которые не проходят write_file/search_replace.
 */
export async function mergeNewlyDirtyEdits(
  editsByPath: Map<string, FileEditStat>,
  baselineDirty: Iterable<string>,
  cwd = workspaceCwd()
): Promise<FileEditStat[]> {
  if (!cwd) {
    return [...editsByPath.values()];
  }

  let current: string[];
  try {
    current = await listDirtyPaths(cwd);
  } catch {
    return [...editsByPath.values()];
  }

  const missing = new Set<string>();
  for (const filePath of pathsNewlyDirty(baselineDirty, current)) {
    const rel = normalizeRel(filePath);
    if (rel && !editsByPath.has(rel)) {
      missing.add(rel);
    }
  }
  for (const filePath of relatedDirtyCompanions(editsByPath.keys(), current)) {
    const rel = normalizeRel(filePath);
    if (rel && !editsByPath.has(rel)) {
      missing.add(rel);
    }
  }

  if (!missing.size) {
    return [...editsByPath.values()];
  }

  const stats = await statsForPaths(cwd, [...missing]);
  for (const rel of missing) {
    const hit = stats.get(rel) || {
      path: rel,
      created: false,
      added: 0,
      removed: 0,
    };
    editsByPath.set(rel, hit);
  }
  return [...editsByPath.values()];
}
