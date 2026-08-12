import * as fs from "fs";
import * as path from "path";
import type { SessionPersistencePort } from "./ports";

/**
 * File-backed session store for JetBrains (analogue of VS Code workspaceState).
 * Default path: `<workspace>/.idea/harbor/session.v2.json`
 */
export function createFileSessionStore(
  filePath: string
): SessionPersistencePort {
  return {
    async load() {
      try {
        const raw = await fs.promises.readFile(filePath, "utf8");
        return JSON.parse(raw) as unknown;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          return undefined;
        }
        throw err;
      }
    },
    async save(store: unknown) {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
      await fs.promises.rename(tmp, filePath);
    },
  };
}

export function defaultIdeaHarborSessionPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".idea", "harbor", "session.v2.json");
}
