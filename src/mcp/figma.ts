import {
  isMcpReadonlyTool,
  parseQualifiedToolName,
  qualifyMcpToolName,
} from "./types";

export const FIGMA_MCP_REMOTE_URL = "https://mcp.figma.com/mcp";
export const FIGMA_SERVER_ID = "figma";
export const FIGMA_TOOL_PREFIX = `mcp__${FIGMA_SERVER_ID}__`;

export const FIGMA_URL_RE =
  /https?:\/\/(?:www\.)?figma\.com\/(?:design|file|board|proto|make|slides|deck)\/[^\s)\]>'"]+/i;

export type FigmaTransportMode = "remote" | "pat";

export type FigmaConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface FigmaStatusPayload {
  state: FigmaConnectionState;
  mode?: FigmaTransportMode;
  message?: string;
  toolCount?: number;
  showPatFallback?: boolean;
  preferPat?: boolean;
  hasPat?: boolean;
  enabled: boolean;
}

export function messageHasFigmaUrl(text: string): boolean {
  return FIGMA_URL_RE.test(String(text || ""));
}

export function qualifyToolName(toolName: string): string {
  return qualifyMcpToolName(FIGMA_SERVER_ID, toolName);
}

export { isMcpReadonlyTool, parseQualifiedToolName };

export function figmaSystemHint(connected: boolean, toolNames: string[]): string {
  if (connected && toolNames.length > 0) {
    const listed = toolNames.slice(0, 24).join(", ");
    return [
      "Figma MCP is connected.",
      "When the user pastes a figma.com link, call Figma MCP tools to fetch design context.",
      "Never say you cannot open external URLs or lack access to Figma when these tools are available.",
      `Available Figma tools: ${listed}.`,
      "Parse fileKey and node-id from the URL (node-id query uses '-' which maps to ':' for the API).",
      "Do not use fetch_url for figma.com designs (SPA/login wall); use MCP tools.",
      "Use open_external only if the user explicitly asks to open the link in a browser.",
    ].join(" ");
  }
  return [
    "Figma MCP is not connected.",
    "If the user pastes a figma.com link, tell them to open Harbor Agents Settings → MCP Servers and connect with a Personal Access Token.",
    "Do not invent design details from a Figma URL without tool results.",
    "fetch_url will not get useful Figma design data — ask them to connect MCP.",
    "If they only want the page opened in a browser, use open_external.",
  ].join(" ");
}

export function mcpSystemHint(toolNames: string[]): string {
  if (!toolNames.length) {
    return [
      "No MCP tools are currently connected. The user can add servers in Settings → MCP Servers.",
      "You CAN access http(s) URLs: call fetch_url to read page content, or open_external to open in the browser.",
      "Never claim you cannot open external URLs.",
    ].join(" ");
  }
  const listed = toolNames.slice(0, 40).join(", ");
  return [
    "MCP tools are available.",
    "Prefer MCP tools when they match the user request (Figma links, external data sources, etc.).",
    `Available MCP tools: ${listed}.`,
    "For other http(s) links: fetch_url to read content, open_external to open in the browser.",
    "Never claim you cannot open external URLs.",
  ].join(" ");
}
