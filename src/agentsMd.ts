import * as fs from "fs";
import * as path from "path";
import { extractReadFileFromToolPayload } from "./toolRecovery";

/**
 * Запрос создать/обновить AGENTS.md — при API 500 дописываем файл локально
 * из уже прочитанных package.json / README / list_files.
 */

export function looksLikeAgentsMdRequest(text: string): boolean {
  const value = String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е");
  if (!value) {
    return false;
  }
  return (
    /agents\.md/.test(value) &&
    /(?:созда|обнов|напиш|сгенерир|добав|write|create|update|generate)/i.test(
      value
    )
  );
}

function parsePackageJson(content: string): {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: string[];
  devDependencies?: string[];
} {
  try {
    const parsed = JSON.parse(content) as {
      name?: unknown;
      version?: unknown;
      scripts?: Record<string, unknown>;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const scripts: Record<string, string> = {};
    if (parsed.scripts && typeof parsed.scripts === "object") {
      for (const [key, val] of Object.entries(parsed.scripts)) {
        if (typeof val === "string") {
          scripts[key] = val;
        }
      }
    }
    return {
      ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
      ...(typeof parsed.version === "string" ? { version: parsed.version } : {}),
      ...(Object.keys(scripts).length ? { scripts } : {}),
      ...(parsed.dependencies
        ? { dependencies: Object.keys(parsed.dependencies).slice(0, 24) }
        : {}),
      ...(parsed.devDependencies
        ? {
            devDependencies: Object.keys(parsed.devDependencies).slice(0, 24),
          }
        : {}),
    };
  } catch {
    return {};
  }
}

function firstParagraph(text: string, max = 400): string {
  const cleaned = String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/^#+\s+/gm, "")
    .trim();
  const block = cleaned.split(/\n\s*\n/)[0] || cleaned;
  return block.length > max ? `${block.slice(0, max)}…` : block;
}

function extractListNames(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as {
      items?: Array<{ name?: unknown; type?: unknown }>;
    };
    return (parsed.items || [])
      .map((item) => String(item?.name || "").trim())
      .filter(Boolean)
      .slice(0, 20);
  } catch {
    return [];
  }
}

export type AgentsMdDraftInput = {
  packageJson?: string;
  readme?: string;
  srcEntries?: string[];
  existingAgentsMd?: string;
};

export function buildAgentsMdDraft(input: AgentsMdDraftInput): string {
  const pkg = input.packageJson ? parsePackageJson(input.packageJson) : {};
  const purpose = input.readme
    ? firstParagraph(input.readme)
    : "Описание проекта уточняется по коду workspace.";
  const deps = [
    ...(pkg.dependencies || []),
    ...(pkg.devDependencies || []),
  ].slice(0, 18);
  const scripts = pkg.scripts || {};
  const scriptLines = Object.entries(scripts)
    .slice(0, 10)
    .map(([name, cmd]) => `- \`npm run ${name}\` — \`${cmd}\``);
  const srcLines = (input.srcEntries || []).map((name) => `- \`src/${name}\``);

  const sections: string[] = [
    `# AGENTS.md`,
    "",
    `Краткий ориентир для AI-агентов${
      pkg.name ? ` в проекте **${pkg.name}**` : ""
    }${pkg.version ? ` (${pkg.version})` : ""}.`,
    "",
    `## Что делает проект`,
    "",
    purpose,
    "",
    `## Стек`,
    "",
    deps.length
      ? deps.map((d) => `- \`${d}\``).join("\n")
      : "- См. `package.json`",
    "",
    `## Сборка и запуск`,
    "",
    scriptLines.length
      ? scriptLines.join("\n")
      : "- Смотри scripts в `package.json`",
    "",
    `## Ключевые точки входа`,
    "",
    "- `package.json` — scripts и зависимости",
    "- `README.md` — описание для людей",
    "- `src/` — исходники",
    "",
    `## Структура src/`,
    "",
    srcLines.length ? srcLines.join("\n") : "- (не удалось получить список)",
    "",
    `## Конвенции`,
    "",
    "- Меняй только то, что нужно для задачи; не делай широких рефакторингов без запроса.",
    "- Перед правками читай соседние файлы и существующие паттерны импортов.",
    "- Не коммить секреты; `git commit`/`push` — только по явной просьбе пользователя (через UI-тег, если так принято в панели).",
    "",
  ];

  const draft = sections.join("\n").trim() + "\n";
  const existing = String(input.existingAgentsMd || "").trim();
  if (!existing) {
    return draft;
  }
  // Сохраняем полезные хвосты старого файла, если они не дублируют черновик.
  if (existing.length < 80 || existing.includes(draft.slice(0, 80))) {
    return draft;
  }
  return `${draft}\n---\n\n## Заметки из предыдущего AGENTS.md\n\n${existing.slice(0, 2500)}\n`;
}

