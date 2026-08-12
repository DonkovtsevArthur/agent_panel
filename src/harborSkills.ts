/**
 * Harbor Agent Skills discovery (SKILL.md).
 * Scans only Harbor roots + user-configured extra directories —
 * never auto-scans `.agents` / `.cline` / `.cursor` skill trees.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type HarborSkillSource = "workspace" | "global" | "extra";

export interface HarborSkillInfo {
  /** Stable id: source + name */
  id: string;
  /** Frontmatter name or directory name */
  name: string;
  description: string;
  /** Absolute path to skill directory */
  dirPath: string;
  /** Absolute path to SKILL.md */
  skillMdPath: string;
  source: HarborSkillSource;
  disabled: boolean;
}

export interface HarborSkillsConfigSlice {
  enabled: boolean;
  extraDirectories: string[];
  disabled: string[];
}

export interface HarborSkillDirectoryInfo {
  path: string;
  source: HarborSkillSource;
  /** Built-in Harbor roots are not removable from Settings. */
  removable: boolean;
}

const SKILL_MD = "SKILL.md";

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Minimal YAML frontmatter: `key: value` lines (quoted or bare). */
function parseSkillFrontmatter(content: string): {
  name?: string;
  description?: string;
} {
  const normalized = stripBom(content);
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return {};
  }
  const block = match[1];
  const out: { name?: string; description?: string } = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) {
      continue;
    }
    const key = m[1].toLowerCase();
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === "name" && value) {
      out.name = value;
    } else if (key === "description" && value) {
      out.description = value;
    }
  }
  return out;
}

export function globalHarborSkillsDir(): string {
  return path.join(os.homedir(), ".harbor", "skills");
}

export function workspaceHarborSkillsDir(cwd: string): string {
  return path.join(cwd, ".harbor", "skills");
}

/** Default Harbor skill roots (may not exist yet). */
export function defaultHarborSkillDirectories(cwd: string): HarborSkillDirectoryInfo[] {
  const workspace = workspaceHarborSkillsDir(cwd);
  const global = globalHarborSkillsDir();
  return [
    { path: workspace, source: "workspace", removable: false },
    { path: global, source: "global", removable: false },
  ];
}

function normalizeDirPath(raw: string): string {
  return path.resolve(String(raw || "").trim());
}

function dedupeDirs(dirs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of dirs) {
    const n = normalizeDirPath(d);
    if (!n || seen.has(n)) {
      continue;
    }
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * Absolute directories to pass to Cline skills.directories.
 * Includes Harbor defaults + extraDirectories (whether or not they exist yet).
 */
export function resolveSkillDirectories(
  cwd: string,
  config: Pick<HarborSkillsConfigSlice, "extraDirectories">
): string[] {
  const defaults = defaultHarborSkillDirectories(cwd).map((d) => d.path);
  const extra = (config.extraDirectories || [])
    .map((p) => String(p || "").trim())
    .filter(Boolean);
  return dedupeDirs([...defaults, ...extra]);
}

export function listSkillDirectoryInfos(
  cwd: string,
  config: Pick<HarborSkillsConfigSlice, "extraDirectories">
): HarborSkillDirectoryInfo[] {
  const defaults = defaultHarborSkillDirectories(cwd);
  const defaultSet = new Set(defaults.map((d) => normalizeDirPath(d.path)));
  const extras: HarborSkillDirectoryInfo[] = [];
  for (const raw of config.extraDirectories || []) {
    const p = normalizeDirPath(raw);
    if (!p || defaultSet.has(p)) {
      continue;
    }
    extras.push({ path: p, source: "extra", removable: true });
  }
  return [...defaults, ...extras];
}

/** Create Harbor default skill roots if missing. */
export function ensureHarborSkillRoots(cwd: string): void {
  for (const dir of defaultHarborSkillDirectories(cwd)) {
    try {
      fs.mkdirSync(dir.path, { recursive: true });
    } catch {
      /* ignore */
    }
  }
}

function sourceForDir(
  dirPath: string,
  cwd: string,
  extraSet: Set<string>
): HarborSkillSource {
  const n = normalizeDirPath(dirPath);
  if (n === normalizeDirPath(workspaceHarborSkillsDir(cwd))) {
    return "workspace";
  }
  if (n === normalizeDirPath(globalHarborSkillsDir())) {
    return "global";
  }
  if (extraSet.has(n)) {
    return "extra";
  }
  return "extra";
}

function isDisabledName(name: string, disabled: ReadonlyArray<string>): boolean {
  const lower = name.trim().toLowerCase();
  return disabled.some((d) => String(d || "").trim().toLowerCase() === lower);
}

/**
 * Scan skill directories for one-level children with SKILL.md.
 */
export function listHarborSkills(
  cwd: string,
  config: HarborSkillsConfigSlice
): HarborSkillInfo[] {
  const dirs = resolveSkillDirectories(cwd, config);
  const extraSet = new Set(
    (config.extraDirectories || []).map((p) => normalizeDirPath(p))
  );
  const disabled = config.disabled || [];
  const byName = new Map<string, HarborSkillInfo>();

  for (const root of dirs) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    const source = sourceForDir(root, cwd, extraSet);
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }
      const dirPath = path.join(root, entry.name);
      const skillMdPath = path.join(dirPath, SKILL_MD);
      let raw: string;
      try {
        if (!fs.statSync(skillMdPath).isFile()) {
          continue;
        }
        raw = fs.readFileSync(skillMdPath, "utf8");
      } catch {
        continue;
      }
      const meta = parseSkillFrontmatter(raw);
      const name = (meta.name || entry.name).trim();
      if (!name) {
        continue;
      }
      const info: HarborSkillInfo = {
        id: `${source}:${name}`,
        name,
        description: String(meta.description || "").trim(),
        dirPath,
        skillMdPath,
        source,
        disabled: isDisabledName(name, disabled),
      };
      // Prefer workspace over global over extra on name clash
      const rank = (s: HarborSkillSource) =>
        s === "workspace" ? 0 : s === "global" ? 1 : 2;
      const prev = byName.get(name.toLowerCase());
      if (!prev || rank(info.source) < rank(prev.source)) {
        byName.set(name.toLowerCase(), info);
      }
    }
  }

  return [...byName.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

/** Names of skills that should be available to the Cline skills tool. */
export function enabledSkillNames(
  cwd: string,
  config: HarborSkillsConfigSlice
): string[] {
  if (config.enabled === false) {
    return [];
  }
  return listHarborSkills(cwd, config)
    .filter((s) => !s.disabled)
    .map((s) => s.name);
}

export function buildSkillsListPayload(
  cwd: string,
  config: HarborSkillsConfigSlice
): {
  enabled: boolean;
  directories: HarborSkillDirectoryInfo[];
  skills: HarborSkillInfo[];
} {
  return {
    enabled: config.enabled !== false,
    directories: listSkillDirectoryInfos(cwd, config),
    skills: listHarborSkills(cwd, config),
  };
}
