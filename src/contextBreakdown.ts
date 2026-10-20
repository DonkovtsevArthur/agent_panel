/**
 * Context window breakdown for the composer «Context» popover.
 *
 * Input is the real model request Cline is about to send (system prompt,
 * tool definitions, messages — captured by the `beforeModel` hook in
 * contextBreakdownExtension.ts) plus the Harbor-known parts inside it (skill
 * catalog, MCP server hint). No exact tokenizer is available for arbitrary
 * OpenAI-compatible gateways, so every part is estimated from characters and
 * the whole picture is then scaled to the prompt tokens the API reported.
 *
 * Pure and vscode-free (unit-tested in tests/contextBreakdown.test.js).
 */

export type ContextCategoryId =
  | "messages"
  | "systemTools"
  | "mcpTools"
  | "systemPrompt"
  | "skills"
  | "memoryFiles"
  | "mcpInstructions"
  | "autocompactBuffer"
  | "freeSpace";

export interface ContextToolDef {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface ContextBreakdownCategory {
  id: ContextCategoryId;
  tokens: number;
}

export interface ContextBreakdownItem {
  name: string;
  tokens: number;
  /** MCP tool behind a `<server>_read` / `_write` dispatcher (not sent). */
  deferred?: boolean;
}

export interface ContextBreakdown {
  contextWindow: number;
  /** Tokens in the window: categories before autocompact buffer / free space. */
  used: number;
  categories: ContextBreakdownCategory[];
  /** Tool schemas that are not sent with the request (tools on demand). */
  deferred: { mcpTools: number; systemTools: number };
  mcpTools: ContextBreakdownItem[];
  memoryFiles: ContextBreakdownItem[];
  /** True when the estimate was scaled to the API-reported prompt tokens. */
  calibrated: boolean;
  /** Request time (ms since epoch). */
  at: number;
}

export interface ContextBreakdownInput {
  systemPrompt: string;
  tools: ContextToolDef[];
  messages: unknown[];
  /** Harbor skill catalog text inside the system prompt. */
  skillsText?: string;
  /** MCP server instructions (McpManager system hint) inside the system prompt. */
  mcpInstructions?: string;
  deferredMcpTools?: ContextToolDef[];
  deferredSystemTools?: ContextToolDef[];
  contextWindow: number;
  /** Request size that triggers auto compact; 0 / undefined = auto compact off. */
  compactTriggerTokens?: number;
  /** Last API usage for this request — used to scale the estimate. */
  usage?: { promptTokens?: number; completionTokens?: number };
  at?: number;
}

/** Rough per-image cost; real numbers depend on model and resolution. */
export const IMAGE_TOKENS_ESTIMATE = 1500;
/** Role / separators per message on the wire. */
const MESSAGE_OVERHEAD_TOKENS = 4;
/** Wrapper of one tool definition on the wire. */
const TOOL_OVERHEAD_TOKENS = 8;

export const MCP_TOOL_PREFIX = "mcp__";

/** Headers written by src/turnContext.ts / src/projectMemory.ts. */
const PROJECT_MEMORY_HEADER = "Project memory (.harbor/memory.md";
const PROJECT_MEMORY_NAME = ".harbor/memory.md";
const WORKSPACE_RULES_HEADER = "Matching workspace rules for the current file(s)";
const WORKSPACE_RULE_HEADING = "# Workspace rule: ";
/** Turn-context blocks that may follow the workspace rules block. */
const TURN_CONTEXT_FOLLOWERS = [
  "\n\nDev runtime context",
  "\n\nLast IDE terminal",
  "\n\nRecently viewed",
];
/** Cline `formatRulesForSystemPrompt` (vendor/cline runtime/safety/rules.ts). */
const CLINE_RULES_HEADING = "\n# Rules\n";
/** Harbor's capped copy of a huge AGENTS.md (workspaceRules.ts). */
const OVERSIZED_AGENTS_MD_HEADING = "## Workspace AGENTS.md\n";

/**
 * chars → tokens. ~4 chars per token for Latin text / code, ~2 for Cyrillic
 * and other non-ASCII (BPE vocabularies split them finer).
 */
export function estimateTokens(text: string): number {
  const value = String(text || "");
  if (!value) {
    return 0;
  }
  let ascii = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) < 128) {
      ascii += 1;
    }
  }
  return Math.ceil(ascii / 4 + (value.length - ascii) / 2);
}

export function estimateToolTokens(tool: ContextToolDef): number {
  let schema = "";
  try {
    schema = tool.inputSchema === undefined ? "" : JSON.stringify(tool.inputSchema);
  } catch {
    schema = "";
  }
  return (
    TOOL_OVERHEAD_TOKENS +
    estimateTokens(String(tool.name || "")) +
    estimateTokens(String(tool.description || "")) +
    estimateTokens(schema)
  );
}

function isImagePart(value: Record<string, unknown>): boolean {
  const type = String(value.type || "");
  return type === "image" || type === "image_url" || type === "file";
}

