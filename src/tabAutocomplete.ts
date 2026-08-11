/**
 * Inline Tab autocomplete for Harbor Agents.
 *
 * UX (debounce, skip filters, accept tracking) adapted from TabCoder
 * `vendor/tabcoder` (Apache-2.0). LLM calls use Harbor openai-compatible
 * client + Settings providers — not TabCoder AI SDK / profiles.
 */

import * as path from "path";
import * as vscode from "vscode";
import {
  getConfig,
  getEnabledModels,
  resolveModelEndpoint,
} from "./config";
import { getOpenAICompatibleClient } from "./openaiClient";
import {
  DefaultHoleFiller,
  buildTabFocusContext,
  refineCompletionAlternatives,
  type AutoCompleteContext,
} from "./tabAutocompleteHoleFiller";
import { buildTabExtraContext, neighborPathCandidates } from "./tabAutocompleteExtraContext";
import {
  pathMatchesAnyExcludeGlob,
} from "./tabAutocompleteExclude";
import { buildTabLspContext } from "./tabAutocompleteLspContext";
import {
  classifyAcceptedText,
  findNextEditTarget,
  type NextEditTarget,
} from "./tabAutocompleteNextEdit";
import {
  languageDebounceScale,
  languageMaxTokens,
} from "./tabAutocompleteLanguage";
import {
  createTabStatsStore,
  formatRecentFillFeedback,
  type TabStatsStore,
} from "./tabAutocompleteStats";
import {
  ensureTabProjectMap,
  getTabProjectMapDigest,
  initTabProjectMap,
  scheduleTabProjectMapBuild,
  setTabProjectMapLogger,
} from "./tabAutocompleteProjectMap";
import {
  ensureTabFileBrief,
  getCachedTabFileBrief,
  setTabFileBriefLogger,
  startTabFileBriefTracking,
} from "./tabAutocompleteFileBrief";
import * as fs from "fs/promises";

const COMPLETION_ACCEPTED_CMD = "agentPanel.tabAutocomplete.completionAccepted";
const STATUS_CLICK_CMD = "agentPanel.tabAutocomplete.statusBarClicked";
const DELETE_ORPHAN_LINE_CMD = "agentPanel.tabAutocomplete.deleteOrphanLine";
const SHOW_SUGGESTION_CMD = "agentPanel.tabAutocomplete.showSuggestion";
const JUMP_NEXT_EDIT_CMD = "agentPanel.tabAutocomplete.jumpNextEdit";
const DISMISS_NEXT_EDIT_CMD = "agentPanel.tabAutocomplete.dismissNextEdit";
/** Context key for Tab keybinding while an orphan delete chip is active. */
const ORPHAN_ACTIVE_CTX = "agentPanel.tabAutocomplete.orphanActive";
/** Context key for Tab → jump to next-edit target. */
const NEXT_EDIT_ACTIVE_CTX = "agentPanel.tabAutocomplete.nextEditActive";
const MAX_COMPLETION_TOKENS = 72;
/** Keep prompts small for corporate gateways / latency. */
const MAX_PREFIX_CHARS = 3_500;
const MAX_SUFFIX_CHARS = 800;
const CACHE_LIMIT = 40;
const RECENT_DELETE_TTL_MS = 90_000;
/** How long a newly typed binding stays “in focus” for Tab (store → event). */
const RECENT_ADD_TTL_MS = 180_000;
/** Pause Tab LLM calls after gateway quota / server failures. */
const COOLDOWN_QUOTA_MS = 120_000;
const COOLDOWN_SERVER_MS = 45_000;
const COOLDOWN_OTHER_MS = 20_000;
/** Pending next-edit chip lifetime after Accept. */
const NEXT_EDIT_TTL_MS = 30_000;
/** Clear next-edit if the caret moves this many lines away. */
const NEXT_EDIT_DISMISS_LINES = 20;

const JS_RESERVED = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "async",
  "await",
  "from",
  "of",
  "as",
  "type",
  "interface",
  "enum",
  "implements",
  "private",
  "public",
  "protected",
  "readonly",
  "static",
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `$` is a non-word char in JS regex, so `\b$store\b` never matches.
 * Use explicit edges instead (Effector-style `$store` names).
 */
function identifierEdgePattern(id: string): string {
  const escaped = escapeRegExp(id);
  return `(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`;
}

/** Binding / import names from deleted code — not every token (createStore, …). */
function extractDeletedBindingNames(text: string): string[] {
  const out: string[] = [];
  const push = (id: string | undefined) => {
    if (!id || id.length < 2 || JS_RESERVED.has(id)) {
      return;
    }
    out.push(id);
  };

  const decl =
    /(?:^|[\n;{}])\s*(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(text))) {
    push(m[1]);
  }

  const namedImport = /import\s*\{([^}]+)\}/g;
  while ((m = namedImport.exec(text))) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/i)[0].trim();
      push(name);
    }
  }

  const defImport = /import\s+([A-Za-z_$][\w$]*)\s+from\b/g;
  while ((m = defImport.exec(text))) {
    push(m[1]);
  }

  return out;
}

function isIncompleteDeclarationLine(lineText: string): boolean {
  const t = lineText.trim();
  if (!t) {
    return false;
  }
  // Still typing: `const $x =` / `const $x` / `let x =`
  return /^(export\s+)?(const|let|var)\s+[A-Za-z_$][\w$]*(\s*=\s*)?$/.test(t);
}

function countReferencesOutsideDefinition(
  document: vscode.TextDocument,
  id: string
): number {
  let n = 0;
  for (let i = 0; i < document.lineCount; i++) {
    const text = document.lineAt(i).text;
    if (lineDefinesSymbol(text, id)) {
      continue;
    }
    if (lineReferencesSymbol(text, id)) {
      n++;
    }
  }
  return n;
}

/**
 * Cursor in a comma-separated list (prev item ends with `,`), often right
 * before `]` / `)` / `}` — where the model otherwise suggests closing brackets.
 */
function isCommaListContinuationContext(
  document: vscode.TextDocument,
  position: vscode.Position
): boolean {
  const line = document.lineAt(position.line).text;
  if (line.slice(position.character).trim().length > 0) {
    return false;
  }
  const before = line.slice(0, position.character);
  if (/[^\sA-Za-z0-9_$]/.test(before)) {
    return false;
  }

  let prev = position.line - 1;
  while (prev >= 0 && isBlankOrCommentLine(document.lineAt(prev).text)) {
    prev--;
  }
  if (prev < 0) {
    return false;
  }
  const prevTrim = document.lineAt(prev).text.trimEnd();
  if (!prevTrim.endsWith(",")) {
    return false;
  }

  const endLine = Math.min(position.line + 8, document.lineCount - 1);
  const suffixHead = document
    .getText(
      new vscode.Range(
        position,
        new vscode.Position(endLine, document.lineAt(endLine).text.length)
      )
    )
    .trimStart();
  if (/^[\]\)}]/.test(suffixHead)) {
    return true;
  }
  // Identifier / $store list item on the previous line.
  return /^(?:[A-Za-z_$][\w$]*|\$[A-Za-z_][\w$]*)\s*,\s*$/.test(
    prevTrim.trim()
  );
}

function identifierPrefixAt(
  lineText: string,
  character: number
): { start: number; prefix: string } {
  let start = character;
  while (start > 0 && /[A-Za-z0-9_$]/.test(lineText.charAt(start - 1))) {
    start--;
  }
  return { start, prefix: lineText.slice(start, character) };
}

/**
 * If the user just declared a binding that is still unused, and the cursor is
 * in a comma list, prefer inserting that name over closing `],` / `})`.
 * Not limited to `$` stores — any const/let/var binding.
 */
function findUnusedBindingListFill(
  document: vscode.TextDocument,
  position: vscode.Position
): { text: string; range: vscode.Range } | undefined {
  if (!isCommaListContinuationContext(document, position)) {
    return undefined;
  }

  const line = document.lineAt(position.line).text;
  const { start: prefixStart, prefix } = identifierPrefixAt(
    line,
    position.character
  );

  const scanFrom = Math.max(0, position.line - 120);
  let best: { name: string; line: number } | undefined;

  for (let i = position.line - 1; i >= scanFrom; i--) {
    const text = document.lineAt(i).text;
    const name = declaredBindingName(text);
    if (!name || name.length < 2 || JS_RESERVED.has(name)) {
      continue;
    }
    if (!text.includes("=")) {
      continue;
    }
    if (/=\s*$/.test(text.trim())) {
      const next =
        i + 1 < document.lineCount ? document.lineAt(i + 1).text : "";
      if (!next.trim() || declaredBindingName(next)) {
        continue;
      }
    }
    if (prefix && !name.startsWith(prefix)) {
      continue;
    }
    if (countReferencesOutsideDefinition(document, name) > 0) {
      continue;
    }
    best = { name, line: i };
    break; // closest unused declaration above the cursor
  }

  if (!best) {
    return undefined;
  }

  const insert = prefix ? best.name.slice(prefix.length) + "," : best.name + ",";
  if (!insert || insert === ",") {
    return undefined;
  }

  return {
    text: insert,
    range: new vscode.Range(
      position.line,
      prefix ? prefixStart : position.character,
      position.line,
      position.character
    ),
  };
}

function isChainContinuationLine(lineText: string): boolean {
  return /^\s*\./.test(lineText);
}

function isBlankOrCommentLine(lineText: string): boolean {
  const t = lineText.trim();
  return !t || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function isLikelyRemovableDeclarationLine(lineText: string): boolean {
  const trimmed = lineText.trim();
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) {
    return false;
  }
  if (trimmed.startsWith("export *")) {
    return false;
  }
  if (/^(export\s+)?(const|let|var)\s+\S+/.test(trimmed)) {
    return (trimmed.match(/;/g) || []).length <= 1;
  }
  if (/^import\s/.test(trimmed)) {
    return true;
  }
  if (isChainContinuationLine(lineText)) {
    return true;
  }
  // e.g. `$store.on(deletedEvent, …)` left after removing the event.
  if (/^[A-Za-z_$][\w$]*\s*\./.test(trimmed)) {
    return true;
  }
  return false;
}

function importNamesOnLine(lineText: string): string[] {
  const trimmed = lineText.trim();
  const named = /import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/.exec(trimmed);
  if (named) {
    return named[1]
      .split(",")
      .map((p) => p.trim().split(/\s+as\s+/i)[0].trim())
      .filter(Boolean);
  }
  const def = /import\s+([A-Za-z_$][\w$]*)\s+from\s*['"][^'"]+['"]/.exec(trimmed);
  if (def?.[1]) {
    return [def[1]];
  }
  return [];
}

