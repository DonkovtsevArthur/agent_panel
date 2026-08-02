import { isMcpReadonlyTool } from "./mcp/types";

/** Tools that are safe to run concurrently within one assistant turn. */
export function isParallelSafeTool(name: string): boolean {
  switch (name) {
    case "read_file":
    case "list_files":
    case "search_text":
    case "get_diagnostics":
    case "fetch_url":
    case "screenshot_url":
    case "open_external":
      return true;
    case "search_replace":
      return false;
    default:
      break;
  }
  if (name.startsWith("mcp__")) {
    return isMcpReadonlyTool(name);
  }
  return false;
}

/**
 * Groups consecutive parallel-safe tools into waves.
 * Serial tools (write_file, run_command, …) stay alone.
 */
export function planToolWaves(names: string[]): number[][] {
  const waves: number[][] = [];
  let i = 0;
  while (i < names.length) {
    if (isParallelSafeTool(names[i] || "")) {
      const wave: number[] = [];
      while (i < names.length && isParallelSafeTool(names[i] || "")) {
        wave.push(i);
        i += 1;
      }
      waves.push(wave);
      continue;
    }
    waves.push([i]);
    i += 1;
  }
  return waves;
}
