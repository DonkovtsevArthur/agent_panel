/**
 * Heuristic “next edit” targets after accepting a Tab completion.
 * Focused on Effector-style files (store → events, event → .on / wiring).
 * Pure text — no VS Code imports (easy to reason about / reuse).
 */

export type NextEditKind = "store" | "event" | "effect" | "wiring" | "import";

export type NextEditTarget = {
  /** 0-based line to place the caret. */
  line: number;
  /** 0-based character (usually end of indentation / blank line). */
  character: number;
  kind: NextEditKind;
  reason: string;
  /** Absolute path when the jump is in another file. */
  filePath?: string;
};

const SECTION_RE =
  /^(?:\/\/|\/\*|#|--)\s*(events?|stores?|effects?|samples?|wiring|units?)\b/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function indentOf(line: string): string {
  const m = /^(\s*)/.exec(line || "");
  return m?.[1] || "";
}

function isBlank(line: string): boolean {
  return !String(line || "").trim();
}

export function classifyAcceptedText(text: string): NextEditKind | undefined {
  const t = String(text || "");
  if (/^\s*import\b/.test(t)) {
    return "import";
  }
  if (/\bcreateStore\b/.test(t) || /(?:^|[\n;])\s*(?:export\s+)?(?:const|let)\s+\$\w+/.test(t)) {
    return "store";
  }
  if (/\bcreateEvent\b/.test(t)) {
    return "event";
  }
  if (/\bcreateEffect\b/.test(t) || /(?:const|let)\s+\w+Fx\b/.test(t)) {
    return "effect";
  }
  if (/\.on\s*\(|\bsample\s*\(/.test(t)) {
    return "wiring";
  }
  return undefined;
}

export function extractPrimaryBinding(text: string): string | undefined {
  const store = /(?:const|let|var)\s+(\$[A-Za-z_$][\w$]*)\b/.exec(text);
  if (store?.[1]) {
    return store[1];
  }
  const named =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*create(?:Event|Effect|Store)\b/.exec(
      text
    );
  if (named?.[1]) {
    return named[1];
  }
  const imp = /import\s*\{([^}]+)\}/.exec(text);
  if (imp?.[1]) {
    const first = imp[1]
      .split(",")
      .map((p) => p.trim().split(/\s+as\s+/i)[0].trim())
      .find((n) => /^[A-Za-z_$][\w$]*$/.test(n));
    if (first) {
      return first;
    }
  }
  return undefined;
}

function findSectionStart(
  lines: string[],
  want: "events" | "stores" | "effects" | "wiring"
): number | undefined {
  for (let i = 0; i < lines.length; i++) {
    const m = SECTION_RE.exec((lines[i] || "").trim());
    if (!m?.[1]) {
      continue;
    }
    const key = m[1].toLowerCase();
    if (want === "events" && key.startsWith("event")) {
      return i;
    }
    if (want === "stores" && key.startsWith("store")) {
      return i;
    }
    if (want === "effects" && key.startsWith("effect")) {
      return i;
    }
    if (
      want === "wiring" &&
      (key.startsWith("sample") ||
        key.startsWith("wir") ||
        key.startsWith("unit"))
    ) {
      return i;
    }
  }
  return undefined;
}

/** First comfortable blank / insert line inside a section (after the header). */
function blankInSection(
  lines: string[],
  sectionStart: number,
  avoidLine: number
): NextEditTarget | undefined {
  const end = Math.min(lines.length - 1, sectionStart + 60);
  // Prefer an existing blank line after at least one binding in the section.
  let sawBinding = false;
  let lastBindingLine = sectionStart;
  for (let i = sectionStart + 1; i <= end; i++) {
    const line = lines[i] || "";
    const trimmed = line.trim();
    if (
      SECTION_RE.test(trimmed) &&
      i > sectionStart + 1
    ) {
      break; // next section
    }
    if (/^(?:export\s+)?(?:const|let|var|function|class)\b/.test(trimmed)) {
      sawBinding = true;
      lastBindingLine = i;
      continue;
    }
    if (sawBinding && isBlank(line) && Math.abs(i - avoidLine) > 1) {
      return {
        line: i,
        character: indentOf(lines[lastBindingLine] || "").length,
        kind: "event",
        reason: "empty line in related section",
      };
    }
  }
  // No blank — insert after last binding (end of line → next line conceptually).
  if (sawBinding && Math.abs(lastBindingLine - avoidLine) > 1) {
    const insertLine = Math.min(lines.length - 1, lastBindingLine + 1);
    if (isBlank(lines[insertLine] || "") || insertLine === lastBindingLine + 1) {
      return {
        line: insertLine,
        character: indentOf(lines[lastBindingLine] || "").length,
        kind: "event",
        reason: "after last binding in related section",
      };
    }
  }
  // Section header only — place on the next line.
  const next = Math.min(lines.length - 1, sectionStart + 1);
  if (Math.abs(next - avoidLine) > 1) {
    return {
      line: next,
      character: indentOf(lines[next] || lines[sectionStart] || "").length,
      kind: "event",
      reason: "under section header",
    };
  }
  return undefined;
}

/** End line of a const binding + chained `.foo(` lines. */
function endOfBindingChain(lines: string[], startLine: number): number {
  let i = startLine;
  while (i + 1 < lines.length) {
    const next = (lines[i + 1] || "").trim();
    if (!next) {
      // allow one blank inside a chain? stop on blank.
      break;
    }
    if (/^[.(`]/.test(next) || next.startsWith(".on") || next.startsWith(".map")) {
      i += 1;
      continue;
    }
    break;
  }
  return i;
}

function findStoreForEvent(
  lines: string[],
  eventName: string
): number | undefined {
  // Prefer $eventName / $foo when event is fooUpdated → rough: strip Updated/Changed/Clicked
  const stem = eventName
    .replace(/(Updated|Changed|Clicked|Submitted|Reset|Set)$/i, "")
    .replace(/^(set|update|reset)/i, "");
  const candidates: Array<{ line: number; score: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m =
      /(?:const|let|var)\s+(\$[A-Za-z_$][\w$]*)\s*=\s*createStore\b/.exec(
        lines[i] || ""
      );
    if (!m?.[1]) {
      continue;
    }
    const id = m[1];
    let score = 0;
    if (stem && id.toLowerCase().includes(stem.toLowerCase())) {
      score += 5;
    }
    // Already wired to this event? skip.
    const chainEnd = endOfBindingChain(lines, i);
    const block = lines.slice(i, chainEnd + 1).join("\n");
    if (new RegExp(`\\.on\\(\\s*${escapeRegExp(eventName)}\\b`).test(block)) {
      continue;
    }
    score += 1;
    candidates.push({ line: i, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.line;
}

function targetAfterLine(
  lines: string[],
  line: number,
  kind: NextEditKind,
  reason: string,
  avoidLine: number
): NextEditTarget | undefined {
  const after = Math.min(lines.length - 1, line + 1);
  if (Math.abs(after - avoidLine) <= 1 && after === avoidLine) {
    return undefined;
  }
  if (Math.abs(after - avoidLine) <= 0) {
    return undefined;
  }
  // Prefer sitting on a blank line after the chain.
  let dest = after;
  if (!isBlank(lines[dest] || "") && dest + 1 < lines.length && isBlank(lines[dest + 1] || "")) {
    dest = dest + 1;
  }
  if (Math.abs(dest - avoidLine) <= 1) {
    return undefined;
  }
  return {
    line: dest,
    character: indentOf(lines[line] || "").length,
    kind,
    reason,
  };
}

function findImportInsertLine(lines: string[], avoidLine: number): NextEditTarget | undefined {
  let lastImport = -1;
  for (let i = 0; i < Math.min(lines.length, 120); i++) {
    if (/^\s*import\b/.test(lines[i] || "")) {
      lastImport = i;
    } else if (lastImport >= 0 && (lines[i] || "").trim()) {
      break;
    }
  }
  if (lastImport < 0) {
    return undefined;
  }
  const dest = Math.min(lines.length - 1, lastImport + 1);
  if (Math.abs(dest - avoidLine) <= 1) {
    return undefined;
  }
  return {
    line: dest,
    character: 0,
    kind: "import",
    reason: "after import block",
  };
}

/**
 * Suggest where the user likely wants to edit next after accepting `acceptedText`
 * at `acceptLine` (0-based).
 */
export function findNextEditTarget(
  fullText: string,
  acceptLine: number,
  acceptedText: string
): NextEditTarget | undefined {
  const lines = String(fullText || "").replace(/\r\n/g, "\n").split("\n");
  if (lines.length === 0) {
    return undefined;
  }
  const kind = classifyAcceptedText(acceptedText);
  if (!kind) {
    return undefined;
  }
  const avoid = Math.max(0, Math.min(acceptLine, lines.length - 1));
  const binding = extractPrimaryBinding(acceptedText);

  if (kind === "store") {
    const events = findSectionStart(lines, "events");
    if (typeof events === "number") {
      const hit = blankInSection(lines, events, avoid);
      if (hit) {
        return { ...hit, kind: "store", reason: `events section after ${binding || "store"}` };
      }
    }
    // Dense createEvent cluster.
    for (let i = 0; i < lines.length; i++) {
      if (/\bcreateEvent\b/.test(lines[i] || "")) {
        const hit = targetAfterLine(
          lines,
          endOfBindingChain(lines, i),
          "store",
          `near events after ${binding || "store"}`,
          avoid
        );
        if (hit) {
          return hit;
        }
        break;
      }
    }
    return undefined;
  }

  if (kind === "event") {
    const eventName = binding;
    if (eventName) {
      const storeLine = findStoreForEvent(lines, eventName);
      if (typeof storeLine === "number") {
        const chainEnd = endOfBindingChain(lines, storeLine);
        const hit = targetAfterLine(
          lines,
          chainEnd,
          "event",
          `wire ${eventName} onto store`,
          avoid
        );
        if (hit) {
          return hit;
        }
      }
    }
    const wiring = findSectionStart(lines, "wiring");
    if (typeof wiring === "number") {
      const hit = blankInSection(lines, wiring, avoid);
      if (hit) {
        return { ...hit, kind: "event", reason: `wiring after ${eventName || "event"}` };
      }
    }
    const stores = findSectionStart(lines, "stores");
    if (typeof stores === "number") {
      const hit = blankInSection(lines, stores, avoid);
      if (hit) {
        return { ...hit, kind: "event", reason: `stores section after ${eventName || "event"}` };
      }
    }
    return undefined;
  }

  if (kind === "effect") {
    const wiring = findSectionStart(lines, "wiring");
    if (typeof wiring === "number") {
      const hit = blankInSection(lines, wiring, avoid);
      if (hit) {
        return { ...hit, kind: "effect", reason: `wiring after ${binding || "effect"}` };
      }
    }
    // Near first sample(
    for (let i = 0; i < lines.length; i++) {
      if (/\bsample\s*\(/.test(lines[i] || "")) {
        return targetAfterLine(
          lines,
          i,
          "effect",
          `near sample after ${binding || "effect"}`,
          avoid
        );
      }
    }
    return undefined;
  }

  if (kind === "import") {
    return findImportInsertLine(lines, avoid);
  }

  if (kind === "wiring") {
    // After wiring fill, offer a blank under the accept chain.
    const chainEnd = endOfBindingChain(lines, avoid);
    return targetAfterLine(
      lines,
      chainEnd,
      "wiring",
      "continue wiring",
      avoid
    );
  }

  return undefined;
}