/** True when every imported name is in `missingIds` (safe to delete the import). */
function importLineOnlyForMissingIds(
  lineText: string,
  missingIds: Set<string>
): boolean {
  const names = importNamesOnLine(lineText);
  return names.length > 0 && names.every((n) => missingIds.has(n));
}

function importLineOnlyForSymbol(lineText: string, id: string): boolean {
  return importLineOnlyForMissingIds(lineText, new Set([id]));
}

function isEmptyStructuralLine(lineText: string): boolean {
  const t = lineText.trim();
  return t === "{" || t === "}" || t === "};" || t === "}," || t === "();";
}

function lineReferencesSymbol(lineText: string, id: string): boolean {
  return new RegExp(identifierEdgePattern(id)).test(lineText);
}

function lineDefinesSymbol(lineText: string, id: string): boolean {
  return new RegExp(
    String.raw`^\s*(export\s+)?(const|let|var|function|class)\s+${identifierEdgePattern(id)}`
  ).test(lineText);
}

function declaredBindingName(lineText: string): string | undefined {
  const m = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(
    lineText
  );
  return m?.[1];
}

function symbolHasDefinition(
  document: vscode.TextDocument,
  name: string
): boolean {
  const def = new RegExp(
    String.raw`(?:^|[\n;{}])\s*(?:export\s+)?(?:const|let|var|function|class)\s+${identifierEdgePattern(name)}`,
    "m"
  );
  return def.test(document.getText());
}

function parseMissingNameFromDiagnostic(message: string): string | undefined {
  const m =
    /cannot find name ['"]([^'"]+)['"]/i.exec(message) ||
    /['"]([^'"]+)['"]\s+is not defined/i.exec(message) ||
    /Cannot find name ['"]([^'"]+)['"]/i.exec(message) ||
    /Не удается найти имя ['"]([^'"]+)['"]/i.exec(message) ||
    /не удаётся найти имя ['"]([^'"]+)['"]/i.exec(message);
  return m?.[1];
}

/**
 * Orphan delete is only for leftovers after a recent delete — not for every
 * "Cannot find name" while the user is still typing a new identifier.
 * Prefer linter diagnostics ∩ recently-deleted bindings; fall back to leftover
 * refs only when the line is a removable leftover (not an incomplete decl).
 */
function collectMissingSymbols(
  document: vscode.TextDocument,
  tracker: RecentDeletionTracker
): Map<number, Set<string>> {
  const byLine = new Map<number, Set<string>>();
  const add = (line: number, id: string) => {
    let set = byLine.get(line);
    if (!set) {
      set = new Set();
      byLine.set(line, set);
    }
    set.add(id);
  };

  const recentlyDeleted = tracker
    .recentlyDeletedIds()
    .filter((id) => !symbolHasDefinition(document, id));
  if (recentlyDeleted.length === 0) {
    return byLine;
  }
  const recentlyDeletedSet = new Set(recentlyDeleted);

  let diagnosticHits = 0;
  for (const d of vscode.languages.getDiagnostics(document.uri)) {
    if (d.severity !== vscode.DiagnosticSeverity.Error) {
      continue;
    }
    const id = parseMissingNameFromDiagnostic(d.message || "");
    if (!id || !recentlyDeletedSet.has(id)) {
      continue;
    }
    diagnosticHits++;
    add(d.range.start.line, id);
  }

  // Always mark leftover imports for recently deleted bindings (even if
  // diagnostics already flagged other lines).
  for (const id of recentlyDeleted) {
    for (let i = 0; i < document.lineCount; i++) {
      const text = document.lineAt(i).text;
      if (!/^import\s/.test(text.trim())) {
        continue;
      }
      if (importLineOnlyForMissingIds(text, recentlyDeletedSet)) {
        add(i, id);
      } else if (importLineOnlyForSymbol(text, id)) {
        add(i, id);
      }
    }
  }

  // Fallback when diagnostics lag: leftover refs to a recently deleted binding.
  // Skip incomplete declarations the user is still typing.
  if (diagnosticHits === 0) {
    for (const id of recentlyDeleted) {
      for (let i = 0; i < document.lineCount; i++) {
        const text = document.lineAt(i).text;
        if (isIncompleteDeclarationLine(text) || lineDefinesSymbol(text, id)) {
          continue;
        }
        if (/^import\s/.test(text.trim())) {
          continue; // already handled above
        }
        if (lineReferencesSymbol(text, id)) {
          add(i, id);
        }
      }
    }
  }

  return byLine;
}

