/**
 * Hole-fill prompts adapted from TabCoder (Apache-2.0)
 * vendor/tabcoder/src/autocomplete/defaultHoleFiller.ts
 * Original inspiration: Continue holeFillerTemplate / VictorTaelin AI-scripts.
 */

export type AutoCompleteContext = {
  textBeforeCursor: string;
  textAfterCursor: string;
  currentLineText: string;
  filename?: string;
  language?: string;
  /**
   * Local intent for smarter Tab fills (recent bindings, Effector region, …).
   * Injected into the user prompt — keep short.
   */
  focus?: TabFocusContext;
  /** Short snippets from relative imports / one sibling open tab. */
  relatedFiles?: TabRelatedSnippet[];
  /** Truncated AGENTS.md / .cursor/rules digest for style consistency. */
  projectRules?: string;
  /**
   * Short LSP digest at the caret (signature help + hover).
   * Prefer when filling calls / typed identifiers.
   */
  lsp?: string;
};

export type TabRelatedSnippet = {
  label: string;
  snippet: string;
};

export type TabFocusContext = {
  /** Bindings the user just added in this file (e.g. a new $store). */
  recentBindings: string[];
  /** Short declaration snippets for recent bindings (helps naming/wiring). */
  recentSnippets: string[];
  /** Top-level bindings near the caret. */
  nearbyBindings: string[];
  /** Heuristic: events | stores | effects | wiring | code */
  region: "events" | "stores" | "effects" | "wiring" | "code";
};

export type HoleFillPromptMessage = {
  role: "system" | "user";
  content: string;
};

/** Hard caps so Tab never pastes a whole function/file dump. */
const MAX_COMPLETION_CHARS = 280;
const MAX_COMPLETION_LINES = 5;

const BINDING_LINE_RE =
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/;

/**
 * Build a short focus block from the caret neighborhood + recent edits.
 * Helps Tab prefer e.g. an event for a store the user just created.
 */
export function buildTabFocusContext(
  fullText: string,
  cursorLine: number,
  recentBindings: string[]
): TabFocusContext {
  const lines = fullText.split("\n");
  const start = Math.max(0, cursorLine - 40);
  const end = Math.min(lines.length - 1, cursorLine + 25);
  const windowText = lines.slice(start, end + 1).join("\n");

  const nearby: string[] = [];
  const seen = new Set<string>();
  for (let i = start; i <= end; i++) {
    const m = BINDING_LINE_RE.exec(lines[i] || "");
    if (!m?.[1] || seen.has(m[1])) {
      continue;
    }
    seen.add(m[1]);
    nearby.push(m[1]);
    if (nearby.length >= 14) {
      break;
    }
  }

  const recent = recentBindings.filter(Boolean).slice(0, 8);
  const region = inferEditorRegion(
    lines,
    cursorLine,
    windowText,
    lines[cursorLine] || "",
    recent
  );
  const recentSnippets = extractRecentSnippets(lines, recent);

  return {
    recentBindings: recent,
    recentSnippets,
    nearbyBindings: nearby,
    region,
  };
}

function extractRecentSnippets(lines: string[], ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids.slice(0, 5)) {
    const re = new RegExp(
      `^\\s*(?:export\\s+)?(?:const|let|var)\\s+${escapeRegExp(id)}\\b`
    );
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i] || "")) {
        continue;
      }
      const chunk = lines
        .slice(i, Math.min(lines.length, i + 3))
        .join("\n")
        .slice(0, 220)
        .trimEnd();
      if (chunk) {
        out.push(chunk);
      }
      break;
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionCommentRegion(
  lines: string[],
  cursorLine: number
): TabFocusContext["region"] | undefined {
  for (let i = cursorLine; i >= Math.max(0, cursorLine - 20); i--) {
    const t = (lines[i] || "").trim();
    const m =
      /^(?:\/\/|\/\*|#|--)\s*(events?|stores?|effects?|samples?|wiring|units?)\b/i.exec(
        t
      ) ||
      /^\s*(?:\/\/|\/\*)\s*=+\s*(events?|stores?|effects?|samples?|wiring)\b/i.exec(
        t
      );
    if (!m?.[1]) {
      continue;
    }
    const key = m[1].toLowerCase();
    if (key.startsWith("event")) {
      return "events";
    }
    if (key.startsWith("store")) {
      return "stores";
    }
    if (key.startsWith("effect")) {
      return "effects";
    }
    if (key.startsWith("sample") || key.startsWith("wir") || key.startsWith("unit")) {
      return "wiring";
    }
  }
  return undefined;
}

