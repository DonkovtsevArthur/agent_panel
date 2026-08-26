/**
 * JetBrains Node sidecar entry.
 * Installs vscode headless stub, starts HeadlessPanelHost + JSON-RPC stdio.
 */
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { startSidecar } from "../packages/harbor-core/src/sidecar";
import {
  createFileSessionStore,
  defaultIdeaHarborSessionPath,
} from "../packages/harbor-core/src/sessionFileStore";
import {
  createMemorySecrets,
  createMemorySettings,
  type HarborHostPorts,
} from "../packages/harbor-core/src/ports";
import {
  HeadlessPanelHost,
  defaultHarborPaths,
} from "./headlessPanelHost";
import { HarborHeadless } from "./vscodeHeadlessStub";
import { applyHarborTlsPolicy } from "./tlsPolicy";
import { initMcpManager } from "./mcpBundle";
import { composeCommitMessageText } from "./commitMessage";
import type * as vscode from "vscode";
import {
  setToolApprovalHook,
  waitForToolApprovalResult,
} from "./toolApproval";

function writeNotification(method: string, params: unknown): void {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`
  );
}

function readSettingsFile(settingsPath: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* missing / invalid — empty settings */
  }
  return {};
}

function rejectUnauthorizedFromSettings(settings: Record<string, unknown>): boolean {
  if (typeof settings.rejectUnauthorized === "boolean") {
    return settings.rejectUnauthorized;
  }
  const ap = settings.agentPanel;
  if (ap && typeof ap === "object" && !Array.isArray(ap)) {
    const v = (ap as Record<string, unknown>).rejectUnauthorized;
    if (typeof v === "boolean") {
      return v;
    }
  }
  return true;
}

async function handleCommitMessage(
  workspaceRoot: string,
  settingsPath: string,
  params: { paths?: unknown; cwd?: unknown }
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const fresh = readSettingsFile(settingsPath);
  HarborHeadless.install({
    workspaceRoot,
    settings: fresh,
    settingsPath,
    storageDir: path.dirname(settingsPath),
  });
  applyHarborTlsPolicy(rejectUnauthorizedFromSettings(fresh));

  const cwd =
    typeof params.cwd === "string" && params.cwd.trim()
      ? params.cwd.trim()
      : workspaceRoot;
  const paths = Array.isArray(params.paths)
    ? params.paths.map((p) => String(p || "").trim()).filter(Boolean)
    : [];

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 55_000);
  try {
    // composeCommitMessageText → collectCommitDiff resolves git root and
    // falls back to a full-tree diff when scoped paths miss (Rider 2025).
    const message = await composeCommitMessageText(
      cwd,
      undefined,
      abort.signal,
      paths
    );
    if (!String(message || "").trim()) {
      return {
        ok: false,
        error: "No changes to commit (empty diff).",
        message: "",
      };
    }
    return { ok: true, message };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (abort.signal.aborted || /aborted/i.test(text)) {
      return {
        ok: false,
        error: "Commit message generation timed out (55s).",
        message: "",
      };
    }
    return { ok: false, error: text, message: "" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Abort-family rejections are expected cancel noise, not fatal faults
 * (upstream Cline daemon filters the same — hub/daemon/entry.ts
 * isAbortRejection). When a user stops a turn, in-flight provider streams
 * reject on floating promises after the run has settled (AbortError /
 * ABORT_ERR / AgentRuntimeAbortError). Node would kill the sidecar process,
 * wedging the panel until an IDE restart — VS Code's extension host
 * survives these, the bare sidecar must too.
 */
function installUnhandledRejectionGuard(): void {
  process.on("unhandledRejection", (reason: unknown) => {
    const err = reason instanceof Error ? reason : undefined;
    const abortFamily =
      err?.name === "AbortError" ||
      err?.name === "AgentRuntimeAbortError" ||
      (err as { code?: unknown } | undefined)?.code === "ABORT_ERR";
    const label = err ? `${err.name}: ${err.message}` : String(reason);
    process.stderr.write(
      `[harbor-sidecar] unhandled rejection${
        abortFamily ? " (abort noise)" : ""
      }: ${label}\n`
    );
  });
}

function main(): void {
  installUnhandledRejectionGuard();
  const workspaceRoot = process.env.HARBOR_WORKSPACE || process.cwd();
  const paths = defaultHarborPaths(workspaceRoot);
  const settingsPath =
    process.env.HARBOR_SETTINGS_PATH || paths.settingsPath;
  const settings = readSettingsFile(settingsPath);

  HarborHeadless.install({
    workspaceRoot,
    settings,
    settingsPath,
    storageDir: path.dirname(settingsPath),
  });
  HarborHeadless.setOpenExternalHook(async (url) => {
    writeNotification("host.openExternal", { url });
  });
  setToolApprovalHook(async (request) => {
    const requestId = `appr-${Date.now()}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    writeNotification("host.requestToolApproval", {
      requestId,
      toolName: request.toolName,
      preview: request.preview || "",
    });
    return waitForToolApprovalResult(requestId);
  });
  // Before Cline/undici touch the network — honor Advanced → Validate TLS.
  applyHarborTlsPolicy(rejectUnauthorizedFromSettings(settings));

  const mcp = initMcpManager(
    HarborHeadless.getExtensionContext() as unknown as vscode.ExtensionContext
  );
  void mcp.refreshSecretFlags().then(() => {
    void mcp.tryQuietReconnect();
  });

  const ports: HarborHostPorts = {
    secrets: createMemorySecrets(),
    settings: createMemorySettings(),
    workspace: { cwd: () => workspaceRoot },
    session: createFileSessionStore(
      process.env.HARBOR_SESSION_PATH ||
        defaultIdeaHarborSessionPath(workspaceRoot)
    ),
  };

  const panel = new HeadlessPanelHost({
    workspaceRoot,
    sessionPath: process.env.HARBOR_SESSION_PATH || paths.sessionPath,
    settingsPath,
    emit: (message) => {
      writeNotification("hostToWebview", message);
      if (message.type === "review" && Array.isArray(message.edits)) {
        const filePaths = (message.edits as Array<{ path?: string }>)
          .map((e) => e.path)
          .filter((p): p is string => !!p);
        if (filePaths.length) {
          writeNotification("vfs.refresh", { paths: filePaths });
          writeNotification("turn.review", {
            paths: filePaths,
            edits: message.edits,
          });
        }
      }
    },
    onVfsRefresh: (filePaths) => {
      writeNotification("vfs.refresh", { paths: filePaths });
    },
  });

  const core = startSidecar({
    ports,
    workspaceRoot,
    // Disable default stdout event handler — we write notifications ourselves
    // for panel messages. Re-enable by wrapping:
  });

  // Replace default event handler: still forward any core events
  core.setEventHandler((event, params) => {
    writeNotification(event, params);
  });

  const original = core.handleMethod.bind(core);
  core.handleMethod = async (method, params) => {
    if (method === "webview.handle") {
      return panel.handleWebviewMessage(
        params as { type: string; [key: string]: unknown }
      );
    }
    if (method === "turn.start") {
      const p = (params || {}) as {
        text?: string;
        model?: string;
        agentMode?: string;
        reasoningEffort?: string;
        attachments?: unknown;
      };
      return panel.handleWebviewMessage({
        type: "send",
        text: p.text,
        model: p.model,
        agentMode: p.agentMode,
        reasoningEffort: p.reasoningEffort,
        attachments: p.attachments,
      });
    }
    if (method === "turn.abort") {
      return panel.handleWebviewMessage({ type: "stop" });
    }
    if (method === "commit.message") {
      return handleCommitMessage(
        workspaceRoot,
        settingsPath,
        (params || {}) as { paths?: unknown; cwd?: unknown }
      );
    }
    return original(method, params);
  };

  process.stderr.write(
    `[harbor-sidecar] ready workspace=${workspaceRoot} ` +
      `session=${path.basename(paths.sessionPath)}\n`
  );
}

main();
