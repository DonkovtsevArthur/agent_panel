export type McpTransportType = "stdio" | "http";

export type McpConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/** Persisted user MCP server (no OAuth — stdio or plain HTTP). */
export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransportType;
  /** stdio */
  command?: string;
  args?: string[];
  /** Non-secret env; secret keys go to SecretStorage */
  env?: Record<string, string>;
  cwd?: string;
  /** http */
  url?: string;
}

export interface McpServerRuntimeStatus {
  id: string;
  name: string;
  enabled: boolean;
  builtin: boolean;
  transport: McpTransportType | "remote" | "pat";
  state: McpConnectionState;
  toolCount: number;
  message?: string;
  detail?: string;
  /** True when secrets/credentials for reconnect are present. */
  hasCredentials?: boolean;
  /** Present for custom servers — used by edit UI. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  /** One-off note from the last upsert (e.g. Jira AGENTS.md rule written). */
  notice?: string;
  /** Jira server: a PAT is saved in SecretStorage (edit form shows it as set). */
  hasSecretToken?: boolean;
}

export function slugifyMcpServerId(name: string): string {
  const base = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || `mcp-${Date.now().toString(36)}`;
}

/** Ensure id has no underscores (tool names use mcp__id__tool). */
export function sanitizeMcpServerId(id: string): string {
  return String(id || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function qualifyMcpToolName(serverId: string, toolName: string): string {
  return `mcp__${sanitizeMcpServerId(serverId)}__${toolName}`;
}

export function parseQualifiedToolName(
  qualified: string
): { serverId: string; toolName: string } | undefined {
  const match = /^mcp__([^_]+)__(.+)$/.exec(qualified);
  if (!match) {
    return undefined;
  }
  return { serverId: match[1], toolName: match[2] };
}

const WRITEISH_TOOL_RE =
  /^(use_|create_|generate_|add_|update_|delete_|write_|send_|remove_|edit_)/i;
/**
 * Service-prefixed tools (`jira_create_issue`, `github_add_comment`) — the
 * verb follows the prefix, so the plain regex above missed them and Plan/Ask
 * could still create / change issues.
 */
const PREFIXED_WRITEISH_TOOL_RE =
  /^(jira|confluence|github|gitlab|bitbucket|linear|notion|slack|youtrack)_(use|create|generate|add|update|delete|write|send|remove|edit|transition|assign|link|move|batch|upload|set|close|merge|approve|reopen)_?/i;

export function isMcpReadonlyTool(qualifiedName: string): boolean {
  const parsed = parseQualifiedToolName(qualifiedName);
  const name = parsed?.toolName || qualifiedName;
  return !WRITEISH_TOOL_RE.test(name) && !PREFIXED_WRITEISH_TOOL_RE.test(name);
}

/**
 * MCP tools allowed in Plan/Ask: all Figma tools + non-write tools from other servers.
 */
export function isAllowedMcpInReadonlyMode(qualifiedName: string): boolean {
  if (!String(qualifiedName || "").startsWith("mcp__")) {
    return false;
  }
  if (qualifiedName.startsWith("mcp__figma__")) {
    return true;
  }
  return isMcpReadonlyTool(qualifiedName);
}

export function formatTransportDetail(cfg: McpServerConfig): string {
  if (cfg.transport === "http") {
    return `http · ${cfg.url || ""}`;
  }
  if (cfg.command === "harbor-jira") {
    return `built-in · Jira REST API · ${cfg.env?.JIRA_URL || ""}`.trim();
  }
  const args = (cfg.args || []).join(" ");
  return `stdio · ${cfg.command || ""}${args ? ` ${args}` : ""}`.trim();
}
