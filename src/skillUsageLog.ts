/**
 * Local skill-usage log: one JSONL line per agent turn with the skills the
 * model loaded via the `skills` tool (possibly none) and a short prompt
 * preview — to see after a while which skills earn their catalog slot.
 * Lives in ~/.harbor/skill-usage.jsonl (outside repos, never sent anywhere);
 * rotated to `.1` past SKILL_USAGE_MAX_BYTES. No `vscode` import (tests).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const SKILL_USAGE_MAX_BYTES = 2 * 1024 * 1024;
const PROMPT_PREVIEW_MAX = 160;

export interface SkillUsageEntry {
  ts: string;
  /** Workspace folder name (not the full path). */
  ws: string;
  chat: string;
  mode: string;
  model: string;
  /** Skill names loaded this turn, in call order (deduplicated). */
  loaded: string[];
  /** Skills in the catalog the model saw this turn. */
  catalog: number;
  prompt: string;
}

export function skillUsageLogPath(baseDir?: string): string {
  return path.join(baseDir || path.join(os.homedir(), ".harbor"), "skill-usage.jsonl");
}

/** Skill name from a `skills` tool input (`{ skill: "name", args? }`). */
export function skillNameFromToolInput(input: unknown): string {
  if (input && typeof input === "object") {
    return String((input as { skill?: unknown }).skill || "").trim();
  }
  return "";
}

export function buildSkillUsageEntry(options: {
  workspaceRoot: string;
  chatId: string;
  mode: string;
  model: string;
  loaded: ReadonlyArray<string>;
  catalog: number;
  userText: string;
  now?: Date;
}): SkillUsageEntry {
  const prompt = String(options.userText || "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    ts: (options.now ?? new Date()).toISOString(),
    ws: options.workspaceRoot ? path.basename(options.workspaceRoot) : "",
    chat: String(options.chatId || "").slice(0, 12),
    mode: options.mode,
    model: options.model,
    loaded: [...new Set(options.loaded.filter(Boolean))],
    catalog: options.catalog,
    prompt:
      prompt.length > PROMPT_PREVIEW_MAX
        ? `${prompt.slice(0, PROMPT_PREVIEW_MAX - 1)}…`
        : prompt,
  };
}

export function appendSkillUsage(
  entry: SkillUsageEntry,
  options: { baseDir?: string; maxBytes?: number } = {}
): void {
  const file = skillUsageLogPath(options.baseDir);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      if (fs.statSync(file).size > (options.maxBytes ?? SKILL_USAGE_MAX_BYTES)) {
        fs.renameSync(file, `${file}.1`);
      }
    } catch {
      /* no log yet */
    }
    fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // diagnostics only — never fail a turn over the usage log
  }
}

/** Turn count and per-skill load counts from the JSONL text. */
export function summarizeSkillUsage(text: string): {
  turns: number;
  turnsWithSkill: number;
  loads: Record<string, number>;
} {
  let turns = 0;
  let turnsWithSkill = 0;
  const loads: Record<string, number> = {};
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    let row: Partial<SkillUsageEntry>;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    turns++;
    const loaded = Array.isArray(row.loaded) ? row.loaded : [];
    if (loaded.length) {
      turnsWithSkill++;
    }
    for (const name of loaded) {
      loads[name] = (loads[name] || 0) + 1;
    }
  }
  return { turns, turnsWithSkill, loads };
}