function isOrphanCandidateLine(
  document: vscode.TextDocument,
  lineNo: number,
  missingIds: Set<string>,
  recentlyAdded?: Set<string>
): boolean {
  const text = document.lineAt(lineNo).text;
  if (isBlankOrCommentLine(text)) {
    return false;
  }
  // Never suggest deleting a declaration the user is still typing.
  if (isIncompleteDeclarationLine(text)) {
    return false;
  }
  const binding = declaredBindingName(text);
  // User just introduced this binding — not an orphan leftover.
  if (binding && recentlyAdded?.has(binding)) {
    return false;
  }
  if (!isLikelyRemovableDeclarationLine(text) && !isChainContinuationLine(text)) {
    if (!isEmptyStructuralLine(text)) {
      return false;
    }
  }
  if (isEmptyStructuralLine(text)) {
    return true;
  }
  if (/^import\s/.test(text.trim())) {
    return importLineOnlyForMissingIds(text, missingIds);
  }
  for (const id of missingIds) {
    if (lineDefinesSymbol(text, id)) {
      continue;
    }
    if (!lineReferencesSymbol(text, id)) {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * Expand a seed orphan line into a contiguous related block:
 * statement chains (.on/.map), adjacent related declarations, blank gaps of 1 line.
 */
function expandOrphanBlock(
  document: vscode.TextDocument,
  seedLine: number,
  missingIds: Set<string>,
  recentlyAdded?: Set<string>
): { start: number; end: number } {
  let start = seedLine;
  let end = seedLine;

  const lineOk = (n: number) => {
    if (n < 0 || n >= document.lineCount) {
      return false;
    }
    const text = document.lineAt(n).text;
    if (isBlankOrCommentLine(text)) {
      return true;
    }
    const binding = declaredBindingName(text);
    if (binding && recentlyAdded?.has(binding)) {
      return false;
    }
    if (isChainContinuationLine(text)) {
      return (
        [...missingIds].some((id) => lineReferencesSymbol(text, id)) ||
        isOrphanCandidateLine(document, n, missingIds, recentlyAdded)
      );
    }
    return isOrphanCandidateLine(document, n, missingIds, recentlyAdded);
  };

  while (start > 0) {
    const prev = start - 1;
    const prevText = document.lineAt(prev).text;
    if (isBlankOrCommentLine(prevText)) {
      if (prev === 0) {
        break;
      }
      const above = prev - 1;
      if (!lineOk(above) || isBlankOrCommentLine(document.lineAt(above).text)) {
        break;
      }
      start = prev;
      continue;
    }
    if (
      isChainContinuationLine(document.lineAt(start).text) &&
      /^(export\s+)?(const|let|var)\s+/.test(prevText.trim()) &&
      !isIncompleteDeclarationLine(prevText)
    ) {
      const headBinding = declaredBindingName(prevText);
      if (!(headBinding && recentlyAdded?.has(headBinding))) {
        start = prev;
        continue;
      }
    }
    // `$store.on(…)` → include preceding `const $store = …` when linked.
    const receiver = /^\s*([A-Za-z_$][\w$]*)\s*\./.exec(
      document.lineAt(start).text
    );
    if (receiver && !isIncompleteDeclarationLine(prevText)) {
      const binding = declaredBindingName(prevText);
      if (
        binding &&
        binding === receiver[1] &&
        !(recentlyAdded?.has(binding))
      ) {
        start = prev;
        continue;
      }
    }
    if (!lineOk(prev)) {
      break;
    }
    start = prev;
  }

  while (end + 1 < document.lineCount) {
    const next = end + 1;
    const nextText = document.lineAt(next).text;
    if (isBlankOrCommentLine(nextText)) {
      if (next + 1 >= document.lineCount) {
        break;
      }
      if (
        !lineOk(next + 1) ||
        isBlankOrCommentLine(document.lineAt(next + 1).text)
      ) {
        break;
      }
      end = next;
      continue;
    }
    if (isChainContinuationLine(nextText)) {
      const cur = document.lineAt(end).text;
      if (
        isChainContinuationLine(cur) ||
        isOrphanCandidateLine(document, end, missingIds, recentlyAdded) ||
        Boolean(declaredBindingName(cur))
      ) {
        end = next;
        continue;
      }
    }
    if (lineOk(next)) {
      end = next;
      continue;
    }
    break;
  }

  while (start < end && isBlankOrCommentLine(document.lineAt(start).text)) {
    start++;
  }
  while (end > start && isBlankOrCommentLine(document.lineAt(end).text)) {
    end--;
  }

  return { start, end };
}

type OrphanBlock = {
  startLine: number;
  endLine: number;
  lineRanges: vscode.Range[];
  deleteRange: vscode.Range;
  inlineRange: vscode.Range;
  reason: string;
};

/**
 * Track identifiers removed (orphan cleanup) and newly added (Tab focus:
 * e.g. user created `$cartStore`, then jumped to the events block).
 */
class RecentDeletionTracker {
  private readonly deleted = new Map<string, number>();
  private readonly added = new Map<string, number>();
  private readonly previousText = new Map<string, string>();

  onDocument(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    if (!this.previousText.has(key)) {
      this.previousText.set(key, document.getText());
    }
  }

  noteChange(event: vscode.TextDocumentChangeEvent): void {
    const key = event.document.uri.toString();
    const before = this.previousText.get(key);
    const after = event.document.getText();
    this.previousText.set(key, after);
    if (before == null || before === after) {
      return;
    }
    for (const change of event.contentChanges) {
      if (change.rangeLength <= 0 || change.text.length >= change.rangeLength) {
        continue;
      }
      try {
        const startOffset = this.offsetInText(before, change.range.start);
        const removed = before.slice(
          startOffset,
          startOffset + change.rangeLength
        );
        if (removed) {
          this.noteDeletedText(removed);
        }
      } catch {
        // ignore
      }
    }
    const beforeBindings = new Set(extractDeletedBindingNames(before));
    const afterBindings = new Set(extractDeletedBindingNames(after));
    const now = Date.now();
    // Binding names that disappeared entirely from the file.
    for (const id of beforeBindings) {
      if (!afterBindings.has(id)) {
        this.deleted.set(id, now);
        this.added.delete(id);
      }
    }
    // Newly introduced bindings → Tab focus for related fills.
    for (const id of afterBindings) {
      if (!beforeBindings.has(id)) {
        this.added.set(id, now);
        this.deleted.delete(id);
      }
    }
    // If a tracked id is defined again, stop treating it as a delete orphan source.
    for (const id of [...this.deleted.keys()]) {
      if (afterBindings.has(id) || symbolHasDefinition(event.document, id)) {
        this.deleted.delete(id);
      }
    }
    this.prune();
  }

  private offsetInText(text: string, position: vscode.Position): number {
    const lines = text.split("\n");
    let offset = 0;
    for (let i = 0; i < position.line && i < lines.length; i++) {
      offset += lines[i].length + 1;
    }
    return offset + position.character;
  }

  noteDeletedText(text: string): void {
    const now = Date.now();
    for (const id of extractDeletedBindingNames(text)) {
      this.deleted.set(id, now);
      this.added.delete(id);
    }
    this.prune();
  }

  recentlyDeleted(id: string): boolean {
    const at = this.deleted.get(id);
    return Boolean(at && Date.now() - at < RECENT_DELETE_TTL_MS);
  }

  recentlyDeletedIds(): string[] {
    this.prune();
    return [...this.deleted.keys()];
  }

  /** Newest-first list of bindings the user just introduced in this file. */
  recentlyAddedIds(): string[] {
    this.prune();
    return [...this.added.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, at] of this.deleted) {
      if (now - at > RECENT_DELETE_TTL_MS) {
        this.deleted.delete(id);
      }
    }
    for (const [id, at] of this.added) {
      if (now - at > RECENT_ADD_TTL_MS) {
        this.added.delete(id);
      }
    }
  }
}

function bindingReferencedOutside(
  document: vscode.TextDocument,
  binding: string,
  blockStart: number,
  blockEnd: number
): boolean {
  const re = new RegExp(identifierEdgePattern(binding));
  for (let j = 0; j < document.lineCount; j++) {
    if (j >= blockStart && j <= blockEnd) {
      continue;
    }
    if (re.test(document.lineAt(j).text)) {
      return true;
    }
  }
  return false;
}

type OrphanLineMark = "delete" | "keep" | "blank";

function markOrphanLines(
  document: vscode.TextDocument,
  start: number,
  end: number,
  missingIds: Set<string>,
  recentlyAdded?: Set<string>
): OrphanLineMark[] {
  const marks: OrphanLineMark[] = [];
  for (let i = start; i <= end; i++) {
    const text = document.lineAt(i).text;
    if (isBlankOrCommentLine(text)) {
      marks.push("blank");
      continue;
    }
    if (isIncompleteDeclarationLine(text)) {
      marks.push("keep");
      continue;
    }
    const binding = declaredBindingName(text);
    // Freshly typed binding — never offer to delete it just because it's unused yet.
    if (binding && recentlyAdded?.has(binding)) {
      marks.push("keep");
      continue;
    }
    if (
      binding &&
      bindingReferencedOutside(document, binding, start, end)
    ) {
      marks.push("keep");
      continue;
    }

    const refsMissing = [...missingIds].some(
      (id) =>
        lineReferencesSymbol(text, id) && !lineDefinesSymbol(text, id)
    );

    // Live declaration that does not reference a deleted symbol — keep.
    if (binding && !missingIds.has(binding) && !refsMissing) {
      marks.push("keep");
      continue;
    }

    if (
      isOrphanCandidateLine(document, i, missingIds, recentlyAdded) ||
      (isChainContinuationLine(text) && refsMissing) ||
      isEmptyStructuralLine(text)
    ) {
      marks.push("delete");
      continue;
    }

    // Unused const that still wires a deleted symbol → leftover, deletable.
    if (binding && refsMissing) {
      marks.push("delete");
      continue;
    }

    marks.push("keep");
  }
  return marks;
}

/**
 * Find a contiguous orphan block around the cursor (leftover after deleting a symbol).
 */
function findOrphanBlock(
  document: vscode.TextDocument,
  position: vscode.Position,
  tracker: RecentDeletionTracker
): OrphanBlock | undefined {
  const missingByLine = collectMissingSymbols(document, tracker);
  if (missingByLine.size === 0) {
    return undefined;
  }

  const recentlyAdded = new Set(tracker.recentlyAddedIds());

  let seed = -1;
  if (missingByLine.has(position.line)) {
    seed = position.line;
  } else {
    for (let dist = 1; dist <= 8; dist++) {
      if (missingByLine.has(position.line - dist)) {
        seed = position.line - dist;
        break;
      }
      if (missingByLine.has(position.line + dist)) {
        seed = position.line + dist;
        break;
      }
    }
  }
  if (seed < 0) {
    return undefined;
  }

  const missingIds = new Set<string>(missingByLine.get(seed) || []);
  for (const [line, ids] of missingByLine) {
    if (Math.abs(line - seed) <= 12) {
      for (const id of ids) {
        missingIds.add(id);
      }
    }
  }

  const seedText = document.lineAt(seed).text;
  if (isIncompleteDeclarationLine(seedText)) {
    return undefined;
  }
  const seedBinding = declaredBindingName(seedText);
  // Cursor on a just-added declaration that isn't a leftover ref — not an orphan.
  if (
    seedBinding &&
    recentlyAdded.has(seedBinding) &&
    ![...missingIds].some(
      (id) =>
        lineReferencesSymbol(seedText, id) && !lineDefinesSymbol(seedText, id)
    )
  ) {
    return undefined;
  }
  if (
    !isOrphanCandidateLine(document, seed, missingIds, recentlyAdded) &&
    !isChainContinuationLine(seedText) &&
    ![...missingIds].some((id) => lineReferencesSymbol(seedText, id))
  ) {
    return undefined;
  }

  const expanded = expandOrphanBlock(
    document,
    seed,
    missingIds,
    recentlyAdded
  );
  if (expanded.end - expanded.start > 20) {
    return undefined;
  }

  const marks = markOrphanLines(
    document,
    expanded.start,
    expanded.end,
    missingIds,
    recentlyAdded
  );
  const seedIdx = seed - expanded.start;
  if (seedIdx < 0 || seedIdx >= marks.length || marks[seedIdx] === "keep") {
    // Seed may be a protected declaration; try nearest delete mark in the block.
    let nearest = -1;
    let best = 999;
    for (let i = 0; i < marks.length; i++) {
      if (marks[i] !== "delete") {
        continue;
      }
      const dist = Math.abs(i - seedIdx);
      if (dist < best) {
        best = dist;
        nearest = i;
      }
    }
    if (nearest < 0) {
      return undefined;
    }
    seed = expanded.start + nearest;
  }

  let start = seed;
  let end = seed;
  while (start > expanded.start) {
    const mark = marks[start - 1 - expanded.start];
    if (mark === "keep") {
      break;
    }
    start--;
  }
  while (end < expanded.end) {
    const mark = marks[end + 1 - expanded.start];
    if (mark === "keep") {
      break;
    }
    end++;
  }

  while (start < end && isBlankOrCommentLine(document.lineAt(start).text)) {
    start++;
  }
  while (end > start && isBlankOrCommentLine(document.lineAt(end).text)) {
    end--;
  }

  let removable = 0;
  for (let i = start; i <= end; i++) {
    const mark = marks[i - expanded.start];
    if (mark === "delete") {
      removable++;
    }
  }
  if (removable === 0) {
    return undefined;
  }

  const lineRanges: vscode.Range[] = [];
  for (let i = start; i <= end; i++) {
    lineRanges.push(document.lineAt(i).range);
  }

  const deleteStart = document.lineAt(start).range.start;
  const deleteEnd =
    end + 1 < document.lineCount
      ? document.lineAt(end + 1).range.start
      : document.lineAt(end).range.end;

  const inlineLine = Math.min(Math.max(position.line, start), end);
  const reasonIds = [...missingIds].slice(0, 3).join(", ");
  const n = end - start + 1;

  return {
    startLine: start,
    endLine: end,
    lineRanges,
    deleteRange: new vscode.Range(deleteStart, deleteEnd),
    inlineRange: document.lineAt(inlineLine).range,
    reason:
      n > 1
        ? `orphan block (${n} lines) for '${reasonIds}'`
        : `orphan line for '${reasonIds}'`,
  };
}

async function findCrossFileNextEdit(
  currentFilePath: string,
  acceptedText: string
): Promise<NextEditTarget | undefined> {
  const kind = classifyAcceptedText(acceptedText);
  if (!kind || kind === "import" || kind === "wiring") {
    return undefined;
  }
  const prefer =
    kind === "store"
      ? /(?:^|\/)events?\./i
      : kind === "event"
        ? /(?:^|\/)stores?\./i
        : /(?:^|\/)(units?|samples?|wiring)\./i;

  for (const candidate of neighborPathCandidates(currentFilePath).slice(0, 16)) {
    const base = path.basename(candidate);
    if (!prefer.test(base) && !prefer.test(candidate)) {
      continue;
    }
    try {
      await fs.access(candidate);
    } catch {
      continue;
    }
    let raw: string;
    try {
      raw = await fs.readFile(candidate, "utf8");
    } catch {
      continue;
    }
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    let line = 0;
    for (let i = 0; i < Math.min(lines.length, 50); i++) {
      const t = (lines[i] || "").trim();
      if (!t) {
        line = i;
        break;
      }
      if (/^(?:export\s+)?(?:const|let|var|function|class)\b/.test(t)) {
        line = Math.min(lines.length - 1, i + 1);
      }
    }
    return {
      line,
      character: 0,
      kind,
      reason: `open ${base}`,
      filePath: candidate,
    };
  }
  return undefined;
}

function debounceMsForAggressiveness(
  level: "low" | "medium" | "high",
  fastTrigger: boolean
): number {
  // Eager per-character prefetch; aggressiveness only scales the pause slightly.
  if (level === "low") {
    return fastTrigger ? 90 : 160;
  }
  if (level === "high") {
    return fastTrigger ? 20 : 45;
  }
  return fastTrigger ? 35 : 70;
}

function showSuggestionShortcutLabel(): string {
  return process.platform === "darwin" ? "⌘⏎" : "Ctrl+Enter";
}

const SKIP_PATH_RE =
  /(^|[/\\])(\.env(\..+)?|.*\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|lock|min\.js|min\.css|map|wasm|woff2?|ttf|eot)|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock)$/i;

let output: vscode.OutputChannel | undefined;

function log(message: string, ...rest: unknown[]): void {
  if (!output) {
    output = vscode.window.createOutputChannel("Harbor Tab Autocomplete");
  }
  const extra =
    rest.length > 0
      ? " " +
        rest
          .map((r) => {
            if (r instanceof Error) {
              return r.stack || r.message;
            }
            try {
              return JSON.stringify(r);
            } catch {
              return String(r);
            }
          })
          .join(" ")
      : "";
  output.appendLine(`[${new Date().toISOString()}] ${message}${extra}`);
}

function delay(ms: number, token: vscode.CancellationToken): Promise<boolean> {
  return new Promise((resolve) => {
    if (token.isCancellationRequested) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => resolve(true), ms);
    const sub = token.onCancellationRequested(() => {
      clearTimeout(timer);
      sub.dispose();
      resolve(false);
    });
  });
}

