/**
 * Каталоги, которые агент не должен обходить и читать через tools
 * (зависимости, VCS, артефакты сборки).
 */
export const WORKSPACE_IGNORE_DIRS = [
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "out",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  ".vscode-test",
  ".idea",
  "__pycache__",
  "target",
  "vendor",
] as const;

const IGNORE_DIR_SET = new Set<string>(WORKSPACE_IGNORE_DIRS);

/** Имя сегмента пути — игнорируемый каталог. */
export function isIgnoredDirName(name: string): boolean {
  const base = String(name || "").trim();
  if (!base || base === "." || base === "..") {
    return false;
  }
  return IGNORE_DIR_SET.has(base);
}

/**
 * Workspace-relative путь попадает в игнорируемый каталог
 * (`node_modules/...`, `src/../node_modules/foo`, `dist`).
 */
export function isIgnoredWorkspacePath(relativePath: string): boolean {
  const normalized = String(relativePath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (!normalized) {
    return false;
  }
  const parts = normalized.split("/").filter((p) => p && p !== ".");
  for (const part of parts) {
    if (part === "..") {
      continue;
    }
    if (IGNORE_DIR_SET.has(part)) {
      return true;
    }
  }
  return false;
}

/** Сообщение для tool result, когда путь запрещён политикой ignore. */
export function ignoredPathError(relativePath: string): string {
  const path = String(relativePath || "").trim() || ".";
  return (
    `Путь игнорируется агентом (зависимости / VCS / артефакты сборки): ${path}. ` +
    `Не читай и не меняй node_modules, .git, dist, out и подобные каталоги. ` +
    `Смотри package.json / исходники проекта.`
  );
}