/** Text of a message tree without image payloads; counts images separately. */
function collectMessageText(
  value: unknown,
  out: { text: string[]; images: number },
  depth = 0
): void {
  if (depth > 12 || value === null || value === undefined) {
    return;
  }
  if (typeof value === "string") {
    // Inline data URLs / base64 blobs are images, not text tokens.
    if (value.startsWith("data:") && value.length > 256) {
      out.images += 1;
      return;
    }
    out.text.push(value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    out.text.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectMessageText(entry, out, depth + 1);
    }
    return;
  }
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    if (isImagePart(row)) {
      out.images += 1;
      return;
    }
    for (const [key, entry] of Object.entries(row)) {
      // Ids and roles are tiny and not model text.
      if (key === "id" || key === "toolCallId" || key === "role" || key === "type") {
        continue;
      }
      collectMessageText(entry, out, depth + 1);
    }
  }
}

export function messagesText(messages: unknown[]): { text: string; images: number } {
  const out = { text: [] as string[], images: 0 };
  collectMessageText(messages, out);
  return { text: out.text.join("\n"), images: out.images };
}

function addItem(map: Map<string, number>, name: string, tokens: number): void {
  if (!name || tokens <= 0) {
    return;
  }
  map.set(name, (map.get(name) || 0) + tokens);
}

/**
 * Rule files Cline appended to the system prompt (`# Rules` / `## <name>`)
 * plus Harbor's capped AGENTS.md copy. Returns per-file token estimates.
 */