/** Uncancellable pause for background Tab prefetch. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncatePrefix(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(text.length - max);
}

function truncateSuffix(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max);
}

function shouldSkipDocument(document: vscode.TextDocument): boolean {
  if (document.uri.scheme !== "file" && document.uri.scheme !== "untitled") {
    return true;
  }
  if (document.isClosed) {
    return true;
  }
  const name = document.fileName || document.uri.fsPath || "";
  if (SKIP_PATH_RE.test(name)) {
    return true;
  }
  // Huge files — too expensive / noisy.
  if (document.lineCount > 8_000) {
    return true;
  }
  // User-configured exclude globs (dist / generated / …).
  if (document.uri.scheme === "file" && name) {
    const globs = getConfig().tabAutocomplete.excludeGlobs;
    if (globs.length > 0) {
      let rel: string | undefined;
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (folder) {
        rel = path
          .relative(folder.uri.fsPath, document.uri.fsPath)
          .split(path.sep)
          .join("/");
      }
      if (pathMatchesAnyExcludeGlob(name, globs, rel)) {
        return true;
      }
    }
  }
  return false;
}

type CachedSuggestion = {
  uri: string;
  prefixTail: string;
  suffixHead: string;
  texts: string[];
  modelId: string;
  alternatives: number;
  at: number;
};

function httpStatusFromError(error: unknown): number | undefined {
  if (
    error &&
    typeof error === "object" &&
    (error as { name?: string }).name === "HttpStatusError" &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
  if (error instanceof Error) {
    const m = /^API (\d+):/i.exec(error.message);
    if (m) {
      return Number(m[1]);
    }
  }
  return undefined;
}

function isQuotaLikeMessage(message: string): boolean {
  return /квот|quota|rate.?limit|resource_error|too many requests|429/i.test(
    message
  );
}

function classifyTabProviderFailure(error: unknown): {
  cooldownMs: number;
  short: string;
} | undefined {
  if (
    error instanceof Error &&
    (error.name === "AbortError" || /abort/i.test(error.message))
  ) {
    return undefined;
  }
  const status = httpStatusFromError(error);
  const message = error instanceof Error ? error.message : String(error);
  if (status === 429 || isQuotaLikeMessage(message)) {
    return {
      cooldownMs: COOLDOWN_QUOTA_MS,
      short: "quota / rate limit",
    };
  }
  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /connection error|internalservererror|econnreset|etimedout/i.test(message)
  ) {
    return {
      cooldownMs: COOLDOWN_SERVER_MS,
      short: `provider ${status || "error"}`,
    };
  }
  if (typeof status === "number" && status >= 400) {
    return {
      cooldownMs: COOLDOWN_OTHER_MS,
      short: `API ${status}`,
    };
  }
  return {
    cooldownMs: COOLDOWN_OTHER_MS,
    short: "provider error",
  };
}

class SuggestionCache {
  private readonly items: CachedSuggestion[] = [];

  get(
    uri: string,
    prefix: string,
    suffix: string,
    modelId: string,
    alternatives: number
  ): string[] | undefined {
    const prefixTail = prefix.slice(-240);
    const suffixHead = suffix.slice(0, 120);

    for (const item of this.items) {
      if (item.uri !== uri || item.modelId !== modelId) {
        continue;
      }
      if (item.alternatives !== alternatives) {
        continue;
      }
      if (item.suffixHead !== suffixHead) {
        continue;
      }
      if (item.prefixTail === prefixTail) {
        return item.texts.slice();
      }
      // User typed further into a previous suggestion — return remainders.
      if (
        prefixTail.length > item.prefixTail.length &&
        prefixTail.startsWith(item.prefixTail)
      ) {
        const typed = prefixTail.slice(item.prefixTail.length);
        if (!typed) {
          continue;
        }
        const remainders = item.texts
          .filter((t) => t.startsWith(typed))
          .map((t) => t.slice(typed.length))
          .filter((t) => t.length > 0);
        if (remainders.length > 0) {
          return remainders;
        }
      }
    }
    return undefined;
  }

  set(
    uri: string,
    prefix: string,
    suffix: string,
    modelId: string,
    alternatives: number,
    texts: string[]
  ): void {
    const entry: CachedSuggestion = {
      uri,
      prefixTail: prefix.slice(-240),
      suffixHead: suffix.slice(0, 120),
      texts: texts.slice(),
      modelId,
      alternatives,
      at: Date.now(),
    };
    this.items.unshift(entry);
    if (this.items.length > CACHE_LIMIT) {
      this.items.length = CACHE_LIMIT;
    }
  }
}

class TabAutocompleteStatusBar {
  private readonly item: vscode.StatusBarItem;
  private readonly activeRequests = new Set<number>();
  private lastError: string | undefined;
  private lastLatencyMs: number | undefined;
  private cooldownUntil = 0;
  private cooldownReason: string | undefined;
  private cooldownTimer: ReturnType<typeof setTimeout> | undefined;
  private suggestionReady = false;
  private streaming = false;
  private readonly requestTimes: number[] = [];
  private onReadyClick: (() => void) | undefined;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = STATUS_CLICK_CMD;
    this.refresh();
    this.item.show();
  }

  dispose(): void {
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = undefined;
    }
    this.item.dispose();
  }

  setReadyClickHandler(handler: (() => void) | undefined): void {
    this.onReadyClick = handler;
  }

  handleStatusClick(): void {
    if (this.suggestionReady && this.onReadyClick) {
      this.onReadyClick();
      return;
    }
    void vscode.commands.executeCommand("agentPanel.openSettings");
  }

  private pruneRequestTimes(now = Date.now()): void {
    const cutoff = now - 60_000;
    while (this.requestTimes.length > 0 && this.requestTimes[0] < cutoff) {
      this.requestTimes.shift();
    }
  }

  noteApiRequest(): void {
    const now = Date.now();
    this.requestTimes.push(now);
    this.pruneRequestTimes(now);
  }

  requestsPerMinute(): number {
    this.pruneRequestTimes();
    return this.requestTimes.length;
  }

  setStreaming(streaming: boolean): void {
    if (this.streaming === streaming) {
      return;
    }
    this.streaming = streaming;
    this.refresh();
  }

  onStart(requestId: number): void {
    this.activeRequests.add(requestId);
    this.lastError = undefined;
    this.noteApiRequest();
    this.refresh();
  }

  onEnd(requestId: number, latencyMs?: number): void {
    this.activeRequests.delete(requestId);
    this.streaming = false;
    if (typeof latencyMs === "number") {
      this.lastLatencyMs = latencyMs;
      this.clearCooldown();
    }
    this.refresh();
  }

  setError(message: string): void {
    this.lastError = message;
    this.suggestionReady = false;
    this.refresh();
  }

  setSuggestionReady(ready: boolean): void {
    if (this.suggestionReady === ready) {
      if (ready) {
        this.refresh();
      }
      return;
    }
    this.suggestionReady = ready;
    this.refresh();
  }

  setCooldown(untilMs: number, reason: string): void {
    this.cooldownUntil = untilMs;
    this.cooldownReason = reason;
    this.lastError = reason;
    this.suggestionReady = false;
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
    }
    const wait = Math.max(0, untilMs - Date.now()) + 50;
    this.cooldownTimer = setTimeout(() => {
      this.cooldownTimer = undefined;
      if (Date.now() >= this.cooldownUntil) {
        this.clearCooldown();
        this.refresh();
      }
    }, wait);
    this.refresh();
  }

  clearCooldown(): void {
    this.cooldownUntil = 0;
    this.cooldownReason = undefined;
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = undefined;
    }
  }

  refresh(): void {
    const config = getConfig();
    const enabled = config.tabAutocomplete.enabled;
    const modelId = config.tabAutocomplete.modelId.trim();
    const model = getEnabledModels().find((m) => m.id === modelId);
    const label = model?.label || modelId || "—";
    const shortcut = showSuggestionShortcutLabel();

    if (this.activeRequests.size > 0) {
      const rpm = this.requestsPerMinute();
      if (this.streaming) {
        this.item.text = `$(sync~spin) Tab streaming`;
        this.item.tooltip = `Harbor Tab receiving tokens…\n${rpm} req/min · model ${label}`;
      } else {
        this.item.text = `$(sync~spin) Tab: ${label}`;
        this.item.tooltip = `Harbor Tab prefetching (${this.activeRequests.size}) · ${rpm} req/min\nGhost text stays hidden until ${shortcut} (chip mode).`;
      }
      return;
    }

    if (!enabled) {
      this.item.text = "$(code) Tab: Off";
      this.item.tooltip =
        "Harbor Tab autocomplete is off. Enable it in Harbor Agents Settings.";
      return;
    }

    if (!modelId || !model) {
      this.item.text = "$(code) Tab: No model";
      this.item.tooltip =
        "Choose a Tab autocomplete model in Harbor Agents Settings.";
      return;
    }

    const coolLeft = this.cooldownUntil - Date.now();
    if (coolLeft > 0) {
      const sec = Math.ceil(coolLeft / 1000);
      this.item.text = `$(debug-pause) Tab: pause ${sec}s`;
      this.item.tooltip = `Harbor Tab paused after provider error (${sec}s left).\n${this.cooldownReason || this.lastError || ""}\n${this.requestsPerMinute()} req/min\nOpen Output → Harbor Tab Autocomplete for details.`;
      return;
    }

    if (this.lastError) {
      this.item.text = `$(warning) Tab: ${label}`;
      this.item.tooltip = `Tab error: ${this.lastError}\n${this.requestsPerMinute()} req/min\nOpen Output → Harbor Tab Autocomplete for details.`;
      return;
    }

    if (this.suggestionReady) {
      this.item.text = "$(sparkle) Tab ready";
      this.item.tooltip = `Suggestion ready · ${this.requestsPerMinute()} req/min\nShortcut chip at the caret — press ${shortcut} to preview (chip mode), then Tab to accept.`;
      return;
    }

    const latency =
      typeof this.lastLatencyMs === "number"
        ? ` · last ${this.lastLatencyMs}ms`
        : "";
    const rpm = this.requestsPerMinute();
    const mode = config.tabAutocomplete.showMode === "inline" ? "inline" : "chip";
    this.item.text = `$(code) Tab: ${label}`;
    this.item.tooltip = `Harbor Tab autocomplete · ${label}${latency} · ${rpm}/min · ${mode}\nPrefetch while typing; ${
      mode === "inline"
        ? "ghost text shows when ready."
        : `caret chip when ready (no code until ${shortcut}).`
    }`;
  }
}

function isShortcutHintText(text: string): boolean {
  const shortcut = showSuggestionShortcutLabel();
  const t = text.trim();
  return t === shortcut || text === ` ${shortcut}` || text === shortcut;
}

/**
 * Caret chips: ready (⌘⏎ | Tab), orphan-delete (Tab), next-edit jump (Tab).
 */
