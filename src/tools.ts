import { execFile } from "child_process";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";
import { lineDiffStats } from "./diffStats";
import type { ChatTool } from "./openaiClient";

const execFileAsync = promisify(execFile);

export const READONLY_TOOL_NAMES = new Set(["list_files", "read_file"]);

export const agentTools: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "Список файлов в папке workspace (относительно корня)",
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
      description: "Прочитать текстовый файл из workspace",
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
      name: "write_file",
      description: "Создать или перезаписать текстовый файл в workspace",
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
        "Выполнить shell-команду в корне workspace (git, npm, ls и т.п.). Используй для git status/log/diff, сборки, тестов.",
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

  // Базовая защита от совсем опасного
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
        // меньше интерактива
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

export async function runTool(
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
        const dir = resolvePath(relativePath);
        const entries = await vscode.workspace.fs.readDirectory(dir);
        const items = entries.map(([entryName, type]) => ({
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
        const uri = resolvePath(relativePath);
        const data = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(data).toString("utf8");
        return JSON.stringify({
          path: relativePath,
          content: truncate(text, 80_000),
        });
      }
      case "write_file": {
        const relativePath = String(args.relativePath ?? "");
        const content = String(args.content ?? "");
        const uri = resolvePath(relativePath);
        let before = "";
        let created = true;
        try {
          const existing = await vscode.workspace.fs.readFile(uri);
          before = Buffer.from(existing).toString("utf8");
          created = false;
        } catch {
          created = true;
        }
        const parent = vscode.Uri.joinPath(uri, "..");
        await vscode.workspace.fs.createDirectory(parent);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
        const { added, removed } = lineDiffStats(before, content);
        return JSON.stringify({
          ok: true,
          path: relativePath,
          created,
          added,
          removed,
        });
      }
      case "run_command": {
        return await runCommand(
          String(args.command ?? ""),
          String(args.cwd ?? "")
        );
      }
      default:
        return JSON.stringify({ error: `Неизвестный инструмент: ${name}` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: message });
  }
}
