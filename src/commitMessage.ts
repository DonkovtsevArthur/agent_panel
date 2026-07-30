import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";
import {
  getConfig,
  getEnabledModels,
  resolveModelEndpoint,
} from "./config";
import {
  defaultCommitMessagePromptForLanguage,
  isBuiltinCommitMessagePrompt,
  resolveUiLanguage,
} from "./i18n";
import { selectUtilityModel } from "./modelRouting";
import { getOpenAICompatibleClient } from "./openaiClient";
import {
  capWorkspaceRuleText,
  DEFAULT_WORKSPACE_RULE_CHAR_CAP,
  readWorkspaceRuleFile,
} from "./workspaceRules";

const execFileAsync = promisify(execFile);

const MAX_DIFF_CHARS = 90_000;

const COMMIT_RULE_CANDIDATES = [
  ".cursor/rules/commit.mdc",
  ".cursor/rules/commit-message.mdc",
  ".cursor/rules/git-commit.mdc",
  ".cursor/rules/committing-changes.mdc",
  ".cursor/rules/commit.md",
  ".cursor/rules/commit-message.md",
  ".cursorrules",
  "AGENTS.md",
  "COMMIT.md",
  "COMMIT_MESSAGE.md",
  "docs/commit.md",
  "docs/commit-message.md",
  ".gitmessage",
];

const RULE_HINT =
  /commit\s*message|сообщен\w*\s+коммит|git\s+commit|conventional\s+commits|generate commit/i;

type GitRepository = {
  rootUri: vscode.Uri;
  inputBox: { value: string };
};

type GitAPI = {
  repositories: GitRepository[];
  getRepository?: (uri: vscode.Uri) => GitRepository | null;
};

async function getGitApi(): Promise<GitAPI | undefined> {
  const ext = vscode.extensions.getExtension("vscode.git");
  if (!ext) {
    return undefined;
  }
  const exports = ext.isActive ? ext.exports : await ext.activate();
  return exports?.getAPI?.(1) as GitAPI | undefined;
}

function asUri(value: unknown): vscode.Uri | undefined {
  if (!value) {
    return undefined;
  }
  if (value instanceof vscode.Uri) {
    return value;
  }
  if (typeof value === "object") {
    const obj = value as {
      rootUri?: vscode.Uri;
      uri?: vscode.Uri;
      repositoryRoot?: string;
    };
    if (obj.rootUri instanceof vscode.Uri) {
      return obj.rootUri;
    }
    if (obj.uri instanceof vscode.Uri) {
      return obj.uri;
    }
    if (typeof obj.repositoryRoot === "string" && obj.repositoryRoot) {
      return vscode.Uri.file(obj.repositoryRoot);
    }
  }
  if (typeof value === "string" && value) {
    try {
      return vscode.Uri.parse(value);
    } catch {
      return vscode.Uri.file(value);
    }
  }
  return undefined;
}

function resolveActiveRepository(
  api: GitAPI,
  preferredUri?: vscode.Uri
): GitRepository | undefined {
  const repos = api.repositories || [];
  if (!repos.length) {
    return undefined;
  }

  const candidates = [
    preferredUri,
    vscode.window.activeTextEditor?.document.uri,
    vscode.workspace.workspaceFolders?.[0]?.uri,
  ].filter(Boolean) as vscode.Uri[];

  if (typeof api.getRepository === "function") {
    for (const uri of candidates) {
      const matched = api.getRepository(uri);
      if (matched) {
        return matched;
      }
    }
  }

  for (const uri of candidates) {
    const hit = repos.find((repo) => {
      const root = repo.rootUri.fsPath.replace(/\/+$/, "");
      const target = uri.fsPath;
      return target === root || target.startsWith(`${root}${path.sep}`);
    });
    if (hit) {
      return hit;
    }
  }

  return repos[0];
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 20_000,
  });
  return String(stdout || "");
}

function truncateDiff(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_DIFF_CHARS) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated]`,
    truncated: true,
  };
}

function normalizeRelPaths(paths: string[] = []): string[] {
  return [
    ...new Set(
      paths
        .map((p) =>
          String(p || "")
            .trim()
            .replace(/^\.\//, "")
            .replace(/^\/+/, "")
            .replace(/\\/g, "/")
        )
        .filter(Boolean)
    ),
  ];
}

/** Собрать staged diff, иначе unstaged + status. Опционально — только по путям. */
export async function collectCommitDiff(
  cwd: string,
  paths: string[] = []
): Promise<{ diff: string; source: "staged" | "unstaged" } | undefined> {
  const scoped = normalizeRelPaths(paths);
  const pathArgs = scoped.length ? (["--", ...scoped] as string[]) : [];
  try {
    const staged = (await runGit(cwd, ["diff", "--cached", ...pathArgs])).trim();
    if (staged) {
      const { text } = truncateDiff(staged);
      return { diff: text, source: "staged" };
    }

    const unstaged = (await runGit(cwd, ["diff", ...pathArgs])).trim();
    const status = (
      await runGit(cwd, [
        "status",
        "--porcelain",
        "--untracked-files=normal",
        ...pathArgs,
      ])
    ).trim();
    if (!unstaged && !status) {
      return undefined;
    }

    const parts: string[] = [];
    if (status) {
      parts.push(`# git status --porcelain\n${status}`);
    }
    if (unstaged) {
      parts.push(`# git diff\n${unstaged}`);
    }
    const { text } = truncateDiff(parts.join("\n\n"));
    return { diff: text, source: "unstaged" };
  } catch {
    return undefined;
  }
}