class CaretShortcutHintController
  implements vscode.Disposable, vscode.InlayHintsProvider
{
  private readonly disposables: vscode.Disposable[] = [];
  private ready:
    | {
        kind: "ready" | "orphan";
        uri: string;
        position: vscode.Position;
        version: number;
        orphanStart?: number;
        orphanEnd?: number;
      }
    | undefined;
  private nextEdit:
    | {
        uri: string;
        position: vscode.Position;
        version: number;
        reason: string;
        expiresAt: number;
        originLine: number;
      }
    | undefined;
  private readonly onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this.onDidChange.event;

  constructor() {
    this.disposables.push(
      vscode.languages.registerInlayHintsProvider({ pattern: "**" }, this),
      this.onDidChange
    );
  }

  dispose(): void {
    this.hide();
    this.clearNextEdit();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  show(editor: vscode.TextEditor, position: vscode.Position): void {
    this.ready = {
      kind: "ready",
      uri: editor.document.uri.toString(),
      position,
      version: editor.document.version,
    };
    this.onDidChange.fire();
  }

  /** Chip that means “press Tab to delete this orphan line/block”. */
  showOrphan(
    editor: vscode.TextEditor,
    position: vscode.Position,
    startLine: number,
    endLine: number
  ): void {
    this.ready = {
      kind: "orphan",
      uri: editor.document.uri.toString(),
      position,
      version: editor.document.version,
      orphanStart: startLine,
      orphanEnd: endLine,
    };
    this.onDidChange.fire();
  }

  showNextEdit(
    editor: vscode.TextEditor,
    position: vscode.Position,
    reason: string,
    originLine: number,
    ttlMs: number = NEXT_EDIT_TTL_MS
  ): void {
    this.nextEdit = {
      uri: editor.document.uri.toString(),
      position,
      version: editor.document.version,
      reason,
      expiresAt: Date.now() + Math.max(5_000, ttlMs),
      originLine,
    };
    void vscode.commands.executeCommand("setContext", NEXT_EDIT_ACTIVE_CTX, true);
    this.onDidChange.fire();
  }

  /** Clear only the prefetch-ready chip; keep orphan chip if present. */
  hideReady(): void {
    if (!this.ready || this.ready.kind !== "ready") {
      return;
    }
    this.ready = undefined;
    this.onDidChange.fire();
  }

  /** Clear only the orphan-delete chip. */
  hideOrphan(): void {
    if (!this.ready || this.ready.kind !== "orphan") {
      return;
    }
    this.ready = undefined;
    this.onDidChange.fire();
  }

  clearNextEdit(): void {
    if (!this.nextEdit) {
      return;
    }
    this.nextEdit = undefined;
    void vscode.commands.executeCommand("setContext", NEXT_EDIT_ACTIVE_CTX, false);
    this.onDidChange.fire();
  }

  getNextEdit():
    | {
        uri: string;
        position: vscode.Position;
        reason: string;
        expiresAt: number;
        originLine: number;
      }
    | undefined {
    const ne = this.nextEdit;
    if (!ne) {
      return undefined;
    }
    if (Date.now() > ne.expiresAt) {
      this.clearNextEdit();
      return undefined;
    }
    return ne;
  }

  hide(): void {
    if (!this.ready) {
      return;
    }
    this.ready = undefined;
    this.onDidChange.fire();
  }

  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
    _token: vscode.CancellationToken
  ): vscode.InlayHint[] {
    const hints: vscode.InlayHint[] = [];

    const ne = this.nextEdit;
    if (
      ne &&
      ne.uri === document.uri.toString() &&
      Date.now() <= ne.expiresAt &&
      ne.position.line >= range.start.line &&
      ne.position.line <= range.end.line
    ) {
      // Refresh version drift: still show if line text exists.
      const jumpPart = new vscode.InlayHintLabelPart(" Next ");
      jumpPart.tooltip = `Next edit: ${ne.reason}. Press Tab to jump.`;
      jumpPart.command = {
        command: JUMP_NEXT_EDIT_CMD,
        title: "Jump to next edit",
      };
      const tabPart = new vscode.InlayHintLabelPart(" Tab ");
      tabPart.tooltip = "Jump to next edit target";
      tabPart.command = {
        command: JUMP_NEXT_EDIT_CMD,
        title: "Jump to next edit",
      };
      const hint = new vscode.InlayHint(ne.position, [jumpPart, tabPart]);
      hint.paddingLeft = true;
      hint.paddingRight = true;
      hint.kind = vscode.InlayHintKind.Parameter;
      hints.push(hint);
    }

    const ready = this.ready;
    if (!ready || ready.uri !== document.uri.toString()) {
      return hints;
    }
    if (ready.version !== document.version) {
      return hints;
    }
    if (
      !range.contains(ready.position) &&
      !range.contains(ready.position.translate(0, 1))
    ) {
      if (
        ready.position.line < range.start.line ||
        ready.position.line > range.end.line
      ) {
        return hints;
      }
    }

    if (ready.kind === "orphan") {
      const tabPart = new vscode.InlayHintLabelPart(" Tab ");
      tabPart.tooltip = "Delete orphan line / block";
      tabPart.command = {
        command: DELETE_ORPHAN_LINE_CMD,
        title: "Delete orphan line",
        arguments: [document.uri, ready.orphanStart, ready.orphanEnd],
      };
      const hint = new vscode.InlayHint(ready.position, [tabPart]);
      hint.paddingLeft = true;
      hint.paddingRight = true;
      hint.kind = vscode.InlayHintKind.Type;
      hints.push(hint);
      return hints;
    }

    const shortcut = showSuggestionShortcutLabel();
    const showPart = new vscode.InlayHintLabelPart(` ${shortcut} `);
    showPart.tooltip = `Show Tab suggestion (${shortcut})`;
    showPart.command = {
      command: SHOW_SUGGESTION_CMD,
      title: "Show Tab suggestion",
    };

    const tabPart = new vscode.InlayHintLabelPart(" Tab ");
    tabPart.tooltip = "Show suggestion, then Tab to accept";
    tabPart.command = {
      command: SHOW_SUGGESTION_CMD,
      title: "Show Tab suggestion",
    };

    const hint = new vscode.InlayHint(ready.position, [showPart, tabPart]);
    hint.paddingLeft = true;
    hint.paddingRight = true;
    hint.kind = vscode.InlayHintKind.Type;
    hints.push(hint);
    return hints;
  }
}

type PrefetchJob = {
  document: vscode.TextDocument;
  position: vscode.Position;
  textBeforeCursor: string;
  textAfterCursor: string;
  modelId: string;
  alternatives: number;
  debounceMs: number;
};

class HarborTabInlineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  private requestCounter = 0;
  private lastAcceptedCompletion:
    | { text: string; position: vscode.Position; timestamp: number }
    | undefined;
  private readonly holeFiller = new DefaultHoleFiller();
  private readonly cache = new SuggestionCache();
  /** modelId → epoch ms until which LLM Tab calls are paused */
  private readonly cooldownUntilByModel = new Map<string, number>();
  private prefetchInFlight = false;
  private prefetchAgain = false;
  private latestPrefetch: PrefetchJob | undefined;
  private prefetchSerial = 0;
  /** Last texts shown as ready chip — used when Invoke cache key drifts slightly. */
  private lastReady:
    | {
        uri: string;
        line: number;
        texts: string[];
        at: number;
      }
    | undefined;
  /** Cross-file Next Edit target (opened on jump). */
  private pendingCrossFileNextEdit: NextEditTarget | undefined;

  constructor(
    private readonly statusBar: TabAutocompleteStatusBar,
    private readonly deletions: RecentDeletionTracker,
    private readonly caretHint: CaretShortcutHintController,
    private readonly stats: TabStatsStore
  ) {}

  takeCrossFileNextEdit(): NextEditTarget | undefined {
    const t = this.pendingCrossFileNextEdit;
    this.pendingCrossFileNextEdit = undefined;
    return t;
  }

  clearPendingCrossFileNextEdit(): void {
    this.pendingCrossFileNextEdit = undefined;
  }

  private rememberReady(
    document: vscode.TextDocument,
    position: vscode.Position,
    texts: string[]
  ): void {
    this.lastReady = {
      uri: document.uri.toString(),
      line: position.line,
      texts: texts.slice(),
      at: Date.now(),
    };
  }

  private takeLastReady(
    document: vscode.TextDocument,
    position: vscode.Position
  ): string[] | undefined {
    const ready = this.lastReady;
    if (!ready) {
      return undefined;
    }
    if (ready.uri !== document.uri.toString()) {
      return undefined;
    }
    if (Math.abs(ready.line - position.line) > 1) {
      return undefined;
    }
    if (Date.now() - ready.at > 120_000) {
      return undefined;
    }
    return ready.texts;
  }

  private setReady(
    ready: boolean,
    document?: vscode.TextDocument,
    position?: vscode.Position
  ): void {
    this.statusBar.setSuggestionReady(ready);
    if (!ready) {
      // Do not clear an orphan-delete chip — strikethrough owns that mode.
      this.caretHint.hideReady();
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (
      !editor ||
      !document ||
      !position ||
      editor.document.uri.toString() !== document.uri.toString()
    ) {
      this.caretHint.hideReady();
      return;
    }
    this.caretHint.show(editor, position);
  }

  private isModelCoolingDown(modelId: string): boolean {
    const until = this.cooldownUntilByModel.get(modelId) || 0;
    if (until <= Date.now()) {
      if (until) {
        this.cooldownUntilByModel.delete(modelId);
      }
      return false;
    }
    return true;
  }

  private armCooldown(modelId: string, error: unknown): void {
    const classified = classifyTabProviderFailure(error);
    if (!classified) {
      return;
    }
    const until = Date.now() + classified.cooldownMs;
    const prev = this.cooldownUntilByModel.get(modelId) || 0;
    this.cooldownUntilByModel.set(modelId, Math.max(prev, until));
    const sec = Math.round(classified.cooldownMs / 1000);
    log("cooldown", {
      modelId,
      reason: classified.short,
      seconds: sec,
    });
    this.statusBar.setCooldown(
      this.cooldownUntilByModel.get(modelId)!,
      `${classified.short} — retry in ~${sec}s`
    );
  }


  /** Queue a background prefetch that is not aborted by the next keystroke. */
  private queuePrefetch(job: PrefetchJob): void {
    this.latestPrefetch = job;
    if (this.prefetchInFlight) {
      this.prefetchAgain = true;
      return;
    }
    this.prefetchInFlight = true;
    void this.runPrefetchLoop();
  }

  private async runPrefetchLoop(): Promise<void> {
    try {
      do {
        this.prefetchAgain = false;
        const job = this.latestPrefetch;
        if (!job) {
          break;
        }
        const wait = await sleep(job.debounceMs);
        void wait;
        if (this.prefetchAgain || this.latestPrefetch !== job) {
          continue;
        }
        if (this.isModelCoolingDown(job.modelId)) {
          continue;
        }

        const requestId = ++this.requestCounter;
        this.statusBar.onStart(requestId);
        const started = Date.now();
        try {
          const texts = await this.fetchCompletionTexts(job);
          this.statusBar.onEnd(requestId, Date.now() - started);
          if (!texts || texts.length === 0) {
            if (this.latestPrefetch === job) {
              this.setReady(false);
            }
            continue;
          }
        this.cache.set(
          job.document.uri.toString(),
          job.textBeforeCursor,
          job.textAfterCursor,
          job.modelId,
          job.alternatives,
          texts
        );
          log("prefetch ready", {
            alternatives: texts.length,
            preview: texts[0].slice(0, 80).replace(/\n/g, "\\n"),
          });
          this.rememberReady(job.document, job.position, texts);
          if (getConfig().tabAutocomplete.showMode === "inline") {
            this.setReady(false);
            void vscode.commands.executeCommand(
              "editor.action.inlineSuggest.trigger"
            );
          } else {
            this.revealReadyHintIfCurrent(job);
          }
        } catch (error) {
          this.statusBar.onEnd(requestId);
          if (
            error instanceof Error &&
            (error.name === "AbortError" || /abort/i.test(error.message))
          ) {
            continue;
          }
          log("error", error);
          this.armCooldown(job.modelId, error);
        }
      } while (this.prefetchAgain);
    } finally {
      this.prefetchInFlight = false;
      if (this.prefetchAgain) {
        this.prefetchInFlight = true;
        void this.runPrefetchLoop();
      }
    }
  }

  private revealReadyHintIfCurrent(job: PrefetchJob): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== job.document.uri.toString()) {
      return;
    }
    const pos = editor.selection.active;
    const textBeforeCursor = truncatePrefix(
      editor.document.getText(new vscode.Range(new vscode.Position(0, 0), pos)),
      MAX_PREFIX_CHARS
    );
    const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
    const textAfterCursor = truncateSuffix(
      editor.document.getText(
        new vscode.Range(
          pos,
          new vscode.Position(
            editor.document.lineCount - 1,
            lastLine.text.length
          )
        )
      ),
      MAX_SUFFIX_CHARS
    );
    const cached = this.cache.get(
      editor.document.uri.toString(),
      textBeforeCursor,
      textAfterCursor,
      job.modelId,
      job.alternatives
    );
    if (!cached || cached.length === 0) {
      return;
    }
    this.setReady(true, editor.document, pos);
    this.rememberReady(editor.document, pos, cached);
  }

  onCompletionAccepted(text: string, position: vscode.Position): void {
    if (isShortcutHintText(text)) {
      // User pressed Tab on a stray shortcut chip — show real suggestion.
      void vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
      return;
    }
    this.lastAcceptedCompletion = {
      text,
      position,
      timestamp: Date.now(),
    };
    this.setReady(false);
    const editor = vscode.window.activeTextEditor;
    const language = editor?.document.languageId || "";
    this.stats.recordAccept(language, text);
    void this.maybeOfferNextEdit(text, position);
  }

  /** After Accept — offer a one-shot jump chip to the likely next hole. */
  private async maybeOfferNextEdit(
    text: string,
    position: vscode.Position
  ): Promise<void> {
    if (!getConfig().tabAutocomplete.nextEdit) {
      this.caretHint.clearNextEdit();
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor || shouldSkipDocument(editor.document)) {
      this.caretHint.clearNextEdit();
      return;
    }

    let target =
      findNextEditTarget(editor.document.getText(), position.line, text) ||
      (await findCrossFileNextEdit(editor.document.uri.fsPath, text));
    if (!target) {
      this.caretHint.clearNextEdit();
      return;
    }

    if (target.filePath && target.filePath !== editor.document.uri.fsPath) {
      // Show chip in the current editor pointing at cross-file jump (click/Tab opens).
      this.pendingCrossFileNextEdit = target;
      const pos = editor.selection.active;
      this.caretHint.showNextEdit(
        editor,
        pos,
        target.reason,
        position.line,
        NEXT_EDIT_TTL_MS
      );
      log("next edit offered (cross-file)", {
        kind: target.kind,
        reason: target.reason,
        filePath: target.filePath,
        line: target.line,
      });
      return;
    }

    this.pendingCrossFileNextEdit = undefined;
    const line = Math.max(
      0,
      Math.min(target.line, editor.document.lineCount - 1)
    );
    if (Math.abs(line - position.line) <= 1) {
      this.caretHint.clearNextEdit();
      return;
    }
    const lineText = editor.document.lineAt(line).text;
    const character = Math.max(
      0,
      Math.min(target.character, lineText.length)
    );
    const pos = new vscode.Position(line, character);
    this.caretHint.showNextEdit(
      editor,
      pos,
      target.reason,
      position.line,
      NEXT_EDIT_TTL_MS
    );
    log("next edit offered", {
      kind: target.kind,
      reason: target.reason,
      line,
      fromLine: position.line,
    });
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
    const config = getConfig();
    if (!config.tabAutocomplete.enabled) {
      return [];
    }
    if (shouldSkipDocument(document)) {
      return [];
    }

    this.deletions.onDocument(document);

    const isInvoke =
      context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke;

    // Local orphan-block delete suggestion (no LLM) — e.g. leftover `.on(event)`
    // chain after deleting createEvent('testClicked'). Always visible.
    const orphan = findOrphanBlock(document, position, this.deletions);
    if (orphan) {
      log("orphan block suggest", orphan.reason);
      this.setReady(false);
      const editor = vscode.window.activeTextEditor;
      if (
        editor &&
        editor.document.uri.toString() === document.uri.toString()
      ) {
        this.caretHint.showOrphan(
          editor,
          position,
          orphan.startLine,
          orphan.endLine
        );
      }
      void vscode.commands.executeCommand(
        "setContext",
        ORPHAN_ACTIVE_CTX,
        true
      );
      // Prefer a real delete via command + Tab keybinding: empty inline
      // replacements are often ignored by the host (no ghost → Tab does nothing).
      const item = new vscode.InlineCompletionItem("", orphan.deleteRange);
      item.filterText = document.getText(orphan.deleteRange) || " ";
      const editItem = item as vscode.InlineCompletionItem & {
        isInlineEdit?: boolean;
        showRange?: vscode.Range;
        showInlineEditMenu?: boolean;
      };
      editItem.isInlineEdit = true;
      editItem.showRange = orphan.deleteRange;
      editItem.showInlineEditMenu = true;
      item.command = {
        command: DELETE_ORPHAN_LINE_CMD,
        title: "Delete orphan block",
        arguments: [document.uri, orphan.startLine, orphan.endLine],
      };
      return [item];
    }

    void vscode.commands.executeCommand("setContext", ORPHAN_ACTIVE_CTX, false);

    // Unused binding in a comma list — prefer `$newStore,` over model `],`.
    const listFill = findUnusedBindingListFill(document, position);
    if (listFill) {
      log("unused binding list suggest", listFill.text);
      this.setReady(false);
      return [this.toItem(listFill.text, position, listFill.range)];
    }

    const modelId = config.tabAutocomplete.modelId.trim();
    if (!modelId) {
      this.setReady(false);
      return [];
    }
    if (!getEnabledModels().some((m) => m.id === modelId)) {
      this.setReady(false);
      return [];
    }
    if (this.shouldSkipRequest(document, position, context, isInvoke)) {
      if (!isInvoke) {
        this.setReady(false);
      }
      return [];
    }

    const textBeforeCursor = truncatePrefix(
      document.getText(new vscode.Range(new vscode.Position(0, 0), position)),
      MAX_PREFIX_CHARS
    );
    const lastLine = document.lineAt(document.lineCount - 1);
    const textAfterCursor = truncateSuffix(
      document.getText(
        new vscode.Range(
          position,
          new vscode.Position(document.lineCount - 1, lastLine.text.length)
        )
      ),
      MAX_SUFFIX_CHARS
    );

    // Instant reuse when the user is typing through a cached suggestion.
    const alternatives = config.tabAutocomplete.alternatives;
    const cached = this.cache.get(
      document.uri.toString(),
      textBeforeCursor,
      textAfterCursor,
      modelId,
      alternatives
    );
    if (cached && cached.length > 0) {
      log("cache hit", {
        alternatives: cached.length,
        preview: cached[0].slice(0, 80).replace(/\n/g, "\\n"),
        show: isInvoke,
      });
      const showInline =
        isInvoke || getConfig().tabAutocomplete.showMode === "inline";
      if (showInline) {
        this.setReady(false);
        return cached.map((text) => this.toItem(text, position));
      }
      // Prefetch path (chip mode): caret shortcut chip only (real code stays cached).
      this.rememberReady(document, position, cached);
      this.setReady(true, document, position);
      return [];
    }

    // Explicit show: fall back to last ready chip texts if prefix drifted.
    if (isInvoke) {
      const readyTexts = this.takeLastReady(document, position);
      if (readyTexts && readyTexts.length > 0) {
        log("invoke lastReady", {
          alternatives: readyTexts.length,
          preview: readyTexts[0].slice(0, 80).replace(/\n/g, "\\n"),
        });
        this.setReady(false);
        return readyTexts.map((text) => this.toItem(text, position));
      }
    }

    if (this.isModelCoolingDown(modelId)) {
      this.setReady(false);
      return [];
    }

    const charBefore =
      position.character > 0
        ? document.lineAt(position.line).text.charAt(position.character - 1)
        : "";
    const fastTrigger =
      /[\w$;{}\n=,(\[\].]/.test(charBefore) || charBefore === " ";
    const debounceMs = isInvoke
      ? 0
      : Math.round(
          debounceMsForAggressiveness(
            config.tabAutocomplete.aggressiveness,
            fastTrigger
          ) * languageDebounceScale(document.languageId)
        );

    if (isInvoke) {
      if (this.requestCounter >= Number.MAX_SAFE_INTEGER) {
        this.requestCounter = 0;
      }
      const currentRequestId = ++this.requestCounter;
      this.statusBar.onStart(currentRequestId);
      const started = Date.now();
      try {
        const texts = await this.fetchCompletionTexts({
          document,
          position,
          textBeforeCursor,
          textAfterCursor,
          modelId,
          alternatives,
          debounceMs: 0,
        });
        this.statusBar.onEnd(currentRequestId, Date.now() - started);
        if (!texts || texts.length === 0) {
          this.setReady(false);
          return [];
        }
        this.cache.set(
          document.uri.toString(),
          textBeforeCursor,
          textAfterCursor,
          modelId,
          alternatives,
          texts
        );
        this.setReady(false);
        return texts.map((text) => this.toItem(text, position));
      } catch (error) {
        this.statusBar.onEnd(currentRequestId);
        if (
          !(
            error instanceof Error &&
            (error.name === "AbortError" || /abort/i.test(error.message))
          )
        ) {
          log("error", error);
          this.armCooldown(modelId, error);
        }
        this.setReady(false);
        return [];
      }
    }

    // Automatic: background prefetch survives keystrokes; chip via decoration.
    this.setReady(false);
    this.queuePrefetch({
      document,
      position,
      textBeforeCursor,
      textAfterCursor,
      modelId,
      alternatives,
      debounceMs,
    });
    return [];
  }

  private toItem(
    text: string,
    position: vscode.Position,
    range?: vscode.Range
  ): vscode.InlineCompletionItem {
    const item = new vscode.InlineCompletionItem(
      text,
      range ?? new vscode.Range(position, position)
    );
    item.command = {
      command: COMPLETION_ACCEPTED_CMD,
      title: "Track Tab completion",
      arguments: [text, position],
    };
    return item;
  }

  private shouldSkipRequest(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    isInvoke: boolean
  ): boolean {
    const currentTime = Date.now();
    const currentLine = document.lineAt(position.line);

    // IntelliSense selection suppresses Automatic Tab, but never blocks ⌘⏎ / Invoke.
    if (!isInvoke && context.selectedCompletionInfo) {
      return true;
    }

    if (
      this.lastAcceptedCompletion &&
      currentTime - this.lastAcceptedCompletion.timestamp < 800
    ) {
      const completionLines = this.lastAcceptedCompletion.text.split("\n");
      let expectedEndPosition: vscode.Position;
      if (completionLines.length === 1) {
        expectedEndPosition = new vscode.Position(
          this.lastAcceptedCompletion.position.line,
          this.lastAcceptedCompletion.position.character +
            this.lastAcceptedCompletion.text.length
        );
      } else {
        expectedEndPosition = new vscode.Position(
          this.lastAcceptedCompletion.position.line +
            completionLines.length -
            1,
          completionLines[completionLines.length - 1].length
        );
      }
      if (
        position.line === expectedEndPosition.line &&
        Math.abs(position.character - expectedEndPosition.character) <= 1
      ) {
        return true;
      }
    }

    // Allow Invoke anytime; Automatic still skips true mid-identifier edits
    // (cursor between word chars) to avoid thrashing, but fires at word end.
    if (!isInvoke) {
      const charAtCursor = currentLine.text.charAt(position.character);
      const charBeforeCursor =
        position.character > 0
          ? currentLine.text.charAt(position.character - 1)
          : "";
      if (
        charAtCursor &&
        /\w/.test(charAtCursor) &&
        /\w/.test(charBeforeCursor)
      ) {
        return true;
      }
    }

    // Empty brand-new file with almost no signal — wait for a bit of context.
    if (document.lineCount <= 1 && currentLine.text.trim().length < 2) {
      return true;
    }

    return false;
  }

  private async fetchCompletionTexts(
    job: PrefetchJob
  ): Promise<string[] | undefined> {
    const {
      document,
      position,
      textBeforeCursor,
      textAfterCursor,
      modelId,
      alternatives,
    } = job;

    const [extra, lsp] = await Promise.all([
      buildTabExtraContext(document, position),
      buildTabLspContext(document, position),
    ]);
    // First Tab in a workspace: kick background map build if cache empty.
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const root = folder?.uri.fsPath;
    if (root && !getTabProjectMapDigest(root)) {
      void ensureTabProjectMap({ root });
    }
    // Prefer brief from open-time research; build on demand if missing.
    let fileBrief = getCachedTabFileBrief(document.uri)?.digest;
    if (!fileBrief) {
      const brief = await ensureTabFileBrief(document);
      fileBrief = brief?.digest;
    }
    const recentFeedback = formatRecentFillFeedback(
      this.stats.recentFills(document.languageId)
    );
    const params: AutoCompleteContext = {
      textBeforeCursor,
      textAfterCursor,
      filename: path.basename(document.fileName || document.uri.fsPath || ""),
      language: document.languageId,
      currentLineText: document.lineAt(position.line).text,
      focus: buildTabFocusContext(
        document.getText(),
        position.line,
        this.deletions.recentlyAddedIds()
      ),
      relatedFiles: extra.related,
      projectRules: extra.projectRules,
      projectMap: extra.projectMap,
      fileIdentity: extra.fileIdentity,
      fileBrief,
      lsp,
      recentFillFeedback: recentFeedback || undefined,
    };

    const endpoint = resolveModelEndpoint(modelId);
    if (!endpoint.baseUrl) {
      const msg = "no provider baseUrl for model";
      log(msg, modelId);
      this.statusBar.setError(msg);
      return undefined;
    }

    const config = getConfig();
    const client = getOpenAICompatibleClient(
      endpoint.baseUrl,
      endpoint.apiKey || "",
      {
        rejectUnauthorized: config.rejectUnauthorized,
        caBundlePath: config.caBundlePath,
      }
    );

    const { messages } = this.holeFiller.prompt(params, alternatives);
    const sameLineSuffix = (textAfterCursor.split("\n")[0] || "");
    const baseTokens = sameLineSuffix.length > 0 ? 36 : MAX_COMPLETION_TOKENS;
    const maxTokens = languageMaxTokens(
      document.languageId,
      Math.min(
        120,
        baseTokens + (alternatives > 1 ? 24 * (alternatives - 1) : 0)
      )
    );

    log("request", {
      modelId,
      providerId: endpoint.providerId,
      prefixLen: textBeforeCursor.length,
      suffixLen: textAfterCursor.length,
      language: document.languageId,
      maxTokens,
      alternatives,
      focusRegion: params.focus?.region,
      recentBindings: params.focus?.recentBindings,
      relatedFiles: (params.relatedFiles || []).map((f) => f.label),
      projectRulesChars: params.projectRules?.length || 0,
      projectMapChars: params.projectMap?.length || 0,
      fileStem: params.fileIdentity?.stem,
      fileLayer: params.fileIdentity?.layerMarker,
      fileSiblings: params.fileIdentity?.siblingsOnDisk,
      fileBriefChars: params.fileBrief?.length || 0,
      lspChars: params.lsp?.length || 0,
      recentFeedbackChars: recentFeedback.length,
    });

    let streamed = "";
    let earlyPublished = false;
    const publishEarly = (rawSoFar: string) => {
      if (earlyPublished) {
        return;
      }
      const early = refineCompletionAlternatives(rawSoFar, params, alternatives);
      if (early.length === 0 || early[0].trim().length < 6) {
        return;
      }
      earlyPublished = true;
      const ranked = this.stats.rankAlternatives(document.languageId, early);
      this.cache.set(
        document.uri.toString(),
        textBeforeCursor,
        textAfterCursor,
        modelId,
        alternatives,
        ranked
      );
      this.rememberReady(document, position, ranked);
      if (config.tabAutocomplete.showMode === "inline") {
        void vscode.commands.executeCommand(
          "editor.action.inlineSuggest.trigger"
        );
      } else {
        this.setReady(true, document, position);
      }
      log("stream early ready", {
        preview: ranked[0].slice(0, 80).replace(/\n/g, "\\n"),
      });
    };

    // No cancellation tied to editor token — typing must not kill prefetch.
    const result = await client.chatCompletions(
      {
        model: modelId,
        messages,
        temperature: 0.1,
        max_tokens: maxTokens,
      },
      undefined,
      {
        onDelta: (delta) => {
          if (!delta.content) {
            return;
          }
          this.statusBar.setStreaming(true);
          streamed += delta.content;
          if (streamed.length >= 12) {
            publishEarly(streamed);
          }
        },
      }
    );

    const content = result.message.content;
    const raw =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .map((part) =>
                part && typeof part === "object" && "text" in part
                  ? String((part as { text?: string }).text || "")
                  : ""
              )
              .join("")
          : "";

    if (!raw) {
      log("empty model response");
      return [];
    }

    const texts = refineCompletionAlternatives(raw, params, alternatives);
    if (texts.length === 0) {
      log("empty after refine", raw.slice(0, 200));
      return [];
    }

    this.cooldownUntilByModel.delete(modelId);
    return this.stats.rankAlternatives(document.languageId, texts);
  }
}

