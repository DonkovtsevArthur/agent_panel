/**
 * In-memory store of recent tool failures per chat. Injected into the next
 * turn's context so the model does not repeat the same mistakes (wrong paths,
 * non-existent APIs, permission errors).
 *
 * Stored per-chat, lost on extension reload (same lifecycle as live Cline
 * sessions). Hard cap: 5 entries per chat, FIFO eviction.
 */

export interface ToolFailureRecord {
  toolName: string;
  /** Short description of what went wrong (≤ 200 chars). */
  error: string;
  /** File path if the tool targeted one. */
  path?: string;
  /** Unix timestamp. */
  ts: number;
}

const MAX_ERRORS_PER_CHAT = 5;
const MAX_ERROR_AGE_MS = 30 * 60 * 1_000; // 30 minutes

/** chatId → recent failures (newest last). */
const errorsByChat = new Map<string, ToolFailureRecord[]>();

export function recordToolFailure(
  chatId: string,
  record: Omit<ToolFailureRecord, "ts">
): void {
  const id = String(chatId || "").trim();
  if (!id) {
    return;
  }
  let list = errorsByChat.get(id);
  if (!list) {
    list = [];
    errorsByChat.set(id, list);
  }
  list.push({ ...record, ts: Date.now() });
  // Evict old entries.
  const cutoff = Date.now() - MAX_ERROR_AGE_MS;
  while (list.length > 0 && (list.length > MAX_ERRORS_PER_CHAT || (list[0]?.ts ?? 0) < cutoff)) {
    list.shift();
  }
}

export function getRecentToolFailures(chatId: string): ToolFailureRecord[] {
  const id = String(chatId || "").trim();
  if (!id) {
    return [];
  }
  const list = errorsByChat.get(id);
  if (!list?.length) {
    return [];
  }
  const cutoff = Date.now() - MAX_ERROR_AGE_MS;
  return list.filter((r) => r.ts >= cutoff);
}

export function clearToolFailures(chatId: string): void {
  errorsByChat.delete(String(chatId || "").trim());
}

/**
 * Build a context block for the turn prompt. Returns empty string when
 * there are no recent failures.
 */
export function buildLearnedErrorsMessage(chatId: string): string {
  const failures = getRecentToolFailures(chatId);
  if (!failures.length) {
    return "";
  }
  const lines = ["Recent tool failures in this chat (avoid repeating):"];
  for (const f of failures) {
    let line = `- ${f.toolName}: ${f.error}`;
    if (f.path) {
      line += ` (file: ${f.path})`;
    }
    lines.push(line);
  }
  return lines.join("\n");
}
