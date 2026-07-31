import type { ToolCall } from "./openaiClient";
import { planToolWaves } from "./toolParallel";

export interface ToolWaveStatus {
  phase: string;
  detail: string;
}

export type ToolLifecycleStatus = "queued" | "running" | "done" | "error";

export interface ExecuteToolCallsOptions {
  toolCalls: readonly ToolCall[];
  invokeOne: (call: ToolCall) => Promise<string>;
  onStatus?: (call: ToolCall, status: ToolWaveStatus) => void;
  formatStatus: (name: string, argsJson: string) => ToolWaveStatus;
  /**
   * Zed-like lifecycle: queued (wave start) → running (invoke) → done/error.
   * `result` is set on done/error.
   */
  onToolLifecycle?: (
    call: ToolCall,
    status: ToolLifecycleStatus,
    result?: string
  ) => void;
}

export interface ExecutedToolCall {
  call: ToolCall;
  result: string;
}

function isErrorishResult(result: string): boolean {
  const trimmed = String(result || "").trim();
  if (!trimmed) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; ok?: unknown };
    if (parsed && typeof parsed === "object") {
      if (parsed.ok === false) {
        return true;
      }
      if (parsed.error != null && String(parsed.error).length > 0) {
        return true;
      }
    }
  } catch {
    // plain text
  }
  return /^\s*error\b/i.test(trimmed);
}

/**
 * Runs tool calls in waves: consecutive parallel-safe tools via Promise.all,
 * serial tools alone. Results are returned in the original call order.
 */
export async function executeToolCallsInOrder(
  options: ExecuteToolCallsOptions
): Promise<ExecutedToolCall[]> {
  const { toolCalls, invokeOne, onStatus, formatStatus, onToolLifecycle } =
    options;
  if (toolCalls.length === 0) {
    return [];
  }

  const names = toolCalls.map((call) => call.function.name || "");
  const waves = planToolWaves(names);
  const results: ExecutedToolCall[] = new Array(toolCalls.length);

  for (const wave of waves) {
    for (const index of wave) {
      const call = toolCalls[index];
      if (!call) {
        continue;
      }
      onToolLifecycle?.(call, "queued");
      onStatus?.(
        call,
        formatStatus(call.function.name, call.function.arguments || "")
      );
    }

    if (wave.length === 1) {
      const index = wave[0];
      const call = toolCalls[index];
      if (!call) {
        continue;
      }
      onToolLifecycle?.(call, "running");
      let result: string;
      try {
        result = await invokeOne(call);
      } catch (error) {
        result = JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        });
      }
      results[index] = { call, result };
      onToolLifecycle?.(
        call,
        isErrorishResult(result) ? "error" : "done",
        result
      );
      continue;
    }

    for (const index of wave) {
      const call = toolCalls[index];
      if (call) {
        onToolLifecycle?.(call, "running");
      }
    }

    const settled = await Promise.all(
      wave.map(async (index) => {
        const call = toolCalls[index]!;
        let result: string;
        try {
          result = await invokeOne(call);
        } catch (error) {
          result = JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return { index, call, result };
      })
    );
    for (const item of settled) {
      results[item.index] = { call: item.call, result: item.result };
      onToolLifecycle?.(
        item.call,
        isErrorishResult(item.result) ? "error" : "done",
        item.result
      );
    }
  }

  return results;
}
