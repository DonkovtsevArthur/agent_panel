/**
 * Discard / restore intent: agent-only edits vs all workspace dirty,
 * plus ambiguous short commands that should ask the user.
 */

export type DiscardScope = "all" | "agent" | "ambiguous";

function normalizeDiscardText(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function isDiscardQuestionOrNegation(value: string): boolean {
  if (
    !value ||
    value === "как" ||
    value.startsWith("как ") ||
    value.startsWith("почему ") ||
    value.startsWith("зачем ") ||
    value.startsWith("что ")
  ) {
    return true;
  }
  return /(не|не надо|не нужно)\s+(убир|убер|убр|откат|отмен|сброс|удал)/.test(
    value
  );
}

function hasDiscardAction(value: string): boolean {
  return /(убир|убер|убр|откат|отмен|сброс|discard|revert|restore|reset|undo)/.test(
    value
  );
}

function hasChangesWord(value: string): boolean {
  return /(измен|правк|change|local change)/.test(value);
}

/** Явная команда отбросить ВСЕ локальные изменения в workspace. */
export function looksLikeDiscardAllChangesRequest(text: string): boolean {
  const value = normalizeDiscardText(text);
  if (isDiscardQuestionOrNegation(value)) {
    return false;
  }
  const all = /(все|всё|all)/.test(value);
  return hasDiscardAction(value) && all && hasChangesWord(value);
}

/**
 * Откат правок агента (не весь dirty workspace).
 * «отмени изменения» / «откати свои правки» — без слова «все».
 */
export function looksLikeDiscardAgentChangesRequest(text: string): boolean {
  const value = normalizeDiscardText(text);
  if (isDiscardQuestionOrNegation(value)) {
    return false;
  }
  if (looksLikeDiscardAllChangesRequest(value)) {
    return false;
  }
  if (looksLikeAmbiguousRestoreRequest(value)) {
    return false;
  }
  const agentOwned =
    /(свои|свою|своих|свой|моя|мои|мое|наделал|наделала|агент|this turn|my changes|agent'?s?\s+changes)/.test(
      value
    );
  return hasDiscardAction(value) && (agentOwned || hasChangesWord(value));
}

/** Короткая команда отката без цели — нужно уточнить scope. */
export function looksLikeAmbiguousRestoreRequest(text: string): boolean {
  const value = normalizeDiscardText(text)
    .replace(/[.!?…]+$/g, "")
    .trim();
  return /^(верни|вернуть|верни назад|откати|откатить|отмени|отменить|восстанови|восстановить|restore|revert|undo)$/.test(
    value
  );
}

export function resolveDiscardScope(text: string): DiscardScope | null {
  if (looksLikeAmbiguousRestoreRequest(text)) {
    return "ambiguous";
  }
  if (looksLikeDiscardAllChangesRequest(text)) {
    return "all";
  }
  if (looksLikeDiscardAgentChangesRequest(text)) {
    return "agent";
  }
  return null;
}

export function buildDiscardSystemHint(options: {
  scope: DiscardScope;
  agentEditedPaths: string[];
}): string {
  const paths = (options.agentEditedPaths || [])
    .map((p) => String(p || "").trim())
    .filter(Boolean);
  const pathList = paths.length
    ? paths.map((p) => `- ${p}`).join("\n")
    : "(no paths recorded from the last agent edit turn)";

  if (options.scope === "ambiguous") {
    return [
      "The user asked to undo/restore without saying WHETHER to discard only this agent's recent edits or ALL local workspace changes.",
      "Call request_user_input once with a clear question and exactly these options:",
      "1) Only this agent's recent edits",
      "2) All local workspace changes",
      "recommended: 0 (agent-only is safer).",
      "Do NOT run git restore . or git clean -fd until the user picks.",
      "Do NOT use write_file / search_replace to undo changes.",
    ].join(" ");
  }

  const stopAfterDiscard =
    "After a successful discard: STOP. Reply briefly what was restored/removed. " +
    "Do NOT re-implement an earlier plan, recreate deleted files, or continue Build/Agent work from chat history — " +
    "the discard IS the completed user request. Only write files again if the user explicitly asks in a later message.";

  if (options.scope === "all") {
    return [
      "The user asked to discard ALL local workspace changes.",
      "Procedure: run_command `git status --short`, then `git restore .` and if untracked remain `git clean -fd`.",
      "Do NOT use write_file or search_replace to empty/rewrite files as an undo.",
      "Do NOT re-read the whole repo.",
      "A successful git restore/clean/rm discard counts as completing the task — do not claim you need write_file.",
      stopAfterDiscard,
    ].join(" ");
  }

  // agent scope
  return [
    "The user asked to discard THIS AGENT's recent edits only — not unrelated local dirty files.",
    "Recorded paths from the last agent edit turn:",
    pathList,
    "Procedure: run_command `git status --short`, then for tracked paths among the list: `git restore -- <path...>` (never `git restore .`).",
    "For untracked paths from that list only: `rm -rf -- <path...>` or `git clean -fd -- <path...>` — do not clean the whole repo.",
    "If the path list is empty: report that there are no recorded agent edits; show git status; do not wipe unrelated dirty files.",
    "Do NOT use write_file / search_replace to undo.",
    stopAfterDiscard,
  ].join("\n");
}
