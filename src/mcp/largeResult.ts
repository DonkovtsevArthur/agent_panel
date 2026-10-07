/**
 * Keep big MCP tool results intact for the model.
 *
 * Cline's message builder middle-truncates every tool_result to
 * `maxToolResultChars` (8k by default), so long MCP answers (e.g. Jira
 * `jira_get_all_projects`) silently lose their middle. Harbor therefore:
 *  1. minifies pretty-printed JSON (often ~30% shorter, fits more often);
 *  2. if the text is still over the limit, writes the full result to
 *     ~/.harbor/workspaces/<ws>/tool-results/ (outside the repo) and hands
 *     the model a preview + the file path to read / grep in parts.
 *
 * vscode-free so tests can import it.
 */

import * as fs from "fs";
import * as path from "path";
import { workspaceStateDir } from "../learnedErrors";

/** Below Cline's 8k cap, leaving room for the footer. */
export const MCP_RESULT_INLINE_LIMIT = 7_000;
const PREVIEW_CHARS = 3_500;
const KEEP_FILES = 50;
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/** Minify JSON text; non-JSON is returned as is. */
export function compactJsonText(text: string): string {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed) || !/\n\s/.test(trimmed)) {
    return text;
  }
  try {
    return JSON.stringify(JSON.parse(trimmed));
  } catch {
    return text;
  }
}

/** "214 items" for top-level arrays or the largest array field. */
function describeJsonShape(text: string): string {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return `JSON array, ${parsed.length} items`;
    }
    if (parsed && typeof parsed === "object") {
      let best: [string, number] | undefined;
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(value) && (!best || value.length > best[1])) {
          best = [key, value.length];
        }
      }
      if (best) {
        return `JSON object, "${best[0]}" has ${best[1]} items`;
      }
      return "JSON object";
    }
  } catch {
    // not JSON
  }
  return "text";
}

/** Pretty JSON (one field per line) so ranged reads and grep work. */
function fileBody(text: string): { body: string; ext: string } {
  try {
    return { body: `${JSON.stringify(JSON.parse(text), null, 1)}\n`, ext: "json" };
  } catch {
    return { body: text, ext: "txt" };
  }
}

function pruneOld(dir: string): void {
  try {
    const files = fs
      .readdirSync(dir)
      .map((name) => {
        const full = path.join(dir, name);
        return { full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    const now = Date.now();
    files.forEach((f, i) => {
      if (i >= KEEP_FILES || now - f.mtime > KEEP_MS) {
        fs.rmSync(f.full, { force: true });
      }
    });
  } catch {
    // best effort
  }
}

export function toolResultsDir(workspaceRoot: string, baseDir?: string): string {
  return path.join(workspaceStateDir(workspaceRoot, baseDir), "tool-results");
}

/**
 * Text that fits → returned unchanged. Longer → full text saved to a file,
 * preview + pointer returned. Never throws (falls back to the input).
 */
export function spillLargeToolText(options: {
  text: string;
  toolName: string;
  workspaceRoot: string;
  limit?: number;
  baseDir?: string;
}): string {
  const limit = options.limit ?? MCP_RESULT_INLINE_LIMIT;
  const text = options.text;
  if (text.length <= limit) {
    return text;
  }
  try {
    const dir = toolResultsDir(options.workspaceRoot, options.baseDir);
    fs.mkdirSync(dir, { recursive: true });
    const { body, ext } = fileBody(text);
    const safeTool = options.toolName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `${stamp}-${safeTool}.${ext}`);
    fs.writeFileSync(file, body, "utf8");
    pruneOld(dir);
    const lines = body.split("\n").length;
    return [
      text.slice(0, PREVIEW_CHARS),
      "",
      `[Harbor: result too large for one tool response (${text.length} chars, ${describeJsonShape(text)}). Only the beginning is shown above. The FULL result is saved to:`,
      file,
      `(${lines} lines). Do not answer from the preview and do not re-call the tool: read that file in line ranges or search it (grep / search_files) for what you need.]`,
    ].join("\n");
  } catch {
    return text;
  }
}

/**
 * Apply compact + spill to an MCP CallToolResult-like object: text parts are
 * minified; if their total is still over the limit they are replaced by one
 * preview part. Image parts are kept as is.
 */
export function shrinkMcpToolResult(
  raw: unknown,
  toolName: string,
  workspaceRoot: string | undefined,
  limit?: number
): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }
  const row = raw as { content?: unknown; isError?: boolean };
  if (!Array.isArray(row.content)) {
    return raw;
  }
  const isText = (p: unknown): p is { type: string; text: string } =>
    Boolean(p) &&
    typeof p === "object" &&
    (p as { type?: unknown }).type === "text" &&
    typeof (p as { text?: unknown }).text === "string";
  const compacted = row.content.map((p) =>
    isText(p) ? { ...p, text: compactJsonText(p.text) } : p
  );
  const texts = compacted.filter(isText).map((p) => p.text);
  const joined = texts.join("\n");
  if (!workspaceRoot || joined.length <= (limit ?? MCP_RESULT_INLINE_LIMIT)) {
    return { ...row, content: compacted };
  }
  const preview = spillLargeToolText({
    text: texts.length === 1 ? texts[0] : joined,
    toolName,
    workspaceRoot,
    limit,
  });
  const others = compacted.filter((p) => !isText(p));
  return { ...row, content: [{ type: "text", text: preview }, ...others] };
}
