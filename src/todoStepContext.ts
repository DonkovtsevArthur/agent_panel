/**
 * Turn-scoped emitter for update_todo steps. The tool is created once per
 * Cline session in the module-level prepare hook (getClineCore), while the
 * Harbor onStep callback lives inside runClineAgentTurn — same ALS bridge
 * pattern as inspectImagesContext.
 */
import { AsyncLocalStorage } from "async_hooks";
import type { AgentStepEvent } from "./agentSteps";

type TodoEmitter = (step: AgentStepEvent) => void;

const emitterAls = new AsyncLocalStorage<TodoEmitter>();
let fallback: TodoEmitter | undefined;

export function withTodoStepEmitter<T>(
  emit: TodoEmitter,
  fn: () => Promise<T>
): Promise<T> {
  const previous = fallback;
  fallback = emit;
  return emitterAls.run(emit, fn).finally(() => {
    fallback = previous;
  });
}

export function emitTodoStep(step: AgentStepEvent): void {
  const emit = emitterAls.getStore() || fallback;
  try {
    emit?.(step);
  } catch {
    /* UI callback must never break the tool call */
  }
}
