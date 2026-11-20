/**
 * Entry point of the bundled Pi chunk (scripts/bundle-pi.js → out/pi/pi.mjs).
 * Keep the export list minimal: everything here ends up in the VSIX.
 */
export {
  VERSION,
  ModelRuntime,
  createAgentSession,
  SessionManager,
  createMcpExtension,
  DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";
