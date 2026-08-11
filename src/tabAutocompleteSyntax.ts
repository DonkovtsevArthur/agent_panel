/**
 * Syntax post-filters + cheap local fills (no LLM) for Tab autocomplete.
 */

/** Minimal caret context (avoids circular import with holeFiller). */
export type SyntaxContext = {
  textBeforeCursor: string;
  textAfterCursor?: string;
  currentLineText?: string;
  language?: string;
};

/** Languages where JSX/TSX tags are expected. */
export function languageAllowsJsx(language?: string): boolean {
  const lang = String(language || "").toLowerCase();
  return (
    lang === "typescriptreact" ||
    lang === "javascriptreact" ||
    lang === "jsx" ||
    lang === "tsx" ||
    lang === "vue" ||
    lang === "svelte" ||
    lang === "html" ||
    lang === "xml"
  );
}

/**
 * Best-effort scan ignoring strings/comments: net open bracket counts.
 * Positive = more opens than closes.
 */
export function bracketDelta(text: string): {
  paren: number;
  bracket: number;
  brace: number;
} {
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inTemplate) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === "`") {
        inTemplate = false;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      continue;
    }
    if (ch === "(") {
      paren++;
    } else if (ch === ")") {
      paren--;
    } else if (ch === "[") {
      bracket++;
    } else if (ch === "]") {
      bracket--;
    } else if (ch === "{") {
      brace++;
    } else if (ch === "}") {
      brace--;
    }
  }
  return { paren, bracket, brace };
}

/** True if fill opens a JSX/HTML tag in a non-JSX language. */
export function isJsxInNonJsxLanguage(
  fill: string,
  language?: string
): boolean {
  if (languageAllowsJsx(language)) {
    return false;
  }
  const t = String(fill || "").trimStart();
  // `<Foo`, `</div>`, `<>` — but not generics like `Array<string>` mid-expression
  // when preceded by identifier. Leading `<` on a new statement is the smell.
  if (/^<[A-Za-z/!]/.test(t) || /^<>/.test(t)) {
    return true;
  }
  if (/\n\s*<[A-Za-z/!]/.test(t)) {
    return true;
  }
  return false;
}

/**
 * Fill would break an unfinished token: prefix ends mid-ident and fill
 * restarts a different identifier / keyword.
 */
export function breaksPartialToken(
  fill: string,
  ctx: SyntaxContext
): boolean {
  const before = String(ctx.textBeforeCursor || "");
  const m = /([A-Za-z_$][\w$]*)$/.exec(before);
  if (!m?.[1]) {
    return false;
  }
  const partial = m[1];
  const t = String(fill || "");
  if (!t) {
    return false;
  }
  // Completing the same identifier is fine: `cre` + `ateStore`
  if (/^[A-Za-z0-9_$]/.test(t) && (partial + t).startsWith(partial)) {
    // If fill starts a brand-new word that doesn't continue partial — e.g.
    // typed `create` and fill is `Store` without connecting → actually OK.
    // Bad: typed `createSt` and fill is `createStore` (echo full token).
    if (t.startsWith(partial) && t.length > partial.length) {
      return true;
    }
  }
  return false;
}

/**
 * Fill introduces more unmatched closers than the prefix opened, or
 * closes brackets that were already balanced at the caret.
 */
