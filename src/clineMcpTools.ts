/**
 * Bridge Harbor MCP (Figma + custom servers) into Cline via createMcpTools.
 * Keeps Harbor Connect (OAuth/PAT); returns raw MCP content so Cline can
 * forward screenshot images inside tool-results.
 */
import { getConfig, resolveModelSupportsVision } from "./config";
import { describeMcpImagesForMainModel } from "./figmaVisionHelper";
import { getMcpManager } from "./mcpBundle";
import {
  figmaPlanAntiDriftHint,
  figmaUserTurnNudge,
  messageHasFigmaUrl,
  parseFigmaUrl,
  qualifyToolName,
  FIGMA_SERVER_ID,
} from "./mcp/figma";
import { splitMcpToolResult } from "./mcp/resultFormat";
import {
  parseQualifiedToolName,
  qualifyMcpToolName,
} from "./mcp/types";

export type ClineCreateMcpTools = (options: {
  serverName: string;
  provider: {
    listTools: (serverName: string) => Promise<
      readonly {
        name: string;
        description?: string;
        inputSchema: Record<string, unknown>;
      }[]
    >;
    callTool: (request: {
      serverName: string;
      toolName: string;
      arguments?: Record<string, unknown>;
      context?: { signal?: AbortSignal };
    }) => Promise<unknown>;
  };
  nameTransform?: (input: {
    serverName: string;
    toolName: string;
  }) => string;
  timeoutMs?: number;
}) => Promise<unknown[]> | unknown[];

/** @deprecated kept for type compatibility with older call sites */
export type ClineCreateTool = (config: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown, context: unknown) => Promise<unknown>;
  timeoutMs?: number;
}) => unknown;

function mcpContentHasImages(result: unknown): boolean {
  const split = splitMcpToolResult(result);
  return split.imageDataUrls.length > 0;
}

/**
 * MCP SDK uses mimeType; Cline/AI SDK tool-result path expects mediaType.
 * Prefer returning a content-block array so toAiSdkToolResultOutput sees images.
 */
function normalizeMcpResultForCline(result: unknown): unknown {
  if (!result || typeof result !== "object") {
    return result;
  }
  const row = result as { content?: unknown; isError?: boolean };
  if (!Array.isArray(row.content)) {
    return result;
  }
  const content = row.content.map((part) => {
    if (!part || typeof part !== "object") {
      return part;
    }
    const p = part as Record<string, unknown>;
    const type = String(p.type || "").toLowerCase();
    if (type !== "image" && type !== "image_url") {
      return part;
    }
    if (typeof p.data === "string" && p.data) {
      const mediaType =
        String(p.mediaType || p.mimeType || p.mime_type || "image/png").trim() ||
        "image/png";
      return { type: "image", data: p.data, mediaType };
    }
    return part;
  });
  // Return the array directly — Cline treats text|image block arrays as multimodal.
  if (row.isError) {
    return { content, isError: true };
  }
  return content;
}

/**
 * Connected Harbor MCP tools as Cline Agent tools (via createMcpTools).
 * Plan/Ask: readonly MCP only; Agent: full connected set.
 */
