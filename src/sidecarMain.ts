/**
 * JetBrains Node sidecar entry.
 * Installs vscode headless stub, starts HeadlessPanelHost + JSON-RPC stdio.
 */
import * as fs from "fs";
import * as path from "path";
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
  return false;
}

function main(): void {
  const workspaceRoot = process.env.HARBOR_WORKSPACE || process.cwd();
  const paths = defaultHarborPaths(workspaceRoot);
  const settingsPath =
    process.env.HARBOR_SETTINGS_PATH || paths.settingsPath;
  const settings = readSettingsFile(settingsPath);

  HarborHeadless.install({ workspaceRoot, settings });
  // Before Cline/undici touch the network — honor Advanced → Validate TLS.
  applyHarborTlsPolicy(rejectUnauthorizedFromSettings(settings));

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
    return original(method, params);
  };

  process.stderr.write(
    `[harbor-sidecar] ready workspace=${workspaceRoot} ` +
      `session=${path.basename(paths.sessionPath)}\n`
  );
}

main();
