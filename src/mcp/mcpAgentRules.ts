import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { isMcpReadonlyTool, qualifyMcpToolName } from "./types";

/**
 * Per-server MCP rules in the workspace AGENTS.md: after a custom MCP server
 * connects, Harbor writes a marked `<!-- harbor:mcp:<id>:* -->` block that
 * tells agents what the server is for and how to call it. Content is
 * deterministic (no LLM): a curated template for known servers, plus the
 * server's own `instructions` from MCP initialize and a compact tool list.
 * Jira / Confluence keep their own `harbor:jira` / `harbor:confluence` blocks.
 */

export interface McpServerRuleTool {
  /** Raw MCP tool name (not qualified). */
  name: string;
  description?: string;
}

export interface McpServerRuleInfo {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  /** `instructions` from the MCP initialize result (untrusted server text). */
  instructions?: string;
  tools: McpServerRuleTool[];
}

export interface McpServerRulesResult {
  file: string;
  changed: boolean;
}

const MAX_LISTED_TOOLS = 30;
const MAX_TOOL_DESCRIPTION_CHARS = 140;
const MAX_INSTRUCTIONS_CHARS = 2000;

function sectionMarkers(id: string): [string, string] {
  return [`<!-- harbor:mcp:${id}:start -->`, `<!-- harbor:mcp:${id}:end -->`];
}

/** Keep server-provided text from closing our markers or adding HTML comments. */
function sanitizeText(text: string): string {
  return text.replace(/<!--/g, "<!—").replace(/-->/g, "—>");
}

function firstSentence(text: string): string {
  const flat = sanitizeText(text).replace(/\s+/g, " ").trim();
  const match = /^(.+?[.!?])(\s|$)/.exec(flat);
  const sentence = match ? match[1] : flat;
  return sentence.length > MAX_TOOL_DESCRIPTION_CHARS
    ? `${sentence.slice(0, MAX_TOOL_DESCRIPTION_CHARS - 1).trimEnd()}…`
    : sentence;
}

/**
 * AGENTS.md is usually committed: keep machine-specific paths out of the block
 * so teammates with the same server do not rewrite it with their own paths.
 * Absolute command → basename; home directory in args → `~`.
 */
function portableSource(info: McpServerRuleInfo): string {
  if (info.transport === "http") {
    return info.url || "";
  }
  const command = String(info.command || "").trim();
  const home = os.homedir();
  const args = (info.args || []).map((a) =>
    home && a.startsWith(home) ? `~${a.slice(home.length)}` : a
  );
  const portable = path.isAbsolute(command) ? path.basename(command) : command;
  return [portable, ...args].join(" ");
}

interface McpRuleTemplate {
  /** Matched against `command args url` of the server config. */
  match: RegExp;
  /** Lines for the block; `tool(name)` is undefined when the server lacks it. */
  lines: (tool: (name: string) => string | undefined) => string[];
}

function onlyWith(names: (string | undefined)[], line: string): string[] {
  return names.every(Boolean) ? [line] : [];
}

/** Curated rules for well-known servers; lines render only for tools the server really has. */
const MCP_RULE_TEMPLATES: McpRuleTemplate[] = [
  {
    match: /codebase-memory/i,
    lines: (tool) => {
      const search = tool("search_graph");
      const trace = tool("trace_call_path");
      const arch = tool("get_architecture");
      const navTools = [search, trace, arch].filter(Boolean).map((t) => `\`${t}\``);
      return [
        ...onlyWith(
          [tool("index_repository")],
          `- Before the first graph query in a chat, check that this repository is indexed (${[tool("list_projects"), tool("index_status")].filter(Boolean).map((t) => `\`${t}\``).join(" / ") || "list projects"}); if not, call \`${tool("index_repository")}\` with the workspace root path.`
        ),
        ...(navTools.length
          ? [
              `- For structure questions (where a symbol is defined, who calls it, impact of a change, architecture overview) use ${navTools.join(", ")} before grep / search_files. Use grep for literal text, config values and comments.`,
            ]
          : []),
        ...onlyWith(
          [tool("get_code_snippet")],
          `- Read one symbol's source with \`${tool("get_code_snippet")}\` instead of reading the whole file.`
        ),
        ...onlyWith(
          [tool("detect_changes")],
          `- After edits, \`${tool("detect_changes")}\` shows the affected symbols and callers.`
        ),
        "- The graph can lag behind uncommitted edits; when it disagrees with the files, trust the files and re-index.",
      ];
    },
  },
  {
    match: /context7/i,
    lines: (tool) => {
      const resolve = tool("resolve-library-id");
      const docs = tool("get-library-docs") || tool("query-docs");
      return onlyWith(
        [resolve, docs],
        `- For questions about a third-party library or framework API, call \`${resolve}\`, then \`${docs}\` instead of answering from memory; mention the library version you looked at.`
      );
    },
  },
  {
    match: /@playwright\/mcp|playwright-mcp|mcp-playwright/i,
    lines: (tool) => [
      ...onlyWith(
        [tool("browser_snapshot")],
        `- To read a page, prefer \`${tool("browser_snapshot")}\` (accessibility tree) over screenshots; use screenshots only for visual checks.`
      ),
      ...onlyWith(
        [tool("browser_close")],
        `- Close the browser with \`${tool("browser_close")}\` when the task is done.`
      ),
    ],
  },
  {
    match: /github-mcp-server|server-github|api\.githubcopilot\.com\/mcp/i,
    lines: () => [
      "- Use it for GitHub issues, pull requests and repository metadata; use local git for the working tree.",
    ],
  },
];

