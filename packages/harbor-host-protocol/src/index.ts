/**
 * Harbor Agents — webview ↔ IDE host message contract.
 * Shared by VS Code webview and JetBrains JCEF (via __harborHost).
 *
 * Protocol version bumps when a breaking rename is required.
 * Additive new `type` values do not require a version bump.
 */
export const HARBOR_HOST_PROTOCOL_VERSION = 1 as const;

/** Injected by JetBrains JCEF; absent in VS Code (falls back to acquireVsCodeApi). */
export interface HarborHostApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

export type HarborHostGlobal = typeof globalThis & {
  __harborHost?: HarborHostApi;
};

export type ChatSearchScope = "all" | "current";
export type ChatSearchRole = "any" | "user" | "assistant";
export type ChatSearchDate = "any" | "today" | "week" | "month";

export interface IncomingAttachment {
  name: string;
  mimeType?: string;
  /** data URL or absolute path depending on host */
  dataUrl?: string;
  path?: string;
  size?: number;
}

/** Webview → IDE host (and JetBrains bridge → sidecar). */
export type WebviewToHost =
  | { type: "ready"; surface?: "panel" | "settings" }
  | {
      type: "send";
      text: string;
      model: string;
      agentMode?: string;
      reasoningEffort?: string;
      attachments?: IncomingAttachment[];
      hideUser?: boolean;
    }
  | { type: "regenerate"; agentMode?: string; reasoningEffort?: string }
  | {
      type: "editUserMessage";
      index: number;
      text: string;
      model: string;
      agentMode?: string;
      reasoningEffort?: string;
      attachments?: IncomingAttachment[];
    }
  | { type: "stop" }
  | { type: "newChat" }
  | { type: "newAgent" }
  | { type: "openAgent"; agentId: string }
  | { type: "showAgents" }
  | { type: "showArchive" }
  | { type: "showSettings" }
  | { type: "closeSettings" }
  | { type: "saveSettings"; settings: Record<string, unknown> }
  | { type: "saveModes"; modes: unknown }
  | { type: "renameAgent"; agentId: string; name: string }
  | { type: "archiveAgent"; agentId: string }
  | { type: "restoreAgent"; agentId: string }
  | { type: "deleteAgent"; agentId: string }
  | { type: "deleteAllArchived" }
  | { type: "modelChanged"; model: string; chatId?: string }
  | { type: "modeChanged"; mode: string; chatId?: string }
  | {
      type: "reasoningEffortChanged";
      reasoningEffort: string;
      chatId?: string;
    }
  | { type: "openFile"; path: string }
  | { type: "openFileDiff"; path: string }
  | {
      type: "openPlanMarkdown";
      text: string;
      reveal?: "editor" | "preview";
    }
  | {
      type: "requestLivePlanForBuild";
      requestId: string;
      fallbackText?: string;
    }
  | { type: "commitAndPush"; paths: string[] }
  | { type: "discardChanges"; paths: string[] }
  | { type: "openScm" }
  | { type: "openExternal"; url: string }
  | { type: "pickModel" }
  | { type: "pickAttachments"; imagesOnly?: boolean }
  | { type: "attachUris"; uris: string[] }
  | { type: "attachFiles"; files: IncomingAttachment[] }
  | { type: "searchFiles"; query: string; requestId: string }
  | {
      type: "searchChat";
      query: string;
      requestId: string;
      scope?: ChatSearchScope;
      role?: ChatSearchRole;
      date?: ChatSearchDate;
    }
  | {
      type: "openSearchHit";
      agentId: string;
      messageIndex: number;
      chatId?: string;
    }
  | { type: "copyText"; text: string }
  | { type: "chatScroll"; chatId: string; scrollTop: number }
  | { type: "branchFromMessage"; messageIndex: number }
  | { type: "switchBranch"; chatId: string }
  | { type: "deleteBranch"; chatId: string }
  | { type: "figmaConnect" }
  | { type: "figmaDisconnect" }
  | { type: "figmaConnectPat"; token: string }
  | { type: "figmaRefreshStatus" }
  | { type: "mcpRefreshList" }
  | {
      type: "mcpUpsertServer";
      server: {
        id?: string;
        name: string;
        transport: "stdio" | "http";
        command?: string;
        argsText?: string;
        envText?: string;
        cwd?: string;
        url?: string;
        bearerToken?: string;
        enabled?: boolean;
        connect?: boolean;
      };
    }
  | { type: "mcpDeleteServer"; id: string }
  | { type: "mcpSetEnabled"; id: string; enabled: boolean }
  | { type: "mcpConnectServer"; id: string }
  | {
      type: "listProviderModels";
      requestId: string;
      providerId: string;
      baseUrl?: string;
      apiKey?: string;
      rejectUnauthorized?: boolean;
      caBundlePath?: string;
    };

