/**
 * Slim OpenAI-compatible chat turn for the Figma host.
 * Runs in the UI iframe (fetch). No Cline, no IDE tools.
 * Mirror of media/src/panel-figma/02-agent-turn.js — keep in sync conceptually.
 */

export type FigmaProvider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
};

export type FigmaModel = {
  id: string;
  label?: string;
  providerId: string;
  supportsVision?: boolean;
};

export type FigmaSelectionPayload = {
  fileKey?: string;
  fileName?: string;
  pageName?: string;
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    width?: number;
    height?: number;
    children?: unknown[];
  }>;
  previewPngDataUrl?: string;
  nodeUrl?: string;
  canWrite?: boolean;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<Record<string, unknown>> | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
};

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function designSystemPrompt(mode: "ask" | "plan" | "agent"): string {
  const base =
    "You are Harbor Agents for Figma — a design assistant inside Figma. " +
    "You help designers critique, name, structure, and hand off UI. " +
    "Ground answers in the current selection JSON and screenshot when provided. " +
    "Use tools to inspect or focus nodes by real ids from the selection — never invent node ids. " +
    "Be concise. Do not invent layers that are not in the selection.";
  if (mode === "agent") {
    return (
      base +
      " Mode: Agent. You may edit the canvas via write tools " +
      "(rename, set text, solid fills, auto-layout padding/gap). " +
      "Do not create or delete nodes. Prefer small targeted edits. " +
      "If a write fails (e.g. Dev Mode), explain and continue with advice only."
    );
  }
  if (mode === "plan") {
    return (
      base +
      " Mode: Plan. Produce a clear implementation / design plan with Goal and numbered Steps. " +
      "You may inspect/focus nodes with read tools. Do not edit the canvas. " +
      "End with a short handoff brief a developer can paste into an IDE agent."
    );
  }
  return (
    base +
    " Mode: Ask. Answer the design question; do not invent a full build plan unless asked. " +
    "You may inspect/focus nodes with read tools. Do not edit the canvas."
  );
}

export function buildSelectionContextText(
  selection: FigmaSelectionPayload | null
): string {
  if (!selection || !selection.nodes || selection.nodes.length === 0) {
    return "Current Figma selection: (none — ask the user to select a frame or node).";
  }
  const header = [
    selection.fileName ? `File: ${selection.fileName}` : null,
    selection.pageName ? `Page: ${selection.pageName}` : null,
    selection.nodeUrl ? `Link: ${selection.nodeUrl}` : null,
    selection.canWrite === false
      ? "Canvas writes: unavailable (Dev Mode)"
      : "Canvas writes: available in Agent mode",
  ]
    .filter(Boolean)
    .join("\n");
  return `${header}\nSelection JSON:\n${JSON.stringify(selection.nodes, null, 2)}`;
}

export function buildHandoffBrief(opts: {
  planText: string;
  selection: FigmaSelectionPayload | null;
}): string {
  const link = opts.selection?.nodeUrl || "(no node link)";
  const name =
    opts.selection?.nodes?.[0]?.name ||
    opts.selection?.fileName ||
    "selection";
  return [
    `# Harbor handoff — ${name}`,
    "",
    `Figma: ${link}`,
    "",
    opts.planText.trim(),
    "",
  ].join("\n");
}

export type StreamHandlers = {
  onDelta: (text: string) => void;
  signal?: AbortSignal;
  invokeTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  onToolStep?: (step: {
    name: string;
    label: string;
    status: string;
    error?: string;
    args?: Record<string, unknown>;
  }) => void;
};

export async function runFigmaAgentTurn(opts: {
  provider: FigmaProvider;
  model: FigmaModel;
  mode: "ask" | "plan" | "agent";
  userText: string;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  selection: FigmaSelectionPayload | null;
  handlers: StreamHandlers;
}): Promise<string> {
  // Runtime path is media/src/panel-figma/02-agent-turn.js — this TS mirror documents the API.
  void opts;
  throw new Error(
    "Use media/src/panel-figma/02-agent-turn.js via the Figma UI bundle"
  );
}