export function buildMcpServerSection(info: McpServerRuleInfo): string {
  const [sectionStart, sectionEnd] = sectionMarkers(info.id);
  const names = new Set(info.tools.map((t) => t.name));
  const tool = (name: string) =>
    names.has(name) ? qualifyMcpToolName(info.id, name) : undefined;
  const signature = [info.command || "", ...(info.args || []), info.url || ""].join(" ");
  const templateLines = MCP_RULE_TEMPLATES.filter((t) => t.match.test(signature)).flatMap(
    (t) => t.lines(tool)
  );
  const writeTools = info.tools
    .map((t) => qualifyMcpToolName(info.id, t.name))
    .filter((q) => !isMcpReadonlyTool(q));
  const listed = info.tools.slice(0, MAX_LISTED_TOOLS);
  const instructions = sanitizeText(String(info.instructions || "").trim());
  const instructionsText =
    instructions.length > MAX_INSTRUCTIONS_CHARS
      ? `${instructions.slice(0, MAX_INSTRUCTIONS_CHARS).trimEnd()}…`
      : instructions;
  const source = portableSource(info);

  const lines = [
    sectionStart,
    `## MCP: ${sanitizeText(info.name)}`,
    "",
    `_Auto-generated by Harbor Agents when the MCP server \`${info.id}\` connected. Reconnecting rewrites this block; removing or disabling the server in Harbor deletes it._`,
    "",
    `- Server: ${info.transport} · \`${sanitizeText(source.trim())}\`. Tools are named \`mcp__${info.id}__<tool>\`.`,
    ...templateLines,
    ...(writeTools.length
      ? [
          `- Tools that change external state (${writeTools.map((t) => `\`${t}\``).join(", ")}) — only when the user asked for that change. Plan / Ask modes expose read tools only.`,
        ]
      : []),
    ...(instructionsText
      ? [
          "",
          "Server instructions (provided by the MCP server, not verified by Harbor):",
          "",
          ...instructionsText.split(/\r?\n/).map((l) => (l.trim() ? `> ${l}` : ">")),
        ]
      : []),
    ...(listed.length
      ? [
          "",
          "Tools:",
          "",
          ...listed.map((t) => {
            const desc = t.description ? firstSentence(t.description) : "";
            return `- \`${t.name}\`${desc ? ` — ${desc}` : ""}`;
          }),
          ...(info.tools.length > listed.length
            ? [`- … and ${info.tools.length - listed.length} more.`]
            : []),
        ]
      : []),
    sectionEnd,
  ];
  return lines.join("\n");
}

/** Replace the block for this server, or append it to the end. */
export function upsertMcpServerSection(content: string, id: string, section: string): string {
  const [sectionStart, sectionEnd] = sectionMarkers(id);
  const start = content.indexOf(sectionStart);
  const end = content.indexOf(sectionEnd);
  if (start >= 0 && end > start) {
    return content.slice(0, start) + section + content.slice(end + sectionEnd.length);
  }
  if (!content.trim()) {
    return `# Agent instructions\n\n${section}\n`;
  }
  const sep = content.endsWith("\n\n") ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  return `${content}${sep}${section}\n`;
}

/** Drop the block for this server (and the blank line it leaves behind). */
export function removeMcpServerSection(content: string, id: string): string {
  const [sectionStart, sectionEnd] = sectionMarkers(id);
  const start = content.indexOf(sectionStart);
  const end = content.indexOf(sectionEnd);
  if (start < 0 || end <= start) {
    return content;
  }
  const before = content.slice(0, start).replace(/\n+$/, "");
  const after = content.slice(end + sectionEnd.length).replace(/^\n+/, "");
  if (!before) {
    return after;
  }
  return after ? `${before}\n\n${after}` : `${before}\n`;
}

export function writeMcpServerRules(
  workspaceRoot: string,
  info: McpServerRuleInfo
): McpServerRulesResult {
  const file = path.join(workspaceRoot, "AGENTS.md");
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const next = upsertMcpServerSection(current, info.id, buildMcpServerSection(info));
  if (next !== current) {
    fs.writeFileSync(file, next, "utf8");
  }
  return { file: "AGENTS.md", changed: next !== current };
}

export function removeMcpServerRules(workspaceRoot: string, id: string): boolean {
  const file = path.join(workspaceRoot, "AGENTS.md");
  if (!fs.existsSync(file)) {
    return false;
  }
  const current = fs.readFileSync(file, "utf8");
  const next = removeMcpServerSection(current, id);
  if (next === current) {
    return false;
  }
  fs.writeFileSync(file, next, "utf8");
  return true;
}
