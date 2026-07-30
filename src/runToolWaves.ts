import type { ToolCall } from "./openaiClient";
import { planToolWaves } from "./toolParallel";

export interface ToolWaveStatus {
  phase: string;
  detail: string;
}

export interface ExecuteToolCallsOptions {
  toolCalls: readonly ToolCall[];
  invokeOne: (call: ToolCall) => Promise<string>;
  onStatus?: (call: ToolCall, status: ToolWaveStatus) => void;
  formatStatus: (name: string, argsJson: string) => ToolWaveStatus;
}

export interface ExecutedToolCall {
  call: ToolCall;
  result: string;
}

/**
 * Runs tool calls in waves: consecutive parallel-safe tools via Promise.all,
 * serial tools alone. Results are returned in the original call order.
 */
export async function executeToolCallsInOrder(
  options: ExecuteToolCallsOptions
): Promise<ExecutedToolCall[]> {
  const { toolCalls, invokeOne, onStatus, formatStatus } = options;
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
      results[index] = {
        call,
        result: await invokeOne(call),
      };
      continue;
    }

    const settled = await Promise.all(
      wave.map(async (index) => {
        const call = toolCalls[index]!;
        const result = await invokeOne(call);
        return { index, call, result };
      })
    );
    for (const item of settled) {
      results[item.index] = { call: item.call, result: item.result };
    }
  }

  return results;
}
