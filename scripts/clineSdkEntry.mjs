/**
 * Esbuild entry: re-export the Cline SDK surface Harbor needs as one CJS bundle.
 * Source of truth for patches: vendor/cline (fork). Runtime resolves
 * from node_modules/@cline/* (same version as the fork).
 *
 * Telemetry sinks (Langfuse / OTLP) are stubbed in scripts/bundle-cline.js —
 * do not delete telemetry code inside vendor/cline.
 *
 * Phase 2: ClineCore local session host (DefaultRuntimeBuilder supplies
 * builtins + plan command-guard). Thin Agent / ToolPresets are not used.
 */
export {
  ClineCore,
  createTool,
  createToolPoliciesWithPreset,
  getClineDefaultSystemPrompt,
} from "@cline/sdk";
