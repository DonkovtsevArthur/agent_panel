/**
 * Hole-fill prompts adapted from TabCoder (Apache-2.0)
 * vendor/tabcoder/src/autocomplete/defaultHoleFiller.ts
 * Original inspiration: Continue holeFillerTemplate / VictorTaelin AI-scripts.
 */

import { languageFillNudge } from "./tabAutocompleteLanguage";
import type { TabFileIdentity } from "./tabAutocompleteExtraContext";
import {
  failsSyntaxPostFilter,
  syntaxRejectReason,
} from "./tabAutocompleteSyntax";

export type AutoCompleteContext = {
  textBeforeCursor: string;
  textAfterCursor: string;
  currentLineText: string;
  filename?: string;
  language?: string;
  /**
   * Parsed meaning of the current path: stem + layer marker + siblings on disk.
   */
  fileIdentity?: TabFileIdentity;
  /**
   * Micro-research digest built when the file was opened/focused.
   * Prefer this over guessing from the filename alone.
   */
  fileBrief?: string;
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
   * Learned repo conventions from Tab project map (workspaceState cache).
   * Prefer over guessing architecture from the filename alone.
   */
  projectMap?: string;
  /**
   * Short LSP digest at the caret (signature help + hover).
   * Prefer when filling calls / typed identifiers.
   */
  lsp?: string;
  /**
   * Short recent accept/dismiss lines for FOCUS (from Tab stats).
   */
  recentFillFeedback?: string;
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
/** Mid-file (non-empty) — keep fills shorter to reduce fantasy. */
const MID_FILE_COMPLETION_CHARS = 200;
const MID_FILE_COMPLETION_LINES = 3;

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

function formatFileIdentityBlock(
  id: TabFileIdentity,
  opts?: { emptyFile?: boolean }
): string {
  const lines: string[] = [
    "## THIS FILE (filename meaning — obey)",
    `- Path: \`${id.relativePath}\``,
    `- Feature stem: \`${id.stem}\` (name symbols from this stem: ${id.stem}, $${id.stem}, ${id.stem}Fx, … as fits local style)`,
    `- Layer marker in filename: \`${id.layerMarker || "(none)"}\` — fill ONLY what belongs in this layer, not what siblings own`,
  ];
  if (id.folder && id.folder !== "." && id.folder !== id.stem) {
    lines.push(`- Folder: \`${id.folder}\``);
  }
  if (opts?.emptyFile) {
    lines.push(
      "- EMPTY FILE: start this layer only. Mirror the SAME LAYER example (imports + first export), renamed to this stem."
    );
    lines.push(
      "- Do NOT paste OTHER LAYER sibling bodies (e.g. do not put domain units into a UI file, or JSX into a `.model` file)."
    );
  }
  if (id.siblingsOnDisk.length > 0) {
    lines.push(
      `- Sibling files on disk (other layers of the same feature): ${id.siblingsOnDisk
        .map((s) => `\`${s}\``)
        .join(", ")}`
    );
    lines.push(
      "- OTHER LAYER siblings are for naming/wiring hints only — do NOT copy their layer into this file."
    );
  } else if (!opts?.emptyFile) {
    lines.push(
      "- No sibling files found yet — still stay consistent with the layer marker and PROJECT MAP shape for this filename."
    );
  }
  lines.push("");
  return lines.join("\n");
}

function isNearlyEmptyFile(ctx: AutoCompleteContext): boolean {
  const before = String(ctx.textBeforeCursor || "").trim();
  const after = String(ctx.textAfterCursor || "").trim();
  return before.length + after.length < 80;
}

function formatExtraContext(ctx: AutoCompleteContext): string {
  const parts: string[] = [];
  const emptyFile = isNearlyEmptyFile(ctx);
  const brief = String(ctx.fileBrief || "").trim();
  if (brief) {
    parts.push("## FILE BRIEF (micro-research on open — obey)");
    // Mid-file: keep only the head (layer / stem / suggested start) — full brief
    // overfeeds the model and causes fantasy fills.
    parts.push(emptyFile ? brief : brief.slice(0, 220));
    parts.push("");
  } else if (ctx.fileIdentity) {
    parts.push(formatFileIdentityBlock(ctx.fileIdentity, { emptyFile }));
  }
  const lsp = formatLspBlock(ctx.lsp || "");
  if (lsp) {
    parts.push(lsp);
  }
  // Mid-file: skip project rules / map noise — prefer LSP + related + short brief.
  if (emptyFile) {
    const rules = String(ctx.projectRules || "").trim();
    if (rules) {
      parts.push("## PROJECT RULES (short — follow for style / naming)");
      parts.push(
        "(Use for naming/conventions only — do NOT turn rules into new comments in the fill.)"
      );
      parts.push(rules);
      parts.push("");
    }
    const map = String(ctx.projectMap || "").trim();
    if (map) {
      parts.push("## PROJECT MAP (style only — do NOT paste into fill)");
      parts.push(
        "(Copy naming/import style. Never emit the skeleton, example path, or sibling list as completion text.)"
      );
      parts.push(map);
      parts.push("");
    }
  } else {
    const map = String(ctx.projectMap || "").trim();
    if (map) {
      parts.push("## PROJECT MAP (style only — do NOT paste into fill)");
      parts.push(map.slice(0, 160));
      parts.push("");
    }
  }
  const files = ctx.relatedFiles || [];
  if (files.length > 0) {
    parts.push(
      emptyFile
        ? "## RELATED FILES (SAME LAYER = template; OTHER LAYER = naming only)"
        : "## RELATED FILES (symbol / neighbor / imports / open tab)"
    );
    const limit = emptyFile ? 2 : 1;
    for (const file of files.slice(0, limit)) {
      parts.push(`### ${file.label}`);
      parts.push("```");
      const snip = file.snippet.trimEnd();
      parts.push(emptyFile ? snip : snip.slice(0, 220));
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
- Do NOT restate object keys that already appear after {{FILL_HERE}} (e.g. if target is already below, do not suggest another target).
- Do NOT start a method chain with \`.\` (e.g. \`.on\`, \`.map\`, \`.filter\`) when the statement before the cursor already ended with \`;\` — chain before the semicolon, or start a new statement.
- Do NOT invent large new features, whole files, or long refactors.
- Prefer finishing the current statement / line; at most a few short lines.
- When a FOCUS section is present, treat it as the user's intent (e.g. after adding a store, complete a related event in an events block).
- When a FILE BRIEF section is present, treat it as the authoritative micro-research for this path (layer, how it is built, siblings, outline). Obey it over generic guesses.
- When a THIS FILE section is present, treat the filename stem + layer marker as hard constraints: name things from the stem; emit only the layer this filename owns; sibling files show other layers — do not merge layers.
- When an LSP section is present, prefer its signature/types for calls and identifiers at the cursor.
- When PROJECT RULES or RELATED FILES are present, match their naming/style and reuse symbols from those snippets when relevant.
- When PROJECT MAP is present: use it only as style guidance for imports/exports — NEVER paste map skeletons, example paths, or sibling lists into the fill.
- Do NOT invent comments, JSDoc, section headers, markdown fences, or explanatory prose — only emit them if the cursor is already inside a comment the user started (\`//\`, \`/*\`, \`#\`). Prefer real code (bindings, calls, types).
- Do NOT emit English explanations, TODOs, placeholders like \`...\` / \`pass\` / \`FIXME\`, or unrelated imports the file already has.
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
    if (ctx.fileIdentity) {
      context += `Editing: "${ctx.fileIdentity.basename}" (stem=${ctx.fileIdentity.stem}, layer=${ctx.fileIdentity.layerMarker || "plain"})\n`;
    } else if (ctx.filename) {
      context += `Filename: "${ctx.filename}"\n`;
    }
    if (ctx.language) {
      context += `Language: "${ctx.language}"\n`;
    }
    context += formatExtraContext(ctx);
    if (ctx.focus) {
      context += formatFocusBlock(ctx.focus);
    }
    const feedback = String(ctx.recentFillFeedback || "").trim();
    if (feedback) {
      context += `## RECENT TAB OUTCOMES\n${feedback}\n\n`;
    }
    const sameLineSuffix = (ctx.textAfterCursor.split("\n")[0] || "");
    const writingComment = isCursorInsideComment(ctx);
    const emptyFile = isNearlyEmptyFile(ctx);
    const guidance = emptyFile
      ? "EMPTY FILE: emit a short start for THIS filename layer only (imports + first export/component), matching SAME LAYER example style and THIS FILE stem. Usually under 8 lines — not a whole feature dump."
      : sameLineSuffix.length > 0
        ? "Finish ONLY the current line (no newlines). Do not repeat text after {{FILL_HERE}}."
        : "Return a MINIMAL fill (usually under 3 lines, never a whole block/file). Stop at the next natural statement boundary.";

    const suffixKeys = collectNearbyObjectKeys(ctx);
    const suffixKeyNudge =
      !emptyFile && suffixKeys.size > 0
        ? ` Object keys already present near the cursor (do NOT emit them again): ${[
            ...suffixKeys,
          ]
            .slice(0, 12)
            .map((k) => `\`${k}\``)
            .join(", ")}.`
        : "";
    const chainNudge = isAfterTerminatedStatement(ctx)
      ? " The statement before the cursor already ended with `;` — do NOT emit a leading `.method(...)` chain; either the user must chain before `;`, or you start a new statement."
      : "";

    const focusNudge = ctx.focus?.recentBindings.length
      ? " Strongly prefer relating the fill to the FOCUS recent bindings / region."
      : "";
    const fileNudge = ctx.fileBrief
      ? emptyFile
        ? " Obey FILE BRIEF: if it has a Suggested start rewritten to this stem, prefer that shape (imports + first export). SAME LAYER only — never OTHER LAYER bodies."
        : " Obey FILE BRIEF structure/layer; do not switch to a sibling layer."
      : ctx.fileIdentity
        ? emptyFile
          ? ` EMPTY: stem=\`${ctx.fileIdentity.stem}\`, layer=\`${ctx.fileIdentity.layerMarker || "plain"}\`. Copy SAME LAYER structure; rename to this stem; never emit OTHER LAYER code.`
          : ` THIS FILE stem is \`${ctx.fileIdentity.stem}\`, layer \`${ctx.fileIdentity.layerMarker || "plain"}\` — name/code must fit that filename; do not write a sibling layer.`
        : "";
    const relatedNudge =
      (ctx.relatedFiles && ctx.relatedFiles.length > 0) ||
      ctx.projectRules ||
      ctx.projectMap ||
      ctx.fileBrief
        ? emptyFile
          ? " Prefer FILE BRIEF / SAME LAYER as the template; OTHER LAYER is naming-only."
          : " Match FILE BRIEF / PROJECT MAP / RELATED FILES style, but emit only the minimal hole fill — never paste brief/map blocks."
        : "";
    const lspNudge = String(ctx.lsp || "").trim()
      ? " Honor LSP signature/types when filling the call or typed identifier."
      : "";
    const langNudge = languageFillNudge(ctx.language);
    const commentNudge = writingComment
      ? buildCommentFillNudge(ctx)
      : " Do NOT add comments/JSDoc/section banners — code only.";

    const k = Math.max(1, Math.min(3, Math.floor(alternatives) || 1));
    if (k <= 1) {
      return `${context}<QUERY>\n${ctx.textBeforeCursor}{{FILL_HERE}}${ctx.textAfterCursor}\n</QUERY>\nTASK: Fill {{FILL_HERE}} only. ${guidance}${fileNudge}${suffixKeyNudge}${chainNudge}${focusNudge}${relatedNudge}${lspNudge}${langNudge}${commentNudge} Answer with one <COMPLETION>...</COMPLETION> and nothing else.\n<COMPLETION>`;
    }

    return `${context}<QUERY>\n${ctx.textBeforeCursor}{{FILL_HERE}}${ctx.textAfterCursor}\n</QUERY>\nTASK: Fill {{FILL_HERE}} only. ${guidance}${fileNudge}${suffixKeyNudge}${chainNudge}${focusNudge}${relatedNudge}${lspNudge}${langNudge}${commentNudge} Return up to ${k} DISTINCT minimal alternatives as separate closed tags:\n<COMPLETION>…</COMPLETION>\nMost likely first (best match to THIS FILE layer / LSP / FOCUS / RELATED FILES / recent accepted). Each alternative is a full short fill (not a continuation of another). No commentary outside tags.`;
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

