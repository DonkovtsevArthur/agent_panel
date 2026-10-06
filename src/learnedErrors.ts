import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";

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

// ---------------------------------------------------------------------------
// Cross-chat recurring failures (persisted per workspace).
//
// Same failure in several chats = the agent keeps re-learning something about
// this project. Stats live outside the repo in
// ~/.harbor/workspaces/<name>-<hash>/learned-errors.json (no git noise) and
// failures seen ≥ RECURRING_MIN_COUNT times in ≥ RECURRING_MIN_CHATS chats
// are injected into the turn context of every new chat.
// ---------------------------------------------------------------------------

export const RECURRING_MIN_COUNT = 3;
export const RECURRING_MIN_CHATS = 2;
const RECURRING_MAX_ENTRIES = 100;
const RECURRING_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000; // 30 days
const RECURRING_MAX_IN_CONTEXT = 5;

export interface RecurringFailure {
  sig: string;
  toolName: string;
  /** Latest error sample (≤ 200 chars). */
  error: string;
  /** Up to 3 most recent distinct paths. */
  paths: string[];
  count: number;
  /** Up to 5 distinct chat ids (only the count of chats matters). */
  chats: string[];
  firstTs: number;
  lastTs: number;
}

/** Stable signature: tool + error with quotes/paths/numbers masked. */
export function failureSignature(toolName: string, error: string): string {
  const masked = String(error || "")
    .toLowerCase()
    .replace(/(["'`]).*?\1/g, "<q>")
    .replace(/(?:[a-z]:)?[\\/][^\s"'`,;)]+/g, "<path>")
    .replace(/\d+/g, "n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return `${String(toolName || "tool")}|${masked}`;
}

export function workspaceStateDir(root: string, baseDir?: string): string {
  const base = baseDir || path.join(os.homedir(), ".harbor", "workspaces");
  const name =
    path.basename(root).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40) || "ws";
  const hash = createHash("sha1").update(path.resolve(root)).digest("hex").slice(0, 10);
  return path.join(base, `${name}-${hash}`);
}

function recurringFile(root: string, baseDir?: string): string {
  return path.join(workspaceStateDir(root, baseDir), "learned-errors.json");
}

function loadRecurring(root: string, baseDir?: string): RecurringFailure[] {
  try {
    const raw = JSON.parse(fs.readFileSync(recurringFile(root, baseDir), "utf8"));
    return Array.isArray(raw?.failures) ? (raw.failures as RecurringFailure[]) : [];
  } catch {
    return [];
  }
}

export function recordWorkspaceToolFailure(
  root: string,
  chatId: string,
  record: Omit<ToolFailureRecord, "ts">,
  options: { now?: number; baseDir?: string } = {}
): void {
  if (!root || !record?.error) {
    return;
  }
  const now = options.now ?? Date.now();
  try {
    const sig = failureSignature(record.toolName, record.error);
    const list = loadRecurring(root, options.baseDir).filter(
      (f) => now - (f.lastTs || 0) < RECURRING_MAX_AGE_MS
    );
    let entry = list.find((f) => f.sig === sig);
    if (!entry) {
      entry = {
        sig,
        toolName: record.toolName,
        error: record.error,
        paths: [],
        count: 0,
        chats: [],
        firstTs: now,
        lastTs: now,
      };
      list.push(entry);
    }
    entry.count += 1;
    entry.lastTs = now;
    entry.error = String(record.error).slice(0, 200);
    if (record.path) {
      entry.paths = [record.path, ...entry.paths.filter((p) => p !== record.path)].slice(0, 3);
    }
    const chat = String(chatId || "").trim();
    if (chat && !entry.chats.includes(chat)) {
      entry.chats = [...entry.chats, chat].slice(-5);
    }
    list.sort((a, b) => b.lastTs - a.lastTs);
    const file = recurringFile(root, options.baseDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ root, failures: list.slice(0, RECURRING_MAX_ENTRIES) }, null, 2),
      "utf8"
    );
  } catch {
    /* stats are best-effort — never break a turn */
  }
}

export function getRecurringToolFailures(
  root: string,
  options: { now?: number; baseDir?: string; limit?: number } = {}
): RecurringFailure[] {
  if (!root) {
    return [];
  }
  const now = options.now ?? Date.now();
  return loadRecurring(root, options.baseDir)
    .filter(
      (f) =>
        now - (f.lastTs || 0) < RECURRING_MAX_AGE_MS &&
        f.count >= RECURRING_MIN_COUNT &&
        (f.chats?.length || 0) >= RECURRING_MIN_CHATS
    )
    .sort((a, b) => b.count - a.count || b.lastTs - a.lastTs)
    .slice(0, options.limit ?? RECURRING_MAX_IN_CONTEXT);
}

export function buildRecurringFailuresMessage(
  root: string,
  options: { now?: number; baseDir?: string } = {}
): string {
  const failures = getRecurringToolFailures(root, options);
  if (!failures.length) {
    return "";
  }
  const lines = [
    "Recurring tool failures in this project (seen across several chats — avoid them; once you know the correct approach, save it with `remember` kind=pitfall):",
  ];
  for (const f of failures) {
    let line = `- ${f.toolName}: ${f.error} (×${f.count} in ${f.chats.length} chats)`;
    if (f.paths.length) {
      line += ` (files: ${f.paths.join(", ")})`;
    }
    lines.push(line);
  }
  return lines.join("\n");
}
