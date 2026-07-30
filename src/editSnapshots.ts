/** Снимки содержимого до write_file — для diff в карточке Changed files. */
const beforeByPath = new Map<string, string>();

function normalizeRel(p: string): string {
  return p.trim().replace(/^\.\//, "").replace(/^\/+/, "").replace(/\\/g, "/");
}

export function rememberEditBefore(
  relativePath: string,
  beforeContent: string
): void {
  const rel = normalizeRel(relativePath);
  if (!rel) {
    return;
  }
  beforeByPath.set(rel, beforeContent);
  if (beforeByPath.size > 80) {
    const first = beforeByPath.keys().next().value;
    if (first !== undefined) {
      beforeByPath.delete(first);
    }
  }
}

export function takeEditBefore(relativePath: string): string | undefined {
  const rel = normalizeRel(relativePath);
  if (!rel) {
    return undefined;
  }
  return beforeByPath.get(rel);
}
