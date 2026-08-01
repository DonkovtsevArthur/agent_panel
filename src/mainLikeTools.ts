/**
 * Tools для main-like path: core как на main + fetch_url / open_external.
 * Figma MCP tools подмешиваются в agentLoopMainLike отдельно.
 */
import { execFile } from "child_process";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";
import type { ChatTool } from "./openaiClient";
import { getConfig } from "./config";
import { runTool } from "./tools";
import { runDelegateTask } from "./delegateTask";
import { isAllowedMcpInReadonlyMode } from "./mcp/types";
import {
  ignoredPathError,
  isIgnoredDirName,
  isIgnoredWorkspacePath,
} from "./workspaceIgnore";
import { applySearchReplace } from "./patchApply";
import { validatePackageJsonVersionValue } from "./versionBump";

const execFileAsync = promisify(execFile);

/**
 * Race a showQuickPick / showInputBox promise against the turn AbortSignal.
 * VS Code's showQuickPick has no native AbortSignal support, so on abort
 * we resolve the race with undefined — the prompt UI may still be visible,
 * but the turn proceeds as cancelled instead of blocking forever.
 */
async function raceShowWithSignal<T>(
  promise: Thenable<T>,
  signal?: AbortSignal
): Promise<T | undefined> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.resolve(undefined);
  }
  return new Promise<T | undefined>((resolve) => {
    let done = false;
    const onAbort = () => {
      if (!done) {
        done = true;
        resolve(undefined);
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        if (!done) {
          done = true;
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        }
      },
      (err) => {
        if (!done) {
          done = true;
          signal.removeEventListener("abort", onAbort);
          resolve(undefined);
        }
      }
    );
  });
}

function raceShowQuickPickWithSignal<T>(
  promise: Thenable<T>,
  signal?: AbortSignal
): Promise<T | undefined> {
  return raceShowWithSignal(promise, signal);
}

function raceShowInputBoxWithSignal(
  promise: Thenable<string | undefined>,
  signal?: AbortSignal
): Promise<string | undefined> {
  return raceShowWithSignal(promise, signal);
}

export const MAIN_LIKE_READONLY_TOOL_NAMES = new Set([
  "list_files",
  "read_file",
  "get_diagnostics",
  "fetch_url",
  "open_external",
  "request_user_input",
  "delegate_task",
]);

/** Main-like инструменты, меняющие файлы на диске (учитываются как правки). */
export const MAIN_LIKE_WRITE_TOOL_NAMES = new Set([
  "write_file",
  "search_replace",
]);

