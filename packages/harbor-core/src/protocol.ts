/**
 * Local copy of protocol types used by harbor-core (keeps package tsc self-contained).
 * Keep in sync with packages/harbor-host-protocol/src/index.ts
 */
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

export type WebviewToHost = { type: string; [key: string]: unknown };
export type HostToWebview = { type: string; [key: string]: unknown };