export function worsensBracketBalance(
  fill: string,
  ctx: SyntaxContext
): boolean {
  const before = String(ctx.textBeforeCursor || "");
  const after = String(ctx.textAfterCursor || "");
  const beforeDelta = bracketDelta(before);
  const fillDelta = bracketDelta(fill);
  const afterDelta = bracketDelta(after);

  // If prefix already balanced (or closed) and fill starts with a closer — bad.
  const trimmed = fill.trimStart();
  if (
    (trimmed.startsWith(")") && beforeDelta.paren <= 0) ||
    (trimmed.startsWith("]") && beforeDelta.bracket <= 0) ||
    (trimmed.startsWith("}") && beforeDelta.brace <= 0)
  ) {
    return true;
  }

  // Combined document with fill shouldn't go deeply negative relative to
  // existing after-cursor closers (those already close prefix opens).
  const combined = {
    paren: beforeDelta.paren + fillDelta.paren + afterDelta.paren,
    bracket: beforeDelta.bracket + fillDelta.bracket + afterDelta.bracket,
    brace: beforeDelta.brace + fillDelta.brace + afterDelta.brace,
  };
  // Allow mild imbalance (async streaming / mid-line); reject large overshoot.
  if (combined.paren < -1 || combined.bracket < -1 || combined.brace < -1) {
    return true;
  }
  // Fill alone shouldn't dump many unmatched closers.
  if (fillDelta.paren < -2 || fillDelta.bracket < -2 || fillDelta.brace < -2) {
    return true;
  }
  return false;
}

/** Unclosed string in fill while caret is not already inside a string. */
export function leavesUnclosedString(
  fill: string,
  ctx: SyntaxContext
): boolean {
  const before = String(ctx.textBeforeCursor || "");
  if (isInsideString(before)) {
    return false;
  }
  return isInsideString(fill);
}

function isInsideString(text: string): boolean {
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inSingle) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inTemplate) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === "`") {
        inTemplate = false;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      if (ch === "'") {
        inSingle = true;
      } else if (ch === '"') {
        inDouble = true;
      } else {
        inTemplate = true;
      }
    }
  }
  return inSingle || inDouble || inTemplate;
}

/**
 * First syntax/junk-adjacent reason, or undefined if the fill looks ok.
 */