export function isMainLikeWriteTool(name: string): boolean {
  return MAIN_LIKE_WRITE_TOOL_NAMES.has(String(name || ""));
}

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
        "Создать или перезаписать текстовый файл в workspace. Не пишет в node_modules/.git/dist/out. При diagnostics/importWarnings в ответе сразу исправь ошибки. Используй ТОЛЬКО для создания нового файла или полной перезаписи. Для точечной правки существующего файла предпочитай search_replace — он меняет только нужный фрагмент и не рискует остальное содержимое.",
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
      name: "search_replace",
      description:
        "Точно заменить текст в существующем файле workspace (хирургическая правка). По умолчанию old_string должен встречаться ровно один раз; для всех совпадений укажи replace_all=true. Сохраняет окончания строк файла. ПРЕДПОЧИТАЙ этот инструмент для точечных правок существующих файлов — он трогает только целевой фрагмент, остальное содержимое (зависимости, импорты, соседний код) не меняется и не удаляется. write_file используй только для создания нового файла или полной перезаписи.",
      parameters: {
        type: "object",
        properties: {
          relativePath: {
            type: "string",
            description: "Относительный путь к существующему файлу",
          },
          old_string: {
            type: "string",
            description:
              "Точный старый текст. Добавь окружающий контекст, чтобы совпадение было уникальным.",
          },
          new_string: {
            type: "string",
            description: "Новый текст (может быть пустым для удаления)",
          },
          replace_all: {
            type: "boolean",
            description: "Заменить все совпадения (по умолчанию false)",
          },
        },
        required: ["relativePath", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Выполнить shell-команду в корне workspace (git, npm, ls и т.п.). git status/log/diff, сборка, тесты. Откат правок агента: git restore -- <paths> (не git restore .). Откат ВСЕХ локальных изменений — только если пользователь явно сказал «все»: git restore . и при необходимости git clean -fd. Не используй write_file для отмены.",
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
  {
    type: "function",
    function: {
      name: "request_user_input",
      description:
        "Ask the user a clarifying question with multiple-choice options. Use when requirements are ambiguous and you need a decision — do not guess, ask. Provide 2–4 mutually exclusive options and a recommended default. The UI always offers a free-text «custom answer» in addition to your options.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question to ask the user",
          },
          options: {
            type: "array",
            items: { type: "string" },
            description: "2–4 mutually exclusive answer options",
          },
          recommended: {
            type: "string",
            description: "Recommended option (0-based index) — used as default if user skips",
          },
        },
        required: ["question", "options"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delegate_task",
      description:
        "Delegate a self-contained sub-task to a sub-agent. Use for large tasks with independent steps — each sub-agent gets its own context budget and max_tokens, avoiding truncation. The sub-agent runs in the same workspace. Returns the sub-agent's final answer. Describe the sub-task concretely with all context the sub-agent needs (file paths, patterns to follow, expected behavior). In Plan/Ask mode the sub-agent is always research-only (ask); agent (edits) requires Agent mode.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "Concrete, self-contained sub-task description with all context the sub-agent needs",
          },
          mode: {
            type: "string",
            enum: ["agent", "ask"],
            description:
              "agent for edits, ask for research only (default: agent). Ignored in Plan/Ask — forced to ask.",
          },
        },
        required: ["task"],
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

async function readWorkspaceFileText(uri: vscode.Uri): Promise<string | null> {
  try {
    const data = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(data).toString("utf8");
  } catch {
    return null;
  }
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
  argsJson: string,
  options?: {
    readonly?: boolean;
    /** Selected chat model — used by delegate_task (falls back to defaultModel). */
    model?: string;
    /** Parent turn abort signal — propagated to delegate_task sub-agent. */
    signal?: AbortSignal;
  }
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
      case "write_file": {
        const relativePath = String(args.relativePath ?? "");
        const baseName = path.basename(relativePath);
        if (baseName === "package.json") {
          const newContent = String(args.content ?? "");
          const guardError = validatePackageJsonVersionValue(newContent);
          if (guardError) {
            return guardError;
          }
        }
        return runTool(name, argsJson);
      }
      case "search_replace": {
        const relativePath = String(args.relativePath ?? "");
        const baseName = path.basename(relativePath);
        if (baseName === "package.json") {
          const uri = resolvePath(relativePath);
          const before = await readWorkspaceFileText(uri);
          if (before !== null) {
            const oldString = String(args.old_string ?? "");
            const newString = String(args.new_string ?? "");
            const replaceAll = args.replace_all === true;
            const applied = applySearchReplace(
              before,
              oldString,
              newString,
              replaceAll
            );
            if (applied.ok) {
              const guardError = validatePackageJsonVersionValue(
                applied.content
              );
              if (guardError) {
                return guardError;
              }
            }
          }
        }
        return runTool(name, argsJson);
      }
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
      case "request_user_input": {
        const question = String(args.question ?? "").trim();
        const optList = Array.isArray(args.options)
          ? (args.options as unknown[]).map((o) => String(o ?? "")).filter(Boolean)
          : [];
        const recommendedIdx = Number(args.recommended);
        if (!question || optList.length < 2) {
          return JSON.stringify({
            ok: false,
            error: "request_user_input requires a question and at least 2 options",
          });
        }
        const customLabel = "Свой ответ…";
        const items: Array<{
          label: string;
          description?: string;
          picked?: boolean;
        }> = optList.map((opt, i) => ({
          label: opt,
          ...(i === recommendedIdx ? { picked: true } : {}),
        }));
        items.push({
          label: customLabel,
          description: "ввести вручную",
        });
        // Abort-aware QuickPick: race showQuickPick against the turn signal
        // so Stop actually interrupts the prompt instead of blocking until
        // the user picks or escapes manually.
        const picked = await raceShowQuickPickWithSignal(
          vscode.window.showQuickPick(items, {
            placeHolder: question,
            canPickMany: false,
            ignoreFocusOut: true,
            title: question,
          }),
          options?.signal
        );
        if (!picked) {
          // Cancel (Esc / focus loss): НЕ подсовываем fallback как ответ.
          // Явно сообщаем модели, что пользователь снял вопрос — не трактовать
          // fallback как выбор и не строить план на выдуманном ответе.
          return JSON.stringify({
            ok: false,
            cancelled: true,
            message:
              "User dismissed the prompt (Esc / cancelled). Do NOT assume any of the options was chosen. Either ask again with a different framing, or proceed with explicit uncertainty and flag the assumption in the plan.",
          });
        }
        if (picked.label === customLabel) {
          const custom = await raceShowInputBoxWithSignal(
            vscode.window.showInputBox({
              prompt: question,
              placeHolder: "Введите свой ответ",
              ignoreFocusOut: true,
            }),
            options?.signal
          );
          const answer = String(custom ?? "").trim();
          if (!answer) {
            return JSON.stringify({
              ok: false,
              cancelled: true,
              message:
                "User dismissed the custom answer input. Do NOT assume any of the options was chosen. Either ask again with a different framing, or proceed with explicit uncertainty and flag the assumption in the plan.",
            });
          }
          return JSON.stringify({ ok: true, answer, custom: true });
        }
        return JSON.stringify({ ok: true, answer: picked.label });
      }
      case "delegate_task": {
        const task = String(args.task ?? "").trim();
        // Plan/Ask parent must not spawn an editing sub-agent.
        const subMode =
          options?.readonly === true
            ? "ask"
            : String(args.mode ?? "agent") === "ask"
              ? "ask"
              : "agent";
        if (!task) {
          return JSON.stringify({
            ok: false,
            error: "delegate_task requires a task description",
          });
        }
        const config = getConfig();
        const modelId = options?.model || config.defaultModel || "";
        if (!modelId) {
          return JSON.stringify({
            ok: false,
            error: "No model configured for delegation.",
          });
        }
        const folder = vscode.workspace.workspaceFolders?.[0];
        const storageUri = folder?.uri;
        const result = await runDelegateTask({
          task,
          mode: subMode as "agent" | "ask",
          model: modelId,
          storageUri,
          signal: options?.signal,
        });
        return JSON.stringify(result);
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
