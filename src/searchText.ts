import * as fs from "fs";
import * as path from "path";
import { WORKSPACE_IGNORE_DIRS, isIgnoredDirName } from "./workspaceIgnore";

// Re-export list for tests / callers that want the canonical ignore set.
export { WORKSPACE_IGNORE_DIRS };

const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_MAX_RESULTS = 50;
const MAX_LINE_CHARS = 300;

export interface SearchTextOptions {
  rootPath: string;
  query: string;
  /** Относительная подпапка для ограничения поиска. */
  pathPrefix?: string;
  /** Простая glob-маска имени файла: "*.ts", "*.{ts,tsx}", "test_*". */
  include?: string;
  /** Трактовать query как RegExp. */
  regex?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
  maxFileBytes?: number;
}

export interface SearchTextMatch {
  path: string;
  line: number;
  text: string;
}

export interface SearchTextResult {
  matches: SearchTextMatch[];
  searchedFiles: number;
  truncated: boolean;
  skippedLargeFiles: number;
}

function toPosix(relative: string): string {
  return relative.split(path.sep).join("/");
}

/** Простая glob-маска ("*.ts", "*.{ts,tsx}") → RegExp по basename. */
export function globToRegExp(glob: string): RegExp | undefined {
  const raw = String(glob || "").trim();
  if (!raw) {
    return undefined;
  }
  const brace = raw.match(/\{([^}]+)\}/);
  const alternatives = brace
    ? brace[1]
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => raw.replace(brace[0], part))
    : [raw];
  const escape = (value: string): string =>
    value
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]");
  try {
    return new RegExp(
      `^(?:${alternatives.map(escape).join("|")})$`,
      "i"
    );
  } catch {
    return undefined;
  }
}

function buildMatcher(
  query: string,
  regex: boolean,
  caseSensitive: boolean
): ((line: string) => boolean) | undefined {
  if (!query) {
    return undefined;
  }
  if (regex) {
    try {
      const re = new RegExp(query, caseSensitive ? "" : "i");
      return (line) => re.test(line);
    } catch {
      return undefined;
    }
  }
  if (caseSensitive) {
    return (line) => line.includes(query);
  }
  const needle = query.toLowerCase();
  return (line) => line.toLowerCase().includes(needle);
}

function looksBinary(buffer: Buffer): boolean {
  const probe = Math.min(buffer.length, 8_000);
  for (let i = 0; i < probe; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Рекурсивный поиск текста по workspace без внешних бинарей.
 * Пропускает служебные каталоги, бинарные и слишком большие файлы.
 */
export function searchTextFiles(options: SearchTextOptions): SearchTextResult {
  const maxResults = Math.max(
    1,
    Math.floor(options.maxResults ?? DEFAULT_MAX_RESULTS)
  );
  const maxFileBytes = Math.max(
    1_024,
    Math.floor(options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES)
  );
  const matcher = buildMatcher(
    String(options.query || ""),
    options.regex === true,
    options.caseSensitive === true
  );
  const result: SearchTextResult = {
    matches: [],
    searchedFiles: 0,
    truncated: false,
    skippedLargeFiles: 0,
  };
  if (!matcher) {
    return result;
  }

  const rootPath = path.resolve(options.rootPath);
  const prefix = String(options.pathPrefix || "")
    .replace(/^\/+|\/+$/g, "");
  const startDir = prefix ? path.join(rootPath, prefix) : rootPath;
  if (!startDir.startsWith(rootPath)) {
    return result;
  }
  const includeRe = globToRegExp(String(options.include || ""));

  const walk = (dir: string): void => {
    if (result.matches.length >= maxResults) {
      result.truncated = true;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (result.matches.length >= maxResults) {
        result.truncated = true;
        return;
      }
      if (entry.name.startsWith(".") && entry.name !== ".") {
        if (entry.isDirectory() || isIgnoredDirName(entry.name)) {
          continue;
        }
      }
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isIgnoredDirName(entry.name)) {
          walk(absolute);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (includeRe && !includeRe.test(entry.name)) {
        continue;
      }
      let stat: fs.Stats;
      try {
        stat = fs.statSync(absolute);
      } catch {
        continue;
      }
      if (stat.size > maxFileBytes) {
        result.skippedLargeFiles += 1;
        continue;
      }
      let buffer: Buffer;
      try {
        buffer = fs.readFileSync(absolute);
      } catch {
        continue;
      }
      if (looksBinary(buffer)) {
        continue;
      }
      result.searchedFiles += 1;
      const relative = toPosix(path.relative(rootPath, absolute));
      const lines = buffer.toString("utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!matcher(line)) {
          continue;
        }
        const text = line.trim();
        result.matches.push({
          path: relative,
          line: i + 1,
          text:
            text.length > MAX_LINE_CHARS
              ? `${text.slice(0, MAX_LINE_CHARS)}…`
              : text,
        });
        if (result.matches.length >= maxResults) {
          result.truncated = true;
          return;
        }
      }
    }
  };

  walk(startDir);
  return result;
}

export interface SliceLinesResult {
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  ranged: boolean;
}

/** Срез файла по 1-based диапазону строк с устойчивым клампом границ. */
export function sliceFileLines(
  text: string,
  startLine?: number,
  endLine?: number
): SliceLinesResult {
  const lines = text.split(/\r?\n/);
  const totalLines = lines.length;
  const hasRange =
    (typeof startLine === "number" && Number.isFinite(startLine)) ||
    (typeof endLine === "number" && Number.isFinite(endLine));
  if (!hasRange) {
    return { content: text, startLine: 1, endLine: totalLines, totalLines, ranged: false };
  }
  const from = Math.min(
    totalLines,
    Math.max(1, Math.floor(Number.isFinite(startLine) ? (startLine as number) : 1))
  );
  const to = Math.min(
    totalLines,
    Math.max(
      from,
      Math.floor(Number.isFinite(endLine) ? (endLine as number) : totalLines)
    )
  );
  return {
    content: lines.slice(from - 1, to).join("\n"),
    startLine: from,
    endLine: to,
    totalLines,
    ranged: true,
  };
}

export interface ReadCacheEntry {
  mtimeMs: number;
  content: string;
}

export interface ReadFileCache {
  get(fsPath: string, mtimeMs: number): string | undefined;
  set(fsPath: string, mtimeMs: number, content: string): void;
  invalidate(fsPath: string): void;
  readonly size: number;
}

/** LRU-подобный кэш содержимого файлов в рамках процесса (инвалидируется по mtime). */
export function createReadFileCache(maxEntries = 40): ReadFileCache {
  const entries = new Map<string, ReadCacheEntry>();
  return {
    get(fsPath, mtimeMs) {
      const hit = entries.get(fsPath);
      if (!hit || hit.mtimeMs !== mtimeMs) {
        return undefined;
      }
      // обновляем порядок для LRU-вытеснения
      entries.delete(fsPath);
      entries.set(fsPath, hit);
      return hit.content;
    },
    set(fsPath, mtimeMs, content) {
      entries.delete(fsPath);
      entries.set(fsPath, { mtimeMs, content });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        entries.delete(oldest);
      }
    },
    invalidate(fsPath) {
      entries.delete(fsPath);
    },
    get size() {
      return entries.size;
    },
  };
}

