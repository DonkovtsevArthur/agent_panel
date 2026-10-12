/**
 * Built-in Confluence (Server / Data Center) tools — same model as the
 * built-in Jira (`jiraNative.ts`): REST from Node with a Bearer PAT, the
 * pre-flight CA / VPN pin, exposed to McpManager as an MCP-client-shaped
 * object. No Python / uv.
 *
 * Pages are read as Markdown (converted from Confluence storage XHTML) and
 * written from Markdown (or raw storage / wiki markup). vscode-free.
 */

import { JiraApiError, jiraRequest, type JiraConn } from "./jiraNative";

/** Pseudo-command marking a Confluence server handled in-process by Harbor. */
export const CONFLUENCE_NATIVE_COMMAND = "harbor-confluence";

type Obj = Record<string, unknown>;
type Query = Record<string, string | number | boolean | undefined>;

function obj(v: unknown): Obj {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

function requireStr(args: Obj, key: string): string {
  const v = String(args[key] ?? "").trim();
  if (!v) {
    throw new Error(`"${key}" is required`);
  }
  return v;
}

function listArg(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof v === "string") {
    return v.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

async function cfRequest(
  conn: JiraConn,
  method: string,
  apiPath: string,
  options: { query?: Query; body?: unknown } = {}
): Promise<unknown> {
  try {
    return await jiraRequest(conn, method, apiPath, options);
  } catch (error) {
    if (error instanceof JiraApiError) {
      throw new JiraApiError(error.message.replace(/^Jira HTTP/, "Confluence HTTP"), error.status);
    }
    throw error;
  }
}

function webUrl(conn: JiraConn, content: Obj): string | undefined {
  const base = conn.baseUrl.replace(/\/+$/, "");
  const links = obj(content._links);
  const web = str(links.webui) || str(links.tinyui);
  if (web) {
    return `${base}${web}`;
  }
  return content.id ? `${base}/pages/viewpage.action?pageId=${content.id}` : undefined;
}

function userName(v: unknown): string | null {
  const u = obj(v);
  const display = str(u.displayName);
  const name = str(u.username) || str(u.userKey);
  return display && name ? `${display} (${name})` : display || name || null;
}

// —— storage XHTML ⇄ Markdown ——

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  laquo: "«",
  raquo: "»",
  hellip: "…",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
  return m ? decodeEntities(m[1]) : undefined;
}

/**
 * Confluence storage format → readable Markdown: headings, paragraphs,
 * lists, tables, code / panel macros, links (incl. page / user links),
 * images and Jira issue macros. Unknown macros keep their body text.
 */
export function storageToMarkdown(xhtml: string): string {
  let s = String(xhtml || "");
  // Code macro → fenced block (protect content from later tag stripping).
  const codeBlocks: string[] = [];
  s = s.replace(
    /<ac:structured-macro[^>]*ac:name="(?:code|noformat)"[^>]*>([\s\S]*?)<\/ac:structured-macro>/gi,
    (_all, inner: string) => {
      const lang = /<ac:parameter[^>]*ac:name="language"[^>]*>([^<]*)<\/ac:parameter>/i.exec(inner)?.[1] || "";
      const body = /<ac:plain-text-body>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/ac:plain-text-body>/i.exec(inner)?.[1] ?? "";
      codeBlocks.push(`\n\n\`\`\`${lang}\n${body.replace(/\n+$/, "")}\n\`\`\`\n\n`);
      return `\u0000CODE${codeBlocks.length - 1}\u0000`;
    }
  );
  // Jira issue macro.
  s = s.replace(
    /<ac:structured-macro[^>]*ac:name="jira"[^>]*>([\s\S]*?)<\/ac:structured-macro>/gi,
    (_all, inner: string) => {
      const key = /<ac:parameter[^>]*ac:name="key"[^>]*>([^<]*)<\/ac:parameter>/i.exec(inner)?.[1];
      return key ? `[Jira ${key}]` : "[Jira issues]";
    }
  );
  // Info / note / warning / tip / expand panels → blockquote with title.
  s = s.replace(
    /<ac:structured-macro[^>]*ac:name="(info|note|warning|tip|panel|expand)"[^>]*>([\s\S]*?)<\/ac:structured-macro>/gi,
    (_all, name: string, inner: string) => {
      const title = /<ac:parameter[^>]*ac:name="title"[^>]*>([^<]*)<\/ac:parameter>/i.exec(inner)?.[1];
      const body = /<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>/i.exec(inner)?.[1] ?? "";
      const md = storageToMarkdown(body)
        .split("\n")
        .map((l) => `> ${l}`.trimEnd())
        .join("\n");
      return `\n\n> **${name.toUpperCase()}${title ? `: ${decodeEntities(title)}` : ""}**\n${md}\n\n`;
    }
  );
  // Remaining macros: keep body text, drop parameters.
  s = s.replace(/<ac:parameter[\s\S]*?<\/ac:parameter>/gi, "");
  s = s.replace(/<ac:structured-macro[^>]*ac:name="toc"[^>]*\/?>(?:[\s\S]*?<\/ac:structured-macro>)?/gi, "");
  // Links to pages / users / attachments.
  s = s.replace(/<ac:link[^>]*>([\s\S]*?)<\/ac:link>/gi, (_all, inner: string) => {
    const page = /<ri:page[^>]*>/i.exec(inner)?.[0];
    const userTag = /<ri:user[^>]*>/i.exec(inner)?.[0];
    const attachment = /<ri:attachment[^>]*>/i.exec(inner)?.[0];
    const text = /<ac:(?:plain-text-)?link-body>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/ac:(?:plain-text-)?link-body>/i
      .exec(inner)?.[1]
      ?.replace(/<[^>]+>/g, "");
    if (page) {
      const title = attr(page, "ri:content-title") || "page";
      const space = attr(page, "ri:space-key");
      return `[[${space ? `${space}:` : ""}${title}${text && text !== title ? `|${text}` : ""}]]`;
    }
    if (userTag) {
      return `@${attr(userTag, "ri:username") || attr(userTag, "ri:userkey") || "user"}`;
    }
    if (attachment) {
      return `[attachment: ${attr(attachment, "ri:filename") || "file"}]`;
    }
    return text || "";
  });
  s = s.replace(/<ac:image[^>]*>([\s\S]*?)<\/ac:image>/gi, (_all, inner: string) => {
    const file = /<ri:attachment[^>]*>/i.exec(inner)?.[0];
    const url = /<ri:url[^>]*>/i.exec(inner)?.[0];
    return `![image](${(file && attr(file, "ri:filename")) || (url && attr(url, "ri:value")) || ""})`;
  });
  s = s.replace(/<ac:task-list>|<\/ac:task-list>/gi, "\n");
  s = s.replace(/<ac:task>([\s\S]*?)<\/ac:task>/gi, (_all, inner: string) => {
    const done = /<ac:task-status>complete<\/ac:task-status>/i.test(inner);
    const body = /<ac:task-body>([\s\S]*?)<\/ac:task-body>/i.exec(inner)?.[1] ?? "";
    return `\n- [${done ? "x" : " "}] ${body.replace(/<[^>]+>/g, "").trim()}`;
  });
  s = s.replace(/<\/?ac:[^>]*>|<\/?ri:[^>]*>/gi, "");

  // Tables → Markdown tables.
  s = s.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_all, inner: string) => {
    const rows = [...inner.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
      [...r[1].matchAll(/<t([hd])[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
        decodeEntities(
          c[2]
            .replace(/<br\s*\/?>/gi, " ")
            .replace(/<\/p>\s*<p[^>]*>/gi, " ")
            .replace(/<[^>]+>/g, "")
        )
          .replace(/\|/g, "\\|")
          .replace(/\s+/g, " ")
          .trim()
      )
    );
    if (!rows.length) {
      return "";
    }
    const width = Math.max(...rows.map((r) => r.length));
    const line = (r: string[]) => `| ${[...r, ...Array(width - r.length).fill("")].join(" | ")} |`;
    return `\n\n${line(rows[0])}\n| ${Array(width).fill("---").join(" | ")} |\n${rows.slice(1).map(line).join("\n")}\n\n`;
  });

  // Block / inline HTML.
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_a, n: string, t: string) => `\n\n${"#".repeat(Number(n))} ${t.trim()}\n\n`);
  s = s.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, "**$2**");
  s = s.replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, "*$2*");
  s = s.replace(/<(s|del|strike)>([\s\S]*?)<\/\1>/gi, "~~$2~~");
  s = s.replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`");
  s = s.replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_a, href: string, t: string) => `[${t.replace(/<[^>]+>/g, "")}](${decodeEntities(href)})`);
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_a, t: string) => `\n\n\`\`\`\n${t.replace(/<[^>]+>/g, "")}\n\`\`\`\n\n`);
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_a, t: string) =>
    `\n\n${storageToMarkdown(t)
      .split("\n")
      .map((l) => `> ${l}`.trimEnd())
      .join("\n")}\n\n`
  );
  // Lists (nested: indent by depth).
  let depth = 0;
  const stack: string[] = [];
  s = s.replace(/<(\/?)(ul|ol|li)[^>]*>/gi, (_a, close: string, tag: string) => {
    const t = tag.toLowerCase();
    if (t === "ul" || t === "ol") {
      if (close) {
        stack.pop();
        depth = Math.max(0, depth - 1);
        return depth ? "" : "\n";
      }
      stack.push(t);
      depth++;
      return "";
    }
    if (close) {
      return "";
    }
    const marker = stack[stack.length - 1] === "ol" ? "1." : "-";
    return `\n${"  ".repeat(Math.max(0, depth - 1))}${marker} `;
  });
  s = s.replace(/<hr\s*\/?>/gi, "\n\n---\n\n");
  s = s.replace(/<br\s*\/?>/gi, "  \n");
  s = s.replace(/<\/p>|<p[^>]*>|<\/div>|<div[^>]*>/gi, "\n\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  s = s.replace(/\u0000CODE(\d+)\u0000/g, (_a, i: string) => codeBlocks[Number(i)]);
  return s
    .replace(/[ \t]+\n/g, (m) => (m.startsWith("  ") ? "  \n" : "\n"))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inlineMarkdown(text: string): string {
  const codes: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_a, c: string) => {
    codes.push(`<code>${escapeHtml(c)}</code>`);
    return `\u0000C${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_a, _alt: string, src: string) =>
    /^https?:/i.test(src)
      ? `<ac:image><ri:url ri:value="${src}" /></ac:image>`
      : `<ac:image><ri:attachment ri:filename="${src}" /></ac:image>`
  );
  s = s.replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_a, target: string, label?: string) => {
    const [space, title] = target.includes(":") ? target.split(/:(.+)/) : ["", target];
    return `<ac:link><ri:page ri:content-title="${title.trim()}"${space ? ` ri:space-key="${space.trim()}"` : ""} />${
      label ? `<ac:plain-text-link-body><![CDATA[${label}]]></ac:plain-text-link-body>` : ""
    }</ac:link>`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_a, a?: string, b?: string) => `<strong>${a ?? b}</strong>`);
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return s.replace(/\u0000C(\d+)\u0000/g, (_a, i: string) => codes[Number(i)]);
}

/**
 * Markdown → Confluence storage XHTML: headings, paragraphs, nested lists,
 * task lists, fenced code (code macro), tables, blockquotes, hr, links,
 * [[Space:Page]] links, images. Good enough for agent-written pages.
 */
export function markdownToStorage(md: string): string {
  const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const listStack: Array<{ type: "ul" | "ol"; indent: number }> = [];
  const closeLists = (toIndent = -1) => {
    while (listStack.length && listStack[listStack.length - 1].indent > toIndent) {
      out.push(`</li></${listStack.pop()!.type}>`);
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      closeLists();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++;
      out.push(
        `<ac:structured-macro ac:name="code">${
          fence[1] ? `<ac:parameter ac:name="language">${fence[1]}</ac:parameter>` : ""
        }<ac:plain-text-body><![CDATA[${body.join("\n").replace(/\]\]>/g, "]]]]><![CDATA[>")}]]></ac:plain-text-body></ac:structured-macro>`
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeLists();
      out.push(`<h${heading[1].length}>${inlineMarkdown(heading[2].trim())}</h${heading[1].length}>`);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      closeLists();
      out.push("<hr />");
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      closeLists();
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) {
          rows.push(cells);
        }
        i++;
      }
      out.push(
        `<table><tbody>${rows
          .map(
            (r, ri) =>
              `<tr>${r.map((c) => (ri === 0 ? `<th>${inlineMarkdown(c)}</th>` : `<td>${inlineMarkdown(c)}</td>`)).join("")}</tr>`
          )
          .join("")}</tbody></table>`
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      closeLists();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${markdownToStorage(quote.join("\n"))}</blockquote>`);
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      const indent = item[1].replace(/\t/g, "  ").length;
      const type: "ul" | "ol" = /\d/.test(item[2]) ? "ol" : "ul";
      const task = /^\[([ xX])\]\s+(.*)$/.exec(item[3]);
      if (task && !listStack.length) {
        const tasks: string[] = [];
        while (i < lines.length) {
          const t = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(lines[i]);
          if (!t) {
            break;
          }
          tasks.push(
            `<ac:task><ac:task-status>${t[1].trim() ? "complete" : "incomplete"}</ac:task-status><ac:task-body>${inlineMarkdown(t[2])}</ac:task-body></ac:task>`
          );
          i++;
        }
        out.push(`<ac:task-list>${tasks.join("")}</ac:task-list>`);
        continue;
      }
      const top = listStack[listStack.length - 1];
      if (!top || indent > top.indent) {
        listStack.push({ type, indent });
        out.push(`<${type}><li>`);
      } else {
        closeLists(indent);
        const cur = listStack[listStack.length - 1];
        if (cur && cur.indent === indent && cur.type === type) {
          out.push("</li><li>");
        } else {
          if (cur && cur.indent === indent) {
            out.push(`</li></${listStack.pop()!.type}>`);
          }
          listStack.push({ type, indent });
          out.push(`<${type}><li>`);
        }
      }
      out.push(inlineMarkdown(item[3]));
      i++;
      continue;
    }
    if (!line.trim()) {
      closeLists();
      i++;
      continue;
    }
    closeLists();
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|\s*```|\s*>|\s*\||\s*([-*+]|\d+[.)])\s+|\s*(-{3,}|\*{3,})\s*$)/.test(lines[i])
    ) {
      para.push(inlineMarkdown(lines[i].replace(/\s{2,}$/, "")));
      i++;
    }
    out.push(`<p>${para.join("<br />")}</p>`);
  }
  closeLists();
  return out.join("");
}

/** Body input → storage XHTML. */
async function toStorage(conn: JiraConn, body: string, format: unknown): Promise<string> {
  const f = String(format || "markdown").toLowerCase();
  if (f === "storage" || f === "xhtml" || f === "html") {
    return body;
  }
  if (f === "wiki") {
    const r = obj(
      await cfRequest(conn, "POST", "/rest/api/contentbody/convert/storage", {
        body: { value: body, representation: "wiki" },
      })
    );
    return String(r.value ?? "");
  }
  return markdownToStorage(body);
}

const FORMAT_PARAM = {
  type: "string",
  description: "Body format: markdown (default), storage (Confluence XHTML) or wiki (Confluence wiki markup)",
  enum: ["markdown", "storage", "wiki"],
};

// —— shaping ——

function briefContent(conn: JiraConn, c: unknown): Obj {
  const x = obj(c);
  const version = obj(x.version);
  return {
    id: x.id,
    type: x.type,
    title: x.title,
    space: str(obj(x.space).key),
    updated: version.when,
    updated_by: userName(version.by),
    url: webUrl(conn, x),
  };
}

async function findPageId(conn: JiraConn, a: Obj): Promise<string> {
  const id = String(a.page_id ?? "").trim();
  if (id) {
    return id;
  }
  const title = String(a.title ?? "").trim();
  const space = String(a.space_key ?? "").trim();
  if (!title || !space) {
    throw new Error('Pass "page_id", or "space_key" + "title".');
  }
  const r = obj(
    await cfRequest(conn, "GET", "/rest/api/content", {
      query: { spaceKey: space, title, type: "page", limit: 1 },
    })
  );
  const hit = obj(arr(r.results)[0]);
  if (!hit.id) {
    throw new Error(`Page "${title}" not found in space ${space}.`);
  }
  return String(hit.id);
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Obj;
  run: (conn: JiraConn, args: Obj) => Promise<unknown>;
}

const S = (type: string, description: string, extra: Obj = {}): Obj => ({ type, description, ...extra });
const schema = (properties: Obj, required: string[] = []): Obj => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
});

const PAGE_REF = {
  page_id: S("string", "Page id"),
  space_key: S("string", "Space key (with title, instead of page_id)"),
  title: S("string", "Exact page title (with space_key, instead of page_id)"),
};

export const CONFLUENCE_NATIVE_TOOLS: ToolDef[] = [
  // ——— read ———
  {
    name: "confluence_search",
    description:
      "Search pages / blog posts. Either free text (query) or CQL (e.g. 'space = DEV AND type = page AND text ~ \"deploy\" ORDER BY lastmodified DESC'). Returns id, title, space, last update, URL.",
    inputSchema: schema({
      query: S("string", "Free text to search for"),
      cql: S("string", "Full CQL (overrides query / space_key / type)"),
      space_key: S("string", "Limit to a space"),
      type: S("string", "page (default), blogpost, attachment or comment"),
      limit: S("number", "Max results (1-50, default 20)"),
      start: S("number", "Offset for paging"),
    }),
    run: async (conn, a) => {
      let cql = str(a.cql);
      if (!cql) {
        const parts: string[] = [];
        const q = String(a.query || "").trim();
        if (q) {
          parts.push(`text ~ "${q.replace(/"/g, '\\"')}"`);
        }
        parts.push(`type = ${str(a.type) || "page"}`);
        if (a.space_key) {
          parts.push(`space = "${String(a.space_key).replace(/"/g, '\\"')}"`);
        }
        cql = `${parts.join(" AND ")} ORDER BY lastmodified DESC`;
      }
      const r = obj(
        await cfRequest(conn, "GET", "/rest/api/content/search", {
          query: {
            cql,
            limit: clampInt(a.limit, 20, 1, 50),
            start: clampInt(a.start, 0, 0, 100000),
            expand: "space,version",
          },
        })
      );
      const results = arr(r.results).map((c) => briefContent(conn, c));
      return { cql, total: r.totalSize ?? r.size, returned: results.length, results };
    },
  },
  {
    name: "confluence_get_page",
    description:
      "Read a page (by page_id or space_key + title): title, space, version, breadcrumb, labels and the body as Markdown (or raw storage XHTML).",
    inputSchema: schema({
      ...PAGE_REF,
      format: S("string", "markdown (default) or storage", { enum: ["markdown", "storage"] }),
    }),
    run: async (conn, a) => {
      const id = await findPageId(conn, a);
      const c = obj(
        await cfRequest(conn, "GET", `/rest/api/content/${encodeURIComponent(id)}`, {
          query: { expand: "body.storage,version,space,ancestors,metadata.labels" },
        })
      );
      const storage = String(obj(obj(c.body).storage).value ?? "");
      const version = obj(c.version);
      return {
        id: c.id,
        title: c.title,
        space: str(obj(c.space).key),
        version: version.number,
        updated: version.when,
        updated_by: userName(version.by),
        url: webUrl(conn, c),
        breadcrumb: arr(c.ancestors).map((x) => obj(x).title),
        parent_id: obj(arr(c.ancestors).slice(-1)[0]).id ?? null,
        labels: arr(obj(obj(c.metadata).labels).results).map((l) => obj(l).name),
        body: String(a.format) === "storage" ? storage : storageToMarkdown(storage),
      };
    },
  },
  {
    name: "confluence_get_page_children",
    description: "Child pages of a page (id, title, URL).",
    inputSchema: schema({ ...PAGE_REF, limit: S("number", "Max (1-100, default 50)") }),
    run: async (conn, a) => {
      const id = await findPageId(conn, a);
      const r = obj(
        await cfRequest(conn, "GET", `/rest/api/content/${encodeURIComponent(id)}/child/page`, {
          query: { limit: clampInt(a.limit, 50, 1, 100), expand: "version,space" },
        })
      );
      return arr(r.results).map((c) => briefContent(conn, c));
    },
  },
  {
    name: "confluence_get_comments",
    description: "Comments on a page (author, date, text as Markdown).",
    inputSchema: schema({ ...PAGE_REF, limit: S("number", "Max (1-100, default 30)") }),
    run: async (conn, a) => {
      const id = await findPageId(conn, a);
      const r = obj(
        await cfRequest(conn, "GET", `/rest/api/content/${encodeURIComponent(id)}/child/comment`, {
          query: { limit: clampInt(a.limit, 30, 1, 100), expand: "body.storage,version", depth: "all" },
        })
      );
      return arr(r.results).map((x) => {
        const c = obj(x);
        const v = obj(c.version);
        return {
          id: c.id,
          author: userName(v.by),
          created: v.when,
          body: storageToMarkdown(String(obj(obj(c.body).storage).value ?? "")),
        };
      });
    },
  },
  {
    name: "confluence_get_attachments",
    description: "Attachments of a page (file name, size, type, download URL).",
    inputSchema: schema({ ...PAGE_REF }),
    run: async (conn, a) => {
      const id = await findPageId(conn, a);
      const r = obj(
        await cfRequest(conn, "GET", `/rest/api/content/${encodeURIComponent(id)}/child/attachment`, {
          query: { limit: 100, expand: "version" },
        })
      );
      const base = conn.baseUrl.replace(/\/+$/, "");
      return arr(r.results).map((x) => {
        const c = obj(x);
        const ext = obj(c.extensions);
        return {
          id: c.id,
          title: c.title,
          size: ext.fileSize,
          media_type: ext.mediaType,
          download: str(obj(c._links).download) ? `${base}${obj(c._links).download}` : undefined,
        };
      });
    },
  },
  {
    name: "confluence_get_spaces",
    description: "Spaces visible to the user (key, name, type). Optional text filter.",
    inputSchema: schema({
      query: S("string", "Filter by part of key or name"),
      type: S("string", "global or personal"),
      limit: S("number", "Max (1-500, default 200)"),
    }),
    run: async (conn, a) => {
      const r = obj(
        await cfRequest(conn, "GET", "/rest/api/space", {
          query: { limit: clampInt(a.limit, 200, 1, 500), type: str(a.type) },
        })
      );
      const q = String(a.query || "").toLowerCase();
      const spaces = arr(r.results)
        .map(obj)
        .map((sp) => ({ key: sp.key, name: sp.name, type: sp.type }))
        .filter((sp) => !q || `${sp.key} ${sp.name}`.toLowerCase().includes(q));
      return { total: spaces.length, spaces };
    },
  },
  {
    name: "confluence_get_space",
    description: "Space details: name, description, home page.",
    inputSchema: schema({ space_key: S("string", "Space key") }, ["space_key"]),
    run: async (conn, a) => {
      const sp = obj(
        await cfRequest(conn, "GET", `/rest/api/space/${encodeURIComponent(requireStr(a, "space_key"))}`, {
          query: { expand: "description.plain,homepage" },
        })
      );
      const home = obj(sp.homepage);
      return {
        key: sp.key,
        name: sp.name,
        type: sp.type,
        description: obj(obj(sp.description).plain).value ?? "",
        home_page: home.id ? { id: home.id, title: home.title } : null,
      };
    },
  },
  {
    name: "confluence_get_myself",
    description: "The connected Confluence user.",
    inputSchema: schema({}),
    run: async (conn) => {
      const me = obj(await cfRequest(conn, "GET", "/rest/api/user/current"));
      return { username: me.username, display_name: me.displayName, user_key: me.userKey };
    },
  },
  // ——— write ———
  {
    name: "confluence_create_page",
    description:
      "Create a page in a space, optionally under a parent page. Body in Markdown by default (tables, code blocks, task lists, [[Space:Page]] links supported).",
    inputSchema: schema(
      {
        space_key: S("string", "Space key"),
        title: S("string", "Page title"),
        body: S("string", "Page content"),
        format: FORMAT_PARAM,
        parent_id: S("string", "Parent page id (optional)"),
      },
      ["space_key", "title", "body"]
    ),
    run: async (conn, a) => {
      const value = await toStorage(conn, String(a.body ?? ""), a.format);
      const c = obj(
        await cfRequest(conn, "POST", "/rest/api/content", {
          body: {
            type: "page",
            title: requireStr(a, "title"),
            space: { key: requireStr(a, "space_key") },
            ...(a.parent_id ? { ancestors: [{ id: String(a.parent_id) }] } : {}),
            body: { storage: { value, representation: "storage" } },
          },
        })
      );
      return { ok: true, id: c.id, title: c.title, url: webUrl(conn, c) };
    },
  },
  {
    name: "confluence_update_page",
    description:
      "Update a page: new title and/or body. mode = replace (default), append or prepend (adds to the current content). Bumps the version automatically.",
    inputSchema: schema({
      ...PAGE_REF,
      new_title: S("string", "New title"),
      body: S("string", "Content"),
      format: FORMAT_PARAM,
      mode: S("string", "replace (default), append or prepend", { enum: ["replace", "append", "prepend"] }),
      version_comment: S("string", "Change note shown in page history"),
    }),
    run: async (conn, a) => {
      const id = await findPageId(conn, a);
      const cur = obj(
        await cfRequest(conn, "GET", `/rest/api/content/${encodeURIComponent(id)}`, {
          query: { expand: "body.storage,version,space" },
        })
      );
      if (a.body === undefined && !a.new_title) {
        throw new Error('Nothing to update — pass "body" and/or "new_title".');
      }
      const current = String(obj(obj(cur.body).storage).value ?? "");
      let value = current;
      if (a.body !== undefined) {
        const next = await toStorage(conn, String(a.body), a.format);
        const mode = String(a.mode || "replace");
        value = mode === "append" ? current + next : mode === "prepend" ? next + current : next;
      }
      const c = obj(
        await cfRequest(conn, "PUT", `/rest/api/content/${encodeURIComponent(id)}`, {
          body: {
            id,
            type: cur.type || "page",
            title: str(a.new_title) || cur.title,
            space: { key: obj(cur.space).key },
            version: {
              number: Number(obj(cur.version).number || 0) + 1,
              ...(a.version_comment ? { message: String(a.version_comment) } : {}),
            },
            body: { storage: { value, representation: "storage" } },
          },
        })
      );
      return { ok: true, id: c.id, title: c.title, version: obj(c.version).number, url: webUrl(conn, c) };
    },
  },
  {
    name: "confluence_add_comment",
    description: "Add a comment to a page (Markdown by default).",
    inputSchema: schema({ ...PAGE_REF, body: S("string", "Comment text"), format: FORMAT_PARAM }, ["body"]),
    run: async (conn, a) => {
      const id = await findPageId(conn, a);
      const value = await toStorage(conn, requireStr(a, "body"), a.format);
      const c = obj(
        await cfRequest(conn, "POST", "/rest/api/content", {
          body: {
            type: "comment",
            container: { id, type: "page" },
            body: { storage: { value, representation: "storage" } },
          },
        })
      );
      return { ok: true, comment_id: c.id, page_id: id };
    },
  },
  {
    name: "confluence_add_labels",
    description: "Add labels to a page.",
    inputSchema: schema(
      { ...PAGE_REF, labels: S("array", "Labels", { items: { type: "string" } }) },
      ["labels"]
    ),
    run: async (conn, a) => {
      const id = await findPageId(conn, a);
      const labels = listArg(a.labels);
      if (!labels.length) {
        throw new Error('"labels" is required');
      }
      await cfRequest(conn, "POST", `/rest/api/content/${encodeURIComponent(id)}/label`, {
        body: labels.map((name) => ({ prefix: "global", name })),
      });
      return { ok: true, page_id: id, added: labels };
    },
  },
  {
    name: "confluence_remove_label",
    description: "Remove a label from a page.",
    inputSchema: schema({ ...PAGE_REF, label: S("string", "Label") }, ["label"]),
    run: async (conn, a) => {
      const id = await findPageId(conn, a);
      const label = requireStr(a, "label");
      await cfRequest(conn, "DELETE", `/rest/api/content/${encodeURIComponent(id)}/label`, {
        query: { name: label },
      });
      return { ok: true, page_id: id, removed: label };
    },
  },
];

/** Tool names that change Confluence (hidden in Plan / Ask). */
export const CONFLUENCE_NATIVE_WRITE_TOOLS = new Set([
  "confluence_create_page",
  "confluence_update_page",
  "confluence_add_comment",
  "confluence_add_labels",
  "confluence_remove_label",
]);

/** MCP-client-shaped wrapper used by McpManager (no child process). */
export function createConfluenceNativeClient(conn: JiraConn): {
  listTools(): Promise<{ tools: Array<{ name: string; description: string; inputSchema: Obj }> }>;
  callTool(req: { name: string; arguments?: Record<string, unknown> }): Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  }>;
  close(): Promise<void>;
} {
  const byName = new Map(CONFLUENCE_NATIVE_TOOLS.map((t) => [t.name, t]));
  return {
    async listTools() {
      return {
        tools: CONFLUENCE_NATIVE_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };
    },
    async callTool(req) {
      const tool = byName.get(req.name);
      if (!tool) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Unknown Confluence tool: ${req.name}` }) }],
          isError: true,
        };
      }
      try {
        const result = await tool.run(conn, obj(req.arguments));
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
      }
    },
    async close() {
      // stateless HTTP
    },
  };
}
