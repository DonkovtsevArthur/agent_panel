import type {
  SidecarNotification,
  SidecarRequest,
  SidecarResponse,
} from "./protocol";
import { HarborCore, type TurnRunner } from "./harborCore";
import {
  createMemorySecrets,
  createMemorySettings,
  type HarborHostPorts,
} from "./ports";
import {
  createFileSessionStore,
  defaultIdeaHarborSessionPath,
} from "./sessionFileStore";

export interface SidecarOptions {
  ports?: HarborHostPorts;
  turnRunner?: TurnRunner;
  workspaceRoot?: string;
  /** When true (default), write JSON-RPC lines to stdout. */
  stdio?: boolean;
}

function createDefaultPorts(workspaceRoot: string): HarborHostPorts {
  const sessionPath = defaultIdeaHarborSessionPath(workspaceRoot);
  return {
    secrets: createMemorySecrets(),
    settings: createMemorySettings(),
    workspace: {
      cwd: () => workspaceRoot,
      async refreshPaths() {
        /* IDE host refreshes VFS via vfs.refresh notifications */
      },
    },
    session: createFileSessionStore(sessionPath),
  };
}

/**
 * Line-delimited JSON-RPC 2.0 over stdio for JetBrains Kotlin ↔ Node.
 */
export function startSidecar(options: SidecarOptions = {}): HarborCore {
  const workspaceRoot =
    options.workspaceRoot ||
    process.env.HARBOR_WORKSPACE ||
    process.cwd();
  const ports = options.ports ?? createDefaultPorts(workspaceRoot);
  const core = new HarborCore(ports, { turnRunner: options.turnRunner });

  const write = (obj: SidecarResponse | SidecarNotification) => {
    process.stdout.write(`${JSON.stringify(obj)}\n`);
  };

  core.setEventHandler((event, params) => {
    write({
      jsonrpc: "2.0",
      method: event,
      params,
    });
  });

  let buffer = "";
  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) {
        continue;
      }
      void handleLine(line);
    }
  };

  const handleLine = async (line: string) => {
    let req: SidecarRequest;
    try {
      req = JSON.parse(line) as SidecarRequest;
    } catch {
      write({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      return;
    }

    if (!req.method) {
      write({
        jsonrpc: "2.0",
        id: req.id ?? null,
        error: { code: -32600, message: "Invalid Request" },
      });
      return;
    }

    try {
      const result = await core.handleMethod(req.method, req.params);
      if (req.id !== undefined && req.id !== null) {
        write({
          jsonrpc: "2.0",
          id: req.id,
          result,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (req.id !== undefined && req.id !== null) {
        write({
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32000, message },
        });
      }
    }
  };

  if (options.stdio !== false) {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.on("end", () => {
      process.exit(0);
    });
  }

  return core;
}

/** CLI entry when run as `node out/harborSidecar.js` — see src/sidecarMain.ts. */
export function main(): void {
  startSidecar();
  process.stderr.write("[harbor-sidecar] ready\n");
}
