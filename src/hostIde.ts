/**
 * Name of the IDE that hosts this agent, for prompts and the `<env>` block.
 * The JetBrains plugin sets HARBOR_HOST_IDE on the sidecar process (e.g.
 * "WebStorm"); the VS Code extension host does not, so it falls back to VS Code.
 */
export function hostIdeName(): string {
  return String(process.env.HARBOR_HOST_IDE || "").trim() || "VS Code";
}