function cleanCommitMessage(raw: string): string {
  let text = String(raw || "").trim();
  if (!text) {
    return "";
  }
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
  }
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }
  // Иногда модели добавляют заголовок
  text = text.replace(/^(commit message|сообщение коммита)\s*:\s*/i, "").trim();
  return text;
}

async function findCommitRuleInCursorRules(
  root: string
): Promise<string | undefined> {
  const rulesDir = path.join(root, ".cursor", "rules");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(rulesDir);
  } catch {
    return undefined;
  }

  const files = entries
    .filter((name) => /\.(mdc|md|txt)$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  const byName = files.filter((name) =>
    /commit|git.?message|committing/i.test(name)
  );
  for (const name of byName) {
    const body = await readWorkspaceRuleFile(path.join(rulesDir, name));
    if (body) {
      return body;
    }
  }

  for (const name of files) {
    const body = await readWorkspaceRuleFile(path.join(rulesDir, name));
    if (body && RULE_HINT.test(body)) {
      return body;
    }
  }
  return undefined;
}

async function findGitCommitTemplate(cwd: string): Promise<string | undefined> {
  try {
    const template = (
      await runGit(cwd, ["config", "--get", "commit.template"])
    ).trim();
    if (!template) {
      return undefined;
    }
    const resolved = path.isAbsolute(template)
      ? template
      : path.join(cwd, template);
    return readWorkspaceRuleFile(resolved);
  } catch {
    return undefined;
  }
}

/** Правило коммитов из проекта, если есть; иначе undefined → дефолтный промпт. */
export async function loadProjectCommitRule(
  root: string
): Promise<string | undefined> {
  for (const rel of COMMIT_RULE_CANDIDATES) {
    const body = await readWorkspaceRuleFile(path.join(root, rel));
    if (!body) {
      continue;
    }
    // AGENTS.md / .cursorrules берём только если там есть секция про коммиты
    if (
      /(^|\/)(AGENTS\.md|\.cursorrules)$/i.test(rel) &&
      !RULE_HINT.test(body)
    ) {
      continue;
    }
    return capWorkspaceRuleText(body, DEFAULT_WORKSPACE_RULE_CHAR_CAP);
  }

  const fromRules = await findCommitRuleInCursorRules(root);
  if (fromRules) {
    return capWorkspaceRuleText(fromRules, DEFAULT_WORKSPACE_RULE_CHAR_CAP);
  }

  const fromTemplate = await findGitCommitTemplate(root);
  if (fromTemplate) {
    return capWorkspaceRuleText(fromTemplate, DEFAULT_WORKSPACE_RULE_CHAR_CAP);
  }

  return undefined;
}

function buildPrompts(
  lang: "en" | "ru",
  diff: string,
  source: "staged" | "unstaged",
  projectRule?: string
): { system: string; user: string } {
  const baseSystem =
    lang === "ru"
      ? "Ты помогаешь писать сообщения git-коммитов. Ответь только текстом сообщения коммита: 1–2 предложения, кратко, по сути изменений. Без кавычек, без markdown, без префикса «Commit message:»."
      : "You write git commit messages. Reply with the commit message text only: 1–2 sentences, concise, focused on why. No quotes, no markdown, no 'Commit message:' prefix.";

  const system = projectRule
    ? lang === "ru"
      ? `${baseSystem}\n\nСоблюдай правило проекта для сообщений коммитов:\n${projectRule}`
      : `${baseSystem}\n\nFollow the project commit-message rule:\n${projectRule}`
    : baseSystem;

  if (lang === "ru") {
    return {
      system,
      user:
        source === "staged"
          ? `Сгенерируй сообщение коммита по staged diff:\n\n${diff}`
          : `Сгенерируй сообщение коммита по незакоммиченным изменениям (staged пуст):\n\n${diff}`,
    };
  }
  return {
    system,
    user:
      source === "staged"
        ? `Generate a commit message for this staged diff:\n\n${diff}`
        : `Generate a commit message for these uncommitted changes (nothing staged):\n\n${diff}`,
  };
}