export interface ServedReadTracker {
  /** Ключ: path + диапазон строк. Возвращает true, если то же чтение уже отдавали при том же mtime. */
  wasServed(key: string, mtimeMs: number): boolean;
  markServed(key: string, mtimeMs: number): void;
  /** После write/search_replace — разрешить одно свежее чтение. */
  invalidatePath(relativePath: string): void;
  clear(): void;
  readonly size: number;
}

export function servedReadKey(
  relativePath: string,
  startLine?: number,
  endLine?: number
): string {
  const pathKey = String(relativePath || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .toLowerCase();
  const from =
    typeof startLine === "number" && Number.isFinite(startLine)
      ? startLine
      : "";
  const to =
    typeof endLine === "number" && Number.isFinite(endLine) ? endLine : "";
  return `${pathKey}#${from}:${to}`;
}

/** Трекер полных read_file в рамках одного хода агента. */
export function createServedReadTracker(): ServedReadTracker {
  const served = new Map<string, number>();
  return {
    wasServed(key, mtimeMs) {
      const prev = served.get(key);
      return prev !== undefined && prev === mtimeMs && mtimeMs > 0;
    },
    markServed(key, mtimeMs) {
      if (mtimeMs > 0) {
        served.set(key, mtimeMs);
      }
    },
    invalidatePath(relativePath) {
      const pathKey = String(relativePath || "")
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .toLowerCase();
      if (!pathKey) {
        return;
      }
      const prefix = `${pathKey}#`;
      for (const key of [...served.keys()]) {
        if (key.startsWith(prefix)) {
          served.delete(key);
        }
      }
    },
    clear() {
      served.clear();
    },
    get size() {
      return served.size;
    },
  };
}

const IDENTIFIER_TOKEN = /[A-Za-z_$][\w$]{3,63}/g;
const IDENTIFIER_STOPWORDS = new Set([
  "function",
  "return",
  "const",
  "export",
  "import",
  "string",
  "number",
  "boolean",
  "true",
  "false",
  "undefined",
  "null",
  "this",
  "await",
  "async",
  "interface",
  "type",
  "class",
]);

/**
 * Кодовые идентификаторы из текста пользователя: camelCase/snake_case/PascalCase
 * токены и всё в бэктиках. Обычные слова (нет регистровой границы и _) пропускаем.
 */
export function extractCodeIdentifiers(text: string): string[] {
  const raw = String(text || "");
  if (!raw) {
    return [];
  }
  const found = new Map<string, number>();
  const push = (token: string, weight: number): void => {
    if (
      token.length < 4 ||
      IDENTIFIER_STOPWORDS.has(token.toLowerCase()) ||
      /^\d+$/.test(token)
    ) {
      return;
    }
    const existing = found.get(token);
    if (existing === undefined || weight > existing) {
      found.set(token, weight);
    }
  };
  // Бэктики — почти всегда точный идентификатор: наивысший приоритет.
  for (const match of raw.matchAll(/`([^`\n]{2,80})`/g)) {
    const inner = match[1].trim();
    if (/^[A-Za-z_$][\w$]*(\.[\w$]+)*$/.test(inner)) {
      push(inner.split(".").pop() || inner, 3);
    }
  }
  for (const match of raw.matchAll(IDENTIFIER_TOKEN)) {
    const token = match[0];
    const isCodeShape =
      token.includes("_") ||
      token.includes("$") ||
      /[a-z][A-Z]/.test(token) ||
      /^[A-Z][a-z]/.test(token);
    push(token, isCodeShape ? 2 : 0);
  }
  return [...found.entries()]
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"))
    .map(([token]) => token)
    .slice(0, 3);
}

/**
 * Prefetch поиска по идентификаторам из user message до первого LLM-вызова:
 * «найди, где X» отвечается за один раунд без search_text.
 */
export function buildSearchPrefetchMessage(
  rootPath: string,
  userText: string,
  options?: { maxPerIdentifier?: number }
): string {
  const identifiers = extractCodeIdentifiers(userText);
  if (!identifiers.length) {
    return "";
  }
  const maxPerIdentifier = Math.max(1, options?.maxPerIdentifier ?? 8);
  const sections: string[] = [];
  for (const identifier of identifiers) {
    const found = searchTextFiles({
      rootPath,
      query: identifier,
      maxResults: maxPerIdentifier,
    });
    if (!found.matches.length) {
      continue;
    }
    sections.push(
      [
        `"${identifier}" (${found.matches.length}${
          found.truncated ? "+" : ""
        } matches):`,
        ...found.matches.map(
          (match) => `- ${match.path}:${match.line}: ${match.text}`
        ),
      ].join("\n")
    );
  }
  if (!sections.length) {
    return "";
  }
  return [
    "Prefetched search results for identifiers from the user message (already computed — do NOT call search_text again for these; answer directly if this is enough):",
    ...sections,
  ].join("\n");
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Строка похожа на определение идентификатора, а не на обычное использование. */
export function isLikelyDefinitionLine(line: string, identifier: string): boolean {
  const text = String(line || "").trim();
  const id = String(identifier || "").trim();
  if (!text || !id) {
    return false;
  }
  const escaped = escapeRegExp(id);
  return new RegExp(
    `(?:^|\\b)(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function\\*?\\s+|class\\s+|type\\s+|interface\\s+|enum\\s+)${escaped}\\b` +
      `|` +
      `(?:^|\\b)(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\s*=`,
    "i"
  ).test(text);
}

/**
 * Достаёт path:line из уже полученных tool-результатов search_text
 * (для ответа после обрыва модели по API 500).
 */
export function formatLocateAnswerFromToolMessages(
  messages: Array<{ role?: string; name?: string; content?: unknown }>,
  userText: string
): string | undefined {
  const identifiers = extractCodeIdentifiers(userText);
  const byId = new Map<string, SearchTextMatch[]>();

  for (const message of messages) {
    if (message.role !== "tool" || message.name !== "search_text") {
      continue;
    }
    let parsed: {
      query?: unknown;
      matches?: Array<{ path?: unknown; line?: unknown; text?: unknown }>;
    };
    try {
      parsed = JSON.parse(String(message.content || "{}")) as typeof parsed;
    } catch {
      continue;
    }
    const query = String(parsed.query || "").trim();
    const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
    if (!matches.length) {
      continue;
    }
    const key =
      identifiers.find((id) => id === query || query.includes(id)) ||
      query ||
      identifiers[0] ||
      "search";
    const bucket = byId.get(key) || [];
    for (const match of matches) {
      const pathValue = String(match.path || "").trim();
      const line = Number(match.line) || 0;
      const text = String(match.text || "");
      if (!pathValue || line < 1) {
        continue;
      }
      bucket.push({ path: pathValue, line, text });
    }
    byId.set(key, bucket);
  }

  if (!byId.size) {
    return undefined;
  }

  const sections: string[] = [];
  for (const [identifier, matches] of byId) {
    if (!matches.length) {
      continue;
    }
    const definitions = matches.filter((match) =>
      isLikelyDefinitionLine(match.text, identifier)
    );
    const picks = (definitions.length ? definitions : matches).slice(0, 12);
    sections.push(
      [
        `**${identifier}** (${definitions.length ? "определение" : "совпадения"}):`,
        ...picks.map(
          (match) =>
            `- \`${match.path}:${match.line}\` — ${match.text.trim().slice(0, 140)}`
        ),
      ].join("\n")
    );
  }
  return sections.length ? sections.join("\n\n") : undefined;
}
