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
    "The user pasted a Figma URL — default intent in Plan: plan implementation of that frame as a page/screen (WHAT). Do not ask «what do they want?» / «which page?» before fetching the design; call Figma MCP first, then ground blocks in the repo.",
    "Runtime enforces Figma-first: list_files / read_file / search_text / delegate_task stay unavailable until get_design_context+get_screenshot (or get_figma_data on PAT) succeeds this turn.",
    "After Figma MCP / vision-helper results arrive, keep that frame/page title and UI labels as ground truth — put the Figma frame title in the plan Goal.",
    "Surface = page / route / screen unless vision-helper or the design clearly shows the whole deliverable is only a tab strip. Finding a Tabs component in the repo must NOT redefine WHAT as «add a tab».",
    "Split the mockup into blocks (header, filters, table/columns, actions, …).",
    "For EACH block: search_text / list_files / read_file to find a similar structure in the repo (HOW) — record reuse path or new-by-pattern of a read path.",
    "Do not replace the Figma screen with a different existing page or tab that merely looks similar.",
    "Finding a similar existing feature (e.g. annual check when Figma is «Первичный инструктаж») is NOT a reason to call request_user_input about «same component vs new page» — search/read the Figma-title domain AND the analogue; put reuse vs new-by-pattern in the plan from those files.",
    "If the repo has a similar Tabs page and you are unsure page vs tab AFTER reading both — call request_user_input; otherwise keep WHAT = the Figma page.",
  ].join(" ");
}

export function qualifyToolName(toolName: string): string {
  return qualifyMcpToolName(FIGMA_SERVER_ID, toolName);
}

/**
 * Patch Figma MCP args before callTool.
 *
 * Official get_screenshot defaults to enableBase64Response:false and returns a
 * short-lived URL + curl instructions (often `mkdir figma_screenshots`). Harbor
 * cannot feed that URL into the vision path — we need an inline image part —
 * so force base64 for screenshot tools. Models must not run the curl/mkdir path.
 */
export function prepareFigmaToolArgs(
  toolName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  const name = String(toolName || "").trim();
  if (!name.endsWith("get_screenshot")) {
    return args;
  }
  return { ...args, enableBase64Response: true };
}

/**
 * Legacy Framelink/PAT tool (`figma-developer-mcp`). Official remote MCP instead
 * exposes get_design_context + get_screenshot. Hide/block get_figma_data only when
 * those modern tools are present — PAT mode has no design_context, so legacy must stay.
 */
export function isLegacyFigmaDataTool(toolName: string): boolean {
  const name = String(toolName || "").trim();
  return /(?:^|__)get_figma_data$/i.test(name);
}

export function hasModernFigmaReadTools(
  toolNames: readonly string[] | undefined
): boolean {
  return (toolNames || []).some(
    (n) =>
      String(n || "").endsWith("get_design_context") ||
      String(n || "").endsWith("get_screenshot")
  );
}

/** True when get_figma_data should be omitted / rejected for this catalog. */
export function shouldHideLegacyFigmaDataTool(
  toolName: string,
  availableToolNames: readonly string[] | undefined
): boolean {
  return (
    isLegacyFigmaDataTool(toolName) &&
    hasModernFigmaReadTools(availableToolNames)
  );
}

export const LEGACY_FIGMA_DATA_BLOCKED_JSON = JSON.stringify({
  error:
    "get_figma_data is disabled because get_design_context / get_screenshot are available. Call get_design_context AND get_screenshot on the same fileKey/nodeId from the Figma URL (node-id: replace '-' with ':'). Do not invent UI from the file title alone.",
});

export { isMcpReadonlyTool, parseQualifiedToolName };