function inferEditorRegion(
  lines: string[],
  cursorLine: number,
  windowText: string,
  currentLine: string,
  recentBindings: string[]
): TabFocusContext["region"] {
  const fromComment = sectionCommentRegion(lines, cursorLine);
  if (fromComment) {
    return fromComment;
  }

  const line = currentLine.toLowerCase();
  if (/\bcreateevent\b/.test(line)) {
    return "events";
  }
  if (/\bcreatestore\b/.test(line)) {
    return "stores";
  }
  if (/\bcreateeffect\b/.test(line)) {
    return "effects";
  }

  const events = (windowText.match(/\bcreateEvent\b/g) || []).length;
  const stores = (windowText.match(/\bcreateStore\b/g) || []).length;
  const effects = (windowText.match(/\bcreateEffect\b/g) || []).length;
  const wiring = (
    windowText.match(/\bsample\s*\(|\.on\s*\(|\bcombine\s*\(/g) || []
  ).length;

  // After adding a $store, empty line in an events cluster → complete an event.
  const recentStores = recentBindings.filter((id) => id.startsWith("$"));
  const recentEvents = recentBindings.filter(
    (id) => !id.startsWith("$") && !/Fx$/i.test(id)
  );
  if (recentStores.length > 0 && events >= stores && events > 0) {
    return "events";
  }
  if (recentEvents.length > 0 && stores >= events && stores > 0) {
    return "stores";
  }

  const scores: Array<[TabFocusContext["region"], number]> = [
    ["events", events],
    ["stores", stores],
    ["effects", effects],
    ["wiring", wiring],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  if (scores[0][1] > 0 && scores[0][1] >= (scores[1]?.[1] || 0)) {
    return scores[0][0];
  }
  return "code";
}

function formatFocusBlock(focus: TabFocusContext): string {
  const lines: string[] = ["## FOCUS (follow this — local editor intent)"];
  if (focus.recentBindings.length > 0) {
    lines.push(
      `- User recently introduced: ${focus.recentBindings.map((s) => `\`${s}\``).join(", ")}`
    );
    lines.push(
      "- Prefer a continuation that relates to those symbols (naming + wiring), not unrelated code from elsewhere in the file."
    );
  }
  if (focus.recentSnippets.length > 0) {
    lines.push("- Recent declaration snippets:");
    lines.push("```");
    lines.push(focus.recentSnippets.join("\n---\n"));
    lines.push("```");
  }
  if (focus.nearbyBindings.length > 0) {
    lines.push(
      `- Bindings near the cursor: ${focus.nearbyBindings
        .slice(0, 10)
        .map((s) => `\`${s}\``)
        .join(", ")}`
    );
  }
  const regionHelp: Record<TabFocusContext["region"], string> = {
    events:
      "Local region looks like Effector **events**. Prefer `createEvent` / event consts linked to recent stores (e.g. `$cart` → `cartUpdated` / `cartReset`). Do NOT invent unrelated domain events.",
    stores:
      "Local region looks like Effector **stores**. Prefer `createStore` / `$name` related to recent events or domain.",
    effects:
      "Local region looks like Effector **effects**. Prefer `createEffect` / `*Fx` related to recent stores/events.",
    wiring:
      "Local region looks like Effector **wiring** (`sample` / `.on`). Prefer connecting recent stores/events/effects, not new unrelated symbols.",
    code: "Stay consistent with nearby identifiers; do not invent distant features.",
  };
  lines.push(`- ${regionHelp[focus.region]}`);
  lines.push("");
  return lines.join("\n");
}

function formatLspBlock(lsp: string): string {
  const text = String(lsp || "").trim();
  if (!text) {
    return "";
  }
  return [
    "## LSP (types / signature at caret — prefer when filling calls)",
    text,
    "",
  ].join("\n");
}

function formatExtraContext(ctx: AutoCompleteContext): string {
  const parts: string[] = [];
  const lsp = formatLspBlock(ctx.lsp || "");
  if (lsp) {
    parts.push(lsp);
  }
  const rules = String(ctx.projectRules || "").trim();
  if (rules) {
    parts.push("## PROJECT RULES (short — follow for style / naming)");
    parts.push(
      "(Use for naming/conventions only — do NOT turn rules into new comments in the fill.)"
    );
    parts.push(rules);
    parts.push("");
  }
  const files = ctx.relatedFiles || [];
  if (files.length > 0) {
    parts.push("## RELATED FILES (imports / open tab — stay consistent)");
    for (const file of files.slice(0, 2)) {
      parts.push(`### ${file.label}`);
      parts.push("```");
      parts.push(file.snippet.trimEnd());
      parts.push("```");
    }
    parts.push("");
  }
  return parts.join("\n");
}

/** Symbols mentioned on the next few lines — used to ground comment fills. */
function upcomingBindingNames(ctx: AutoCompleteContext): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const lines = String(ctx.textAfterCursor || "").split("\n").slice(0, 10);
  for (const line of lines) {
    const m =
      /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/.exec(line) ||
      /^\s*(?:export\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)\b/.exec(line);
    if (!m?.[1] || seen.has(m[1])) {
      continue;
    }
    seen.add(m[1]);
    out.push(m[1]);
    if (out.length >= 6) {
      break;
    }
  }
  return out;
}

