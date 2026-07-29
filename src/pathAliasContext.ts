import * as vscode from "vscode";
import {
  expandFileCandidates,
  extractImportSpecifiers,
  formatPathAliasContext,
  parseTsconfigPathsJson,
  PathAliasConfig,
  resolveImportCandidates,
  tsconfigCandidateNames,
} from "./projectPaths";

let cached: { at: number; config: PathAliasConfig | null } | undefined;
const CACHE_MS = 30_000;

export async function loadWorkspacePathAliases(): Promise<PathAliasConfig | null> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) {
    return cached.config;
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    cached = { at: now, config: null };
    return null;
  }

  for (const name of tsconfigCandidateNames()) {
    try {
      const uri = vscode.Uri.joinPath(folder.uri, name);
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(bytes).toString("utf8");
      const parsed = parseTsconfigPathsJson(text, name);
      if (parsed) {
        cached = { at: now, config: parsed };
        return parsed;
      }
    } catch {
      // next candidate
    }
  }

  cached = { at: now, config: null };
  return null;
}

export async function buildPathAliasContextMessage(): Promise<string> {
  const config = await loadWorkspacePathAliases();
  if (!config) {
    return [
      "Import path conventions:",
      "- No tsconfig/jsconfig paths found.",
      "- Before writing imports: read_file the target and a sibling; copy their import style.",
      "- Never invent module paths. After write_file, fix importWarnings immediately.",
    ].join("\n");
  }
  return formatPathAliasContext(config);
}

export async function collectImportWarnings(
  importerRelPath: string,
  content: string
): Promise<string[]> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return [];
  }
  const config = await loadWorkspacePathAliases();
  const specs = extractImportSpecifiers(content);
  const warnings: string[] = [];

  for (const spec of specs.slice(0, 40)) {
    const candidates = resolveImportCandidates(
      importerRelPath,
      spec,
      config
    );
    if (!candidates.length) {
      continue;
    }
    let ok = false;
    for (const cand of candidates) {
      for (const fileRel of expandFileCandidates(cand)) {
        try {
          const uri = vscode.Uri.joinPath(folder.uri, ...fileRel.split("/"));
          await vscode.workspace.fs.stat(uri);
          ok = true;
          break;
        } catch {
          // try next
        }
      }
      if (ok) {
        break;
      }
    }
    if (!ok) {
      warnings.push(
        `Unresolved import "${spec}" (tried: ${candidates
          .slice(0, 3)
          .join(", ")})`
      );
    }
  }

  return warnings;
}