/**
 * Remove full and *truncated* COMPLETION/QUERY markup.
 * Models often hit max_tokens mid-`</COMPLETION>`, leaving ghosts like `</COMPLE`.
 */
export function stripCompletionMarkup(text: string): string {
  let out = String(text || "").replace(/\r\n/g, "\n");

  // Complete tags (with or without attributes / whitespace).
  out = out.replace(/<\/?\s*COMPLETION\b[^>]*>/gi, "");
  out = out.replace(/<\/?\s*(?:QUERY|FOCUS)\b[^>]*>/gi, "");

  // Truncated tag fragments anywhere (</C … </COMPLETION, <COMPLE…).
  out = out.replace(/<\/?\s*COMPLET(?:ION)?[A-Za-z]*/gi, "");
  out = out.replace(/<\/?\s*COMPLE[A-Za-z]*/gi, "");
  out = out.replace(/<\/?\s*COMPL[A-Za-z]*/gi, "");
  out = out.replace(/<\/?\s*QUER[A-Za-z]*/gi, "");
  out = out.replace(/<\/?\s*FOCU[A-Za-z]*/gi, "");

  // Dangling `<` / `</` / partial tag at end of string (common after hard caps).
  out = out.replace(/<\/?[A-Za-z][^>\n]*$/g, "");
  out = out.replace(/<\s*$/g, "");

  // Orphan `>` left from a stripped tag on its own line.
  out = out.replace(/^\s*>\s*$/gm, "");

  return out;
}

