export interface FileEditStat {
  path: string;
  added: number;
  removed: number;
  created: boolean;
}

/** Грубая оценка +/- по мультимножеству строк (достаточно для UI). */
export function lineDiffStats(
  before: string,
  after: string
): { added: number; removed: number } {
  const oldLines = before.length ? before.split(/\r?\n/) : [];
  const newLines = after.length ? after.split(/\r?\n/) : [];

  // Пустой новый файл
  if (!after && !before) {
    return { added: 0, removed: 0 };
  }

  const oldCount = new Map<string, number>();
  for (const line of oldLines) {
    oldCount.set(line, (oldCount.get(line) ?? 0) + 1);
  }

  const newCount = new Map<string, number>();
  for (const line of newLines) {
    newCount.set(line, (newCount.get(line) ?? 0) + 1);
  }

  let added = 0;
  let removed = 0;
  const keys = new Set([...oldCount.keys(), ...newCount.keys()]);
  for (const key of keys) {
    const o = oldCount.get(key) ?? 0;
    const n = newCount.get(key) ?? 0;
    if (n > o) {
      added += n - o;
    }
    if (o > n) {
      removed += o - n;
    }
  }

  // Новый файл: все строки — добавления
  if (!before && after) {
    return { added: newLines.length, removed: 0 };
  }

  return { added, removed };
}

export function formatEditTotals(edits: FileEditStat[]): {
  files: number;
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const edit of edits) {
    added += edit.added;
    removed += edit.removed;
  }
  return { files: edits.length, added, removed };
}