function buildCommentFillNudge(ctx: AutoCompleteContext): string {
  const upcoming = upcomingBindingNames(ctx);
  const recent = ctx.focus?.recentBindings || [];
  const nearby = ctx.focus?.nearbyBindings || [];
  const symbols = [...new Set([...recent, ...upcoming, ...nearby])].slice(0, 8);
  const region = ctx.focus?.region;
  const symbolBit = symbols.length
    ? ` Anchor the comment to: ${symbols.map((s) => `\`${s}\``).join(", ")}.`
    : "";
  const regionBit =
    region && region !== "code"
      ? ` Local region is ${region}, but do NOT reply with just the word "${region}".`
      : "";
  return (
    " Cursor is inside a comment — finish with a short meaningful phrase about what the following code does" +
    " (purpose / domain), not a section banner." +
    symbolBit +
    regionBit +
    ' Bad: "events". Better: " search text events for $testSearch ".'
  );
}

/** Bare section labels the model loves and users hate. */
const USELESS_COMMENT_FILL_RE =
  /^(events?|stores?|effects?|units?|types?|helpers?|utils?|hooks?|constants?|models?|actions?|selectors?|components?|todo|fixme|hack|note|section|imports?|exports?|public|private|---+|===+|\*\*\*+)$/i;

/**
 * Reject empty / one-word section-header comment completions.
 */
export function isUselessCommentFill(text: string): boolean {
  let t = String(text || "")
    .replace(/\r\n/g, "\n")
    .trim();
  // Completion is only the text after `//` — strip leftover markers if present.
  t = t.replace(/^\/\*+/, "").replace(/\*\/$/, "").replace(/^\/\//, "").trim();
  t = t.replace(/^#+/, "").trim();
  if (!t) {
    return true;
  }
  if (USELESS_COMMENT_FILL_RE.test(t)) {
    return true;
  }
  // Single short token that looks like a folder/section name.
  if (!/\s/.test(t) && t.length <= 14 && /^[A-Za-z][\w-]*$/.test(t)) {
    if (
      /^(event|store|effect|unit|type|helper|util|hook|const|model|action)/i.test(
        t
      )
    ) {
      return true;
    }
  }
  return false;
}

export class DefaultHoleFiller {
  systemPrompt(): string {
    return `You are a HOLE FILLER for inline editor autocomplete (ghost text).
Fill ONLY the {{FILL_HERE}} hole with the smallest correct continuation.
Rules:
- Output ONLY the missing text that belongs at the cursor — not the surrounding code.
- Do NOT rewrite, repeat, or continue past code that already exists after {{FILL_HERE}}.
- Do NOT invent large new features, whole files, or long refactors.
- Prefer finishing the current statement / line; at most a few short lines.
- When a FOCUS section is present, treat it as the user's intent (e.g. after adding a store, complete a related event in an events block).
- When an LSP section is present, prefer its signature/types for calls and identifiers at the cursor.
- When PROJECT RULES or RELATED FILES are present, match their naming/style and reuse symbols from those snippets when relevant.
- Do NOT invent comments, JSDoc, section headers, or explanatory prose — only emit them if the cursor is already inside a comment the user started (\`//\`, \`/*\`, \`#\`). Prefer real code (bindings, calls, types).
- If finishing a comment: write a short meaningful phrase about the nearby/following code (symbols, intent). Never a bare section label like "events", "stores", "TODO".
- Keep indentation consistent with the hole.
- Put each answer inside <COMPLETION>...</COMPLETION>.

## EXAMPLE

<QUERY>
function sum_evens(lim) {
  var sum = 0;
  for (var i = 0; i < lim; ++i) {
    {{FILL_HERE}}
  }
  return sum;
}
</QUERY>

<COMPLETION>if (i % 2 === 0) {
      sum += i;
    }</COMPLETION>

## EXAMPLE

<QUERY>
def sum_list(lst):
  total = 0
  for x in lst:
  {{FILL_HERE}}
  return total
</QUERY>

<COMPLETION>  total += x</COMPLETION>

## EXAMPLE

<QUERY>
function hypothenuse(a, b) {
  return Math.sqrt({{FILL_HERE}}b ** 2);
}
</QUERY>

<COMPLETION>a ** 2 + </COMPLETION>

## EXAMPLE

FOCUS: User recently introduced \`$cartStore\`. Region: events.
<QUERY>
const $cartStore = createStore(null)
{{FILL_HERE}}
</QUERY>

<COMPLETION>export const cartUpdated = createEvent<Cart>()
</COMPLETION>
`;
  }

  userPrompt(ctx: AutoCompleteContext, alternatives: number = 1): string {
    let context = "";
    if (ctx.filename) {
      context += `Filename: "${ctx.filename}"\n`;
    }
    if (ctx.language) {
      context += `Language: "${ctx.language}"\n`;
    }
    context += formatExtraContext(ctx);
    if (ctx.focus) {
      context += formatFocusBlock(ctx.focus);
    }
    const sameLineSuffix = (ctx.textAfterCursor.split("\n")[0] || "");
    const writingComment = isCursorInsideComment(ctx);
    const guidance =
      sameLineSuffix.length > 0
        ? "Finish ONLY the current line (no newlines). Do not repeat text after {{FILL_HERE}}."
        : "Return a MINIMAL fill (usually under 3 lines, never a whole block/file). Stop at the next natural statement boundary.";

    const focusNudge = ctx.focus?.recentBindings.length
      ? " Strongly prefer relating the fill to the FOCUS recent bindings / region."
      : "";
    const relatedNudge =
      (ctx.relatedFiles && ctx.relatedFiles.length > 0) || ctx.projectRules
        ? " Prefer symbols and naming from RELATED FILES / PROJECT RULES when they fit."
        : "";
    const lspNudge = String(ctx.lsp || "").trim()
      ? " Honor LSP signature/types when filling the call or typed identifier."
      : "";
    const commentNudge = writingComment
      ? buildCommentFillNudge(ctx)
      : " Do NOT add comments/JSDoc/section banners — code only.";

    const k = Math.max(1, Math.min(3, Math.floor(alternatives) || 1));
    if (k <= 1) {
      return `${context}<QUERY>\n${ctx.textBeforeCursor}{{FILL_HERE}}${ctx.textAfterCursor}\n</QUERY>\nTASK: Fill {{FILL_HERE}} only. ${guidance}${focusNudge}${relatedNudge}${lspNudge}${commentNudge} Answer with one <COMPLETION>...</COMPLETION> and nothing else.\n<COMPLETION>`;
    }

    return `${context}<QUERY>\n${ctx.textBeforeCursor}{{FILL_HERE}}${ctx.textAfterCursor}\n</QUERY>\nTASK: Fill {{FILL_HERE}} only. ${guidance}${focusNudge}${relatedNudge}${lspNudge}${commentNudge} Return up to ${k} DISTINCT minimal alternatives as separate closed tags:\n<COMPLETION>…</COMPLETION>\nMost likely first (best match to LSP / FOCUS / RELATED FILES). Each alternative is a full short fill (not a continuation of another). No commentary outside tags.`;
  }

  prompt(
    params: AutoCompleteContext,
    alternatives: number = 1
  ): { messages: HoleFillPromptMessage[] } {
    return {
      messages: [
        { role: "system", content: this.systemPrompt() },
        { role: "user", content: this.userPrompt(params, alternatives) },
      ],
    };
  }
}

/** Strip optional COMPLETION XML wrapper from model output (TabCoder). */
export function processHoleFillResponse(responseText: string): string {
  const closed = /<COMPLETION>([\s\S]*?)<\/COMPLETION>/i.exec(responseText);
  if (closed) {
    return closed[1];
  }
  // Open tag without close — take after the tag, stop at next tag-like noise.
  const open = /<COMPLETION>([\s\S]*)/i.exec(responseText);
  if (open) {
    return open[1].replace(/<\/?COMPLETION>?/gi, "").trimEnd();
  }
  return responseText.replace(/<\/?COMPLETION>?/gi, "");
}

/**
 * Extract up to `max` raw completion bodies from model output.
 * Prefers closed `<COMPLETION>...</COMPLETION>` tags; falls back to a single
 * `processHoleFillResponse` parse when no closed tags are found.
 */
export function parseCompletions(raw: string, max: number): string[] {
  const limit = Math.max(1, Math.min(3, Math.floor(max) || 1));
  const closed: string[] = [];
  const re = /<COMPLETION>([\s\S]*?)<\/COMPLETION>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) && closed.length < limit) {
    closed.push(m[1]);
  }
  if (closed.length > 0) {
    return closed;
  }
  const one = processHoleFillResponse(raw);
  return one.trim() ? [one] : [];
}

