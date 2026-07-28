/** Runtime entry for MCP (bundled with esbuild into out/mcpBundle.js). */
export {
  McpManager,
  getMcpManager,
  initMcpManager,
} from "./mcp/manager";
export type { FigmaStatusPayload } from "./mcp/figma";
export type {
  McpServerConfig,
  McpServerRuntimeStatus,
} from "./mcp/types";
export {
  envToLines,
  parseArgsInput,
  parseEnvLines,
} from "./mcp/serversStore";
