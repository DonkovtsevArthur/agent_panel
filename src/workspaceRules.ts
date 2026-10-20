import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

export const DEFAULT_WORKSPACE_RULE_CHAR_CAP = 12_000;

export type ParsedWorkspaceRule = {
  body: string;
  alwaysApply?: boolean;
  globs: string[];
};

export type WorkspaceRule = ParsedWorkspaceRule & {
  relativePath: string;
};

export type LoadWorkspaceRulesOptions = {
  targetPaths?: string[];
  charCap?: number;
  /** Не подмешивать корневой AGENTS.md (чтобы не дублировать при его же перезаписи). */
  omitAgentsMd?: boolean;
};

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseGlobValues(value: string): string[] {
  const trimmed = value.trim();
  const contents =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1)
      : trimmed;
  const values: string[] = [];
  let current = "";
  let quote = "";
  let braceDepth = 0;
  for (const char of contents) {
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? "" : char;
      current += char;
    } else if (!quote && char === "{") {
      braceDepth += 1;
      current += char;
    } else if (!quote && char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      current += char;
    } else if (!quote && braceDepth === 0 && char === ",") {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values
    .map(unquote)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Parse the small frontmatter subset used by workspace rules. */
export function parseWorkspaceRule(raw: string): ParsedWorkspaceRule {
  const text = String(raw || "").replace(/\r\n?/g, "\n");
  if (!text.startsWith("---\n")) {
    return { body: text.trim(), globs: [] };
  }

  const end = text.indexOf("\n---", 4);
  if (end < 0) {
    return { body: text.trim(), globs: [] };
  }

  const metadata = text.slice(4, end);
  const globs: string[] = [];
  let alwaysApply: boolean | undefined;
  let readingGlobList = false;

  for (const line of metadata.split("\n")) {
    const keyValue = line.match(/^\s*([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/);
    if (keyValue) {
      const key = keyValue[1].toLowerCase();
      const value = keyValue[2];
      readingGlobList = key === "globs" && !value;
      if (key === "alwaysapply" && /^(true|false)$/i.test(value)) {
        alwaysApply = value.toLowerCase() === "true";
      } else if (key === "globs" && value) {
        globs.push(...parseGlobValues(value));
      }
      continue;
    }

    if (readingGlobList) {
      const item = line.match(/^\s*-\s*(.+?)\s*$/);
      if (item) {
        globs.push(unquote(item[1]).trim());
      }
    }
  }

  return {
    body: text.slice(end + 4).trim(),
    alwaysApply,
    globs: globs.filter(Boolean),
  };
}

/** Preserve the existing commit-rule frontmatter behavior for shared readers. */
export function stripWorkspaceRuleFrontmatter(raw: string): string {
  const text = String(raw || "");
  if (!text.startsWith("---")) {
    return text.trim();
  }
  const end = text.indexOf("\n---", 3);
  if (end < 0) {
    return text.trim();
  }
  return text.slice(end + 4).trim();
}

export function capWorkspaceRuleText(
  text: string,
  charCap = DEFAULT_WORKSPACE_RULE_CHAR_CAP
): string {
  const safeCap = Math.max(0, Math.floor(charCap));
  return String(text || "").slice(0, safeCap);
}

export async function readWorkspaceRuleFile(
  filePath: string
): Promise<string | undefined> {
  try {
    const body = stripWorkspaceRuleFrontmatter(
      await fs.readFile(filePath, "utf8")
    );
    return body || undefined;
  } catch {
    return undefined;
  }
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/^\/+/, "");
}

function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf("{");
  if (open < 0) {
    return [pattern];
  }
  const close = pattern.indexOf("}", open + 1);
  if (close < 0) {
    return [pattern];
  }
  const choices = pattern.slice(open + 1, close).split(",");
  if (choices.length < 2) {
    return [pattern];
  }
  return choices.flatMap((choice) =>
    expandBraces(pattern.slice(0, open) + choice + pattern.slice(close + 1))
  );
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      index += 1;
      if (pattern[index + 1] === "/") {
        index += 1;
        source += "(?:.*/)?";
      } else {
        source += ".*";
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

/** Match a workspace-relative path without filesystem access or dependencies. */
export function matchesWorkspaceRuleGlob(
  relativePath: string,
  glob: string
): boolean {
  const target = normalizeRelativePath(relativePath);
  const normalizedGlob = normalizeRelativePath(unquote(glob));
  if (!target || !normalizedGlob) {
    return false;
  }
  return expandBraces(normalizedGlob).some((pattern) =>
    globToRegExp(pattern).test(target)
  );
}

export function isWorkspaceRuleApplicable(
  rule: WorkspaceRule,
  targetPaths: string[] = []
): boolean {
  if (/^AGENTS\.md$/i.test(normalizeRelativePath(rule.relativePath))) {
    return true;
  }
  if (rule.alwaysApply === true) {
    return true;
  }
  if (rule.globs.length > 0) {
    return targetPaths.some((target) =>
      rule.globs.some((glob) => matchesWorkspaceRuleGlob(target, glob))
    );
  }
  return rule.alwaysApply !== false;
}

function compareRulePaths(left: WorkspaceRule, right: WorkspaceRule): number {
  const leftIsAgents = /^AGENTS\.md$/i.test(left.relativePath);
  const rightIsAgents = /^AGENTS\.md$/i.test(right.relativePath);
  if (leftIsAgents !== rightIsAgents) {
    return leftIsAgents ? -1 : 1;
  }
  return left.relativePath < right.relativePath
    ? -1
    : left.relativePath > right.relativePath
      ? 1
      : 0;
}

/** Pure selection and formatting step used by tests and the filesystem loader. */
export function combineWorkspaceRules(
  rules: WorkspaceRule[],
  targetPaths: string[] = [],
  charCap = DEFAULT_WORKSPACE_RULE_CHAR_CAP
): string | undefined {
  const combined = [...rules]
    .filter((rule) => rule.body && isWorkspaceRuleApplicable(rule, targetPaths))
    .sort(compareRulePaths)
    .map(
      (rule) =>
        `# Workspace rule: ${normalizeRelativePath(rule.relativePath)}\n\n${rule.body}`
    )
    .join("\n\n");
  const capped = capWorkspaceRuleText(combined, charCap);
  return capped || undefined;
}

/** Load root AGENTS.md and direct .cursor/rules/*.mdc files. */
export async function loadWorkspaceRules(
  root: string,
  options: LoadWorkspaceRulesOptions = {}
): Promise<string | undefined> {
  const candidates: string[] = options.omitAgentsMd ? [] : ["AGENTS.md"];
  try {
    const entries = await fs.readdir(path.join(root, ".cursor", "rules"));
    candidates.push(
      ...entries
        .filter((name) => name.toLowerCase().endsWith(".mdc"))
        .sort()
        .map((name) => path.posix.join(".cursor/rules", name))
    );
  } catch {
    // A workspace does not have to define .cursor/rules.
  }

  const rules = (
    await Promise.all(
      candidates.map(async (relativePath): Promise<WorkspaceRule | undefined> => {
        try {
          const raw = await fs.readFile(path.join(root, relativePath), "utf8");
          return { relativePath, ...parseWorkspaceRule(raw) };
        } catch {
          return undefined;
        }
      })
    )
  ).filter((rule): rule is WorkspaceRule => Boolean(rule));

  return combineWorkspaceRules(
    rules,
    options.targetPaths,
    options.charCap ?? DEFAULT_WORKSPACE_RULE_CHAR_CAP
  );
}

/**
 * Cline loads the workspace AGENTS.md into the session rules (system prompt)
 * with no size limit, so a huge file is re-sent with every request. Above this
 * cap Harbor takes AGENTS.md out of Cline's rule search paths and injects a
 * truncated copy itself (see `loadOversizedWorkspaceAgentsMd`).
 */
export const SESSION_AGENTS_MD_CHAR_CAP = 12_000;

/**
 * Cline's default rule search paths (`resolveRulesConfigSearchPaths` in
 * vendor/cline/sdk/packages/shared/src/storage/paths.ts) minus the workspace
 * AGENTS.md. Keep in sync on re-fork. `<workspace>/.cline` is appended by
 * Cline itself when `workspacePath` is passed.
 */
export function clineRuleSearchPathsWithoutWorkspaceAgentsMd(
  workspacePath: string,
  homeDir: string = os.homedir()
): string[] {
  const clineDir = String(process.env.CLINE_DIR || "").trim() ||
    path.join(homeDir, ".cline");
  return [
    path.join(workspacePath, ".clinerules"),
    path.join(workspacePath, ".cline", "rules"),
    path.join(homeDir, ".agents", "AGENTS.md"),
    path.join(clineDir, "rules"),
    path.join(homeDir, "Documents", "Cline", "Rules"),
  ];
}

export type OversizedWorkspaceAgentsMd = {
  /** Rule block for the Harbor rules slot (truncated body + notice). */
  rule: string;
  originalChars: number;
};

/** Truncate an AGENTS.md body to the cap, on a line boundary when possible. */
export function truncateWorkspaceAgentsMd(
  text: string,
  charCap = SESSION_AGENTS_MD_CHAR_CAP
): string {
  const body = String(text || "");
  if (body.length <= charCap) {
    return body;
  }
  const head = body.slice(0, Math.max(0, Math.floor(charCap)));
  const lastNewline = head.lastIndexOf("\n");
  return lastNewline > charCap * 0.8 ? head.slice(0, lastNewline) : head;
}

export function formatOversizedWorkspaceAgentsMdRule(
  text: string,
  charCap = SESSION_AGENTS_MD_CHAR_CAP
): string {
  const body = String(text || "");
  const shown = truncateWorkspaceAgentsMd(body, charCap);
  return [
    "## Workspace AGENTS.md",
    shown.trimEnd(),
    "",
    `[Harbor: AGENTS.md is ${body.length} chars; only the first ${shown.length} are in the prompt. Read the rest of AGENTS.md with read_files when the task needs it.]`,
  ].join("\n");
}

/**
 * Returns the truncated AGENTS.md rule when the workspace AGENTS.md is larger
 * than the cap; undefined when it is missing or small enough for Cline to load
 * as usual.
 */
export async function loadOversizedWorkspaceAgentsMd(
  workspacePath: string,
  charCap = SESSION_AGENTS_MD_CHAR_CAP
): Promise<OversizedWorkspaceAgentsMd | undefined> {
  let text: string;
  try {
    text = await fs.readFile(path.join(workspacePath, "AGENTS.md"), "utf8");
  } catch {
    return undefined;
  }
  if (text.length <= charCap) {
    return undefined;
  }
  return {
    rule: formatOversizedWorkspaceAgentsMdRule(text, charCap),
    originalChars: text.length,
  };
}

/**
 * Ссылки на отдельный файл правил коммитов из AGENTS.md / .cursorrules:
 * `[commits.md](./docs/agents/commits.md)`. Сам AGENTS.md часто только
 * отсылает туда — без этого модель не видела настоящих правил проекта.
 * Возвращает относительные пути как в тексте, без якорей, без внешних URL.
 */
export function findLinkedCommitRulePaths(text: string): string[] {
  const found: string[] = [];
  const re = /\]\(\s*<?([^)\s>]+)>?\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const target = match[1].split("#", 1)[0];
    if (
      !target ||
      /^[a-z][a-z0-9+.-]*:/i.test(target) ||
      !/\.(md|mdc|txt)$/i.test(target) ||
      !/commit|коммит/i.test(target)
    ) {
      continue;
    }
    if (!found.includes(target)) {
      found.push(target);
    }
  }
  return found;
}
