/**
 * Per-tool approval when Settings → Auto-approve tools is off.
 */
import * as vscode from "vscode";
import {
  getConfig,
  TOOL_APPROVAL_GROUPS,
  type ToolApprovalGroup,
} from "./config";
import { resolveUiLanguage } from "./i18n";

/** Cline builtin tool names grouped for granular auto-approve. */
const TOOL_GROUP_BY_NAME: Record<string, ToolApprovalGroup> = {
  read_files: "reads",
  search_codebase: "reads",
  skills: "reads",
  fetch_web_content: "web",
  editor: "edits",
  apply_patch: "edits",
  run_commands: "commands",
  spawn_agent: "subagents",
};

/**
 * Which approval group a tool belongs to. Everything not in a builtin group
 * (MCP tools, inspect_images, …) falls back to `mcp`.
 */
export function harborToolApprovalGroup(toolName: string): ToolApprovalGroup {
  return TOOL_GROUP_BY_NAME[String(toolName || "")] || "mcp";
}

/** Effective auto-approve for one group: explicit override wins over master. */
export function isToolGroupAutoApproved(group: ToolApprovalGroup): boolean {
  const config = getConfig();
  const override = config.tools.approvals?.[group];
  return typeof override === "boolean" ? override : config.tools.autoApprove;
}

/** Effective auto-approve for a concrete tool call. */
export function isToolAutoApproved(toolName: string): boolean {
  return isToolGroupAutoApproved(harborToolApprovalGroup(toolName));
}

function approvalsFingerprintPart(): string {
  const approvals = getConfig().tools.approvals || {};
  return TOOL_APPROVAL_GROUPS.map(
    (group) => `${group}:${approvals[group] === undefined ? "-" : approvals[group] ? "1" : "0"}`
  ).join(",");
}

/**
 * Cline toolPolicies built from the master flag + per-group overrides.
 * Cline only prompts when `autoApprove === false`; missing/`{}` means allow,
 * so Harbor always emits explicit entries for the known tool names. Unknown
 * names (MCP tools) are covered by `"*"`, which carries the `mcp` group value.
 */
export function harborClineToolPolicies(): Record<string, unknown> {
  const byGroup = Object.fromEntries(
    TOOL_APPROVAL_GROUPS.map((group) => [
      group,
      isToolGroupAutoApproved(group),
    ])
  ) as Record<ToolApprovalGroup, boolean>;
  const policy = (autoApprove: boolean) => ({
    enabled: true,
    autoApprove,
  });
  const policies: Record<string, unknown> = {
    "*": policy(byGroup.mcp),
  };
  for (const [toolName, group] of Object.entries(TOOL_GROUP_BY_NAME)) {
    policies[toolName] = policy(byGroup[group]);
  }
  return policies;
}

/** Fingerprint component so sessions restart when approval groups change. */
export function harborToolApprovalsFingerprint(): string {
  return `${isToolsAutoApproveEnabled() ? "1" : "0"}|${approvalsFingerprintPart()}`;
}

export type ToolApprovalRequest = {
  toolName: string;
  preview?: string;
};

type ApprovalHook = (request: ToolApprovalRequest) => Promise<boolean>;

let externalHook: ApprovalHook | undefined;
const pending = new Map<
  string,
  { resolve: (approved: boolean) => void }
>();

export function setToolApprovalHook(hook: ApprovalHook | undefined): void {
  externalHook = hook;
}

export function resolveToolApproval(
  requestId: string,
  approved: boolean
): void {
  const row = pending.get(String(requestId || ""));
  if (!row) {
    return;
  }
  pending.delete(String(requestId || ""));
  row.resolve(approved === true);
}

export function isToolsAutoApproveEnabled(): boolean {
  return getConfig().tools.autoApprove !== false;
}

function previewText(input: unknown): string {
  try {
    const raw = JSON.stringify(input ?? {});
    return raw.length > 280 ? `${raw.slice(0, 280)}…` : raw;
  } catch {
    return "";
  }
}

export async function requestHarborToolApproval(request: {
  toolName?: string;
  input?: unknown;
}): Promise<{ approved: boolean }> {
  const toolName = String(request.toolName || "tool").trim() || "tool";
  if (toolName === "inspect_images") {
    return { approved: true };
  }
  if (isToolAutoApproved(toolName)) {
    return { approved: true };
  }
  const preview = previewText(request.input);
  if (externalHook) {
    const approved = await externalHook({ toolName, preview });
    return { approved };
  }
  const lang = resolveUiLanguage(getConfig().language);
  const approve = lang === "ru" ? "Разрешить" : "Approve";
  const deny = lang === "ru" ? "Отклонить" : "Deny";
  const title =
    lang === "ru"
      ? `Harbor Agents хочет выполнить «${toolName}»`
      : `Harbor Agents wants to run ${toolName}`;
  const pick = await vscode.window.showWarningMessage(
    title,
    { modal: true, ...(preview ? { detail: preview } : {}) },
    approve,
    deny
  );
  if (pick === approve || pick === deny) {
    return { approved: pick === approve };
  }
  // Headless stub returns undefined — wait is not possible without a hook.
  return { approved: false };
}

export function waitForToolApprovalResult(
  requestId: string,
  timeoutMs = 120_000
): Promise<boolean> {
  const id = String(requestId || "").trim();
  if (!id) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(false);
    }, timeoutMs);
    pending.set(id, {
      resolve: (approved) => {
        clearTimeout(timer);
        resolve(approved);
      },
    });
  });
}
