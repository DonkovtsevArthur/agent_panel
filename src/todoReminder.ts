/**
 * update_todo reminder as a Cline `afterTool` extension. On every Agent/Plan
 * turn (with or without the needsPlanCard nudge), a model that has already made
 * TODO_REMINDER_AFTER_TOOLS tool calls without update_todo gets one note
 * appended to the next tool result: «create the plan now». Once per turn,
 * root agent only (spawned sub-agents never call update_todo).
 *
 * Once a plan exists the extension also watches for a stale card: the model
 * keeps working (edits, commands) but never advances update_todo, so the
 * card freezes on the first step while the real work is already further on.
 * After TODO_STALE_AFTER_TOOLS tool calls or TODO_STALE_AFTER_EDITS file
 * edits since the last update_todo, one «sync the plan» note is appended
 * (at most TODO_STALE_MAX_REMINDERS in a row; every update_todo resets the
 * budget, so a long Build turn keeps getting nudges for each lagging stretch
 * instead of spending them all on the first steps). Works whether or not the
 * turn got the initial nudge — the model may create the plan on its own.
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
/** Tool calls since the last update_todo before the «plan is stale» note. */
export const TODO_STALE_AFTER_TOOLS = 8;
/** File edits since the last update_todo before the «plan is stale» note. */
export const TODO_STALE_AFTER_EDITS = 3;
/**
 * Stale-plan notes without an update_todo in between — keeps a stubborn model
 * from being spammed; update_todo resets it.
 */
export const TODO_STALE_MAX_REMINDERS = 2;

export interface TodoPlanStep {
  title: string;
  status: string;
}

export interface TodoReminderState {
  /** This turn expects a plan card (nudge was sent). */
  armed: boolean;
  lang: UiLanguage;
  /** Harbor Plan mode: the todo card tracks exploration, not the plan. */
  planMode?: boolean;
  toolsWithoutPlan: number;
  /** The «no plan yet» phase is over (plan seen or reminder sent). */
  done: boolean;
  /** Last steps passed to update_todo this turn (null — no plan yet). */
  plan: TodoPlanStep[] | null;
  toolsSinceUpdate: number;
  editsSinceUpdate: number;
  staleReminders: number;
}

const stateAls = new AsyncLocalStorage<TodoReminderState>();
let fallback: TodoReminderState | undefined;

export function createTodoReminderState(
  armed: boolean,
  lang: UiLanguage,
  modeId?: string
): TodoReminderState {
  return {
    armed,
    lang,
    planMode: String(modeId || "").toLowerCase() === "plan",
    toolsWithoutPlan: 0,
    done: !armed,
    plan: null,
    toolsSinceUpdate: 0,
    editsSinceUpdate: 0,
    staleReminders: 0,
  };
}

/** Same heuristic as clineRuntime's edit detection (editor, apply_patch, write…). */
export function isEditToolName(name: string): boolean {
  const n = String(name || "").toLowerCase();
  return (
    n === "editor" ||
    n === "apply_patch" ||
    n.includes("edit") ||
    n.includes("write") ||
    n.includes("patch")
  );
}

/** Steps from an update_todo input; null when the input carries none. */
export function todoPlanFromInput(input: unknown): TodoPlanStep[] | null {
  const raw = (input as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(raw)) {
    return null;
  }
  const steps: TodoPlanStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const title = String((item as { title?: unknown }).title || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) {
      continue;
    }
    steps.push({
      title,
      status: String((item as { status?: unknown }).status || "pending"),
    });
  }
  return steps.length ? steps : null;
}

