/**
 * User slash commands: markdown prompt templates from
 * `<workspace>/.harbor/commands/*.md` and `~/.harbor/commands/*.md`.
 * `/name args` in the composer expands the template host-side; `$ARGUMENTS`
 * is replaced with args. Builtin commands (/agent /plan /ask /init /compact,
 * handled in the webview) always win.
 */
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

export interface HarborUserCommandMeta {
  name: string;
  description: string;
  path: string;
  source: "workspace" | "global";
}

const BUILTIN_COMMANDS = new Set([
  "agent",
  "plan",
  "ask",
  "init",
  "compact",
]);

const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

function commandDirs(
  cwd?: string
): Array<{ dir: string; source: "workspace" | "global" }> {
  const dirs: Array<{ dir: string; source: "workspace" | "global" }> = [];
  if (cwd) {
    dirs.push({
      dir: path.join(cwd, ".harbor", "commands"),
      source: "workspace",
    });
  }
  dirs.push({
    dir: path.join(os.homedir(), ".harbor", "commands"),
    source: "global",
  });
  return dirs;
}

function extractDescription(raw: string): string {
  const text = String(raw || "");
  // Frontmatter description wins.
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatter) {
    const desc = frontmatter[1].match(/^description:\s*(.+)$/m);
    if (desc) {
      return desc[1].trim().slice(0, 140);
    }
  }
  // Otherwise the first non-empty line that is not frontmatter/heading.
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---" || trimmed.startsWith("#")) {
      continue;
    }
    return trimmed.slice(0, 140);
  }
  return "";
}

function stripFrontmatter(raw: string): string {
  return String(raw || "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

/** List available user commands (workspace dir wins on name collisions). */
export async function listHarborUserCommands(
  cwd?: string
): Promise<HarborUserCommandMeta[]> {
  const byName = new Map<string, HarborUserCommandMeta>();
  // Global first so workspace entries overwrite on collision.
  for (const { dir, source } of [...commandDirs(cwd)].reverse()) {
    let files: string[] = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const file of files.sort()) {
      if (!file.toLowerCase().endsWith(".md")) {
        continue;
      }
      const name = file.slice(0, -3).toLowerCase();
      if (!NAME_RE.test(name) || BUILTIN_COMMANDS.has(name)) {
        continue;
      }
      const filePath = path.join(dir, file);
      let description = "";
      try {
        description = extractDescription(
          await fs.readFile(filePath, "utf8")
        );
      } catch {
        /* unreadable — still offer the command */
      }
      byName.set(name, { name, description, path: filePath, source });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface ExpandedUserCommand {
  name: string;
  prompt: string;
}

/**
 * Expand `/name args` into the command template. Returns undefined when the
 * text is not a user command (builtins are handled by the webview).
 */
export async function expandUserSlashCommand(
  text: string,
  cwd?: string
): Promise<ExpandedUserCommand | undefined> {
  const match = String(text || "")
    .trim()
    .match(/^\/([a-z0-9_-]+)(?:\s+([\s\S]*))?$/i);
  if (!match) {
    return undefined;
  }
  const name = String(match[1] || "").toLowerCase();
  if (BUILTIN_COMMANDS.has(name)) {
    return undefined;
  }
  const args = String(match[2] || "").trim();
  for (const { dir } of commandDirs(cwd)) {
    const filePath = path.join(dir, `${name}.md`);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const template = stripFrontmatter(raw);
      if (!template) {
        continue;
      }
      const prompt = template.includes("$ARGUMENTS")
        ? template.replace(/\$ARGUMENTS/g, args)
        : args
          ? `${template}\n\n${args}`
          : template;
      return { name, prompt };
    } catch {
      /* try next dir */
    }
  }
  return undefined;
}
