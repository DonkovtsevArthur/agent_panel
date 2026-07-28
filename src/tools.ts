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

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    });
}

function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function attrValue(tag: string, name: string): string | undefined {
  const re = new RegExp(
    `${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  );
  const m = tag.match(re);
  return m?.[1] ?? m?.[2] ?? m?.[3];
}

function extractMetaContent(html: string, key: string): string | undefined {
  const metaRe = /<meta\b[^>]*>/gi;
  for (const tag of html.match(metaRe) || []) {
    const name = (
      attrValue(tag, "name") ||
      attrValue(tag, "property") ||
      attrValue(tag, "itemprop") ||
      ""
    ).toLowerCase();
    if (name === key.toLowerCase()) {
      const content = attrValue(tag, "content");
      if (content?.trim()) {
        return decodeHtmlEntities(content.trim());
      }
    }
  }
  return undefined;
}

function extractTitle(html: string): string | undefined {
  const og = extractMetaContent(html, "og:title");
  if (og) {
    return og;
  }
  const m = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (m?.[1]) {
    return stripTags(m[1]).trim() || undefined;
  }
  return undefined;
}

function extractHeadings(html: string, limit = 20): string[] {
  const out: string[] = [];
  const re = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < limit) {
    const text = stripTags(m[2]);
    if (text) {
      out.push(`h${m[1]}: ${text}`);
    }
  }
  return out;
}

function extractLinks(html: string, pageUrl: URL, limit = 30): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < limit) {
    const hrefRaw = m[1] ?? m[2] ?? m[3] ?? "";
    if (!hrefRaw || hrefRaw.startsWith("#") || hrefRaw.startsWith("javascript:")) {
      continue;
    }
    let abs: string;
    try {
      abs = new URL(hrefRaw, pageUrl).toString();
    } catch {
      continue;
    }
    if (seen.has(abs)) {
      continue;
    }
    seen.add(abs);
    const label = stripTags(m[4] || "").slice(0, 80);
    out.push(label ? `${label} → ${abs}` : abs);
  }
  return out;
}

function extractJsonLd(html: string, limitChars = 8_000): string[] {
  const blocks: string[] = [];
  const re =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  let used = 0;
  while ((m = re.exec(html)) && used < limitChars) {
    const raw = m[1].trim();
    if (!raw) {
      continue;
    }
    const slice = raw.slice(0, Math.min(raw.length, limitChars - used));
    blocks.push(slice);
    used += slice.length;
  }
  return blocks;
}

function htmlToReadableText(html: string): string {
  const withBreaks = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(p|div|section|article|li|h[1-6])\b[^>]*>/gi, "\n");
  return decodeHtmlEntities(
    withBreaks
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

function normalizeColorToken(raw: string): string {
  const t = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (/^#[0-9a-f]{3}$/i.test(t)) {
    return (
      "#" +
      t
        .slice(1)
        .split("")
        .map((c) => c + c)
        .join("")
    );
  }
  if (/^#[0-9a-f]{4}$/i.test(t)) {
    const r = t[1];
    const g = t[2];
    const b = t[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-f]{8}$/i.test(t)) {
    return t.slice(0, 7);
  }
  return t;
}

function extractColorsFromText(source: string): string[] {
  const counts = new Map<string, number>();
  const bump = (token: string) => {
    const n = normalizeColorToken(token);
    if (!n) {
      return;
    }
    counts.set(n, (counts.get(n) || 0) + 1);
  };

  const hexRe = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;
  const rgbRe =
    /rgba?\(\s*[\d.]+\s*(?:,|\s)\s*[\d.]+\s*(?:,|\s)\s*[\d.]+(?:\s*(?:,|\/)\s*[\d.%]+)?\s*\)/gi;
  const hslRe =
    /hsla?\(\s*[\d.]+(?:deg|rad|turn)?\s*(?:,|\s)\s*[\d.%]+\s*(?:,|\s)\s*[\d.%]+(?:\s*(?:,|\/)\s*[\d.%]+)?\s*\)/gi;

  for (const re of [hexRe, rgbRe, hslRe]) {
    const matches = source.match(re) || [];
    for (const m of matches) {
      bump(m);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 24)
    .map(([color]) => color);
}

function collectStylesheetHrefs(html: string, pageUrl: URL): string[] {
  const hrefs: string[] = [];
  const linkRe =
    /<link\b[^>]*rel\s*=\s*["'][^"']*stylesheet[^"']*["'][^>]*>/gi;
  const hrefAttr = /href\s*=\s*["']([^"']+)["']/i;
  for (const tag of html.match(linkRe) || []) {
    const m = tag.match(hrefAttr);
    if (!m?.[1]) {
      continue;
    }
    try {
      hrefs.push(new URL(m[1], pageUrl).toString());
    } catch {
      // ignore bad href
    }
  }
  return [...new Set(hrefs)].slice(0, 4);
}

function looksLikeSpaShell(text: string, html: string): boolean {
  if (text.length >= 400) {
    return false;
  }
  return (
    /<div\s+id=["'](?:root|app|__next|__nuxt)["']/i.test(html) ||
    /marketplace\.visualstudio\.com/i.test(html) ||
    (/<script\b/i.test(html) && text.length < 200)
  );
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

async function httpGet(
  url: URL,
  redirectsLeft = 5
): Promise<{ status: number; contentType: string; body: string; finalUrl: string }> {
  const lib = url.protocol === "https:" ? https : http;
  const result = await new Promise<{
    status: number;
    contentType: string;
    body: string;
    location?: string;
  }>((resolve, reject) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,text/css,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
          "User-Agent":
            "Mozilla/5.0 (compatible; HarborAgents/1.0; +https://github.com/DonkovtsevArthur/agent_panel)",
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
            location: res.headers.location
              ? String(res.headers.location)
              : undefined,
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

  if (
    result.location &&
    redirectsLeft > 0 &&
    result.status >= 300 &&
    result.status < 400
  ) {
    const next = new URL(result.location, url);
    if (next.protocol === "http:" || next.protocol === "https:") {
      return httpGet(next, redirectsLeft - 1);
    }
  }

  return {
    status: result.status,
    contentType: result.contentType,
    body: result.body,
    finalUrl: url.toString(),
  };
}

async function fetchUrl(rawUrl: string): Promise<string> {
  const parsed = parseHttpUrl(rawUrl);
  const { status, contentType, body, finalUrl } = await httpGet(parsed);

  if (status < 200 || status >= 400) {
    return JSON.stringify({
      ok: false,
      url: finalUrl,
      status,
      error: `HTTP ${status}`,
      preview: truncate(body, 2_000),
      note: "Do not invent authorization requirements. Report the HTTP status. If the question is about this workspace/project, use read_file / list_files instead.",
    });
  }

  const isHtml = /html|xml/i.test(contentType) || /^\s*</.test(body);
  const isCss = /css/i.test(contentType) || /\.css(\?|$)/i.test(finalUrl);
  const isJson =
    /json/i.test(contentType) || /^\s*[{[]/.test(body.trim());

  if (!isHtml && !isCss) {
    return JSON.stringify({
      ok: true,
      url: finalUrl,
      status,
      contentType,
      note: "Non-HTML response. Answer from content. Do not claim you cannot open external URLs.",
      content: truncate(body, 60_000),
    });
  }

  const text = isHtml ? htmlToReadableText(body) : body;
  const title = isHtml ? extractTitle(body) : undefined;
  const description =
    (isHtml &&
      (extractMetaContent(body, "description") ||
        extractMetaContent(body, "og:description") ||
        extractMetaContent(body, "twitter:description"))) ||
    undefined;
  const headings = isHtml ? extractHeadings(body) : [];
  const links = isHtml ? extractLinks(body, new URL(finalUrl)) : [];
  const jsonLd = isHtml ? extractJsonLd(body) : [];

  let colorSource = body;
  const stylesheetUrls: string[] = [];
  if (isHtml) {
    for (const href of collectStylesheetHrefs(body, new URL(finalUrl))) {
      try {
        const sheet = await httpGet(new URL(href));
        if (sheet.status >= 200 && sheet.status < 400) {
          stylesheetUrls.push(href);
          colorSource += "\n" + sheet.body;
        }
      } catch {
        // ignore stylesheet fetch errors
      }
    }
  }

  const colors = extractColorsFromText(colorSource);
  const spa = isHtml && looksLikeSpaShell(text, body);

  return JSON.stringify({
    ok: true,
    url: finalUrl,
    status,
    contentType,
    title,
    description,
    headings,
    colors,
    links,
    jsonLd: jsonLd.length ? jsonLd : undefined,
    stylesheetsFetched: stylesheetUrls,
    spaShell: spa || undefined,
    note: spa
      ? "Page looks like a JS SPA shell: body text may be sparse. Still answer from whatever title/description/headings/colors/jsonLd/content you have. Do NOT invent login/authorization walls. Say what is missing honestly. For Harbor Agents branding use package.json / media via read_file."
      : "Use title, description, headings, content, colors, links, and jsonLd to answer ANY user question about this URL. Do not claim you cannot open or load external URLs.",
    content: truncate(isCss || isJson ? body : text, 60_000),
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
