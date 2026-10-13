/**
 * update_todo reminder as a Cline `afterTool` extension. On a turn that got
 * the plan-card nudge (needsPlanCard), a model that has already made
 * TODO_REMINDER_AFTER_TOOLS tool calls without update_todo gets one note
 * appended to the next tool result: «create the plan now». Once per turn,
 * root agent only (spawned sub-agents never call update_todo).
 *
 * The extension is created once per Cline session while the turn state lives
 * in runClineAgentTurn — same AsyncLocalStorage bridge as todoStepContext.
 */
import { AsyncLocalStorage } from "async_hooks";
import type { UiLanguage } from "./i18n";
import { TODO_TOOL } from "./todoTool";

export const HARBOR_TODO_REMINDER_EXTENSION_NAME = "harbor.todo-reminder";

/** Tool calls without a plan before the reminder fires. */
export const TODO_REMINDER_AFTER_TOOLS = 3;

export interface TodoReminderState {
  /** This turn expects a plan card (nudge was sent). */
  armed: boolean;
  lang: UiLanguage;
  toolsWithoutPlan: number;
  done: boolean;
}

const stateAls = new AsyncLocalStorage<TodoReminderState>();
let fallback: TodoReminderState | undefined;

export function createTodoReminderState(
  armed: boolean,
  lang: UiLanguage
): TodoReminderState {
  return { armed, lang, toolsWithoutPlan: 0, done: !armed };
}

export function withTodoReminder<T>(
  state: TodoReminderState,
  fn: () => Promise<T>
): Promise<T> {
  const previous = fallback;
  fallback = state;
  return stateAls.run(state, fn).finally(() => {
    fallback = previous;
  });
}

export function todoReminderText(lang: UiLanguage): string {
  return lang === "ru"
    ? `[Harbor] Ты сделал уже ${TODO_REMINDER_AFTER_TOOLS}+ вызова инструментов без плана. Это многошаговая задача — вызови update_todo СЕЙЧАС (полный список шагов, текущий — 'in_progress'), затем продолжай. Пользователь следит за ходом работы по этой карточке.`
    : `[Harbor] You have made ${TODO_REMINDER_AFTER_TOOLS}+ tool calls without a plan. This is multi-step work — call update_todo NOW (full step list, current step 'in_progress'), then continue. The user follows progress through that card.`;
}

/**
 * Append the note to a tool output without breaking hosts that parse it
 * (UI metrics read structured outputs): string → appended text, content-part
 * array → extra text part, plain object → extra `harbor_note` field.
 * Anything else → undefined (try again on the next tool).
 */
export function appendTodoReminderToOutput(
  output: unknown,
  note: string
): unknown | undefined {
  if (typeof output === "string") {
    return output ? `${output}\n\n${note}` : note;
  }
  if (Array.isArray(output)) {
    const isContentParts =
      output.length > 0 &&
      output.every(
        (part) =>
          part &&
          typeof part === "object" &&
          typeof (part as { type?: unknown }).type === "string"
      );
    return isContentParts ? [...output, { type: "text", text: note }] : undefined;
  }
  if (output && typeof output === "object") {
    return { ...(output as Record<string, unknown>), harbor_note: note };
  }
  return undefined;
}

type ToolCallPartLike = { type?: unknown; toolCallId?: unknown; toolName?: unknown };
type MessageLike = { role?: unknown; content?: unknown };

type AfterToolContext = {
  snapshot?: { parentAgentId?: string | null; messages?: readonly unknown[] };
  tool?: { name?: string };
  toolCall?: { toolName?: string; toolCallId?: string };
  result?: { output: unknown; isError?: boolean; metadata?: Record<string, unknown> };
};

function toolCallParts(message: unknown): ToolCallPartLike[] {
  const content = (message as MessageLike | undefined)?.content;
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter(
    (part): part is ToolCallPartLike =>
      !!part &&
      typeof part === "object" &&
      (part as ToolCallPartLike).type === "tool-call"
  );
}

/**
 * True when the assistant message that issued the current tool call also
 * calls update_todo — the model already made the plan in this batch, so a
 * sibling tool must not get the reminder (sequential execution runs
 * `[read, read, read, update_todo]` in order, and parallel execution fires
 * afterTool in completion order).
 */
export function batchHasTodoCall(context: AfterToolContext): boolean {
  const messages = context.snapshot?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return false;
  }
  const callId = context.toolCall?.toolCallId;
  let batch: ToolCallPartLike[] | undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as MessageLike | undefined;
    if (message?.role !== "assistant") {
      continue;
    }
    const parts = toolCallParts(message);
    if (!callId || parts.some((part) => part.toolCallId === callId)) {
      batch = parts;
      break;
    }
  }
  return !!batch && batch.some((part) => part.toolName === TODO_TOOL);
}

export function createHarborTodoReminderExtension(): {
  name: string;
  manifest: { capabilities: string[] };
  hooks: {
    afterTool: (
      context: AfterToolContext
    ) => { result: NonNullable<AfterToolContext["result"]> } | undefined;
  };
} {
  return {
    name: HARBOR_TODO_REMINDER_EXTENSION_NAME,
    manifest: { capabilities: ["hooks"] },
    hooks: {
      afterTool(context) {
        const state = stateAls.getStore() || fallback;
        if (!state || state.done || !state.armed) {
          return undefined;
        }
        // Spawned sub-agents run inside the same turn — never count them.
        if (context.snapshot?.parentAgentId) {
          return undefined;
        }
        const name = String(
          context.tool?.name || context.toolCall?.toolName || ""
        );
        if (name === TODO_TOOL || batchHasTodoCall(context)) {
          state.done = true;
          return undefined;
        }
        state.toolsWithoutPlan += 1;
        if (state.toolsWithoutPlan < TODO_REMINDER_AFTER_TOOLS || !context.result) {
          return undefined;
        }
        const output = appendTodoReminderToOutput(
          context.result.output,
          todoReminderText(state.lang)
        );
        if (output === undefined) {
          return undefined;
        }
        state.done = true;
        return { result: { ...context.result, output } };
      },
    },
  };
}

/** Merge the reminder into a Cline session `extensions` array (idempotent). */
export function withHarborTodoReminderExtension(prior: unknown): unknown[] {
  const list = Array.isArray(prior) ? [...prior] : [];
  const filtered = list.filter(
    (entry) =>
      !entry ||
      typeof entry !== "object" ||
      String((entry as { name?: unknown }).name || "") !==
        HARBOR_TODO_REMINDER_EXTENSION_NAME
  );
  filtered.push(createHarborTodoReminderExtension());
  return filtered;
}
