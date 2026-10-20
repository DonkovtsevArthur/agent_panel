/**
 * Cline `beforeModel` extension that hands the real model request (system
 * prompt, tool definitions, messages) to the current Harbor turn, so the
 * «Context» popover measures what is actually sent (contextBreakdown.ts).
 * Read-only: never changes the request. Spawned sub-agents are skipped —
 * their requests are not this chat's context window.
 */
import { createTurnScopedValue } from "./turnScopedValue";
import type { ContextToolDef } from "./contextBreakdown";

export const HARBOR_CONTEXT_BREAKDOWN_EXTENSION_NAME = "harbor.context-breakdown";

export interface CapturedModelRequest {
  systemPrompt: string;
  tools: ContextToolDef[];
  messages: unknown[];
}

type Sink = (request: CapturedModelRequest) => void;

const sinkScope = createTurnScopedValue<Sink>();

export function withContextBreakdownSink<T>(
  sink: Sink,
  fn: () => Promise<T>
): Promise<T> {
  return sinkScope.run(sink, fn);
}

type BeforeModelContext = {
  snapshot?: { parentAgentId?: string };
  request?: {
    systemPrompt?: unknown;
    tools?: unknown;
    messages?: unknown;
  };
};

export function createHarborContextBreakdownExtension(): {
  name: string;
  manifest: { capabilities: string[] };
  hooks: { beforeModel: (context: BeforeModelContext) => undefined };
} {
  return {
    name: HARBOR_CONTEXT_BREAKDOWN_EXTENSION_NAME,
    manifest: { capabilities: ["hooks"] },
    hooks: {
      beforeModel(context) {
        const sink = sinkScope.get();
        if (!sink || context.snapshot?.parentAgentId) {
          return undefined;
        }
        const request = context.request || {};
        const tools = Array.isArray(request.tools)
          ? (request.tools as ContextToolDef[])
          : [];
        try {
          sink({
            systemPrompt: String(request.systemPrompt || ""),
            tools: tools.map((tool) => ({
              name: String(tool?.name || ""),
              description: tool?.description,
              inputSchema: tool?.inputSchema,
            })),
            messages: Array.isArray(request.messages) ? request.messages : [],
          });
        } catch {
          // Diagnostics only — never break the model call.
        }
        return undefined;
      },
    },
  };
}

/** Merge the extension into a Cline session `extensions` array (idempotent). */
export function withHarborContextBreakdownExtension(prior: unknown): unknown[] {
  const list = Array.isArray(prior) ? [...prior] : [];
  const filtered = list.filter(
    (entry) =>
      !entry ||
      typeof entry !== "object" ||
      String((entry as { name?: unknown }).name || "") !==
        HARBOR_CONTEXT_BREAKDOWN_EXTENSION_NAME
  );
  filtered.push(createHarborContextBreakdownExtension());
  return filtered;
}