export function collectAgentsMdDraftFromMessages(
  messages: Array<{ role?: string; name?: string; content?: unknown }>
): AgentsMdDraftInput {
  const input: AgentsMdDraftInput = {};
  const isUsable = (content: string): boolean => {
    const text = String(content || "");
    if (text.length < 8) {
      return false;
    }
    // После shrink recovery JSON/текст часто битый — лучше взять с диска.
    if (
      /\[truncated for recovery after model error\]/i.test(text) ||
      /\[older tool result compacted\]/i.test(text)
    ) {
      return false;
    }
    return true;
  };
  for (const message of messages) {
    if (message.role !== "tool") {
      continue;
    }
    const name = String(message.name || "");
    const raw = String(message.content || "");
    if (name === "read_file") {
      const extracted = extractReadFileFromToolPayload(raw);
      const pathValue = String(extracted.path || "")
        .replace(/\\/g, "/")
        .toLowerCase();
      const content = extracted.content;
      if (!content || !isUsable(content)) {
        continue;
      }
      if (pathValue.endsWith("package.json") && !input.packageJson) {
        input.packageJson = content;
      } else if (/readme\.md$/i.test(pathValue) && !input.readme) {
        input.readme = content;
      } else if (/agents\.md$/i.test(pathValue) && !input.existingAgentsMd) {
        input.existingAgentsMd = content;
      }
      continue;
    }
    if (name === "list_files" && !input.srcEntries?.length) {
      try {
        const parsed = JSON.parse(raw) as { path?: string };
        const listPath = String(parsed.path || ".")
          .replace(/\\/g, "/")
          .replace(/^\.\//, "");
        if (listPath === "src" || listPath.endsWith("/src")) {
          input.srcEntries = extractListNames(raw);
        }
      } catch {
        // ignore
      }
    }
  }
  return input;
}

export function canBuildAgentsMdFromMessages(
  messages: Array<{ role?: string; name?: string; content?: unknown }>
): boolean {
  const draft = collectAgentsMdDraftFromMessages(messages);
  return Boolean(draft.packageJson || draft.readme || draft.srcEntries?.length);
}

/**
 * Черновик для recovery после API 500: сначала факты из tools,
 * дырки (урезанный package.json и т.п.) добиваем с диска.
 */
export function resolveAgentsMdDraftForRecovery(
  messages: Array<{ role?: string; name?: string; content?: unknown }>,
  rootPath: string
): AgentsMdDraftInput {
  const fromTools = collectAgentsMdDraftFromMessages(messages);
  const fromDisk = loadAgentsMdDraftFromWorkspace(rootPath);
  return {
    packageJson: fromTools.packageJson || fromDisk.packageJson,
    readme: fromTools.readme || fromDisk.readme,
    srcEntries:
      fromTools.srcEntries?.length ? fromTools.srcEntries : fromDisk.srcEntries,
    existingAgentsMd: fromTools.existingAgentsMd || fromDisk.existingAgentsMd,
  };
}

export function canRecoverAgentsMd(
  messages: Array<{ role?: string; name?: string; content?: unknown }>,
  rootPath: string
): boolean {
  if (canBuildAgentsMdFromMessages(messages)) {
    return true;
  }
  const disk = loadAgentsMdDraftFromWorkspace(rootPath);
  return Boolean(disk.packageJson || disk.readme || disk.srcEntries?.length);
}

/** В этом ходе уже был успешный write_file/search_replace для AGENTS.md. */
export function turnAlreadyWroteAgentsMd(
  messages: Array<{ role?: string; name?: string; content?: unknown }>
): boolean {
  for (const message of messages) {
    if (message.role !== "tool") {
      continue;
    }
    const name = String(message.name || "");
    if (name !== "write_file" && name !== "search_replace") {
      continue;
    }
    const raw = String(message.content || "");
    try {
      const parsed = JSON.parse(raw) as { ok?: unknown; path?: unknown };
      if (parsed.ok === false) {
        continue;
      }
      const pathValue = String(parsed.path || "")
        .replace(/\\/g, "/")
        .toLowerCase();
      if (pathValue === "agents.md" || pathValue.endsWith("/agents.md")) {
        return true;
      }
    } catch {
      if (/agents\.md/i.test(raw) && /"ok"\s*:\s*true/.test(raw)) {
        return true;
      }
    }
  }
  return false;
}

/** Собрать черновик с диска workspace (без LLM). */
export function loadAgentsMdDraftFromWorkspace(rootPath: string): AgentsMdDraftInput {
  const root = String(rootPath || "").trim();
  const input: AgentsMdDraftInput = {};
  if (!root) {
    return input;
  }
  const readOptional = (relative: string): string | undefined => {
    try {
      return fs.readFileSync(path.join(root, relative), "utf8");
    } catch {
      return undefined;
    }
  };
  input.packageJson = readOptional("package.json");
  input.readme =
    readOptional("README.md") ||
    readOptional("Readme.md") ||
    readOptional("readme.md");
  input.existingAgentsMd = readOptional("AGENTS.md");
  try {
    const entries = fs.readdirSync(path.join(root, "src"), {
      withFileTypes: true,
    });
    input.srcEntries = entries
      .map((entry) => entry.name)
      .filter((name) => name !== ".DS_Store")
      .slice(0, 20);
  } catch {
    // no src/
  }
  return input;
}
