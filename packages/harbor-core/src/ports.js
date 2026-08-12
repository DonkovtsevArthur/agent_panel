"use strict";
/**
 * Host ports — IDE-specific adapters implement these.
 * VS Code: workspaceState / SecretStorage / vscode.workspace
 * JetBrains: file store / PasswordSafe / VFS
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMemorySecrets = createMemorySecrets;
exports.createMemorySettings = createMemorySettings;
function createMemorySecrets() {
    const map = new Map();
    return {
        _map: map,
        async get(key) {
            return map.get(key);
        },
        async set(key, value) {
            map.set(key, value);
        },
        async delete(key) {
            map.delete(key);
        },
    };
}
function createMemorySettings(initial = {}) {
    const data = { ...initial };
    return {
        get(key) {
            return data[key];
        },
        async set(key, value) {
            data[key] = value;
        },
    };
}
//# sourceMappingURL=ports.js.map