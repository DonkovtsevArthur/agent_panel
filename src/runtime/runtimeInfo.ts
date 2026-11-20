/**
 * Small runtime facts for the "Show agent core" command and diagnostics.
 * Kept vscode-free apart from getConfig's settings read.
 */
import * as fs from "fs";
import * as path from "path";
import { getConfig } from "../config";
import { agentRuntimeKind, type AgentRuntimeKind } from "./agentRuntime";

export interface AgentRuntimeInfo {
  kind: AgentRuntimeKind;
  /** Bundled Pi chunk shipped with the extension (out/pi/pi.mjs). */
  piChunkPath: string;
  piChunkBuilt: boolean;
  providers: number;
  models: number;
}

export function describeAgentRuntime(): AgentRuntimeInfo {
  const piChunkPath = path.join(__dirname, "..", "..", "out", "pi", "pi.mjs");
  const cfg = getConfig();
  return {
    kind: agentRuntimeKind(),
    piChunkPath,
    piChunkBuilt: fs.existsSync(piChunkPath),
    providers: cfg.providers.length,
    models: cfg.models.filter((model) => model.enabled !== false).length,
  };
}