export function systemPromptMemoryFiles(systemPrompt: string): Map<string, number> {
  const files = new Map<string, number>();
  const prompt = String(systemPrompt || "");
  const rulesAt = prompt.lastIndexOf(CLINE_RULES_HEADING);
  if (rulesAt >= 0) {
    const block = prompt.slice(rulesAt + CLINE_RULES_HEADING.length);
    const sections = block.split(/^## /m).filter((part) => part.trim());
    sections.forEach((section, index) => {
      const newline = section.indexOf("\n");
      const name = (newline >= 0 ? section.slice(0, newline) : section).trim();
      // The shared "# Rules" heading rides on the first file.
      const heading = index === 0 ? estimateTokens(CLINE_RULES_HEADING) : 0;
      addItem(files, name, heading + estimateTokens(`## ${section}`));
    });
  }
  const agentsAt = prompt.indexOf(OVERSIZED_AGENTS_MD_HEADING);
  if (agentsAt >= 0 && (rulesAt < 0 || agentsAt < rulesAt)) {
    const rest = prompt.slice(agentsAt);
    const end = rest.indexOf("chars are in the prompt.");
    const close = end >= 0 ? rest.indexOf("]", end) : -1;
    const block = close >= 0 ? rest.slice(0, close + 1) : rest;
    addItem(files, "AGENTS.md", estimateTokens(block));
  }
  return files;
}

/** Project memory and `.cursor/rules` blocks Harbor put into user messages. */
export function messageMemoryFiles(text: string): Map<string, number> {
  const files = new Map<string, number>();
  const body = String(text || "");
  let from = 0;
  for (;;) {
    const at = body.indexOf(PROJECT_MEMORY_HEADER, from);
    if (at < 0) {
      break;
    }
    const end = body.indexOf("\n\n", at);
    const block = body.slice(at, end >= 0 ? end : body.length);
    addItem(files, PROJECT_MEMORY_NAME, estimateTokens(block));
    from = at + block.length;
  }
  from = 0;
  for (;;) {
    const at = body.indexOf(WORKSPACE_RULES_HEADER, from);
    if (at < 0) {
      break;
    }
    let end = body.length;
    for (const follower of TURN_CONTEXT_FOLLOWERS) {
      const next = body.indexOf(follower, at);
      if (next >= 0 && next < end) {
        end = next;
      }
    }
    const nextRules = body.indexOf(WORKSPACE_RULES_HEADER, at + 1);
    if (nextRules >= 0 && nextRules < end) {
      end = nextRules;
    }
    const block = body.slice(at, end);
    const parts = block.split(WORKSPACE_RULE_HEADING).slice(1);
    for (const part of parts) {
      const newline = part.indexOf("\n");
      const name = (newline >= 0 ? part.slice(0, newline) : part).trim();
      addItem(files, name, estimateTokens(WORKSPACE_RULE_HEADING + part));
    }
    from = end;
  }
  return files;
}

function sumMap(map: Map<string, number>): number {
  let total = 0;
  for (const value of map.values()) {
    total += value;
  }
  return total;
}

/** Tokens of `part` when it really is inside `text`, else 0. */
function containedTokens(text: string, part: string | undefined): number {
  const value = String(part || "").trim();
  if (!value || !text.includes(value)) {
    return 0;
  }
  return estimateTokens(value);
}

export function computeContextBreakdown(input: ContextBreakdownInput): ContextBreakdown {
  const contextWindow = Math.max(1, Math.floor(Number(input.contextWindow) || 0));
  const systemPrompt = String(input.systemPrompt || "");

  // --- System prompt and what Harbor knows is inside it ---
  const systemTotal = estimateTokens(systemPrompt);
  const skills = containedTokens(systemPrompt, input.skillsText);
  const mcpInstructions = containedTokens(systemPrompt, input.mcpInstructions);
  const systemMemory = systemPromptMemoryFiles(systemPrompt);
  const systemMemoryTokens = sumMap(systemMemory);
  const systemRest = Math.max(
    0,
    systemTotal - skills - mcpInstructions - systemMemoryTokens
  );

  // --- Tools sent with the request ---
  let systemTools = 0;
  let mcpTools = 0;
  const mcpItems: ContextBreakdownItem[] = [];
  for (const tool of input.tools || []) {
    const tokens = estimateToolTokens(tool);
    if (String(tool.name || "").startsWith(MCP_TOOL_PREFIX)) {
      mcpTools += tokens;
      mcpItems.push({ name: tool.name, tokens });
    } else {
      systemTools += tokens;
    }
  }

  // --- Conversation ---
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const flat = messagesText(messages);
  const messageMemory = messageMemoryFiles(flat.text);
  const messageMemoryTokens = sumMap(messageMemory);
  const messagesTotal =
    estimateTokens(flat.text) +
    flat.images * IMAGE_TOKENS_ESTIMATE +
    messages.length * MESSAGE_OVERHEAD_TOKENS;
  const messagesRest = Math.max(0, messagesTotal - messageMemoryTokens);

  const memoryMap = new Map<string, number>();
  for (const map of [systemMemory, messageMemory]) {
    for (const [name, tokens] of map) {
      addItem(memoryMap, name, tokens);
    }
  }

  // --- Scale the estimate to the API-reported prompt size ---
  const estimatedPrompt =
    systemRest +
    skills +
    mcpInstructions +
    systemMemoryTokens +
    systemTools +
    mcpTools +
    messagesRest +
    messageMemoryTokens;
  const promptTokens = Math.max(0, Number(input.usage?.promptTokens) || 0);
  const completionTokens = Math.max(0, Number(input.usage?.completionTokens) || 0);
  const calibrated = promptTokens > 0 && estimatedPrompt > 0;
  const scale = calibrated ? promptTokens / estimatedPrompt : 1;
  const scaled = (n: number) => Math.round(n * scale);

  const memoryFiles = [...memoryMap.entries()]
    .map(([name, tokens]) => ({ name, tokens: scaled(tokens) }))
    .sort((a, b) => b.tokens - a.tokens);
  const memoryTokens = memoryFiles.reduce((sum, item) => sum + item.tokens, 0);

  const categoriesUsed: ContextBreakdownCategory[] = [
    // The reply becomes part of the next request.
    { id: "messages", tokens: scaled(messagesRest) + completionTokens },
    { id: "systemTools", tokens: scaled(systemTools) },
    { id: "mcpTools", tokens: scaled(mcpTools) },
    { id: "systemPrompt", tokens: scaled(systemRest) },
    { id: "skills", tokens: scaled(skills) },
    { id: "memoryFiles", tokens: memoryTokens },
    { id: "mcpInstructions", tokens: scaled(mcpInstructions) },
  ];
  const used = categoriesUsed.reduce((sum, c) => sum + c.tokens, 0);

  const trigger = Math.max(0, Math.floor(Number(input.compactTriggerTokens) || 0));
  const autocompactBuffer =
    trigger > 0 && trigger < contextWindow
      ? Math.max(0, Math.min(contextWindow - trigger, contextWindow - used))
      : 0;
  const freeSpace = Math.max(0, contextWindow - used - autocompactBuffer);

  const deferredMcp = input.deferredMcpTools || [];
  const deferredItems = deferredMcp.map((tool) => ({
    name: tool.name,
    tokens: estimateToolTokens(tool),
    deferred: true,
  }));

  return {
    contextWindow,
    used,
    categories: [
      ...categoriesUsed,
      { id: "autocompactBuffer", tokens: autocompactBuffer },
      { id: "freeSpace", tokens: freeSpace },
    ],
    deferred: {
      mcpTools: deferredItems.reduce((sum, item) => sum + item.tokens, 0),
      systemTools: (input.deferredSystemTools || []).reduce(
        (sum, tool) => sum + estimateToolTokens(tool),
        0
      ),
    },
    mcpTools: [
      ...mcpItems
        .map((item) => ({ name: item.name, tokens: scaled(item.tokens) }))
        .sort((a, b) => b.tokens - a.tokens),
      ...deferredItems.sort((a, b) => b.tokens - a.tokens),
    ],
    memoryFiles,
    calibrated,
    at: Number(input.at) || Date.now(),
  };
}