/** Strip optional COMPLETION XML wrapper from model output (TabCoder). */
export function processHoleFillResponse(responseText: string): string {
  const closed = /<COMPLETION>([\s\S]*?)<\/COMPLETION>/i.exec(responseText);
  if (closed) {
    return stripCompletionMarkup(closed[1]);
  }
  // Open tag without close — take after the tag, strip markup leftovers.
  const open = /<COMPLETION>([\s\S]*)/i.exec(responseText);
  if (open) {
    return stripCompletionMarkup(open[1]).trimEnd();
  }
  return stripCompletionMarkup(responseText);
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
  // Match shorter lines too (e.g. `target: $x,`).
  const lines = suffix.split("\n").filter((l) => l.trim().length >= 4);
  for (const line of lines.slice(0, 10)) {
    const needle = line.trim();
    const idx = out.indexOf(needle);
    if (idx >= 0) {
      const cut = out.slice(0, idx).replace(/\s+$/, "");
      if (cut.length > 0 && cut.length < out.length) {
        return cut;
      }
      if (idx === 0) {
        return "";
      }
    }
    // Fill is only the property key that already appears below (`target:` vs `target: $fileStore`).
    const key = objectKeyFromLine(needle);
    if (key) {
      const fillKey = objectKeyFromLine(out.trim()) || objectKeyFromLine(out.trim() + ":");
      if (fillKey && fillKey === key) {
        return "";
      }
    }
  }
  return out;
}

