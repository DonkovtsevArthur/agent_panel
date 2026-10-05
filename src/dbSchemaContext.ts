/**
 * `@db` mention support: collect DB schema definitions from the workspace
 * (Prisma schema, SQL migrations, Liquibase/Flyway changelogs) and build a
 * compact prompt block. Pure fs/path — no vscode import at module top level
 * so tests and the JetBrains/Figma sidecars can use the formatter too; the
 * vscode workspace search is required lazily with an fs-walk fallback.
 */
import * as fs from "fs";
import * as path from "path";

/** Workspace globs scanned by `@db` (overridable: agentPanel.db.schemaGlobs). */
export const DEFAULT_DB_SCHEMA_GLOBS: string[] = [
  "prisma/schema.prisma",
  "**/schema.prisma",
  "**/db/migration/**",
  "**/db/changelog/**",
  "**/migrations/**/*.sql",
  "db/**/*.sql",
];

export interface DbSchemaFile {
  /** Workspace-relative display path. */
  path: string;
  text: string;
}

const MAX_FILES = 12;
const PER_FILE_CHARS = 24_000;
const TOTAL_CHARS = 32_000;
const MAX_SCAN_FILES = 80;
const MAX_FILE_BYTES = 400_000;
const WALK_MAX_DEPTH = 10;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "out",
  "build",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  ".next",
  ".turbo",
]);

/** Normalize a user-provided glob list; empty → defaults. */
export function normalizeDbSchemaGlobs(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw.map((g) => String(g || "").trim()).filter(Boolean)
    : [];
  return list.length ? list : DEFAULT_DB_SCHEMA_GLOBS;
}

/** Minimal glob → RegExp: `**` spans separators, `*`/`?` do not. */
function globToRegExp(glob: string): RegExp {
  const prefix = glob.startsWith("/") ? "" : "/";
  let source = "";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        // `**/` and `**` — any path (greedy across separators).
        source += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
        i += glob[i + 2] === "/" ? 3 : 2;
      } else {
        source += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      source += "[^/]";
      i += 1;
    } else if ("\\^$.|+()[]{}".includes(ch)) {
      source += `\\${ch}`;
      i += 1;
    } else {
      source += ch;
      i += 1;
    }
  }
  return new RegExp(`^${prefix}${source}$`);
}

export function dbSchemaMatchesGlobs(
  relPath: string,
  globs: string[]
): boolean {
  const rel = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return globs.some((g) => {
    try {
      return globToRegExp(g).test(`/${rel}`);
    } catch {
      return false;
    }
  });
}

/** Schema files first, then changelogs, then migrations, then everything else. */
function dbSchemaPriority(relPath: string): number {
  const p = relPath.toLowerCase();
  if (p.endsWith("schema.prisma")) {
    return p === "prisma/schema.prisma" ? 0 : 1;
  }
  if (p.endsWith(".sql")) {
    if (p.includes("changelog")) {
      return 2;
    }
    if (p.includes("migration")) {
      return 3;
    }
    return 5;
  }
  if (p.includes("changelog")) {
    return 4;
  }
  return 6;
}

function* walkFiles(root: string, dir: string, depth: number): Generator<string> {
  if (depth > WALK_MAX_DEPTH) {
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      yield* walkFiles(root, full, depth + 1);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function relativeToRoots(roots: string[], filePath: string): string {
  for (const root of roots) {
    if (filePath.startsWith(root + path.sep)) {
      return path.relative(root, filePath);
    }
  }
  return filePath;
}

/** Fast path inside VS Code: workspace search honors default excludes. */
async function collectWithVscode(
  globs: string[]
): Promise<string[] | undefined> {
  let vscode: typeof import("vscode");
  try {
    // Lazy require: this module is also loaded in headless sidecars.
    vscode = require("vscode");
  } catch {
    return undefined;
  }
  if (!vscode?.workspace?.findFiles) {
    return undefined;
  }
  const found: string[] = [];
  const seen = new Set<string>();
  for (const glob of globs) {
    try {
      const uris = await vscode.workspace.findFiles(glob, null, MAX_SCAN_FILES);
      for (const uri of uris) {
        if (!seen.has(uri.fsPath)) {
          seen.add(uri.fsPath);
          found.push(uri.fsPath);
        }
      }
    } catch {
      /* invalid glob from settings — skip it */
    }
  }
  return found;
}

function collectWithWalk(roots: string[], globs: string[]): string[] {
  const found: string[] = [];
  for (const root of roots) {
    try {
      if (!fs.statSync(root).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    for (const filePath of walkFiles(root, root, 0)) {
      const rel = relativeToRoots(roots, filePath);
      if (dbSchemaMatchesGlobs(rel, globs)) {
        found.push(filePath);
        if (found.length >= MAX_SCAN_FILES) {
          return found;
        }
      }
    }
  }
  return found;
}

function readCapped(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
      return "";
    }
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

/**
 * Read DB schema files under the workspace roots matching the globs, ordered
 * schema-first, capped. Returns [] when nothing matches.
 */
export async function collectDbSchemaFiles(
  roots: string[],
  globs: string[]
): Promise<DbSchemaFile[]> {
  const normalizedRoots = roots.map((r) => String(r || "").trim()).filter(Boolean);
  if (!normalizedRoots.length || !globs.length) {
    return [];
  }
  const absolute =
    (await collectWithVscode(globs)) ?? collectWithWalk(normalizedRoots, globs);
  const byPath = new Map<string, string>();
  for (const filePath of absolute) {
    const rel = relativeToRoots(normalizedRoots, filePath);
    if (!byPath.has(rel)) {
      byPath.set(rel, filePath);
    }
  }
  const ordered = [...byPath.entries()]
    .sort((a, b) => dbSchemaPriority(a[0]) - dbSchemaPriority(b[0]) || a[0].localeCompare(b[0]))
    .slice(0, MAX_FILES);
  const files: DbSchemaFile[] = [];
  for (const [rel, filePath] of ordered) {
    const text = readCapped(filePath);
    if (text.trim()) {
      files.push({ path: rel, text });
    }
  }
  return files;
}

function languageTagFor(relPath: string): string {
  const p = relPath.toLowerCase();
  if (p.endsWith(".prisma")) {
    return "prisma";
  }
  if (p.endsWith(".sql")) {
    return "sql";
  }
  if (p.endsWith(".xml")) {
    return "xml";
  }
  if (p.endsWith(".yaml") || p.endsWith(".yml")) {
    return "yaml";
  }
  return "";
}

/** Build the `[Harbor mentions]` block part for `@db`. Never returns "". */
export function buildDbSchemaMessage(files: DbSchemaFile[]): string {
  if (!files.length) {
    return [
      "DB schema (@db): no schema/migration files matched in this workspace.",
      "Configure agentPanel.db.schemaGlobs if the schema lives elsewhere.",
    ].join(" ");
  }
  const parts: string[] = [
    `DB schema (@db, ${files.length} file(s) from the workspace; paths are workspace-relative):`,
  ];
  let total = 0;
  for (const file of files) {
    const remaining = TOTAL_CHARS - total;
    if (remaining <= 200) {
      parts.push("… (remaining files omitted: @db context char budget reached)");
      break;
    }
    const cap = Math.min(PER_FILE_CHARS, remaining);
    const lang = languageTagFor(file.path);
    let body = file.text;
    let note = "";
    if (body.length > cap) {
      body = body.slice(0, cap);
      note = " (truncated)";
    }
    parts.push(`### ${file.path}${note}\n\`\`\`${lang}\n${body}\n\`\`\``);
    total += body.length;
  }
  return parts.join("\n\n");
}
