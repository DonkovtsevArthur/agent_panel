/**
 * Stack trace parsing for the @logs mention: normalize frames from
 * Java/Kotlin, Python, Node, Go and generic `file.ext:line` mentions into a
 * deduped `file:line` list the model can open directly. Pure string work —
 * no vscode/fs.
 */

export interface StackFrame {
  /** Workspace-relative path when resolvable, otherwise as written. */
  file: string;
  line?: number;
}

const MAX_FRAMES = 30;

interface FramePattern {
  re: RegExp;
  file: number;
  line: number;
}

// Ordered: specific formats first, generic file.ext:line last.
const PATTERNS: FramePattern[] = [
  // Java / Kotlin / Scala / C#: `at com.x.Y.method(File.java:42)` (also
  // `...at com.x.Y(File.java:42)`), `Caused by: ...` lines carry no frame.
  {
    re: /\bat\s+[\w$.]+\((?:[^()]*?[\\/])?([^()/\\]+?\.(?:java|kt|kts|scala|cs)):(\d+)\)/g,
    file: 1,
    line: 2,
  },
  // Python: `File "app/api.py", line 42, in handler`
  { re: /File\s+"([^"]+?\.(?:py|pyw))",\s+line\s+(\d+)/g, file: 1, line: 2 },
  // Node: `at fn (/abs/path/file.js:12:34)`, `at /abs/path/file.js:12:34`
  {
    re: /\(?((?:[A-Za-z]:)?[^\s()]*?\.(?:js|mjs|cjs|ts|tsx|jsx)):(\d+):(\d+)\)?/g,
    file: 1,
    line: 2,
  },
  // Go: `\t/path/to/file.go:42 +0x1a`
  { re: /\s((?:[A-Za-z]:)?[^\s:]*?\.go):(\d+)\s/g, file: 1, line: 2 },
  // Generic fallback: `src/api/service.py:12` / `service.py:12` in prose or
  // tracebacks the specific formats missed.
  {
    re: /(?:^|[\s("'`])((?:[A-Za-z]:)?[\w./\\-]*?\.(?:java|kt|kts|py|js|mjs|cjs|ts|tsx|jsx|rb|go|php|cs|rs)):(\d+)(?![\w.])/g,
    file: 1,
    line: 2,
  },
];

/** Extract unique frames in order of first appearance, capped. */
export function extractStackFrames(text: string): StackFrame[] {
  const raw = String(text || "");
  const frames: StackFrame[] = [];
  const seen = new Set<string>();
  for (const { re, file, line } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      const f = String(m[file] || "").replace(/\\/g, "/").replace(/^\.\//, "");
      const n = Number(m[line]);
      if (!f || !Number.isFinite(n) || n <= 0) {
        continue;
      }
      // Node internals carry no useful file to open.
      if (/node:internal|^internal[/\\]/.test(f)) {
        continue;
      }
      const key = `${f}:${n}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      frames.push({ file: f, line: n });
      if (frames.length >= MAX_FRAMES) {
        return frames;
      }
    }
  }
  return frames;
}

/** Relativize absolute frame paths that live under one of the roots. */
export function resolveFramePaths(
  frames: StackFrame[],
  roots: string[]
): StackFrame[] {
  const normalizedRoots = roots
    .map((r) => String(r || "").trim())
    .filter(Boolean);
  if (!normalizedRoots.length) {
    return frames;
  }
  return frames.map((frame) => {
    let f = frame.file;
    if (/^([A-Za-z]:)?\//.test(f) || /^[A-Za-z]:[\\/]/.test(f)) {
      const unix = f.replace(/\\/g, "/");
      for (const root of normalizedRoots) {
        const rootUnix = root.replace(/\\/g, "/").replace(/\/+$/, "");
        if (unix.startsWith(`${rootUnix}/`)) {
          f = unix.slice(rootUnix.length + 1);
          break;
        }
      }
    }
    return f === frame.file ? frame : { ...frame, file: f };
  });
}

/** `[Harbor mentions]` sub-block: resolved frames the model can open. */
export function buildStackFramesMessage(frames: StackFrame[]): string {
  if (!frames.length) {
    return "";
  }
  const rows = frames.map((f) => `- ${f.file}${f.line ? `:${f.line}` : ""}`);
  return [
    "Stack trace frames (workspace-relative where possible):",
    ...rows,
  ].join("\n");
}
