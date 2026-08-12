/**
 * Host protocol types for the VS Code extension.
 * Keep in sync with packages/harbor-host-protocol/src/index.ts
 * (JetBrains / sidecar source of truth lives in packages/).
 */
export const HARBOR_HOST_PROTOCOL_VERSION = 1 as const;

export interface HarborHostApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

export type IncomingAttachment = {
  name: string;
  mimeType?: string;
  dataUrl?: string;
  path?: string;
  size?: number;
};

/** Discriminant-only check used by hosts when routing webview messages. */
export function isWebviewToHost(
  msg: unknown
): msg is { type: string; [key: string]: unknown } {
  return (
    !!msg &&
    typeof msg === "object" &&
    typeof (msg as { type?: unknown }).type === "string"
  );
}
