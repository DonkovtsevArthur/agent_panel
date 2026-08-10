/**
 * Upstream TabCoder activate — not used by Harbor.
 * Harbor wires Tab autocomplete in `src/extension.ts` → `startTabAutocomplete`.
 */
export function activate(): void {
  throw new Error(
    "TabCoder vendor activate is disabled; use Harbor startTabAutocomplete."
  );
}

export function deactivate(): void {}