/** Current step of a plan: first 'in_progress', else first not 'done'. */
export function currentTodoStep(plan: TodoPlanStep[] | null): TodoPlanStep | null {
  if (!plan) {
    return null;
  }
  return (
    plan.find((step) => step.status === "in_progress") ||
    plan.find((step) => step.status !== "done") ||
    null
  );
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

export function todoReminderText(
  lang: UiLanguage,
  planMode = false
): string {
  if (planMode) {
    return lang === "ru"
      ? `[Harbor] Ты сделал уже ${TODO_REMINDER_AFTER_TOOLS}+ вызова инструментов без чек-листа. Вызови update_todo СЕЙЧАС с чек-листом исследования (что ещё изучить, текущий пункт — 'in_progress'), затем продолжай. Шаги реализации в update_todo не клади — они идут в <proposed_plan> финала.`
      : `[Harbor] You have made ${TODO_REMINDER_AFTER_TOOLS}+ tool calls without a checklist. Call update_todo NOW with the exploration checklist (what is left to investigate, current item 'in_progress'), then continue. Do not put implementation steps into update_todo — they belong in the finale's <proposed_plan>.`;
  }
  return lang === "ru"
    ? `[Harbor] Ты сделал уже ${TODO_REMINDER_AFTER_TOOLS}+ вызова инструментов без плана. Это многошаговая задача — вызови update_todo СЕЙЧАС (полный список шагов, текущий — 'in_progress'), затем продолжай. Пользователь следит за ходом работы по этой карточке.`
    : `[Harbor] You have made ${TODO_REMINDER_AFTER_TOOLS}+ tool calls without a plan. This is multi-step work — call update_todo NOW (full step list, current step 'in_progress'), then continue. The user follows progress through that card.`;
}

export function todoStaleReminderText(
  lang: UiLanguage,
  tools: number,
  edits: number,
  current: string
): string {
  if (lang === "ru") {
    const step = current ? ` Текущий шаг в карточке всё ещё «${current}».` : "";
    return `[Harbor] Карточка плана отстаёт: с последнего update_todo уже ${tools} вызовов инструментов (правок файлов: ${edits}).${step} Вызови update_todo СЕЙЧАС с полным списком: завершённые шаги — 'done', тот, что реально выполняешь, — 'in_progress'. Если пропустил или переставил шаг (например, правишь код до воспроизведения) — отрази это в плане честно. Затем продолжай.`;
  }
  const step = current ? ` The card still shows «${current}» as the current step.` : "";
  return `[Harbor] The plan card is stale: ${tools} tool calls since the last update_todo (file edits: ${edits}).${step} Call update_todo NOW with the full list: finished steps 'done', the step you are actually on 'in_progress'. If you skipped or reordered a step (e.g. editing code before reproducing), reflect that honestly in the plan. Then continue.`;
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
  toolCall?: { toolName?: string; toolCallId?: string; input?: unknown };
  input?: unknown;
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
        if (!state) {
          return undefined;
        }
        // Spawned sub-agents run inside the same turn — never count them.
        if (context.snapshot?.parentAgentId) {
          return undefined;
        }
        const name = String(
          context.tool?.name || context.toolCall?.toolName || ""
        );
        if (name === TODO_TOOL) {
          state.done = true;
          state.plan =
            todoPlanFromInput(context.input ?? context.toolCall?.input) ||
            state.plan ||
            [];
          state.toolsSinceUpdate = 0;
          state.editsSinceUpdate = 0;
          // The model listened — next lagging stretch gets a fresh budget.
          state.staleReminders = 0;
          return undefined;
        }
        // A sibling of update_todo in the same batch — the plan is being
        // (re)written right now, nothing is stale or missing.
        if (batchHasTodoCall(context)) {
          state.done = true;
          return undefined;
        }
        if (state.plan) {
          return staleReminder(state, name, context);
        }
        if (state.done || !state.armed) {
          return undefined;
        }
        state.toolsWithoutPlan += 1;
        if (state.toolsWithoutPlan < TODO_REMINDER_AFTER_TOOLS || !context.result) {
          return undefined;
        }
        const output = appendTodoReminderToOutput(
          context.result.output,
          todoReminderText(state.lang, state.planMode === true)
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

function staleReminder(
  state: TodoReminderState,
  name: string,
  context: AfterToolContext
): { result: NonNullable<AfterToolContext["result"]> } | undefined {
  const plan = state.plan || [];
  // Finished plan (every step done) — the model is wrapping up.
  if (plan.length && plan.every((step) => step.status === "done")) {
    return undefined;
  }
  state.toolsSinceUpdate += 1;
  if (isEditToolName(name) && !context.result?.isError) {
    state.editsSinceUpdate += 1;
  }
  if (
    state.staleReminders >= TODO_STALE_MAX_REMINDERS ||
    !context.result ||
    (state.toolsSinceUpdate < TODO_STALE_AFTER_TOOLS &&
      state.editsSinceUpdate < TODO_STALE_AFTER_EDITS)
  ) {
    return undefined;
  }
  const output = appendTodoReminderToOutput(
    context.result.output,
    todoStaleReminderText(
      state.lang,
      state.toolsSinceUpdate,
      state.editsSinceUpdate,
      currentTodoStep(plan)?.title || ""
    )
  );
  if (output === undefined) {
    return undefined;
  }
  state.staleReminders += 1;
  // Next note only after another full window of work without an update.
  state.toolsSinceUpdate = 0;
  state.editsSinceUpdate = 0;
  return { result: { ...context.result, output } };
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
