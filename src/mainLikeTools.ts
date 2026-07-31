/**
 * Tools для main-like path: core как на main + fetch_url / open_external.
 * Figma MCP tools подмешиваются в agentLoopMainLike отдельно.
 */
import { execFile } from "child_process";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";
import type { ChatTool } from "./openaiClient";
import { runTool } from "./tools";
import { isAllowedMcpInReadonlyMode } from "./mcp/types";
import {
  ignoredPathError,
  isIgnoredDirName,
  isIgnoredWorkspacePath,
} from "./workspaceIgnore";

const execFileAsync = promisify(execFile);

export const MAIN_LIKE_READONLY_TOOL_NAMES = new Set([
  "list_files",
  "read_file",
  "get_diagnostics",
  "fetch_url",
  "open_external",
]);

/** Plan/Ask: built-in read tools + Figma MCP (all) + other read-only MCP. */
export function isAllowedToolInReadonlyMainLike(name: string): boolean {
  if (MAIN_LIKE_READONLY_TOOL_NAMES.has(name)) {
    return true;
  }
  return isAllowedMcpInReadonlyMode(name);
}

export const mainLikeAgentTools: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "Список файлов в папке workspace (относительно корня). Пропускает node_modules/.git/dist/out и другие служебные каталоги.",
      parameters: {
        type: "object",
        properties: {
          relativePath: {
            type: "string",
            description: "Относительный путь к папке, пустая строка = корень",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Прочитать текстовый файл из workspace. Не для node_modules/.git/dist/out.",
      parameters: {
        type: "object",
        properties: {
          relativePath: {
            type: "string",
            description: "Относительный путь к файлу",
          },
        },
        required: ["relativePath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_diagnostics",
      description:
        "Получить актуальные VS Code Problems (error/warning) для указанных файлов workspace; без paths — для открытых файлов. После правок вызывай перед финалом, чтобы исправить недочёты.",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Относительные пути файлов workspace",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Создать или перезаписать текстовый файл в workspace. Не пишет в node_modules/.git/dist/out. При diagnostics/importWarnings в ответе сразу исправь ошибки.",
      parameters: {
        type: "object",
        properties: {
          relativePath: {
            type: "string",
            description: "Относительный путь к файлу",
          },
          content: {
            type: "string",
            description: "Полное содержимое файла",
          },
        },
        required: ["relativePath", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Выполнить shell-команду в корне workspace (git, npm, ls и т.п.). Используй для git status/log/diff, сборки, тестов, lint/typecheck.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Команда целиком, например: git log -1 --oneline",
          },
          cwd: {
            type: "string",
            description:
              "Относительная подпапка workspace для cwd (по умолчанию корень)",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_url",
      description:
        "Скачать http(s) URL и вернуть структурированные данные страницы: title, description, headings, content, colors, links. Используй для ЛЮБОГО вопроса по ссылке (факты, цвета, цены, текст, метаданные). Не говори, что не можешь открывать URL. Для figma.com — MCP Figma tools, если доступны.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Полный URL со схемой http или https",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_external",
      description:
        "Открыть http(s) URL во внешнем браузере пользователя. Если нужно самому проверить факты/текст/цвета по ссылке — сначала fetch_url. Для Figma — MCP tools.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Полный URL со схемой http или https",
          },
        },
        required: ["url"],
      },
    },
  },
];

function getWorkspaceRoot(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error("Нет открытого workspace");
  }
  return folder.uri;
}

function resolvePath(relativePath: string): vscode.Uri {
  const root = getWorkspaceRoot();
  const normalized = relativePath.replace(/^\/+/, "");
  const resolved = normalized
    ? vscode.Uri.joinPath(root, normalized)
    : root;
  const rootPath = root.fsPath.endsWith(path.sep)
    ? root.fsPath
    : root.fsPath + path.sep;
  if (
    resolved.fsPath !== root.fsPath &&
    !resolved.fsPath.startsWith(rootPath)
  ) {
    throw new Error("Путь вне workspace запрещён");
  }
  return resolved;
}

function truncate(text: string, max = 40_000): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max) + "\n\n[truncated]";
}

async function runCommand(command: string, cwdRelative = ""): Promise<string> {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("Пустая команда");
  }

  const blocked = [/^\s*rm\s+-rf\s+\/\s*$/i, /mkfs\./i, /diskutil\s+erase/i];
  if (blocked.some((re) => re.test(trimmed))) {
    throw new Error("Команда заблокирована политикой безопасности");
  }

  const cwd = resolvePath(cwdRelative).fsPath;
  try {
    const { stdout, stderr } = await execFileAsync("/bin/zsh", ["-lc", trimmed], {
      cwd,
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_PAGER: "cat",
        PAGER: "cat",
      },
    });
    return JSON.stringify({
      ok: true,
      cwd: cwdRelative || ".",
      command: trimmed,
      stdout: truncate(stdout || ""),
      stderr: truncate(stderr || ""),
    });
  } catch (error) {
    const err = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
      killed?: boolean;
    };
    return JSON.stringify({
      ok: false,
      cwd: cwdRelative || ".",
      command: trimmed,
      code: err.code ?? null,
      killed: Boolean(err.killed),
      stdout: truncate(err.stdout || ""),
      stderr: truncate(err.stderr || err.message || String(error)),
    });
  }
}

export async function runMainLikeTool(
  name: string,
  argsJson: string
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    return JSON.stringify({ error: "Некорректный JSON аргументов" });
  }

  try {
    switch (name) {
      case "list_files": {
        const relativePath = String(args.relativePath ?? "");
        if (isIgnoredWorkspacePath(relativePath)) {
          return JSON.stringify({ error: ignoredPathError(relativePath) });
        }
        const dir = resolvePath(relativePath);
        const entries = await vscode.workspace.fs.readDirectory(dir);
        const items = entries
          .filter(([entryName, type]) => {
            if (type === vscode.FileType.Directory && isIgnoredDirName(entryName)) {
              return false;
            }
            return true;
          })
          .map(([entryName, type]) => ({
            name: entryName,
            type:
              type === vscode.FileType.Directory
                ? "dir"
                : type === vscode.FileType.File
                  ? "file"
                  : "other",
          }));
        return JSON.stringify({ path: relativePath || ".", items });
      }
      case "read_file": {
        const relativePath = String(args.relativePath ?? "");
        if (isIgnoredWorkspacePath(relativePath)) {
          return JSON.stringify({ error: ignoredPathError(relativePath) });
        }
        const uri = resolvePath(relativePath);
        const data = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(data).toString("utf8");
        return JSON.stringify({
          path: relativePath,
          content: truncate(text, 80_000),
        });
      }
      case "write_file":
      case "get_diagnostics": {
        // Полный путь из tools.ts: diagnostics / importWarnings / unchanged.
        return runTool(name, argsJson);
      }
      case "run_command": {
        return await runCommand(
          String(args.command ?? ""),
          String(args.cwd ?? "")
        );
      }
      case "fetch_url":
      case "open_external": {
        return runTool(name, argsJson);
      }
      default:
        return JSON.stringify({ error: `Неизвестный инструмент: ${name}` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: message });
  }
}

export function mainLikeToolsForPolicy(
  tools: "agent" | "readonly"
): ChatTool[] {
  if (tools !== "readonly") {
    return mainLikeAgentTools;
  }
  return mainLikeAgentTools.filter((tool) =>
    MAIN_LIKE_READONLY_TOOL_NAMES.has(tool.function.name)
  );
}
