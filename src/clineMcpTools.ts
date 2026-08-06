/**
 * Bridge Harbor MCP (Figma + custom servers) into Cline AgentTool[].
 */
import type { ChatTool } from "./openaiClient";
import { getMcpManager } from "./mcpBundle";
import { messageHasFigmaUrl } from "./mcp/figma";

export type ClineCreateTool = (config: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown, context: unknown) => Promise<unknown>;
  timeoutMs?: number;
}) => unknown;

/**
 * Connected Harbor MCP tools as Cline Agent tools (qualified names).
 * Plan/Ask: readonly MCP only; Agent: full connected set.
 */
export async function loadHarborMcpToolsForCline(options: {
  createTool: ClineCreateTool;
  readonlyOnly: boolean;
}): Promise<{ tools: unknown[]; toolNames: string[]; systemHint: string }> {
  const mcp = getMcpManager();
  if (!mcp) {
    return { tools: [], toolNames: [], systemHint: "" };
  }

  let chatTools: ChatTool[] = [];
  try {
    chatTools = await mcp.listOpenAiTools(options.readonlyOnly);
  } catch {
    chatTools = [];
  }

  const tools = chatTools.map((chatTool) => {
    const name = String(chatTool.function?.name || "").trim();
    const description = String(chatTool.function?.description || name).trim();
    const inputSchema =
      chatTool.function?.parameters &&
      typeof chatTool.function.parameters === "object"
        ? (chatTool.function.parameters as Record<string, unknown>)
        : { type: "object", properties: {} };

    return options.createTool({
      name,
      description: description || `MCP tool ${name}`,
      inputSchema,
      timeoutMs: 120_000,
      execute: async (input: unknown) => {
        let argsJson = "{}";
        try {
          argsJson = JSON.stringify(
            input && typeof input === "object" ? input : {}
          );
        } catch {
          argsJson = "{}";
        }
        try {
          return await mcp.callTool(name, argsJson);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return JSON.stringify({ error: message });
        }
      },
    });
  });

  const toolNames = chatTools
    .map((t) => String(t.function?.name || "").trim())
    .filter(Boolean);
  const systemHint = mcp.buildSystemHint(toolNames).trim();
  return { tools, toolNames, systemHint };
}

/** True when the user pasted a Figma URL but Harbor Figma MCP is not connected. */
export function shouldNotifyFigmaNeedsConnect(userText: string): boolean {
  if (!messageHasFigmaUrl(userText)) {
    return false;
  }
  const mcp = getMcpManager();
  if (!mcp) {
    return true;
  }
  const status = mcp.getStatus();
  if (status.enabled === false) {
    return true;
  }
  return status.state !== "connected";
}