/** IDE host → webview (subset of types used for JetBrains MVP + VS Code). */
export type HostToWebview =
  | { type: "init"; [key: string]: unknown }
  | { type: "showChat"; [key: string]: unknown }
  | { type: "showAgents"; [key: string]: unknown }
  | { type: "showArchive"; [key: string]: unknown }
  | { type: "showSettings"; [key: string]: unknown }
  | { type: "agentsList"; [key: string]: unknown }
  | { type: "archiveList"; [key: string]: unknown }
  | { type: "append"; role: string; text: string; chatId?: string }
  | { type: "assistantDelta"; text: string; chatId?: string }
  | { type: "assistantDone"; [key: string]: unknown }
  | { type: "assistantStreamClear"; chatId?: string }
  | { type: "reasoning"; text: string; chatId?: string }
  | { type: "status"; [key: string]: unknown }
  | { type: "idle"; chatId?: string }
  | { type: "stopped"; [key: string]: unknown }
  | { type: "review"; [key: string]: unknown }
  | { type: "runFailed"; [key: string]: unknown }
  | { type: "runFinished"; [key: string]: unknown }
  | { type: "contextUsage"; [key: string]: unknown }
  | { type: "modelsUpdated"; [key: string]: unknown }
  | { type: "modesUpdated"; [key: string]: unknown }
  | { type: "mcpServers"; [key: string]: unknown }
  | { type: "figmaStatus"; [key: string]: unknown }
  | { type: "figmaNeedsConnect"; [key: string]: unknown }
  | { type: "attachmentsAdded"; [key: string]: unknown }
  | { type: "fileSearchResults"; [key: string]: unknown }
  | { type: "chatSearchResults"; [key: string]: unknown }
  | { type: "providerConnStatus"; [key: string]: unknown }
  | { type: "providerModelsListed"; [key: string]: unknown }
  | { type: "copied" }
  | { type: "openChatSearch" }
  | { type: "messagesReplaced"; [key: string]: unknown }
  | { type: "regenerateState"; [key: string]: unknown }
  | { type: "scmButtons"; [key: string]: unknown }
  | { type: "agentRenamed"; [key: string]: unknown }
  | { type: "livePlanForBuild"; [key: string]: unknown }
  | { type: "insertComposerText"; text: string }
  | { type: "insertComposerSelection"; [key: string]: unknown }
  | { type: "insertComposerMentions"; [key: string]: unknown };

/** JSON-RPC methods: JetBrains Kotlin ↔ Node sidecar. */
export type SidecarMethod =
  | "ping"
  | "session.get"
  | "session.save"
  | "turn.start"
  | "turn.abort"
  | "config.get"
  | "config.set"
  | "mcp.list"
  | "mcp.refresh"
  | "commit.andPush"
  | "commit.message"
  | "webview.handle";

export type SidecarEventName =
  | "turn.step"
  | "turn.delta"
  | "turn.reasoning"
  | "turn.review"
  | "turn.idle"
  | "turn.failed"
  | "hostToWebview"
  | "vfs.refresh";

export interface SidecarRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: SidecarMethod | string;
  params?: unknown;
}

export interface SidecarResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface SidecarNotification {
  jsonrpc: "2.0";
  method: SidecarEventName | string;
  params?: unknown;
}

export function isWebviewToHost(msg: unknown): msg is WebviewToHost {
  return (
    !!msg &&
    typeof msg === "object" &&
    typeof (msg as { type?: unknown }).type === "string"
  );
}
