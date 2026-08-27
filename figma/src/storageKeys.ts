/** Storage keys for the Figma host only — never IDE workspaceState / globalState. */
export const FIGMA_STORAGE_PREFIX = "harbor.figma." as const;
export const FIGMA_STORAGE_SETTINGS = `${FIGMA_STORAGE_PREFIX}settings` as const;
export const FIGMA_STORAGE_SESSION = `${FIGMA_STORAGE_PREFIX}session` as const;
export const FIGMA_STORAGE_UI_STATE = `${FIGMA_STORAGE_PREFIX}uiState` as const;
