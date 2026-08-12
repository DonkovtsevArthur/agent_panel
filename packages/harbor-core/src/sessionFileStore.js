"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFileSessionStore = createFileSessionStore;
exports.defaultIdeaHarborSessionPath = defaultIdeaHarborSessionPath;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * File-backed session store for JetBrains (analogue of VS Code workspaceState).
 * Default path: `<workspace>/.idea/harbor/session.v2.json`
 */
function createFileSessionStore(filePath) {
    return {
        async load() {
            try {
                const raw = await fs.promises.readFile(filePath, "utf8");
                return JSON.parse(raw);
            }
            catch (err) {
                const code = err?.code;
                if (code === "ENOENT") {
                    return undefined;
                }
                throw err;
            }
        },
        async save(store) {
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            const tmp = `${filePath}.tmp`;
            await fs.promises.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
            await fs.promises.rename(tmp, filePath);
        },
    };
}
function defaultIdeaHarborSessionPath(workspaceRoot) {
    return path.join(workspaceRoot, ".idea", "harbor", "session.v2.json");
}
//# sourceMappingURL=sessionFileStore.js.map