const OBJECT_KEY_LINE_RE =
  /^\s*(?:["']([\w$]+)["']|([A-Za-z_$][\w$]*))\s*:/;

function objectKeyFromLine(line: string): string | undefined {
  const m = OBJECT_KEY_LINE_RE.exec(String(line || ""));
  if (!m) {
    return undefined;
  }
  return (m[1] || m[2] || "").toLowerCase();
}

/** Slice of prefix from the nearest unmatched `{` (current object literal). */
function prefixOpenObjectSlice(before: string): string {
  const text = String(before || "");
  let depth = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "}") {
      depth++;
    } else if (ch === "{") {
      if (depth === 0) {
        return text.slice(i);
      }
      depth--;
    }
  }
  return text.slice(-400);
}

/** Property keys already present in the object around the caret. */
export function collectNearbyObjectKeys(ctx: AutoCompleteContext): Set<string> {
  const keys = new Set<string>();
  const addFrom = (block: string, stopAtClose: boolean) => {
    let depth = 0;
    for (const line of block.split("\n").slice(0, 50)) {
      const key = objectKeyFromLine(line);
      if (key && depth === 0) {
        keys.add(key);
      }
      for (const ch of line) {
        if (ch === "{") {
          depth++;
        } else if (ch === "}") {
          depth--;
          if (stopAtClose && depth < 0) {
            return;
          }
        }
      }
      if (stopAtClose && depth < 0) {
        return;
      }
    }
  };

  // Prefix: only inside the open object.
  const open = prefixOpenObjectSlice(ctx.textBeforeCursor || "");
  // Skip the opening `{` line's outer depth by scanning after first `{`.
  const afterBrace = open.includes("{") ? open.slice(open.indexOf("{") + 1) : open;
  addFrom(afterBrace, false);

  // Suffix: until this object closes.
  addFrom(ctx.textAfterCursor || "", true);
  return keys;
}

