"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSidecar = startSidecar;
exports.main = main;
const harborCore_1 = require("./harborCore");
const ports_1 = require("./ports");
const sessionFileStore_1 = require("./sessionFileStore");
function createDefaultPorts(workspaceRoot) {
    const sessionPath = (0, sessionFileStore_1.defaultIdeaHarborSessionPath)(workspaceRoot);
    return {
        secrets: (0, ports_1.createMemorySecrets)(),
        settings: (0, ports_1.createMemorySettings)(),
        workspace: {
            cwd: () => workspaceRoot,
            async refreshPaths() {
                /* IDE host refreshes VFS via vfs.refresh notifications */
            },
        },
        session: (0, sessionFileStore_1.createFileSessionStore)(sessionPath),
    };
}
/**
 * Line-delimited JSON-RPC 2.0 over stdio for JetBrains Kotlin ↔ Node.
 */
function startSidecar(options = {}) {
    const workspaceRoot = options.workspaceRoot ||
        process.env.HARBOR_WORKSPACE ||
        process.cwd();
    const ports = options.ports ?? createDefaultPorts(workspaceRoot);
    const core = new harborCore_1.HarborCore(ports, { turnRunner: options.turnRunner });
    const write = (obj) => {
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
    const onData = (chunk) => {
        buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) {
                continue;
            }
            void handleLine(line);
        }
    };
    const handleLine = async (line) => {
        let req;
        try {
            req = JSON.parse(line);
        }
        catch {
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
        }
        catch (err) {
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
function main() {
    startSidecar();
    process.stderr.write("[harbor-sidecar] ready\n");
}
//# sourceMappingURL=sidecar.js.map