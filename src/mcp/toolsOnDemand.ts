/**
 * MCP tools on demand for any server (Figma, custom servers) — the same idea
 * as built-in Jira / Confluence in atlassianCompact.ts. A server with many
 * tools puts every JSON schema into every request (Figma alone is ~30 tools),
 * while a chat calls a few of them. Here the well-known core tools stay
 * direct; the rest go through two dispatchers per server:
 *
 * - `<server>_read`  — every other read tool (allowed in Plan / Ask);
 * - `<server>_write` — every write tool (`isMcpReadonlyTool` false; hidden in
 *   Plan / Ask and approved as a write — the `_write` suffix is a write).
 *
 * Lazy mode (`agentPanel.mcp.lazyTools`, default on) goes further: no direct
 * tools at all and a names-only catalog — the model calls `describe` when the
 * task needs the server, so unrelated servers cost a few dozen tokens.
 *
 * The tool set is static per connected server, so the session fingerprint
 * (and the prompt cache) stays stable. Built-in Jira / Confluence keep their
 * own dispatchers. vscode-free.
 */
import type { ChatTool } from "../openaiTypes";
import { catalogLine } from "./atlassianCompact";
import {
  isMcpReadonlyTool,
  parseQualifiedToolName,
  qualifyMcpToolName,
  sanitizeMcpServerId,
} from "./types";

/** Servers with fewer tools are sent as-is. */
export const MCP_ON_DEMAND_MIN_TOOLS = 9;

/**
 * Tools models call first on a typical task — kept as direct tools on any
 * server (names are specific enough: Figma Dev Mode / Framelink, Playwright).
 */
export const MCP_CORE_TOOL_NAMES: ReadonlySet<string> = new Set([
  // Figma Dev Mode MCP + Framelink (PAT) — the URL → design → screenshot path.
  "get_design_context",
  "get_screenshot",
  "get_metadata",
  "get_variable_defs",
  "get_figma_data",
  "download_figma_images",
  // Playwright MCP — open, read, act.
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_take_screenshot",
]);

export function mcpDispatcherNames(serverId: string): {
  read: string;
  write: string;
} {
  const prefix = sanitizeMcpServerId(serverId).replace(/-/g, "_") || "mcp";
  return { read: `${prefix}_read`, write: `${prefix}_write` };
}

type ToolGroups = {
  core: ChatTool[];
  reads: ChatTool[];
  writes: ChatTool[];
};

function innerName(tool: ChatTool): string {
  const name = String(tool.function?.name || "");
  return parseQualifiedToolName(name)?.toolName || name;
}

/**
 * Lazy mode (`agentPanel.mcp.lazyTools`): every server with at least this many
 * tools is sent as dispatchers only — no direct tools, names-only catalog.
 */
export const MCP_LAZY_MIN_TOOLS = 2;

export interface McpOnDemandOptions {
  /** Names-only dispatchers for every tool (the model loads schemas itself). */
  lazy?: boolean;
}

/** Split a server's tools, or undefined when the server stays as-is. */
function groupServerTools(
  serverId: string,
  tools: readonly ChatTool[],
  options: McpOnDemandOptions = {}
): ToolGroups | undefined {
  const lazy = options.lazy === true;
  if (tools.length < (lazy ? MCP_LAZY_MIN_TOOLS : MCP_ON_DEMAND_MIN_TOOLS)) {
    return undefined;
  }
  const names = mcpDispatcherNames(serverId);
  if (tools.some((t) => [names.read, names.write].includes(innerName(t)))) {
    // A real tool already has the dispatcher name — never shadow it.
    return undefined;
  }
  const groups: ToolGroups = { core: [], reads: [], writes: [] };
  for (const tool of tools) {
    if (!lazy && MCP_CORE_TOOL_NAMES.has(innerName(tool))) {
      groups.core.push(tool);
    } else if (isMcpReadonlyTool(tool.function.name)) {
      groups.reads.push(tool);
    } else {
      groups.writes.push(tool);
    }
  }
  // Moving one or two tools behind a dispatcher saves nothing.
  if (!lazy && groups.reads.length + groups.writes.length < 3) {
    return undefined;
  }
  return groups;
}

