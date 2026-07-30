/**
 * Политика раундов tools (main-like loop):
 * 1) автопродление бюджета, если ход продуктивный и лимит кончился;
 * 2) soft-nudge после серии только explore (list/read);
 * 3) hard-cut — дальше без explore, только write или финальный ответ.
 */

export const EXPLORE_ONLY_TOOLS = new Set(["list_files", "read_file"]);

/** После стольких explore-only раундов подряд — soft nudge. */
export const EXPLORE_SOFT_NUDGE_ROUNDS = 2;

/** После стольких — hard-cut explore. */
export const EXPLORE_HARD_CUT_ROUNDS = 4;

/** Сколько раз можно продлить бюджет раундов. */
export const MAX_ROUND_EXTENSIONS = 1;

/** На сколько раундов продлеваем за раз. */
export const ROUND_EXTENSION_SIZE = 8;

export function isExploreOnlyTool(name: string): boolean {
  return EXPLORE_ONLY_TOOLS.has(String(name || ""));
}

export function roundWasExploreOnly(
  toolNames: Array<string | undefined>
): boolean {
  const names = toolNames.map((n) => String(n || "")).filter(Boolean);
  return names.length > 0 && names.every((n) => isExploreOnlyTool(n));
}

export function shouldExtendToolRounds(options: {
  extensionsUsed: number;
  hadProductiveTool: boolean;
  answered: boolean;
}): boolean {
  if (options.answered) {
    return false;
  }
  if (options.extensionsUsed >= MAX_ROUND_EXTENSIONS) {
    return false;
  }
  return options.hadProductiveTool;
}

export function buildExploreSoftNudge(options: {
  agentsMd: boolean;
  readonly: boolean;
}): string {
  if (options.readonly) {
    return [
      "Stop exploring the repository.",
      "You already have enough context from the tools above.",
      "Do not call list_files or read_file again.",
      "Reply to the user now with a concise answer based on what you already gathered.",
    ].join(" ");
  }
  if (options.agentsMd) {
    return [
      "Stop exploring the repository.",
      "You already have enough context (package.json / README / src listing is enough).",
      "Do not call list_files or read_file again.",
      "Immediately call write_file for AGENTS.md (create or update), then briefly confirm in chat what you wrote.",
    ].join(" ");
  }
  return [
    "Stop exploring the repository.",
    "You already have enough context from the tools above.",
    "Do not call list_files or read_file again.",
    "If you need to change files, call write_file now; otherwise reply briefly to the user.",
  ].join(" ");
}

export function buildExploreHardNudge(options: {
  agentsMd: boolean;
  readonly: boolean;
}): string {
  if (options.readonly) {
    return [
      "Exploration limit reached.",
      "list_files and read_file are no longer allowed this turn.",
      "Answer the user now using only the information already gathered. Do not call tools.",
    ].join(" ");
  }
  if (options.agentsMd) {
    return [
      "Exploration limit reached.",
      "list_files and read_file are no longer allowed this turn.",
      "Call write_file for AGENTS.md now (short guide), then confirm briefly. No more reading.",
    ].join(" ");
  }
  return [
    "Exploration limit reached.",
    "list_files and read_file are no longer allowed this turn.",
    "Call write_file if edits are still needed; otherwise reply to the user. No more reading.",
  ].join(" ");
}
