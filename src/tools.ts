import { execFile } from "child_process";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import { URL } from "url";
import { promisify } from "util";
import * as vscode from "vscode";
import { lineDiffStats } from "./diffStats";
import type { ChatTool } from "./openaiClient";

const execFileAsync = promisify(execFile);

export const READONLY_TOOL_NAMES = new Set([
  "list_files",
  "read_file",
  "open_external",
  "fetch_url",
]);

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
  {
    type: "function",
    function: {
      name: "fetch_url",
      description:
        "Скачать содержимое http(s) URL и вернуть текст (для чтения страницы/документации). Не говори, что не можешь открывать внешние URL — вызывай этот tool. Для figma.com используй MCP Figma tools, если они доступны.",
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
        "Открыть http(s) URL во внешнем браузере пользователя. Если нужно самому прочитать содержимое ссылки — используй fetch_url. Для Figma — MCP tools.",
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

function htmlToReadableText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHttpUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Пустой URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Некорректный URL");
  }
  const scheme = parsed.protocol.replace(":", "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    throw new Error("Разрешены только http и https");
  }
  return parsed;
}

async function fetchUrl(rawUrl: string): Promise<string> {
  const parsed = parseHttpUrl(rawUrl);
  const lib = parsed.protocol === "https:" ? https : http;

  const { status, contentType, body } = await new Promise<{
    status: number;
    contentType: string;
    body: string;
  }>((resolve, reject) => {
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
          "User-Agent": "HarborAgents/1.0 (+VS Code extension)",
        },
        timeout: 20_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        const maxBytes = 512_000;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total <= maxBytes) {
            chunks.push(chunk);
          }
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            contentType: String(res.headers["content-type"] || ""),
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("Таймаут запроса URL"));
    });
    req.on("error", reject);
    req.end();
  });

  if (status < 200 || status >= 400) {
    return JSON.stringify({
      ok: false,
      url: parsed.toString(),
      status,
      error: `HTTP ${status}`,
      preview: truncate(body, 2_000),
    });
  }

  const isHtml = /html|xml/i.test(contentType) || /^\s*</.test(body);
  const text = isHtml ? htmlToReadableText(body) : body;
  return JSON.stringify({
    ok: true,
    url: parsed.toString(),
    status,
    contentType,
    content: truncate(text, 60_000),
  });
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
      case "open_external": {
        const raw = String(args.url ?? "").trim();
        let parsed: URL;
        try {
          parsed = parseHttpUrl(raw);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ error: message });
        }
        const opened = await vscode.env.openExternal(
          vscode.Uri.parse(parsed.toString())
        );
        return JSON.stringify({ ok: opened, url: parsed.toString() });
      }
      case "fetch_url": {
        return await fetchUrl(String(args.url ?? ""));
      }
      default:
        return JSON.stringify({ error: `Неизвестный инструмент: ${name}` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: message });
  }
}
