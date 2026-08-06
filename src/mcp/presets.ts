/**
 * One-click MCP server presets for Settings → MCP Servers.
 * vscode-free so unit tests can import without the VS Code module.
 */

export type McpPresetId = "playwright" | "github";

export interface McpPresetDef {
  id: McpPresetId;
  /** Display name for the server card / modal. */
  name: string;
  transport: "stdio" | "http";
  /** stdio */
  command?: string;
  args?: string[];
  /** Non-secret env hint lines (KEY=value); empty values prompt the user. */
  envHint?: Record<string, string>;
  /** http */
  url?: string;
  /** True when the user must paste a bearer token before connect. */
  needsBearerToken?: boolean;
  /** Short note shown when opening the prefilled modal. */
  noteEn: string;
  noteRu: string;
}

export const MCP_PRESETS: readonly McpPresetDef[] = [
  {
    id: "playwright",
    name: "Playwright Browser",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest", "--headless"],
    noteEn:
      "Interactive browser via Playwright MCP (navigate, snapshot, click). Needs Node.js / npx. Harbor also has builtin browser_* tools.",
    noteRu:
      "Интерактивный браузер через Playwright MCP (navigate, snapshot, click). Нужен Node.js / npx. В Harbor также есть builtin browser_* tools.",
  },
  {
    id: "github",
    name: "GitHub",
    transport: "http",
    url: "https://api.githubcopilot.com/mcp/",
    needsBearerToken: true,
    noteEn:
      "GitHub remote MCP. Paste a Personal Access Token (repo / issues / PRs scopes) into Bearer token, then Save & Connect.",
    noteRu:
      "Удалённый GitHub MCP. Вставьте Personal Access Token (scopes: repo / issues / PRs) в Bearer token, затем Save & Connect.",
  },
];

export function getMcpPreset(id: string): McpPresetDef | undefined {
  return MCP_PRESETS.find((p) => p.id === id);
}

/** Prefill payload for the custom MCP edit modal / upsert. */
export function mcpPresetToModalPrefill(preset: McpPresetDef): {
  name: string;
  transport: "stdio" | "http";
  command: string;
  argsText: string;
  envText: string;
  url: string;
  note: string;
  needsBearerToken: boolean;
} {
  return {
    name: preset.name,
    transport: preset.transport,
    command: preset.command || "",
    argsText: Array.isArray(preset.args) ? preset.args.join(" ") : "",
    envText: preset.envHint
      ? Object.entries(preset.envHint)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n")
      : "",
    url: preset.url || "",
    note: preset.noteEn,
    needsBearerToken: Boolean(preset.needsBearerToken),
  };
}