function stripPrefixEcho(response: string, ctx: AutoCompleteContext): string {
  let out = response;
  if (out.startsWith(ctx.currentLineText)) {
    out = out.slice(ctx.currentLineText.length);
  }
  // Model sometimes re-emits the end of the prefix.
  const prefixTail = ctx.textBeforeCursor.slice(-80);
  if (prefixTail.length >= 8) {
    for (let n = prefixTail.length; n >= 8; n--) {
      const chunk = prefixTail.slice(-n);
      if (out.startsWith(chunk)) {
        out = out.slice(chunk.length);
        break;
      }
    }
  }
  return out;
}

function trimAgainstSuffix(response: string, ctx: AutoCompleteContext): string {
  let out = response;
  const sameLineSuffix = (ctx.textAfterCursor.split("\n")[0] || "");
  if (sameLineSuffix.length > 0) {
    out = out.split("\n")[0] || "";
    while (out.length > 0 && sameLineSuffix.startsWith(out)) {
      return "";
    }
    for (let n = Math.min(out.length, sameLineSuffix.length); n > 0; n--) {
      if (out.endsWith(sameLineSuffix.slice(0, n))) {
        out = out.slice(0, out.length - n);
        break;
      }
    }
    return out;
  }

  // If the model pasted upcoming code, cut at the first strong overlap.
  const suffix = ctx.textAfterCursor;
  if (!suffix.trim()) {
    return out;
  }
  const lines = suffix.split("\n").filter((l) => l.trim().length >= 8);
  for (const line of lines.slice(0, 6)) {
    const needle = line.trim();
    const idx = out.indexOf(needle);
    if (idx >= 0) {
      // Keep a little before the echoed line if it looks like a partial new line.
      const cut = out.slice(0, idx).replace(/\s+$/, "");
      if (cut.length > 0 && cut.length < out.length) {
        return cut;
      }
      if (idx === 0) {
        return "";
      }
    }
  }
  return out;
}

