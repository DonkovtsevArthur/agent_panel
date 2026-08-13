/**
 * Per-tool approval when Settings → Auto-approve tools is off.
 */
import * as vscode from "vscode";
import { getConfig } from "./config";
import { resolveUiLanguage } from "./i18n";

/** Cline only prompts when `autoApprove === false`. Missing/`{}` means allow. */
export function harborClineToolPolicies(autoApprove: boolean): {
  "*": { enabled: boolean; autoApprove: boolean };
} {
  return {
    "*": { enabled: true, autoApprove: autoApprove === true },
  };
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
  if (isToolsAutoApproveEnabled()) {
    return { approved: true };
  }
  const toolName = String(request.toolName || "tool").trim() || "tool";
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
