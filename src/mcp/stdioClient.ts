import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Local Framelink / community Figma MCP via npx (PAT / FIGMA_API_KEY).
 */
export async function connectFigmaPat(accessToken: string): Promise<Client> {
  const token = accessToken.trim();
  if (!token) {
    throw new Error("Figma Personal Access Token is empty");
  }

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "figma-developer-mcp", "--stdio"],
    env: {
      ...getDefaultEnvironment(),
      FIGMA_API_KEY: token,
    },
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
