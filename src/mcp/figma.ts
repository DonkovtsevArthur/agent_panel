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

/**
 * Extra Plan/Ask reminder when the user pasted a Figma link — reinforces
 * anti-drift after repo exploration (see figmaSystemHint).
 */
export function figmaPlanAntiDriftHint(): string {
  return [
    "The user pasted a Figma URL — that frame/page is the plan target.",
    "After Figma MCP / vision-helper results arrive, keep that page title and UI labels as ground truth.",
    "Use list_files / read_file only to find implementation patterns and insertion points.",
    "Do not switch the plan to another repo page that looks similar.",
  ].join(" ");
}

export function qualifyToolName(toolName: string): string {
  return qualifyMcpToolName(FIGMA_SERVER_ID, toolName);
}

export { isMcpReadonlyTool, parseQualifiedToolName };

export function figmaSystemHint(connected: boolean, toolNames: string[]): string {
  if (connected && toolNames.length > 0) {
    const listed = toolNames.slice(0, 24).join(", ");
    const hasScreenshot = toolNames.some((n) => n.endsWith("get_screenshot"));
    return [
      "Figma MCP is connected.",
      "When the user pastes a figma.com link, call Figma MCP tools to fetch design context.",
      "Never say you cannot open external URLs or lack access to Figma when these tools are available.",
      `Available Figma tools: ${listed}.`,
      "Parse fileKey and node-id from the URL (node-id query uses '-' which maps to ':' for the API).",
      "Do not use fetch_url for figma.com designs (SPA/login wall); use MCP tools.",
      "Use open_external only if the user explicitly asks to open the link in a browser.",
      hasScreenshot
        ? "After get_design_context, also call get_screenshot on the same node. Harbor runs a vision helper under the hood on the screenshot and returns concrete UI labels as text in the tool result — use that text (column headers, button labels, filter chips) as the primary source; the chat model stays the planner and does not need to «see» raw image bytes."
        : "If get_screenshot is available, call it after get_design_context to get concrete labels.",
      "Figma MCP often returns an abstracted dev-mode representation (node tree / generated code) that may omit concrete table fields, filter chips, and button labels. If the fetched payload AND the vision-helper labels still lack the concrete elements needed for a decision-complete plan, do NOT write the clarification as prose and do NOT finish the turn with «fields not fixed / ColumnDef not captured». Call request_user_input with options like «typical page — use template» / «unique layout — I will describe the structure» / «switch to Agent for iterative build», then continue. Never ask the user to describe the structure or to switch modes in plain chat text.",
      "Anti-drift: the Figma URL / frame name and vision-helper labels are the authoritative plan target. Repository exploration is only for patterns and where to implement. Do NOT replace the Figma screen with a different existing page that merely looks similar (similar table, same checkbox columns). If a repo page title differs from the Figma page/frame, plan against Figma and note the mismatch — or ask via request_user_input.",
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
      "You CAN access http(s) URLs via fetch_url for any question about a linked page (facts, summary, colors, metadata).",
      "Never claim you cannot open external URLs. Never invent auth requirements.",
    ].join(" ");
  }
  const listed = toolNames.slice(0, 40).join(", ");
  return [
    "MCP tools are available.",
    "Prefer MCP tools when they match the user request (Figma links, external data sources, etc.).",
    `Available MCP tools: ${listed}.`,
    "For other http(s) links and any question about a page: call fetch_url, then answer from the structured fields.",
    "Never claim you cannot open external URLs. Never invent auth requirements.",
  ].join(" ");
}