/**
 * Visual strikethrough for orphan lines (stable API). Complements proposed
 * `isInlineEdit` when the host supports it.
 */
class OrphanStrikethroughController implements vscode.Disposable {
  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];
  private currentKey: string | undefined;

  constructor(
    private readonly deletions: RecentDeletionTracker,
    private readonly caretHint: CaretShortcutHintController
  ) {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      textDecoration: "line-through solid",
      opacity: "0.55",
      backgroundColor: new vscode.ThemeColor("diffEditor.removedLineBackground"),
      overviewRulerColor: new vscode.ThemeColor(
        "diffEditor.removedLineBackground"
      ),
      overviewRulerLane: vscode.OverviewRulerLane.Center,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });

    const refresh = () => this.refresh();
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(refresh),
      vscode.window.onDidChangeTextEditorSelection(refresh),
      vscode.workspace.onDidChangeTextDocument((e) => {
        const ed = vscode.window.activeTextEditor;
        if (ed && e.document.uri.toString() === ed.document.uri.toString()) {
          refresh();
        }
      }),
      vscode.languages.onDidChangeDiagnostics((e) => {
        const ed = vscode.window.activeTextEditor;
        if (!ed) {
          return;
        }
        if (e.uris.some((u) => u.toString() === ed.document.uri.toString())) {
          refresh();
        }
      })
    );
    refresh();
  }

  dispose(): void {
    this.clear();
    this.decorationType.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private clear(): void {
    const ed = vscode.window.activeTextEditor;
    if (ed) {
      ed.setDecorations(this.decorationType, []);
    }
    this.currentKey = undefined;
    this.caretHint.hideOrphan();
    void vscode.commands.executeCommand("setContext", ORPHAN_ACTIVE_CTX, false);
  }

  refresh(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !getConfig().tabAutocomplete.enabled) {
      this.clear();
      return;
    }
    if (shouldSkipDocument(editor.document)) {
      this.clear();
      return;
    }

    this.deletions.onDocument(editor.document);
    const orphan = findOrphanBlock(
      editor.document,
      editor.selection.active,
      this.deletions
    );
    if (!orphan) {
      this.clear();
      return;
    }

    const key = `${editor.document.uri.toString()}:${orphan.startLine}-${orphan.endLine}:${orphan.reason}`;
    const hover = new vscode.MarkdownString(
      `**Harbor Tab** — ${orphan.reason}. Press **Tab** (or click the Tab chip) to delete.`
    );
    editor.setDecorations(
      this.decorationType,
      orphan.lineRanges.map((range) => ({
        range,
        hoverMessage: hover,
      }))
    );
    this.caretHint.showOrphan(
      editor,
      editor.selection.active,
      orphan.startLine,
      orphan.endLine
    );
    void vscode.commands.executeCommand("setContext", ORPHAN_ACTIVE_CTX, true);
    if (this.currentKey !== key) {
      this.currentKey = key;
      log("orphan strikethrough", orphan.reason);
      void vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
    }
  }
}
export function startTabAutocomplete(
  context: vscode.ExtensionContext
): void {
  const statusBar = new TabAutocompleteStatusBar();
  const deletions = new RecentDeletionTracker();
  const caretHint = new CaretShortcutHintController();
  const stats = createTabStatsStore(context.globalState);
  initTabProjectMap(context.workspaceState);
  output = vscode.window.createOutputChannel("Harbor Tab Autocomplete");
  setTabProjectMapLogger((message, extra) => {
    log(`projectMap: ${message}`, extra);
  });
  setTabFileBriefLogger((message, extra) => {
    log(`fileBrief: ${message}`, extra);
  });
  scheduleTabProjectMapBuild();
  startTabFileBriefTracking(context.subscriptions);
  const provider = new HarborTabInlineCompletionProvider(
    statusBar,
    deletions,
    caretHint,
    stats
  );
  const strikethrough = new OrphanStrikethroughController(deletions, caretHint);

  const ensureInlineSuggest = async () => {
    if (!getConfig().tabAutocomplete.enabled) {
      return;
    }
    const cfg = vscode.workspace.getConfiguration("editor");
    if (cfg.get<boolean>("inlineSuggest.enabled") === false) {
      log("editor.inlineSuggest.enabled is false — enabling for Tab");
      await cfg.update(
        "inlineSuggest.enabled",
        true,
        vscode.ConfigurationTarget.Global
      );
    }
    // Ready chip uses inlay hints (segmented pill at the caret).
    if (cfg.get<boolean>("inlayHints.enabled") === false) {
      log("editor.inlayHints.enabled is false — enabling for Tab chip");
      await cfg.update(
        "inlayHints.enabled",
        true,
        vscode.ConfigurationTarget.Global
      );
    }
  };
  void ensureInlineSuggest();

  const triggerShowSuggestion = async () => {
    if (!getConfig().tabAutocomplete.enabled) {
      return;
    }
    log("show suggestion", showSuggestionShortcutLabel());
    // IntelliSense steals focus / blocks inline ghost — dismiss it first.
    try {
      await vscode.commands.executeCommand("hideSuggestWidget");
    } catch {
      // ignore if command unavailable
    }
    await vscode.commands.executeCommand("editor.action.inlineSuggest.hide");
    await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
  };
  statusBar.setReadyClickHandler(() => {
    void triggerShowSuggestion();
  });

  const orphanCodeActions: vscode.CodeActionProvider = {
    provideCodeActions(document, range) {
      if (!getConfig().tabAutocomplete.enabled) {
        return [];
      }
      const pos = range.start;
      const orphan = findOrphanBlock(document, pos, deletions);
      if (!orphan) {
        return [];
      }
      const n = orphan.endLine - orphan.startLine + 1;
      const action = new vscode.CodeAction(
        n > 1
          ? `Harbor Tab: delete orphan block (${n} lines)`
          : "Harbor Tab: delete orphan line",
        vscode.CodeActionKind.QuickFix
      );
      action.isPreferred = true;
      action.command = {
        command: DELETE_ORPHAN_LINE_CMD,
        title: "Delete orphan block",
        arguments: [document.uri, orphan.startLine, orphan.endLine],
      };
      return [action];
    },
  };

  context.subscriptions.push(
    statusBar,
    output,
    caretHint,
    strikethrough,
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: "**" },
      provider
    ),
    vscode.languages.registerCodeActionsProvider(
      [
        { language: "typescript" },
        { language: "typescriptreact" },
        { language: "javascript" },
        { language: "javascriptreact" },
      ],
      orphanCodeActions,
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    ),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.scheme !== "file" && e.document.uri.scheme !== "untitled") {
        return;
      }
      deletions.noteChange(e);
      const ne = caretHint.getNextEdit();
      if (ne && e.document.uri.toString() === ne.uri) {
        if (ne.position.line >= e.document.lineCount) {
          caretHint.clearNextEdit();
        }
      }
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      deletions.onDocument(doc);
    }),
    vscode.commands.registerCommand(
      COMPLETION_ACCEPTED_CMD,
      (text: string, position: vscode.Position) => {
        if (typeof text === "string" && position) {
          provider.onCompletionAccepted(text, position);
        }
      }
    ),
    vscode.commands.registerCommand(JUMP_NEXT_EDIT_CMD, async () => {
      if (!getConfig().tabAutocomplete.enabled) {
        return;
      }
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      const crossTarget = provider.takeCrossFileNextEdit();
      if (crossTarget?.filePath) {
        caretHint.clearNextEdit();
        const doc = await vscode.workspace.openTextDocument(
          crossTarget.filePath
        );
        const ed = await vscode.window.showTextDocument(doc, {
          preview: false,
          preserveFocus: false,
        });
        const line = Math.max(
          0,
          Math.min(crossTarget.line, doc.lineCount - 1)
        );
        const lineText = doc.lineAt(line).text;
        const character = Math.max(
          0,
          Math.min(crossTarget.character, lineText.length)
        );
        const pos = new vscode.Position(line, character);
        ed.selection = new vscode.Selection(pos, pos);
        ed.revealRange(
          new vscode.Range(pos, pos),
          vscode.TextEditorRevealType.InCenterIfOutsideViewport
        );
        log("jumped next edit cross-file", {
          reason: crossTarget.reason,
          filePath: crossTarget.filePath,
          line,
        });
        await triggerShowSuggestion();
        return;
      }

      const ne = caretHint.getNextEdit();
      if (!ne || ne.uri !== editor.document.uri.toString()) {
        caretHint.clearNextEdit();
        return;
      }
      const line = Math.max(
        0,
        Math.min(ne.position.line, editor.document.lineCount - 1)
      );
      const lineText = editor.document.lineAt(line).text;
      const character = Math.max(
        0,
        Math.min(ne.position.character, lineText.length)
      );
      const pos = new vscode.Position(line, character);
      caretHint.clearNextEdit();
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(
        new vscode.Range(pos, pos),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport
      );
      log("jumped next edit", { reason: ne.reason, line });
      await triggerShowSuggestion();
    }),
    vscode.commands.registerCommand(DISMISS_NEXT_EDIT_CMD, () => {
      provider.clearPendingCrossFileNextEdit();
      caretHint.clearNextEdit();
      log("dismissed next edit");
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      const ne = caretHint.getNextEdit();
      if (!ne) {
        return;
      }
      if (e.textEditor.document.uri.toString() !== ne.uri) {
        caretHint.clearNextEdit();
        return;
      }
      const line = e.selections[0]?.active.line ?? 0;
      const farFromTarget =
        Math.abs(line - ne.position.line) > NEXT_EDIT_DISMISS_LINES;
      const farFromOrigin =
        Math.abs(line - ne.originLine) > NEXT_EDIT_DISMISS_LINES;
      if (farFromTarget && farFromOrigin) {
        caretHint.clearNextEdit();
      }
    }),
    vscode.commands.registerCommand(
      DELETE_ORPHAN_LINE_CMD,
      async (uri?: vscode.Uri, startLine?: number, endLine?: number) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return;
        }
        if (uri && editor.document.uri.toString() !== uri.toString()) {
          return;
        }
        let from = startLine;
        let to = endLine;
        if (typeof from !== "number" || typeof to !== "number") {
          const orphan = findOrphanBlock(
            editor.document,
            editor.selection.active,
            deletions
          );
          if (!orphan) {
            return;
          }
          from = orphan.startLine;
          to = orphan.endLine;
        }
        const doc = editor.document;
        const last = Math.min(to, doc.lineCount - 1);
        const first = Math.max(0, Math.min(from, last));
        const deleteStart = doc.lineAt(first).range.start;
        const deleteEnd =
          last + 1 < doc.lineCount
            ? doc.lineAt(last + 1).range.start
            : doc.lineAt(last).range.end;
        await editor.edit((edit) => {
          edit.delete(new vscode.Range(deleteStart, deleteEnd));
        });
        log("deleted orphan block", { from: first, to: last });
        strikethrough.refresh();
      }
    ),
    vscode.commands.registerCommand(SHOW_SUGGESTION_CMD, () => {
      void triggerShowSuggestion();
    }),
    vscode.commands.registerCommand(STATUS_CLICK_CMD, () => {
      statusBar.handleStatusClick();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("agentPanel.tabAutocomplete") ||
        e.affectsConfiguration("agentPanel.models") ||
        e.affectsConfiguration("agentPanel.providers")
      ) {
        statusBar.refresh();
        void ensureInlineSuggest();
        if (
          !getConfig().tabAutocomplete.enabled ||
          !getConfig().tabAutocomplete.nextEdit
        ) {
          caretHint.clearNextEdit();
        }
        if (
          e.affectsConfiguration("agentPanel.tabAutocomplete.enabled") ||
          e.affectsConfiguration("agentPanel.tabAutocomplete.modelId")
        ) {
          if (getConfig().tabAutocomplete.enabled) {
            scheduleTabProjectMapBuild({ force: true, delayMs: 800 });
          }
        }
      }
    })
  );

  for (const doc of vscode.workspace.textDocuments) {
    deletions.onDocument(doc);
  }

  log("Tab autocomplete registered", {
    enabled: getConfig().tabAutocomplete.enabled,
    modelId: getConfig().tabAutocomplete.modelId,
  });
}
