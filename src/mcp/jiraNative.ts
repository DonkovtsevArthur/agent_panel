/**
 * Built-in Jira (Server / Data Center) tools: Harbor talks to the REST API
 * directly from Node — no Python, uv or PyPI download. Exposed through the
 * MCP manager as a client-like object (listTools / callTool / close), so
 * tool listing, approvals, Plan/Ask read-only filtering, large-result spill
 * and the Settings card work exactly like for a real MCP server.
 *
 * Corporate CA and VPN-only DNS come from `prepareJiraConnection`
 * (`ca` + `pinIp`), applied per request. vscode-free.
 */

import * as https from "https";
import { pinnedLookup } from "./jiraConnect";

/** Pseudo-command marking a Jira server handled in-process by Harbor. */
export const JIRA_NATIVE_COMMAND = "harbor-jira";

export interface JiraConn {
  baseUrl: string;
  token: string;
  ca: string | string[];
  pinIp?: string;
}

const REQUEST_TIMEOUT_MS = 30_000;

class JiraApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined>;

function jiraRequest(
  conn: JiraConn,
  method: string,
  apiPath: string,
  options: { query?: Query; body?: unknown } = {}
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${conn.baseUrl.replace(/\/+$/, "")}${apiPath}`);
    for (const [k, v] of Object.entries(options.query || {})) {
      if (v !== undefined && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
    const payload =
      options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body), "utf8");
    const req = https.request(
      url,
      {
        method,
        agent: false,
        ca: conn.ca,
        lookup: conn.pinIp ? pinnedLookup(conn.pinIp) : undefined,
        servername: url.hostname,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${conn.token}`,
          Accept: "application/json",
          ...(payload
            ? { "Content-Type": "application/json", "Content-Length": String(payload.length) }
            : {}),
          // Jira DC rejects state-changing calls without it when XSRF checks are on.
          "X-Atlassian-Token": "no-check",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const status = res.statusCode || 0;
          const text = Buffer.concat(chunks).toString("utf8");
          let data: unknown = undefined;
          if (text.trim()) {
            try {
              data = JSON.parse(text);
            } catch {
              data = text;
            }
          }
          if (status >= 200 && status < 300) {
            resolve(data);
            return;
          }
          reject(new JiraApiError(describeApiError(status, data), status));
        });
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("Jira request timed out")));
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function describeApiError(status: number, data: unknown): string {
  const parts: string[] = [];
  if (data && typeof data === "object") {
    const d = data as { errorMessages?: unknown; errors?: unknown; message?: unknown };
    if (Array.isArray(d.errorMessages)) {
      parts.push(...d.errorMessages.map(String));
    }
    if (d.errors && typeof d.errors === "object") {
      for (const [k, v] of Object.entries(d.errors as Record<string, unknown>)) {
        parts.push(`${k}: ${String(v)}`);
      }
    }
    if (typeof d.message === "string") {
      parts.push(d.message);
    }
  } else if (typeof data === "string" && data.trim()) {
    parts.push(data.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300));
  }
  const hint =
    status === 401
      ? " (token rejected or expired)"
      : status === 403
        ? " (no permission)"
        : status === 404
          ? " (not found or no access)"
          : "";
  return `Jira HTTP ${status}${hint}${parts.length ? `: ${parts.join("; ")}` : ""}`;
}

// —— shaping ——

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function user(v: unknown): string | null {
  const u = obj(v);
  if (!Object.keys(u).length) {
    return null;
  }
  const display = str(u.displayName);
  const name = str(u.name) || str(u.key);
  return display && name ? `${display} (${name})` : display || name || null;
}

function named(v: unknown): string | undefined {
  return str(obj(v).name) || str(obj(v).value);
}

function issueUrl(conn: JiraConn, key: string): string {
  return `${conn.baseUrl.replace(/\/+$/, "")}/browse/${key}`;
}

const BRIEF_FIELDS = ["summary", "status", "issuetype", "priority", "assignee", "updated"];

function briefIssue(issue: unknown, extraFields: string[] = []): Obj {
  const i = obj(issue);
  const f = obj(i.fields);
  const out: Obj = {
    key: i.key,
    summary: f.summary,
    status: named(f.status),
    type: named(f.issuetype),
    priority: named(f.priority),
    assignee: user(f.assignee),
    updated: f.updated,
  };
  for (const name of extraFields) {
    if (!BRIEF_FIELDS.includes(name) && name in f) {
      out[name] = simplifyFieldValue(f[name]);
    }
  }
  return out;
}