export async function loadHarborMcpToolsForCline(options: {
  createMcpTools: ClineCreateMcpTools;
  readonlyOnly: boolean;
  plannerModelId?: string;
  /** When true (Plan + Figma URL), append anti-drift hint. */
  figmaUrlInTurn?: boolean;
}): Promise<{ tools: unknown[]; toolNames: string[]; systemHint: string }> {
  const mcp = getMcpManager();
  if (!mcp) {
    return { tools: [], toolNames: [], systemHint: "" };
  }

  let chatTools: Awaited<ReturnType<typeof mcp.listOpenAiTools>> = [];
  try {
    chatTools = await mcp.listOpenAiTools(options.readonlyOnly);
  } catch {
    chatTools = [];
  }

  const byServer = new Map<
    string,
    {
      name: string;
      description?: string;
      inputSchema: Record<string, unknown>;
    }[]
  >();

  for (const chatTool of chatTools) {
    const qualified = String(chatTool.function?.name || "").trim();
    const parsed = parseQualifiedToolName(qualified);
    if (!parsed) {
      continue;
    }
    const list = byServer.get(parsed.serverId) || [];
    list.push({
      name: parsed.toolName,
      description: String(chatTool.function?.description || parsed.toolName).trim(),
      inputSchema:
        chatTool.function?.parameters &&
        typeof chatTool.function.parameters === "object"
          ? (chatTool.function.parameters as Record<string, unknown>)
          : { type: "object", properties: {} },
    });
    byServer.set(parsed.serverId, list);
  }

  const plannerModelId = String(options.plannerModelId || "").trim();
  const plannerSupportsVision =
    plannerModelId.length > 0 && resolveModelSupportsVision(plannerModelId);
  const visionPreferenceIds = getConfig().visionRouting.preferredModelIds;

  const provider = {
    listTools: async (serverName: string) => {
      return byServer.get(serverName) || [];
    },
    callTool: async (request: {
      serverName: string;
      toolName: string;
      arguments?: Record<string, unknown>;
      context?: { signal?: AbortSignal };
    }) => {
      const qualified = qualifyMcpToolName(request.serverName, request.toolName);
      let argsJson = "{}";
      try {
        argsJson = JSON.stringify(
          request.arguments && typeof request.arguments === "object"
            ? request.arguments
            : {}
        );
      } catch {
        argsJson = "{}";
      }

      const raw = await mcp.callToolRaw(qualified, argsJson);

      if (plannerSupportsVision || !mcpContentHasImages(raw)) {
        return normalizeMcpResultForCline(raw);
      }

      // Non-vision planner: OCR screenshots → Visible UI text.
      const split = splitMcpToolResult(raw);
      try {
        const described = await describeMcpImagesForMainModel({
          imageDataUrls: split.imageDataUrls,
          accompanyingText: split.text,
          visionPreferenceIds,
          signal: request.context?.signal,
        });
        return described;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [
            split.text,
            `[Harbor vision helper failed: ${message}. Call request_user_input if concrete labels are still missing.]`,
          ]
            .filter(Boolean)
            .join("\n\n");
      }
    },
  };

  const tools: unknown[] = [];
  const toolNames: string[] = [];

  for (const serverName of byServer.keys()) {
    const serverTools = await options.createMcpTools({
      serverName,
      provider,
      timeoutMs: 120_000,
      // Keep Harbor qualified names (mcp__figma__…) for hints / UI consistency.
      nameTransform: ({ serverName: s, toolName: t }) =>
        qualifyMcpToolName(s, t),
    });
    tools.push(...serverTools);
    for (const descriptor of byServer.get(serverName) || []) {
      toolNames.push(qualifyMcpToolName(serverName, descriptor.name));
    }
  }

  const hintParts = [mcp.buildSystemHint(toolNames).trim()];
  if (
    options.figmaUrlInTurn &&
    options.readonlyOnly &&
    toolNames.some((n) => n.startsWith(`mcp__${FIGMA_SERVER_ID}__`))
  ) {
    hintParts.push(figmaPlanAntiDriftHint());
  }

  return {
    tools,
    toolNames,
    systemHint: hintParts.filter(Boolean).join("\n\n"),
  };
}

/** Append Figma call instructions to the runtime user prompt (UI text unchanged). */
export function appendFigmaRuntimeNudge(userText: string): string {
  const base = String(userText || "").trim();
  const mcp = getMcpManager();
  if (!mcp) {
    return base;
  }
  const status = mcp.getStatus();
  if (status.enabled === false || status.state !== "connected") {
    return base;
  }
  const parsed = parseFigmaUrl(base);
  if (!parsed) {
    return base;
  }
  const nudge = figmaUserTurnNudge(parsed);
  return base ? `${base}\n\n${nudge}` : nudge;
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

export { messageHasFigmaUrl, parseFigmaUrl, qualifyToolName };