function applyHardCaps(response: string, midLine: boolean): string {
  let out = response.replace(/\r\n/g, "\n");
  if (midLine) {
    out = out.split("\n")[0] || "";
  } else {
    const lines = out.split("\n");
    if (lines.length > MAX_COMPLETION_LINES) {
      out = lines.slice(0, MAX_COMPLETION_LINES).join("\n");
    }
  }
  if (out.length > MAX_COMPLETION_CHARS) {
    out = out.slice(0, MAX_COMPLETION_CHARS);
    // Avoid cutting mid-identifier when possible.
    const soft = out.replace(/\s+\S*$/, "");
    if (soft.length >= Math.floor(MAX_COMPLETION_CHARS * 0.5)) {
      out = soft;
    }
  }
  return out;
}

/** True when the caret is already inside a user-started comment. */
export function isCursorInsideComment(ctx: AutoCompleteContext): boolean {
  const before = ctx.textBeforeCursor || "";
  const line = before.split("\n").pop() || "";
  const lang = String(ctx.language || "").toLowerCase();

  const lineCommentIdx = line.indexOf("//");
  if (lineCommentIdx >= 0) {
    return true;
  }

  if (
    lang === "python" ||
    lang === "ruby" ||
    lang === "shellscript" ||
    lang === "yaml" ||
    lang === "dockerfile"
  ) {
    const hash = line.indexOf("#");
    if (hash >= 0) {
      return true;
    }
  }

  const lastOpen = before.lastIndexOf("/*");
  const lastClose = before.lastIndexOf("*/");
  if (lastOpen >= 0 && lastOpen > lastClose) {
    return true;
  }
  return false;
}

