/**
 * `@logs` mention: tail the last IDE terminal output and workspace log files
 * (or one explicit `@logs path/to/app.log`) and parse stack traces from the
 * combined text so the model gets `file:line` frames instead of a wall of
 * output. Pure fs for file reads; no vscode import.
 */
import * as fs from "fs";
import * as path from "path";
import { collectFilesByGlobs } from "./globFiles";
import {
  buildStackFramesMessage,
  extractStackFrames,
  resolveFramePaths,
} from "./stackTrace";

/** Globs scanned by bare `@logs` (newest files first). */
export const DEFAULT_LOG_GLOBS: string[] = [
  "*.log",
  "logs/**/*.log",
  "log/**/*.log",
];

const MAX_LOG_FILES = 4;
const PER_FILE_CHARS = 8_000;
const TOTAL_CHARS = 20_000;
const MAX_FILE_BYTES = 4_000_000;
const MAX_SCAN_FILES = 40;
const MAX_WALK_DEPTH = 8;

export interface LogsMentionInput {
  /** Raw `[Harbor mentions]`-style terminal block from terminalContext. */
  terminalMessage?: string;
  /** Explicit `@logs path` argument (workspace-relative or absolute). */
  explicitPath?: string;
}

interface LogSection {
  label: string;
  text: string;
  /** true — text is already formatted, include verbatim (no extra fence). */
  raw?: boolean;
}

function readTail(filePath: string, maxChars: number): string {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
      return "";
    }
    const text = fs.readFileSync(filePath, "utf8");
    if (text.length <= maxChars) {
      return text;
    }
    // Keep the tail (errors live at the end) on a line boundary.
    const tail = text.slice(-maxChars);
    const nl = tail.indexOf("\n");
    return nl >= 0 ? tail.slice(nl + 1) : tail;
  } catch {
    return "";
  }
}

function newestFirst(roots: string[]): { abs: string; rel: string }[] {
  const refs = collectFilesByGlobs(roots, DEFAULT_LOG_GLOBS, {
    maxFiles: MAX_SCAN_FILES,
    maxDepth: MAX_WALK_DEPTH,
  });
  return refs
    .map((ref) => {
      let mtime = 0;
      try {
        mtime = fs.statSync(ref.abs).mtimeMs;
      } catch {
        /* unreadable — sort last */
      }
      return { ...ref, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_LOG_FILES);
}

function collectSections(
  roots: string[],
  input: LogsMentionInput
): LogSection[] {
  const sections: LogSection[] = [];
  let budget = TOTAL_CHARS;

  if (input.explicitPath) {
    const raw = input.explicitPath.trim();
    const abs = path.isAbsolute(raw)
      ? raw
      : path.join(roots[0] || "", raw);
    const text = readTail(abs, Math.min(PER_FILE_CHARS * 2, budget));
    if (text) {
      const rel = path.relative(roots[0] || "", abs).replace(/\\/g, "/");
      sections.push({
        label: `Log file: ${rel || raw}`,
        text,
      });
      budget -= text.length;
    } else {
      sections.push({
        label: `Log file: ${raw}`,
        text: "(not found, empty, or too large)",
      });
    }
  } else {
    for (const ref of newestFirst(roots)) {
      if (budget <= 500) {
        break;
      }
      const text = readTail(ref.abs, Math.min(PER_FILE_CHARS, budget));
      if (text.trim()) {
        sections.push({ label: `Log file: ${ref.rel}`, text });
        budget -= text.length;
      }
    }
  }

  const terminal = String(input.terminalMessage || "").trim();
  if (terminal) {
    sections.push({
      label: "Last IDE terminal / Run output:",
      text: terminal,
      raw: true,
    });
  }
  return sections;
}

/**
 * Build the `@logs` `[Harbor mentions]` part: log tails + terminal output +
 * resolved stack trace frames. Returns "" when there is nothing to show.
 */
export function buildLogsMessage(
  roots: string[],
  input: LogsMentionInput = {}
): string {
  const sections = collectSections(roots, input);
  const combined = sections.map((s) => s.text).join("\n");
  const frames = resolveFramePaths(extractStackFrames(combined), roots);
  const framesMessage = buildStackFramesMessage(frames);
  if (!sections.length && !framesMessage) {
    return "";
  }
  const parts: string[] = [];
  if (sections.length) {
    parts.push("App logs (@logs, tails — newest last):");
    for (const s of sections) {
      parts.push(
        s.raw ? s.text : `### ${s.label}\n\`\`\`\n${s.text}\n\`\`\``
      );
    }
  }
  if (framesMessage) {
    parts.push(framesMessage);
  }
  return parts.join("\n\n");
}
