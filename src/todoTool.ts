/**
 * Harbor extraTool: `update_todo` — the model maintains a visible task plan
 * (Cline's focus_chain analog; that feature lives only in Cline's VS Code app
 * and is not exposed via @cline/sdk, so Harbor ships its own tool).
 */
import type { AgentStepEvent, TodoStepItem } from "./agentSteps";
import { emitTodoStep } from "./todoStepContext";

type CreateTool = (config: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown, context: unknown) => Promise<unknown>;
  timeoutMs?: number;
}) => unknown;

export const TODO_TOOL = "update_todo";
/** Stable stepId — the webview card is upserted in place, one card per turn. */
export const TODO_STEP_ID = "todo-plan";

function normalizeSteps(raw: unknown): TodoStepItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const steps: TodoStepItem[] = [];
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const title = String((item as { title?: unknown }).title || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    if (!title) {
      continue;
    }
    const status = String((item as { status?: unknown }).status || "pending");
    steps.push({
      title,
      status:
        status === "in_progress" || status === "done" ? status : "pending",
    });
  }
  return steps;
}

export function createTodoTool(createTool: CreateTool): unknown {
  return createTool({
    name: TODO_TOOL,
    description: [
      "Maintain the visible task plan shown to the user as a progress card.",
      "In Agent and Plan modes call it ALWAYS, on every user request, without exception — as your VERY FIRST tool, with the full step list (all 'pending', first 'in_progress'). Even a single-step task gets one step.",
      "Call it again whenever a step completes or the plan changes — always pass the FULL updated list (it replaces the card, it is not an append).",
      "When everything is done, make a final call with every step 'done'.",
      "Main agent only: do not call from spawned sub-agents.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          description: "Full task plan, 1-12 steps, in execution order.",
          items: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Short imperative step title (max ~80 chars).",
              },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "done"],
                description:
                  "Exactly one step should be 'in_progress' while working.",
              },
            },
            required: ["title", "status"],
          },
        },
      },
      required: ["steps"],
    },
    execute: async (input: unknown) => {
      const raw = (input as { steps?: unknown } | null)?.steps;
      const steps = normalizeSteps(raw);
      if (!steps.length) {
        return "No valid steps provided. Pass steps: [{title, status}].";
      }
      const done = steps.filter((s) => s.status === "done").length;
      const event: AgentStepEvent = {
        stepId: TODO_STEP_ID,
        kind: "todo",
        name: TODO_TOOL,
        status: done === steps.length ? "done" : "running",
        steps,
        argsPreview: `${done}/${steps.length}`,
      };
      emitTodoStep(event);
      return `Plan updated (${done}/${steps.length} done). Continue with the next step.`;
    },
    timeoutMs: 5_000,
  });
}
