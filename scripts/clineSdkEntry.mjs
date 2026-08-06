/**
 * Esbuild entry: re-export the Cline SDK surface Harbor needs as one CJS bundle.
 * Source of truth for patches: vendor/cline (fork). Runtime resolves
 * from node_modules/@cline/* (same version as the fork).
 */
export {
  Agent,
  createBuiltinTools,
  ToolPresets,
  createToolPoliciesWithPreset,
  getClineDefaultSystemPrompt,
} from "@cline/sdk";