/** Collapse Jira field objects to readable values (names, keys, lists). */
function simplifyFieldValue(v: unknown): unknown {
  if (v === null || v === undefined || typeof v !== "object") {
    return v;
  }
  if (Array.isArray(v)) {
    return v.map(simplifyFieldValue);
  }
  const o = v as Obj;
  if ("displayName" in o) {
    return user(o);
  }
  if ("key" in o && "fields" in o) {
    return { key: o.key, summary: obj(o.fields).summary };
  }
  return str(o.name) ?? str(o.value) ?? str(o.key) ?? o;
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

/** Jira worklog "started": yyyy-MM-dd'T'HH:mm:ss.SSSZ in local offset. */
function jiraDateTime(input: unknown): string | undefined {
  if (!input) {
    return undefined;
  }
  const d = new Date(String(input));
  if (Number.isNaN(d.getTime())) {
    throw new Error(`invalid date: ${String(input)}`);
  }
  const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0");
  const off = -d.getTimezoneOffset();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${off >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(off) / 60))}${pad(Math.abs(off) % 60)}`
  );
}

// —— per-connection caches ——

interface Caches {
  fields?: Promise<Obj[]>;
  myself?: Promise<Obj>;
}

async function allFields(conn: JiraConn, cache: Caches): Promise<Obj[]> {
  cache.fields ??= jiraRequest(conn, "GET", "/rest/api/2/field").then((r) => arr(r).map(obj));
  return cache.fields;
}

async function epicLinkFieldId(conn: JiraConn, cache: Caches): Promise<string | undefined> {
  const fields = await allFields(conn, cache);
  const hit =
    fields.find((f) => str(obj(f.schema).custom) === "com.pyxis.greenhopper.jira:gh-epic-link") ||
    fields.find((f) => String(f.name || "").toLowerCase() === "epic link");
  return str(hit?.id);
}

async function myself(conn: JiraConn, cache: Caches): Promise<Obj> {
  cache.myself ??= jiraRequest(conn, "GET", "/rest/api/2/myself").then(obj);
  return cache.myself;
}

async function resolveUserName(conn: JiraConn, cache: Caches, v: unknown): Promise<string | null> {
  const s = String(v ?? "").trim();
  if (!s || s.toLowerCase() === "none" || s.toLowerCase() === "unassigned") {
    return null;
  }
  if (s.toLowerCase() === "me" || s === "currentUser()") {
    return str((await myself(conn, cache)).name) || null;
  }
  return s;
}

/** Shared create/update field builder. */
async function buildIssueFields(conn: JiraConn, cache: Caches, args: Obj): Promise<Obj> {
  const fields: Obj = {};
  if (args.summary !== undefined) fields.summary = String(args.summary);
  if (args.description !== undefined) fields.description = String(args.description);
  if (args.priority) fields.priority = { name: String(args.priority) };
  if (args.labels !== undefined) fields.labels = listArg(args.labels);
  if (args.components !== undefined) {
    fields.components = listArg(args.components).map((name) => ({ name }));
  }
  if (args.fix_versions !== undefined) {
    fields.fixVersions = listArg(args.fix_versions).map((name) => ({ name }));
  }
  if (args.due_date !== undefined) fields.duedate = args.due_date ? String(args.due_date) : null;
  if (args.assignee !== undefined) {
    const name = await resolveUserName(conn, cache, args.assignee);
    fields.assignee = name ? { name } : null;
  }
  if (args.epic_key) {
    const id = await epicLinkFieldId(conn, cache);
    if (!id) {
      throw new Error('This Jira has no "Epic Link" field; use parent_key or fields instead.');
    }
    fields[id] = String(args.epic_key);
  }
  Object.assign(fields, obj(args.fields));
  return fields;
}

// —— tools ——

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Obj;
  run: (conn: JiraConn, cache: Caches, args: Obj) => Promise<unknown>;
}

const S = (type: string, description: string, extra: Obj = {}): Obj => ({ type, description, ...extra });
const schema = (properties: Obj, required: string[] = []): Obj => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
});

const ISSUE_KEY = S("string", "Issue key, e.g. PROJ-123");

export const JIRA_NATIVE_TOOLS: ToolDef[] = [
  // ——— read ———
  {
    name: "jira_search",
    description:
      "Search issues with JQL (e.g. 'project = PROJ AND assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC'). Returns key, summary, status, type, priority, assignee, updated (+ requested extra fields). Page with start_at.",
    inputSchema: schema(
      {
        jql: S("string", "JQL query"),
        fields: S("string", "Extra comma-separated fields to include (e.g. 'labels,duedate,customfield_10002')"),
        limit: S("number", "Max issues (1-100, default 25)"),
        start_at: S("number", "Offset for paging (default 0)"),
      },
      ["jql"]
    ),
    run: async (conn, _c, a) => {
      const extra = listArg(a.fields);
      const r = obj(
        await jiraRequest(conn, "POST", "/rest/api/2/search", {
          body: {
            jql: requireStr(a, "jql"),
            startAt: clampInt(a.start_at, 0, 0, 1_000_000),
            maxResults: clampInt(a.limit, 25, 1, 100),
            fields: [...BRIEF_FIELDS, ...extra],
          },
        })
      );
      const issues = arr(r.issues).map((i) => briefIssue(i, extra));
      return { total: r.total, startAt: r.startAt, returned: issues.length, issues };
    },
  },
  {
    name: "jira_get_issue",
    description:
      "Full issue: summary, description, status, type, priority, people, dates, labels, components, versions, epic/parent, subtasks, links, attachments, latest comments; optional status history.",
    inputSchema: schema(
      {
        issue_key: ISSUE_KEY,
        comment_limit: S("number", "Latest comments to include (0-100, default 20)"),
        include_history: S("boolean", "Include status/assignee change history (default false)"),
        fields: S("string", "Extra comma-separated fields (e.g. custom fields) to include"),
      },
      ["issue_key"]
    ),
    run: async (conn, cache, a) => {
      const key = requireStr(a, "issue_key");
      const r = obj(
        await jiraRequest(conn, "GET", `/rest/api/2/issue/${encodeURIComponent(key)}`, {
          query: { expand: a.include_history ? "changelog,renderedFields" : undefined },
        })
      );
      const f = obj(r.fields);
      const epicId = await epicLinkFieldId(conn, cache).catch(() => undefined);
      const commentLimit = clampInt(a.comment_limit, 20, 0, 100);
      const comments = arr(obj(f.comment).comments);
      const out: Obj = {
        key: r.key,
        url: issueUrl(conn, String(r.key)),
        summary: f.summary,
        status: named(f.status),
        type: named(f.issuetype),
        priority: named(f.priority),
        resolution: named(f.resolution) || null,
        assignee: user(f.assignee),
        reporter: user(f.reporter),
        created: f.created,
        updated: f.updated,
        due: f.duedate || null,
        labels: f.labels,
        components: arr(f.components).map(named),
        fix_versions: arr(f.fixVersions).map(named),
        epic: epicId ? f[epicId] || null : undefined,
        parent: f.parent ? simplifyFieldValue(f.parent) : undefined,
        description: f.description || "",
        subtasks: arr(f.subtasks).map((s) => briefIssue(s)),
        links: arr(f.issuelinks).map((l) => {
          const link = obj(l);
          const type = obj(link.type);
          return link.outwardIssue
            ? { relation: type.outward, issue: briefIssue(link.outwardIssue) }
            : { relation: type.inward, issue: briefIssue(link.inwardIssue) };
        }),
        attachments: arr(f.attachment).map((x) => {
          const at = obj(x);
          return { filename: at.filename, size: at.size, created: at.created, url: at.content };
        }),
        comments_total: obj(f.comment).total ?? comments.length,
        comments: comments.slice(-commentLimit).map((x) => {
          const c = obj(x);
          return { id: c.id, author: user(c.author), created: c.created, body: c.body };
        }),
      };
      for (const name of listArg(a.fields)) {
        out[name] = simplifyFieldValue(f[name]);
      }
      if (a.include_history) {
        out.history = arr(obj(r.changelog).histories)
          .slice(-50)
          .map((h) => {
            const hh = obj(h);
            return {
              at: hh.created,
              by: user(hh.author),
              changes: arr(hh.items).map((it) => {
                const i = obj(it);
                return `${i.field}: ${i.fromString ?? ""} → ${i.toString ?? ""}`;
              }),
            };
          });
      }
      return out;
    },
  },
  {
    name: "jira_get_projects",
    description: "List projects visible to the user (key, name, type, category). Optional substring filter.",
    inputSchema: schema({ query: S("string", "Filter by key or name (case-insensitive)") }),
    run: async (conn, _c, a) => {
      const q = String(a.query || "").toLowerCase();
      const projects = arr(await jiraRequest(conn, "GET", "/rest/api/2/project"))
        .map(obj)
        .map((p) => ({
          key: p.key,
          name: p.name,
          type: p.projectTypeKey,
          category: named(p.projectCategory),
        }))
        .filter((p) => !q || `${p.key} ${p.name}`.toLowerCase().includes(q));
      return { total: projects.length, projects };
    },
  },
  {
    name: "jira_get_project",
    description: "Project details: lead, issue types, components and versions.",
    inputSchema: schema({ project_key: S("string", "Project key") }, ["project_key"]),
    run: async (conn, _c, a) => {
      const p = obj(
        await jiraRequest(conn, "GET", `/rest/api/2/project/${encodeURIComponent(requireStr(a, "project_key"))}`)
      );
      return {
        key: p.key,
        name: p.name,
        description: p.description || "",
        lead: user(p.lead),
        issue_types: arr(p.issueTypes).map((t) => ({ name: obj(t).name, subtask: obj(t).subtask })),
        components: arr(p.components).map(named),
        versions: arr(p.versions)
          .map(obj)
          .slice(-40)
          .map((v) => ({ name: v.name, released: v.released, releaseDate: v.releaseDate })),
      };
    },
  },
  {
    name: "jira_get_create_fields",
    description:
      "Fields for creating an issue: without issue_type lists the project's issue types; with issue_type lists its fields (required flag, allowed values).",
    inputSchema: schema(
      {
        project_key: S("string", "Project key"),
        issue_type: S("string", "Issue type name or id"),
      },
      ["project_key"]
    ),
    run: async (conn, _c, a) => {
      const project = encodeURIComponent(requireStr(a, "project_key"));
      const wanted = String(a.issue_type || "").trim().toLowerCase();
      const shapeField = (fid: string, fd: Obj) => ({
        id: fid,
        name: fd.name,
        required: fd.required,
        type: obj(fd.schema).type,
        allowed: arr(fd.allowedValues).slice(0, 50).map(named).filter(Boolean),
      });
      try {
        // Jira 8.4+ / 9.x
        const types = arr(obj(await jiraRequest(conn, "GET", `/rest/api/2/issue/createmeta/${project}/issuetypes`)).values).map(obj);
        if (!wanted) {
          return { issue_types: types.map((t) => ({ id: t.id, name: t.name, subtask: t.subtask })) };
        }
        const type = types.find((t) => String(t.id) === wanted || String(t.name).toLowerCase() === wanted);
        if (!type) {
          throw new Error(`Issue type "${a.issue_type}" not found. Available: ${types.map((t) => t.name).join(", ")}`);
        }
        const fields = arr(
          obj(await jiraRequest(conn, "GET", `/rest/api/2/issue/createmeta/${project}/issuetypes/${type.id}`, { query: { maxResults: 200 } })).values
        ).map(obj);
        return { issue_type: type.name, fields: fields.map((fd) => shapeField(String(fd.fieldId), fd)) };
      } catch (error) {
        if (!(error instanceof JiraApiError && error.status === 404)) {
          throw error;
        }
      }
      // Older Jira
      const meta = obj(
        await jiraRequest(conn, "GET", "/rest/api/2/issue/createmeta", {
          query: { projectKeys: decodeURIComponent(project), expand: "projects.issuetypes.fields" },
        })
      );
      const types = arr(obj(arr(meta.projects)[0]).issuetypes).map(obj);
      if (!wanted) {
        return { issue_types: types.map((t) => ({ id: t.id, name: t.name, subtask: t.subtask })) };
      }
      const type = types.find((t) => String(t.id) === wanted || String(t.name).toLowerCase() === wanted);
      if (!type) {
        throw new Error(`Issue type "${a.issue_type}" not found. Available: ${types.map((t) => t.name).join(", ")}`);
      }
      return {
        issue_type: type.name,
        fields: Object.entries(obj(type.fields)).map(([fid, fd]) => shapeField(fid, obj(fd))),
      };
    },
  },
  {
    name: "jira_get_transitions",
    description: "Available workflow transitions for an issue (id, name, target status).",
    inputSchema: schema({ issue_key: ISSUE_KEY }, ["issue_key"]),
    run: async (conn, _c, a) => {
      const r = obj(
        await jiraRequest(conn, "GET", `/rest/api/2/issue/${encodeURIComponent(requireStr(a, "issue_key"))}/transitions`)
      );
      return arr(r.transitions).map((t) => ({ id: obj(t).id, name: obj(t).name, to: named(obj(t).to) }));
    },
  },
  {
    name: "jira_search_users",
    description:
      "Find users by name/login/email (for assignee, mentions). With issue_key or project_key returns only users assignable there.",
    inputSchema: schema(
      {
        query: S("string", "Part of name, login or email"),
        issue_key: S("string", "Only users assignable to this issue"),
        project_key: S("string", "Only users assignable in this project"),
      },
      ["query"]
    ),
    run: async (conn, _c, a) => {
      const q = requireStr(a, "query");
      const assignable = a.issue_key || a.project_key;
      const r = await jiraRequest(
        conn,
        "GET",
        assignable ? "/rest/api/2/user/assignable/search" : "/rest/api/2/user/search",
        {
          query: {
            username: q,
            issueKey: str(a.issue_key),
            project: a.issue_key ? undefined : str(a.project_key),
            maxResults: 20,
          },
        }
      );
      return arr(r).map((u) => {
        const x = obj(u);
        return { name: x.name, display_name: x.displayName, email: x.emailAddress, active: x.active };
      });
    },
  },
  {
    name: "jira_get_myself",
    description: "The connected user (login name, display name, email, time zone).",
    inputSchema: schema({}),
    run: async (conn, cache) => {
      const me = await myself(conn, cache);
      return { name: me.name, display_name: me.displayName, email: me.emailAddress, time_zone: me.timeZone };
    },
  },
  {
    name: "jira_get_fields",
    description: "Find field ids by name (custom fields like Story Points, Epic Link, Sprint) for search/create/update.",
    inputSchema: schema({ query: S("string", "Part of the field name or id") }),
    run: async (conn, cache, a) => {
      const q = String(a.query || "").toLowerCase();
      return (await allFields(conn, cache))
        .filter((f) => !q || `${f.id} ${f.name}`.toLowerCase().includes(q))
        .slice(0, 80)
        .map((f) => ({ id: f.id, name: f.name, custom: f.custom, type: obj(f.schema).type }));
    },
  },
  {
    name: "jira_get_link_types",
    description: "Issue link types (name, inward, outward) for jira_link_issues.",
    inputSchema: schema({}),
    run: async (conn) =>
      arr(obj(await jiraRequest(conn, "GET", "/rest/api/2/issueLinkType")).issueLinkTypes).map((t) => ({
        name: obj(t).name,
        inward: obj(t).inward,
        outward: obj(t).outward,
      })),
  },
  {
    name: "jira_get_worklogs",
    description: "Work log entries of an issue (author, time spent, started, comment).",
    inputSchema: schema({ issue_key: ISSUE_KEY }, ["issue_key"]),
    run: async (conn, _c, a) => {
      const r = obj(
        await jiraRequest(conn, "GET", `/rest/api/2/issue/${encodeURIComponent(requireStr(a, "issue_key"))}/worklog`)
      );
      return {
        total: r.total,
        worklogs: arr(r.worklogs).map((w) => {
          const x = obj(w);
          return { id: x.id, author: user(x.author), time_spent: x.timeSpent, started: x.started, comment: x.comment };
        }),
      };
    },
  },
  {
    name: "jira_get_boards",
    description: "Agile boards (id, name, type), optionally for one project or by name.",
    inputSchema: schema({
      project_key: S("string", "Project key"),
      name: S("string", "Part of the board name"),
    }),
    run: async (conn, _c, a) => {
      const r = obj(
        await jiraRequest(conn, "GET", "/rest/agile/1.0/board", {
          query: { projectKeyOrId: str(a.project_key), name: str(a.name), maxResults: 50 },
        })
      );
      return arr(r.values).map((b) => ({ id: obj(b).id, name: obj(b).name, type: obj(b).type }));
    },
  },
  {
    name: "jira_get_sprints",
    description: "Sprints of a board (id, name, state, dates). Default: active and future.",
    inputSchema: schema(
      {
        board_id: S("number", "Board id (from jira_get_boards)"),
        state: S("string", "Comma-separated: active, future, closed (default 'active,future')"),
      },
      ["board_id"]
    ),
    run: async (conn, _c, a) => {
      const r = obj(
        await jiraRequest(conn, "GET", `/rest/agile/1.0/board/${clampInt(a.board_id, 0, 0, Number.MAX_SAFE_INTEGER)}/sprint`, {
          query: { state: str(a.state) || "active,future", maxResults: 50 },
        })
      );
      return arr(r.values).map((s) => {
        const x = obj(s);
        return { id: x.id, name: x.name, state: x.state, start: x.startDate, end: x.endDate, goal: x.goal };
      });
    },
  },
  {
    name: "jira_get_sprint_issues",
    description: "Issues in a sprint (optionally filtered by JQL).",
    inputSchema: schema(
      {
        sprint_id: S("number", "Sprint id"),
        jql: S("string", "Extra JQL filter, e.g. 'assignee = currentUser()'"),
        limit: S("number", "Max issues (1-100, default 50)"),
        start_at: S("number", "Offset for paging"),
      },
      ["sprint_id"]
    ),
    run: async (conn, _c, a) => {
      const r = obj(
        await jiraRequest(conn, "GET", `/rest/agile/1.0/sprint/${clampInt(a.sprint_id, 0, 0, Number.MAX_SAFE_INTEGER)}/issue`, {
          query: {
            jql: str(a.jql),
            fields: BRIEF_FIELDS.join(","),
            maxResults: clampInt(a.limit, 50, 1, 100),
            startAt: clampInt(a.start_at, 0, 0, 1_000_000),
          },
        })
      );
      return { total: r.total, issues: arr(r.issues).map((i) => briefIssue(i)) };
    },
  },
  {
    name: "jira_get_dev_info",
    description:
      "Development info linked to an issue via the Git integration (GitLab / Bitbucket / GitHub): branches, merge/pull requests, recent commits.",
    inputSchema: schema({ issue_key: ISSUE_KEY }, ["issue_key"]),
    run: async (conn, _c, a) => {
      const key = requireStr(a, "issue_key");
      const issue = obj(
        await jiraRequest(conn, "GET", `/rest/api/2/issue/${encodeURIComponent(key)}`, { query: { fields: "summary" } })
      );
      const issueId = String(issue.id || "");
      const summary = obj(
        obj(await jiraRequest(conn, "GET", "/rest/dev-status/1.0/issue/summary", { query: { issueId } })).summary
      );
      const appTypes = new Set<string>();
      for (const part of Object.values(summary)) {
        for (const t of Object.keys(obj(obj(part).byInstanceType))) {
          appTypes.add(t);
        }
      }
      const out: Obj = { issue: key, branches: [], merge_requests: [], commits: [] };
      for (const applicationType of appTypes) {
        for (const dataType of ["branch", "pullrequest", "repository"]) {
          let detail: Obj;
          try {
            detail = obj(
              await jiraRequest(conn, "GET", "/rest/dev-status/1.0/issue/detail", {
                query: { issueId, applicationType, dataType },
              })
            );
          } catch {
            continue;
          }
          for (const d of arr(detail.detail).map(obj)) {
            for (const b of arr(d.branches).map(obj)) {
              (out.branches as Obj[]).push({ name: b.name, repo: named(b.repository), url: b.url });
            }
            for (const p of arr(d.pullRequests).map(obj)) {
              (out.merge_requests as Obj[]).push({
                title: p.name,
                status: p.status,
                author: named(p.author),
                source: named(p.source),
                destination: named(p.destination),
                url: p.url,
              });
            }
            for (const r of arr(d.repositories).map(obj)) {
              for (const c of arr(r.commits).map(obj).slice(0, 20)) {
                (out.commits as Obj[]).push({
                  id: c.displayId || c.id,
                  message: String(c.message || "").split("\n")[0],
                  author: named(c.author),
                  at: c.authorTimestamp,
                  repo: r.name,
                  url: c.url,
                });
              }
            }
          }
        }
      }
      return out;
    },
  },
  // ——— write ———
  {
    name: "jira_add_comment",
    description: "Add a comment to an issue (Jira wiki markup).",
    inputSchema: schema({ issue_key: ISSUE_KEY, body: S("string", "Comment text") }, ["issue_key", "body"]),
    run: async (conn, _c, a) => {
      const key = requireStr(a, "issue_key");
      const r = obj(
        await jiraRequest(conn, "POST", `/rest/api/2/issue/${encodeURIComponent(key)}/comment`, {
          body: { body: requireStr(a, "body") },
        })
      );
      return { ok: true, issue: key, comment_id: r.id, url: issueUrl(conn, key) };
    },
  },
  {
    name: "jira_create_issue",
    description:
      "Create an issue or sub-task. Use jira_get_create_fields first when the project has required custom fields.",
    inputSchema: schema(
      {
        project_key: S("string", "Project key"),
        issue_type: S("string", "Issue type name (e.g. Задача / Task / Bug / Sub-task)"),
        summary: S("string", "Title"),
        description: S("string", "Description (Jira wiki markup)"),
        assignee: S("string", "Login name, or 'me'"),
        priority: S("string", "Priority name"),
        labels: S("array", "Labels", { items: { type: "string" } }),
        components: S("array", "Component names", { items: { type: "string" } }),
        fix_versions: S("array", "Fix version names", { items: { type: "string" } }),
        due_date: S("string", "YYYY-MM-DD"),
        parent_key: S("string", "Parent issue key (for sub-tasks)"),
        epic_key: S("string", "Epic issue key (sets Epic Link)"),
        fields: S("object", "Extra raw fields, e.g. {\"customfield_10002\": 3}"),
      },
      ["project_key", "issue_type", "summary"]
    ),
    run: async (conn, cache, a) => {
      const fields = await buildIssueFields(conn, cache, a);
      fields.project = { key: requireStr(a, "project_key") };
      const type = requireStr(a, "issue_type");
      fields.issuetype = /^\d+$/.test(type) ? { id: type } : { name: type };
      if (a.parent_key) {
        fields.parent = { key: String(a.parent_key) };
      }
      const r = obj(await jiraRequest(conn, "POST", "/rest/api/2/issue", { body: { fields } }));
      return { ok: true, key: r.key, url: issueUrl(conn, String(r.key)) };
    },
  },
  {
    name: "jira_update_issue",
    description:
      "Update issue fields. Only passed fields change. labels/components replace the list; use labels_add / labels_remove to edit it.",
    inputSchema: schema(
      {
        issue_key: ISSUE_KEY,
        summary: S("string", "New title"),
        description: S("string", "New description (Jira wiki markup)"),
        assignee: S("string", "Login name, 'me', or 'none' to unassign"),
        priority: S("string", "Priority name"),
        labels: S("array", "Replace labels", { items: { type: "string" } }),
        labels_add: S("array", "Labels to add", { items: { type: "string" } }),
        labels_remove: S("array", "Labels to remove", { items: { type: "string" } }),
        components: S("array", "Replace components", { items: { type: "string" } }),
        fix_versions: S("array", "Replace fix versions", { items: { type: "string" } }),
        due_date: S("string", "YYYY-MM-DD, or empty to clear"),
        epic_key: S("string", "Epic issue key (sets Epic Link)"),
        fields: S("object", "Extra raw fields"),
      },
      ["issue_key"]
    ),
    run: async (conn, cache, a) => {
      const key = requireStr(a, "issue_key");
      const fields = await buildIssueFields(conn, cache, a);
      const update: Obj = {};
      const labelOps = [
        ...listArg(a.labels_add).map((l) => ({ add: l })),
        ...listArg(a.labels_remove).map((l) => ({ remove: l })),
      ];
      if (labelOps.length) {
        update.labels = labelOps;
      }
      if (!Object.keys(fields).length && !labelOps.length) {
        throw new Error("Nothing to update — pass at least one field.");
      }
      await jiraRequest(conn, "PUT", `/rest/api/2/issue/${encodeURIComponent(key)}`, {
        body: { ...(Object.keys(fields).length ? { fields } : {}), ...(labelOps.length ? { update } : {}) },
      });
      return { ok: true, issue: key, updated: [...Object.keys(fields), ...(labelOps.length ? ["labels"] : [])], url: issueUrl(conn, key) };
    },
  },
  {
    name: "jira_transition_issue",
    description:
      "Change issue status. 'transition' = transition id, transition name or target status name (see jira_get_transitions). Optional comment and fields (e.g. resolution).",
    inputSchema: schema(
      {
        issue_key: ISSUE_KEY,
        transition: S("string", "Transition id / name / target status"),
        comment: S("string", "Comment to add with the transition"),
        fields: S("object", "Fields required by the transition screen, e.g. {\"resolution\": {\"name\": \"Done\"}}"),
      },
      ["issue_key", "transition"]
    ),
    run: async (conn, _c, a) => {
      const key = requireStr(a, "issue_key");
      const wanted = requireStr(a, "transition").toLowerCase();
      const transitions = arr(
        obj(await jiraRequest(conn, "GET", `/rest/api/2/issue/${encodeURIComponent(key)}/transitions`)).transitions
      ).map(obj);
      const hit =
        transitions.find((t) => String(t.id) === wanted) ||
        transitions.find((t) => String(t.name).toLowerCase() === wanted) ||
        transitions.find((t) => String(named(t.to) || "").toLowerCase() === wanted);
      if (!hit) {
        throw new Error(
          `Transition "${a.transition}" is not available for ${key}. Available: ${transitions
            .map((t) => `${t.name} → ${named(t.to)} (id ${t.id})`)
            .join("; ") || "none"}`
        );
      }
      await jiraRequest(conn, "POST", `/rest/api/2/issue/${encodeURIComponent(key)}/transitions`, {
        body: {
          transition: { id: hit.id },
          ...(a.fields ? { fields: obj(a.fields) } : {}),
          ...(a.comment ? { update: { comment: [{ add: { body: String(a.comment) } }] } } : {}),
        },
      });
      return { ok: true, issue: key, transition: hit.name, status: named(hit.to), url: issueUrl(conn, key) };
    },
  },
  {
    name: "jira_assign_issue",
    description: "Assign an issue: login name, 'me', or 'none' to unassign.",
    inputSchema: schema(
      { issue_key: ISSUE_KEY, assignee: S("string", "Login name (see jira_search_users), 'me' or 'none'") },
      ["issue_key", "assignee"]
    ),
    run: async (conn, cache, a) => {
      const key = requireStr(a, "issue_key");
      const name = await resolveUserName(conn, cache, a.assignee);
      await jiraRequest(conn, "PUT", `/rest/api/2/issue/${encodeURIComponent(key)}/assignee`, { body: { name } });
      return { ok: true, issue: key, assignee: name, url: issueUrl(conn, key) };
    },
  },
  {
    name: "jira_link_issues",
    description:
      "Link two issues. 'type' is a link type name (see jira_get_link_types); outward_issue <outward phrase> inward_issue, e.g. Blocks: outward blocks inward.",
    inputSchema: schema(
      {
        type: S("string", "Link type name, e.g. Blocks / Relates / Duplicate"),
        outward_issue: S("string", "Issue on the outward side (e.g. the blocker)"),
        inward_issue: S("string", "Issue on the inward side (e.g. the blocked one)"),
        comment: S("string", "Optional comment"),
      },
      ["type", "outward_issue", "inward_issue"]
    ),
    run: async (conn, _c, a) => {
      await jiraRequest(conn, "POST", "/rest/api/2/issueLink", {
        body: {
          type: { name: requireStr(a, "type") },
          outwardIssue: { key: requireStr(a, "outward_issue") },
          inwardIssue: { key: requireStr(a, "inward_issue") },
          ...(a.comment ? { comment: { body: String(a.comment) } } : {}),
        },
      });
      return { ok: true };
    },
  },
  {
    name: "jira_add_worklog",
    description: "Log work on an issue (time_spent like '1h 30m', optional started date-time and comment).",
    inputSchema: schema(
      {
        issue_key: ISSUE_KEY,
        time_spent: S("string", "Jira duration, e.g. '2h', '1h 30m', '1d'"),
        started: S("string", "When the work started (ISO date-time; default now)"),
        comment: S("string", "Work description"),
      },
      ["issue_key", "time_spent"]
    ),
    run: async (conn, _c, a) => {
      const key = requireStr(a, "issue_key");
      const r = obj(
        await jiraRequest(conn, "POST", `/rest/api/2/issue/${encodeURIComponent(key)}/worklog`, {
          body: {
            timeSpent: requireStr(a, "time_spent"),
            ...(a.comment ? { comment: String(a.comment) } : {}),
            ...(a.started ? { started: jiraDateTime(a.started) } : {}),
          },
        })
      );
      return { ok: true, issue: key, worklog_id: r.id, time_spent: r.timeSpent };
    },
  },
  {
    name: "jira_add_issues_to_sprint",
    description: "Move issues into a sprint.",
    inputSchema: schema(
      {
        sprint_id: S("number", "Sprint id (from jira_get_sprints)"),
        issue_keys: S("array", "Issue keys", { items: { type: "string" } }),
      },
      ["sprint_id", "issue_keys"]
    ),
    run: async (conn, _c, a) => {
      const issues = listArg(a.issue_keys);
      if (!issues.length) {
        throw new Error('"issue_keys" is required');
      }
      await jiraRequest(conn, "POST", `/rest/agile/1.0/sprint/${clampInt(a.sprint_id, 0, 0, Number.MAX_SAFE_INTEGER)}/issue`, {
        body: { issues },
      });
      return { ok: true, moved: issues };
    },
  },
  {
    name: "jira_move_issues_to_backlog",
    description: "Move issues out of their sprint into the backlog.",
    inputSchema: schema(
      { issue_keys: S("array", "Issue keys", { items: { type: "string" } }) },
      ["issue_keys"]
    ),
    run: async (conn, _c, a) => {
      const issues = listArg(a.issue_keys);
      if (!issues.length) {
        throw new Error('"issue_keys" is required');
      }
      await jiraRequest(conn, "POST", "/rest/agile/1.0/backlog/issue", { body: { issues } });
      return { ok: true, moved: issues };
    },
  },
];

/** Tool names that change Jira (hidden in Plan / Ask). */
export const JIRA_NATIVE_WRITE_TOOLS = new Set([
  "jira_add_comment",
  "jira_create_issue",
  "jira_update_issue",
  "jira_transition_issue",
  "jira_assign_issue",
  "jira_link_issues",
  "jira_add_worklog",
  "jira_add_issues_to_sprint",
  "jira_move_issues_to_backlog",
]);

/** MCP-client-shaped wrapper used by McpManager (no child process). */
export function createJiraNativeClient(conn: JiraConn): {
  listTools(): Promise<{ tools: Array<{ name: string; description: string; inputSchema: Obj }> }>;
  callTool(req: { name: string; arguments?: Record<string, unknown> }): Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  }>;
  close(): Promise<void>;
} {
  const cache: Caches = {};
  const byName = new Map(JIRA_NATIVE_TOOLS.map((t) => [t.name, t]));
  return {
    async listTools() {
      return {
        tools: JIRA_NATIVE_TOOLS.map((t) => ({
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
          content: [{ type: "text", text: JSON.stringify({ error: `Unknown Jira tool: ${req.name}` }) }],
          isError: true,
        };
      }
      try {
        const result = await tool.run(conn, cache, obj(req.arguments));
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
      }
    },
    async close() {
      // stateless HTTP — nothing to close
    },
  };
}
