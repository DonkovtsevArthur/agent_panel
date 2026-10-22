/**
 * Auto-compact budget for Cline sessions. Pure helpers (no `vscode`) so unit
 * tests can import them from `out/`.
 */

/** Cline auto-compacts at this share of `maxInputTokens` (COMPACTION_TRIGGER_RATIO). */
export const CLINE_COMPACTION_TRIGGER_RATIO = 0.9;

/** Harbor's default auto-compact trigger as a share of the model's context window. */
export const HARBOR_COMPACTION_WINDOW_RATIO = 0.75;

/**
 * `maxInputTokens` for Cline's compaction budget. Cline compacts at 90% of it;
 * Harbor lowers the budget so compaction fires at 75% of the model's context
 * window. `agentPanel.autoCompact.thresholdTokens` (> 0) additionally caps the
 * trigger at that request size — on 1M-window models long chats otherwise
 * re-send hundreds of thousands of tokens per step and time-to-first-token
 * grows every turn. The model's real `contextWindow` is unchanged.
 */
export function harborCompactionInputBudget(
  contextWindow: number,
  autoCompact: { enabled: boolean; thresholdTokens: number }
): number {
  if (!autoCompact.enabled || !(contextWindow > 0)) {
    return contextWindow;
  }
  let trigger = Math.floor(contextWindow * HARBOR_COMPACTION_WINDOW_RATIO);
  const threshold = autoCompact.thresholdTokens;
  if (threshold > 0) {
    trigger = Math.min(trigger, threshold);
  }
  return Math.min(
    contextWindow,
    Math.ceil(trigger / CLINE_COMPACTION_TRIGGER_RATIO)
  );
}