/** Keys the fill is trying to introduce (`target:` / `target: foo`). */
export function fillObjectKeys(fill: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of String(fill || "").split("\n")) {
    const key = objectKeyFromLine(line);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  if (out.length === 0) {
    // Bare `target` or `target:` on its own.
    const bare = /^\s*([A-Za-z_$][\w$]*)\s*:?\s*$/.exec(String(fill || "").trim());
    if (bare?.[1]) {
      out.push(bare[1].toLowerCase());
    }
  }
  return out;
}

/**
 * True when the fill re-declares an object key that already exists above/below
 * the caret in the same literal (e.g. suggesting `target:` while `target: $x` is below).
 */
export function duplicatesExistingObjectKey(
  fill: string,
  ctx: AutoCompleteContext
): boolean {
  const existing = collectNearbyObjectKeys(ctx);
  if (existing.size === 0) {
    return false;
  }
  for (const key of fillObjectKeys(fill)) {
    if (existing.has(key)) {
      return true;
    }
  }
  return false;
}

function applyHardCaps(response: string, midLine: boolean, emptyFile: boolean): string {
  let out = response.replace(/\r\n/g, "\n");
  const maxLines = emptyFile ? MAX_COMPLETION_LINES : MID_FILE_COMPLETION_LINES;
  const maxChars = emptyFile ? MAX_COMPLETION_CHARS : MID_FILE_COMPLETION_CHARS;
  if (midLine) {
    out = out.split("\n")[0] || "";
  } else {
    const lines = out.split("\n");
    if (lines.length > maxLines) {
      out = lines.slice(0, maxLines).join("\n");
    }
  }
  if (out.length > maxChars) {
    out = out.slice(0, maxChars);
    // Avoid cutting mid-identifier when possible.
    const soft = out.replace(/\s+\S*$/, "");
    if (soft.length >= Math.floor(maxChars * 0.5)) {
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
 * True when the caret sits after a statement that already ended with `;`
 * (so a leading `.on(...)` chain would be outside the call).
 */
export function isAfterTerminatedStatement(ctx: AutoCompleteContext): boolean {
  const before = String(ctx.textBeforeCursor || "");
  const line = before.split("\n").pop() || "";
  const trimmedEnd = line.replace(/\s+$/, "");
  if (/;\s*$/.test(trimmedEnd)) {
    return true;
  }
  // Cursor on a fresh line after a line that ended with `;`
  if (/^\s*$/.test(line)) {
    const lines = before.split("\n");
    for (let i = lines.length - 2; i >= 0; i--) {
      const prev = (lines[i] || "").replace(/\s+$/, "");
      if (!prev || /^\s*\/\//.test(prev)) {
        continue;
      }
      return /;\s*$/.test(prev);
    }
  }
  return false;
}

/**
 * Fill starts a method chain (`.on`, `.map`, …) where chaining is invalid.
 */
export function isDanglingMethodChainFill(
  fill: string,
  ctx: AutoCompleteContext
): boolean {
  const t = String(fill || "").trimStart();
  if (!/^\./.test(t)) {
    return false;
  }
  return isAfterTerminatedStatement(ctx);
}

/**
 * Reject completions that look like prompt leakage, prose, or map dumps.
 */
export function isJunkCompletion(
  text: string,
  ctx: AutoCompleteContext
): boolean {
  const raw = String(text || "");
  const t = raw.trim();
  if (!t) {
    return true;
  }

  // `.on(...)` after `createStore('');` — chain belongs on the call, not after `;`.
  if (isDanglingMethodChainFill(raw, ctx)) {
    return true;
  }

  // Prompt / map leakage / truncated XML tags.
  if (
    /PROJECT MAP|FILE BRIEF|RELATED FILES|FILE ROLE|For this file shape|Siblings in folder|Example:\s+\S+\.(ts|tsx|js|jsx)/i.test(
      t
    ) ||
    /<\/?\s*(?:COMPLETION|QUERY|FOCUS|COMPLE)/i.test(t) ||
    /^```/.test(t) ||
    /\n```/.test(t)
  ) {
    return true;
  }

  // English prose / assistant chatter (not code).
  if (
    /^(here(?:'s| is)|this (?:function|code|file)|you (?:can|should)|consider|note that|the following)\b/i.test(
      t
    )
  ) {
    return true;
  }
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const proseLines = lines.filter(
      (l) =>
        /^[A-ZА-Я]/.test(l) &&
        /[.!?]$/.test(l) &&
        !/[{}();=<>]|=>|\b(?:const|let|var|function|class|import|export|return|if|for|await)\b/.test(
          l
        )
    );
    if (proseLines.length >= Math.ceil(lines.length * 0.6)) {
      return true;
    }
  }

  // Placeholder junk.
  if (
    /^(?:\.\.\.|…|pass|TODO|FIXME|TBD|implement me|your code here)\s*;?$/i.test(
      t
    )
  ) {
    return true;
  }

  // Whole-file dump smell: many top-level imports while cursor isn't at imports.
  const importLines = lines.filter((l) => /^import\b/.test(l)).length;
  if (importLines >= 3 && !/^\s*import\b/m.test(ctx.currentLineText || "")) {
    const before = ctx.textBeforeCursor || "";
    const atTop =
      before.trim().length < 40 ||
      /(?:^|\n)\s*$/.test(before.slice(-20));
    // Allow import fills near top of file.
    if (!atTop || before.split("\n").length > 30) {
      return true;
    }
  }

  // Pasting a long skeleton-like block (many exports) as one fill.
  const exportLines = lines.filter((l) => /^export\b/.test(l)).length;
  if (exportLines >= 3 && lines.length >= 6) {
    return true;
  }

  if (failsSyntaxPostFilter(raw, ctx)) {
    return true;
  }

  return false;
}

/** Human-readable reject reason for Output diagnostics (or undefined if ok). */
export function completionRejectReason(
  text: string,
  ctx: AutoCompleteContext
): string | undefined {
  if (isJunkCompletion(text, ctx)) {
    const syn = syntaxRejectReason(text, ctx);
    if (syn) {
      return syn;
    }
    return "junk";
  }
  if (duplicatesExistingObjectKey(text, ctx)) {
    return "duplicate-object-key";
  }
  return undefined;
}

/**
 * Clean model output into insertable ghost text.
 * - strip fences / echoed line
 * - drop overlap with suffix after cursor
 * - hard caps so Tab never dumps a whole file
 * - drop unsolicited comments / junk
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
  const emptyFile = isNearlyEmptyFile(ctx);
  if (emptyFile && !midLine) {
    // Allow a short file header (imports + first export), still capped.
    const lines = response.replace(/\r\n/g, "\n").split("\n");
    if (lines.length > 8) {
      response = lines.slice(0, 8).join("\n");
    }
    if (response.length > 420) {
      response = response.slice(0, 420).replace(/\s+\S*$/, "");
    }
  } else {
    response = applyHardCaps(response, midLine, false);
  }
  // Caps can cut mid-`</COMPLETION>` — strip leftovers again.
  response = stripCompletionMarkup(response);

  // Suggesting `target:` when `target: $fileStore` is already below — drop.
  if (duplicatesExistingObjectKey(response, ctx)) {
    return "";
  }

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

  if (isJunkCompletion(response, ctx)) {
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