/** Fallback, если модель недоступна. */
export function fallbackCommitMessage(
  paths: string[],
  lang: "en" | "ru" = "en"
): string {
  const list = normalizeRelPaths(paths);
  if (!list.length) {
    return lang === "ru" ? "Обновить изменения" : "Update changes";
  }
  if (list.length === 1) {
    return lang === "ru" ? `Обновить ${list[0]}` : `Update ${list[0]}`;
  }
  return lang === "ru"
    ? `Обновить ${list.length} файлов`
    : `Update ${list.length} files`;
}

/**
 * Сгенерировать текст сообщения коммита по diff.
 * Без UI — для SCM-команды и детерминированного commit/push из панели.
 */
export async function composeCommitMessageText(
  cwd: string,
  collected?: { diff: string; source: "staged" | "unstaged" },
  signal?: AbortSignal,
  paths: string[] = []
): Promise<string> {
  const data = collected ?? (await collectCommitDiff(cwd, paths));
  if (!data) {
    return "";
  }

  const config = getConfig();
  const uiLang = resolveUiLanguage(config.language);
  const commitLangSetting = config.commitMessage.language;
  const lang =
    commitLangSetting === "ru" || commitLangSetting === "en"
      ? commitLangSetting
      : uiLang;

  const enabled = getEnabledModels().filter((m) => {
    const endpoint = resolveModelEndpoint(m.id);
    return Boolean(endpoint.baseUrl && endpoint.apiKey);
  });
  const mainModelId =
    (config.defaultModel &&
    enabled.some((m) => m.id === config.defaultModel)
      ? config.defaultModel
      : "") ||
    enabled[0]?.id ||
    "";
  // Под капотом для коммита — лёгкая модель, если она включена; иначе основная.
  const modelId =
    selectUtilityModel(enabled, { fallbackModelId: mainModelId })?.modelId ||
    mainModelId;
  if (!modelId) {
    return fallbackCommitMessage(paths, lang);
  }

  const endpoint = resolveModelEndpoint(modelId);
  if (!endpoint.baseUrl || !endpoint.apiKey) {
    return fallbackCommitMessage(paths, lang);
  }

  const storedPrompt = String(
    vscode.workspace
      .getConfiguration("agentPanel")
      .get<string>("commitMessage.prompt") || ""
  ).trim();
  const hasCustomPrompt =
    Boolean(storedPrompt) && !isBuiltinCommitMessagePrompt(storedPrompt);
  const projectRule = hasCustomPrompt
    ? undefined
    : await loadProjectCommitRule(cwd);
  const instruction = hasCustomPrompt
    ? storedPrompt
    : projectRule || defaultCommitMessagePromptForLanguage(lang);
  const prompts = buildPrompts(
    lang,
    data.diff,
    data.source,
    instruction
  );
  const client = getOpenAICompatibleClient(endpoint.baseUrl, endpoint.apiKey, {
    rejectUnauthorized: config.rejectUnauthorized,
    caBundlePath: config.caBundlePath,
  });

  const result = await client.chatCompletions(
    {
      model: modelId,
      messages: [
        { role: "system", content: prompts.system },
        { role: "user", content: prompts.user },
      ],
      temperature: 0.2,
      max_tokens: 256,
    },
    signal
  );
  const content = result.message.content;
  const raw =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part) =>
              part && typeof part === "object" && "text" in part
                ? String(part.text || "")
                : ""
            )
            .join("")
        : "";
  return cleanCommitMessage(raw) || fallbackCommitMessage(paths, lang);
}

export async function generateCommitMessage(
  arg?: unknown
): Promise<void> {
  const preferredUri = asUri(arg);
  const api = await getGitApi();
  if (!api) {
    void vscode.window.showWarningMessage(
      "Git extension is not available."
    );
    return;
  }

  const repo = resolveActiveRepository(api, preferredUri);
  if (!repo) {
    void vscode.window.showWarningMessage("No Git repository found.");
    return;
  }

  const cwd = repo.rootUri.fsPath;
  const collected = await collectCommitDiff(cwd);
  if (!collected) {
    void vscode.window.showWarningMessage("No changes to commit.");
    return;
  }

  const lang = resolveUiLanguage(getConfig().language);

  try {
    const message = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title:
          lang === "ru"
            ? "Harbor Agents: генерирую сообщение коммита…"
            : "Harbor Agents: generating commit message…",
        cancellable: true,
      },
      async (_progress, token) => {
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());
        return composeCommitMessageText(cwd, collected, abort.signal);
      }
    );

    if (!message) {
      void vscode.window.showWarningMessage(
        lang === "ru"
          ? "Модель вернула пустое сообщение коммита."
          : "The model returned an empty commit message."
      );
      return;
    }

    repo.inputBox.value = message;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || /aborted/i.test(error.message))
    ) {
      return;
    }
    const text = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(
      lang === "ru"
        ? `Не удалось сгенерировать сообщение коммита: ${text}`
        : `Failed to generate commit message: ${text}`
    );
  }
}
