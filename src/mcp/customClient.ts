import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerConfig } from "./types";

export async function connectCustomMcpServer(options: {
  config: McpServerConfig;
  bearerToken?: string;
  secretEnv?: Record<string, string>;
}): Promise<Client> {
  const { config } = options;
  if (config.transport === "http") {
    return connectHttp(config, options.bearerToken);
  }
  return connectStdio(config, options.secretEnv);
}

async function connectHttp(
  config: McpServerConfig,
  bearerToken?: string
): Promise<Client> {
  const url = String(config.url || "").trim();
  if (!url) {
    throw new Error("HTTP MCP server URL is empty");
  }
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
  };
  if (bearerToken?.trim()) {
    headers.Authorization = `Bearer ${bearerToken.trim()}`;
  }
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers },
  });
  const client = new Client(
    { name: "harbor-agents", version: "1.0.0" },
    { capabilities: {} }
  );
  await client.connect(transport);
  return client;
}

async function connectStdio(
  config: McpServerConfig,
  secretEnv?: Record<string, string>
): Promise<Client> {
  const command = String(config.command || "").trim();
  if (!command) {
    throw new Error("stdio MCP command is empty");
  }
  const env: Record<string, string> = {
    ...getDefaultEnvironment(),
    ...(config.env || {}),
    ...(secretEnv || {}),
  };
  const transport = new StdioClientTransport({
    command,
    args: config.args || [],
    env,
    cwd: config.cwd || undefined,
    stderr: "pipe",
  });
  const client = new Client(
    { name: "harbor-agents", version: "1.0.0" },
    { capabilities: {} }
  );
  const stderrChunks: string[] = [];
  const stderr = transport.stderr;
  if (stderr) {
    stderr.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(String(chunk));
    });
  }
  try {
    await client.connect(transport);
    return client;
  } catch (error) {
    const detail = stderrChunks.join("").trim().slice(-2000);
    const base = error instanceof Error ? error.message : String(error);
    throw new Error(detail ? `${base}\n${detail}` : base);
  }
}