function isCommentOnlyLine(line: string, language?: string): boolean {
  const t = line.trim();
  if (!t) {
    return false;
  }
  if (
    t.startsWith("//") ||
    t.startsWith("/*") ||
    t.startsWith("*") ||
    t === "*/" ||
    t.startsWith("*/")
  ) {
    return true;
  }
  const lang = String(language || "").toLowerCase();
  if (
    (lang === "python" ||
      lang === "ruby" ||
      lang === "shellscript" ||
      lang === "yaml" ||
      lang === "dockerfile") &&
    t.startsWith("#")
  ) {
    return true;
  }
  return false;
}

/** Strip trailing `// …` / `# …` from a code line (not inside strings — best-effort). */
function stripTrailingLineComment(line: string, language?: string): string {
  const lang = String(language || "").toLowerCase();
  const hashLang =
    lang === "python" ||
    lang === "ruby" ||
    lang === "shellscript" ||
    lang === "yaml" ||
    lang === "dockerfile";

  // Skip if the whole line is already a comment.
  if (isCommentOnlyLine(line, language)) {
    return line;
  }

  // Avoid stripping URLs in strings crudely: only strip when `//` has code before it.
  const slash = line.search(/(?<=\S)\s*\/\//);
  if (slash >= 0) {
    const before = line.slice(0, slash);
    const dq = (before.match(/"/g) || []).length;
    const sq = (before.match(/'/g) || []).length;
    if (dq % 2 === 0 && sq % 2 === 0) {
      return before.replace(/\s+$/, "");
    }
  }

  if (hashLang) {
    const hash = line.search(/(?<=\S)\s*#/);
    if (hash >= 0) {
      const before = line.slice(0, hash);
      const dq = (before.match(/"/g) || []).length;
      const sq = (before.match(/'/g) || []).length;
      if (dq % 2 === 0 && sq % 2 === 0) {
        return before.replace(/\s+$/, "");
      }
    }
  }
  return line;
}

/**
 * Drop unsolicited comments/JSDoc the model invents when the user is writing code.
 */
export function stripUnsolicitedComments(
  response: string,
  ctx: AutoCompleteContext
): string {
  if (!response || isCursorInsideComment(ctx)) {
    return response;
  }

  let out = response.replace(/\r\n/g, "\n");

  // Strip leading JSDoc / block comment if the whole fill starts with one.
  out = out.replace(/^\s*\/\*\*[\s\S]*?\*\/\s*/, "");
  out = out.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "");

  const lines = out.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (isCommentOnlyLine(line, ctx.language)) {
      continue;
    }
    kept.push(stripTrailingLineComment(line, ctx.language));
  }

  // Trim leading/trailing blank lines left after stripping comments.
  while (kept.length > 0 && !kept[0].trim()) {
    kept.shift();
  }
  while (kept.length > 0 && !kept[kept.length - 1].trim()) {
    kept.pop();
  }

  return kept.join("\n");
}

/**
 * Clean model output into insertable ghost text.
 * - strip fences / echoed line
 * - drop overlap with suffix after cursor
 * - hard caps so Tab never dumps a whole file
 * - drop unsolicited comments
 */
export function refineCompletionText(
  raw: string,
  ctx: AutoCompleteContext
): string {
  let response = processHoleFillResponse(raw).replace(/\r\n/g, "\n");
  response = response.replace(/^```[\w-]*\n?/, "").replace(/\n?```$/, "");
  response = stripPrefixEcho(response, ctx);
  response = trimAgainstSuffix(response, ctx);
  response = stripUnsolicitedComments(response, ctx);

  const midLine = (ctx.textAfterCursor.split("\n")[0] || "").length > 0;
  response = applyHardCaps(response, midLine);

  // Reject absurd dumps that still look like rewrites of nearby code.
  const prefixSample = ctx.textBeforeCursor.slice(-200).trim();
  if (
    prefixSample.length > 40 &&
    response.length > 80 &&
    response.includes(prefixSample.slice(0, 40))
  ) {
    return "";
  }

  // If only whitespace remains after comment stripping — no suggestion.
  if (!response.trim()) {
    return "";
  }

  // Bare "// events" style fills — drop; prefer no ghost over a useless label.
  if (isCursorInsideComment(ctx) && isUselessCommentFill(response)) {
    return "";
  }

  return response;
}

/**
 * Parse + refine + dedupe alternatives from a single model response.
 */
export function refineCompletionAlternatives(
  raw: string,
  ctx: AutoCompleteContext,
  max: number
): string[] {
  const parts = parseCompletions(raw, max);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const refined = refineCompletionText(
      `<COMPLETION>${part}</COMPLETION>`,
      ctx
    );
    if (!refined.trim() || seen.has(refined)) {
      continue;
    }
    seen.add(refined);
    out.push(refined);
  }
  return out;
}
