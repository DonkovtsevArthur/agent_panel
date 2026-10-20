/**
 * Per-turn value: AsyncLocalStorage plus a module fallback for callbacks that
 * Cline runs outside the ALS context (event emitter).
 *
 * Several chats can run turns at the same time. A single "last started wins"
 * fallback hands one chat's value to another chat, and restoring the previous
 * value on finish (LIFO) drops it for a turn that is still running. So the
 * fallback answers only while exactly one turn is open; with overlapping turns
 * it is ambiguous and callers get `undefined` instead of a foreign value.
 */
import { AsyncLocalStorage } from "async_hooks";

export interface TurnScopedValue<T> {
  run<R>(value: T, fn: () => Promise<R>): Promise<R>;
  get(): T | undefined;
}

export function createTurnScopedValue<T>(): TurnScopedValue<T> {
  const als = new AsyncLocalStorage<{ value: T }>();
  const open = new Set<{ value: T }>();
  return {
    run<R>(value: T, fn: () => Promise<R>): Promise<R> {
      const scope = { value };
      open.add(scope);
      let pending: Promise<R>;
      try {
        pending = als.run(scope, fn);
      } catch (error) {
        open.delete(scope);
        throw error;
      }
      return pending.finally(() => {
        open.delete(scope);
      });
    },
    get(): T | undefined {
      const scope = als.getStore();
      if (scope) {
        return scope.value;
      }
      if (open.size !== 1) {
        return undefined;
      }
      return open.values().next().value?.value;
    },
  };
}