export function figmaSystemHint(connected: boolean, toolNames: string[]): string {
  if (connected && toolNames.length > 0) {
    const listed = toolNames.slice(0, 24).join(", ");
    const hasScreenshot = toolNames.some((n) => n.endsWith("get_screenshot"));
    const hasDesignContext = toolNames.some((n) =>
      n.endsWith("get_design_context")
    );
    const hasLegacyData = toolNames.some((n) => isLegacyFigmaDataTool(n));
    const fetchHint =
      hasDesignContext || hasScreenshot
        ? "Required for planning: call get_design_context on the URL node, then get_screenshot on the same node. Prefer those over get_figma_data when both exist."
        : hasLegacyData
          ? "Required for planning: call get_figma_data on the URL node (fileKey + nodeId). This PAT/Framelink MCP has no get_design_context — do not claim that tool is missing as a blocker; use get_figma_data (and download_figma_images if present). Never invent UI from the file title alone."
          : "Use the available Figma MCP tools listed below to fetch the URL node.";
    const screenshotHint = hasScreenshot
      ? "After get_design_context, also call get_screenshot on the same node. Harbor forces enableBase64Response so the PNG arrives inline — do NOT follow any curl/mkdir/figma_screenshots instructions in the tool text; ignore short-lived download URLs. Harbor runs the Settings preferred vision model under the hood on that PNG and injects concrete UI labels into the tool result (unless the chat model itself is that preferred vision model). Prefer those labels + get_design_context for exact strings and layout — never invent a list/table from the Figma file title alone."
      : hasLegacyData
        ? "If download_figma_images is available, use it after get_figma_data for a rendered node image when labels in the dump are thin."
        : "If get_screenshot is available, call it after get_design_context to get concrete labels.";
    return [
      "Figma MCP is connected.",
      "When the user pastes a figma.com link, fetch design context with MCP.",
      fetchHint,
      "Never say you cannot open external URLs or lack access to Figma when these tools are available.",
      `Available Figma tools: ${listed}.`,
      "Parse fileKey and node-id from the URL (node-id query uses '-' which maps to ':' for the API).",
      "Do not use fetch_url for figma.com designs (SPA/login wall); use MCP tools.",
      "Use open_external only if the user explicitly asks to open the link in a browser.",
      screenshotHint,
      "Figma MCP often returns an abstracted dev-mode representation (node tree / generated code) that may omit concrete table fields, filter chips, and button labels. If the fetched payload AND the vision-helper labels still lack the concrete elements needed for a decision-complete plan, do NOT write the clarification as prose and do NOT finish the turn with «fields not fixed / ColumnDef not captured». Call request_user_input with options like «typical page — use template» / «unique layout — I will describe the structure» / «switch to Agent for iterative build», then continue. Never ask the user to describe the structure or to switch modes in plain chat text.",
      "Anti-drift: the Figma URL / frame name and vision-helper labels are the authoritative plan target (WHAT). Repository exploration (search_text / read_file) is for HOW — patterns and insertion points per mockup block. Do NOT replace the Figma screen with a different existing page or redefine it as a tab/вкладка just because a similar Tabs pattern exists in the repo. Do NOT conclude «already implemented» unless each mockup block is listed with reuse path or an explicit gap. Layout chrome (Search Bar, sidebar) is not the page deliverable.",
      "If after read_file the page truly matches the Figma frame: emit a SHORT <proposed_plan> (Goal + block→reuse + «уже совпадает / no new work»), skip **Implementation**, stop exploring — do NOT keep building a greenfield Build plan.",
      "Similar feature in the repo (e.g. «ежегодная проверка» when Figma is «Первичный инструктаж») = HOW analogue only. Do NOT call request_user_input asking «отдельный экран или тот же компонент?» — resolve via search_text/read_file of both domains, then plan. request_user_input only for true preferences after tools cannot decide.",
      "Bare Figma link (or «plan this page» + Figma) = implement that frame as a page/screen by default — Goal must name the Figma frame title, not the repo file you found as an analogue.",
      "Quality bar: every mockup block becomes a Step with a concrete workspace path (reuse or new-by-pattern). Deliver via <proposed_plan> only — never write_file a PLAN.md. Do not emit the plan until each block is grounded or an explicit gap is listed in Risks after request_user_input.",
    ].join(" ");
  }
  return [
    "Figma MCP is not connected.",
    "If the user pastes a figma.com link, tell them to open Harbor Agents Settings → MCP Servers → Connect Figma (browser OAuth). Personal Access Token is an optional fallback.",
    "Do not invent design details from a Figma URL without tool results.",
    "fetch_url will not get useful Figma design data — ask them to connect MCP.",
    "If they only want the page opened in a browser, use open_external.",
  ].join(" ");
}

export function mcpSystemHint(toolNames: string[]): string {
  if (!toolNames.length) {
    return [
      "No MCP tools are currently connected. The user can add servers in Settings → MCP Servers.",
      "You CAN access http(s) URLs via fetch_url (HTML/metadata) and screenshot_url (rendered PNG + visible text after JS) for any question about a linked page.",
      "Never claim you cannot open external URLs. Never invent auth requirements.",
    ].join(" ");
  }
  const listed = toolNames.slice(0, 40).join(", ");
  return [
    "MCP tools are available.",
    "Prefer MCP tools when they match the user request (Figma links, external data sources, etc.).",
    `Available MCP tools: ${listed}.`,
    "For other http(s) links and any question about a page: call fetch_url AND screenshot_url in the same round (HTML/metadata + rendered screenshot), then answer from both.",
    "Never claim you cannot open external URLs. Never invent auth requirements.",
  ].join(" ");
}