function isAfterTerminatedStatement(ctx: SyntaxContext): boolean {
  const before = String(ctx.textBeforeCursor || "");
  const line = before.split("\n").pop() || "";
  const trimmedEnd = line.replace(/\s+$/, "");
  if (/;\s*$/.test(trimmedEnd)) {
    return true;
  }
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

export function syntaxRejectReason(
  fill: string,
  ctx: SyntaxContext
): string | undefined {
  const raw = String(fill || "");
  if (!raw.trim()) {
    return "empty";
  }
  if (/^\./.test(raw.trimStart()) && isAfterTerminatedStatement(ctx)) {
    return "dangling-chain-after-semicolon";
  }
  if (isJsxInNonJsxLanguage(raw, ctx.language)) {
    return "jsx-in-non-jsx-language";
  }
  if (breaksPartialToken(raw, ctx)) {
    return "echoes-partial-token";
  }
  if (worsensBracketBalance(raw, ctx)) {
    return "bracket-balance";
  }
  if (leavesUnclosedString(raw, ctx) && raw.trim().length > 1) {
    // Single-character quote close is handled as a local fill, not reject.
    if (!/^['"`]$/.test(raw.trim())) {
      return "unclosed-string";
    }
  }
  return undefined;
}

export function failsSyntaxPostFilter(
  fill: string,
  ctx: SyntaxContext
): boolean {
  return Boolean(syntaxRejectReason(fill, ctx));
}

/**
 * Mid-stream / early-publish: raw model buffer already looks like junk.
 */
export function streamLooksLikeJunk(rawSoFar: string): boolean {
  const t = String(rawSoFar || "");
  if (
    /PROJECT MAP|FILE BRIEF|RELATED FILES|FILE ROLE|For this file shape/i.test(
      t
    )
  ) {
    return true;
  }
  // Truncated / leaked tags without a proper completion body.
  if (/<\/?\s*COMPLE(?!TION\b)/i.test(t)) {
    return true;
  }
  if (/^```/m.test(t) && !/<COMPLETION>/i.test(t)) {
    return true;
  }
  // Duplicate object key smell while streaming alternatives.
  const targets = t.match(/\btarget\s*:/g);
  if (targets && targets.length >= 3) {
    return true;
  }
  if (
    /^(here(?:'s| is)|this (?:function|code|file)|you (?:can|should))\b/im.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

/**
 * True when the stream buffer has at least one closed COMPLETION worth showing.
 */
export function streamHasClosedCompletion(rawSoFar: string): boolean {
  return /<COMPLETION>[\s\S]*?<\/COMPLETION>/i.test(String(rawSoFar || ""));
}

export type LocalCheapFill = {
  text: string;
  reason: string;
};

/**
 * High-precision local completions — only when almost certain.
 */
export function findLocalCheapFill(
  textBeforeCursor: string,
  textAfterCursor: string,
  language?: string
): LocalCheapFill | undefined {
  const before = String(textBeforeCursor || "");
  const after = String(textAfterCursor || "");
  const lineBefore = before.split("\n").pop() || "";
  const lineAfter = after.split("\n")[0] || "";

  // Inside an unclosed string on this line → close with matching quote.
  if (isInsideString(before) && !isInsideString(before + (lineAfter[0] || ""))) {
    // Determine which quote is open by scanning before.
    const open = openStringQuote(before);
    if (open && !lineAfter.startsWith(open)) {
      return { text: open, reason: `close-string-${open}` };
    }
  }

  // Single unmatched opener on the current statement → matching closer.
  // Only when lineAfter doesn't already start with that closer.
  const delta = bracketDelta(before);
  const afterDelta = bracketDelta(after);
  // Prefer closing what the prefix opened and the suffix doesn't already close.
  const needParen = delta.paren - Math.max(0, -afterDelta.paren);
  const needBracket = delta.bracket - Math.max(0, -afterDelta.bracket);
  const needBrace = delta.brace - Math.max(0, -afterDelta.brace);

  if (
    needParen === 1 &&
    needBracket === 0 &&
    needBrace === 0 &&
    !/^\s*\)/.test(lineAfter) &&
    /[(\w$\]"']\s*$/.test(lineBefore)
  ) {
    // Avoid inserting `)` right after `(` empty call if user is still typing args —
    // only when line looks finished-ish: ends with ident/literal.
    if (/(\w|["'`)\]])\s*$/.test(lineBefore) && !/\(\s*$/.test(lineBefore)) {
      return { text: ")", reason: "close-paren" };
    }
  }
  if (
    needBracket === 1 &&
    needParen === 0 &&
    needBrace === 0 &&
    !/^\s*\]/.test(lineAfter) &&
    /[\[\w$\]"']\s*$/.test(lineBefore) &&
    !/\[\s*$/.test(lineBefore)
  ) {
    return { text: "]", reason: "close-bracket" };
  }

  // Finish a known binding continuation: prefix ends with partial of a
  // recent-looking create* call — too risky; skip.

  void language;
  return undefined;
}

function openStringQuote(text: string): "'" | '"' | "`" | undefined {
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inSingle) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inTemplate) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === "`") {
        inTemplate = false;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
    } else if (ch === '"') {
      inDouble = true;
    } else if (ch === "`") {
      inTemplate = true;
    }
  }
  if (inSingle) {
    return "'";
  }
  if (inDouble) {
    return '"';
  }
  if (inTemplate) {
    return "`";
  }
  return undefined;
}

/** Slice ghost text for partial accept. */
export function slicePartialAccept(
  full: string,
  mode: "line" | "statement"
): string {
  const text = String(full || "");
  if (!text) {
    return "";
  }
  if (mode === "line") {
    const nl = text.indexOf("\n");
    return nl >= 0 ? text.slice(0, nl + 1) : text;
  }
  // statement: through first `;` (inclusive) or first line if none.
  const semi = text.indexOf(";");
  if (semi >= 0) {
    let end = semi + 1;
    if (text[end] === "\n") {
      end++;
    }
    return text.slice(0, end);
  }
  const nl = text.indexOf("\n");
  return nl >= 0 ? text.slice(0, nl + 1) : text;
}