function dispatcherTool(
  serverId: string,
  name: string,
  kind: "read" | "write",
  tools: ChatTool[],
  lazy = false
): ChatTool {
  const intro = lazy
    ? kind === "read"
      ? `Read-only tools of MCP server "${serverId}" — use only when the task needs this server.`
      : `Write tools of MCP server "${serverId}" (change data — only when the user asked for it).`
    : kind === "read"
      ? `More read-only tools of MCP server "${serverId}". Call with tool + arguments.`
      : `Write tools of MCP server "${serverId}" (change data — only when the user asked for it). Call with tool + arguments.`;
  const catalog = lazy
    ? [
        "Call with describe: true first to get a tool's description and schema, then call with tool + arguments. Tool names from rules / skills / hints are called through here.",
        `Tools: ${tools.map(innerName).join(", ")}.`,
      ]
    : [
        "`*` = required, `…` = more optional params. Unsure about arguments → call with describe: true first (returns the full schema). Tool names from rules / skills / hints that are not in your tool list are called through here.",
        ...tools.map((t) =>
          catalogLine({
            name: innerName(t),
            description: t.function.description,
            inputSchema: t.function.parameters,
          })
        ),
      ];
  return {
    type: "function",
    function: {
      name: qualifyMcpToolName(serverId, name),
      description: [intro, ...catalog].join("\n"),
      parameters: {
        type: "object",
        properties: {
          tool: {
            type: "string",
            enum: tools.map(innerName),
            description: "Tool to run",
          },
          arguments: {
            type: "object",
            description: "Arguments of that tool",
          },
          describe: {
            type: "boolean",
            description: "Return the tool's full schema instead of running it",
          },
        },
        required: ["tool"],
      },
    },
  };
}

/**
 * Core tools as-is + `<server>_read` / `<server>_write` dispatchers for the
 * rest. Small servers come back unchanged.
 */
export function compactMcpServerTools(
  serverId: string,
  tools: readonly ChatTool[],
  options: McpOnDemandOptions = {}
): ChatTool[] {
  const groups = groupServerTools(serverId, tools, options);
  if (!groups) {
    return [...tools];
  }
  const names = mcpDispatcherNames(serverId);
  const lazy = options.lazy === true;
  return [
    ...groups.core,
    ...(groups.reads.length
      ? [dispatcherTool(serverId, names.read, "read", groups.reads, lazy)]
      : []),
    ...(groups.writes.length
      ? [dispatcherTool(serverId, names.write, "write", groups.writes, lazy)]
      : []),
  ];
}

export type McpDispatch =
  | { kind: "direct" }
  | { kind: "call"; tool: string; args: Record<string, unknown> }
  | { kind: "result"; text: string };

/**
 * Resolve a call by (unqualified) tool name against the server's full tool
 * list: a dispatcher → the inner tool (or its schema), anything else →
 * direct. A read dispatcher never runs a write tool.
 */
export function resolveMcpDispatch(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
  tools: readonly ChatTool[],
  options: McpOnDemandOptions = {}
): McpDispatch {
  const names = mcpDispatcherNames(serverId);
  if (toolName !== names.read && toolName !== names.write) {
    return { kind: "direct" };
  }
  const groups = groupServerTools(serverId, tools, options);
  if (!groups) {
    return { kind: "direct" };
  }
  const wantWrite = toolName === names.write;
  const allowedTools = wantWrite ? groups.writes : groups.reads;
  const allowed = allowedTools.map(innerName);
  const inner = String(args.tool || "").trim();
  const def = allowedTools.find((t) => innerName(t) === inner);
  if (!def) {
    const hint = groups.core.some((t) => innerName(t) === inner)
      ? ` ${inner} is a direct tool — call it by name.`
      : !wantWrite && groups.writes.some((t) => innerName(t) === inner)
        ? ` ${inner} changes data — use ${names.write}.`
        : "";
    return {
      kind: "result",
      text: JSON.stringify({
        error: `Unknown tool "${inner}" for ${toolName}.${hint}`,
        allowed,
      }),
    };
  }
  if (args.describe === true) {
    return {
      kind: "result",
      text: JSON.stringify({
        tool: inner,
        description: def.function.description,
        inputSchema: def.function.parameters,
      }),
    };
  }
  // Some models send `arguments` as a JSON string.
  let raw: unknown = args.arguments;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = undefined;
    }
  }
  const innerArgs =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return { kind: "call", tool: inner, args: innerArgs };
}
