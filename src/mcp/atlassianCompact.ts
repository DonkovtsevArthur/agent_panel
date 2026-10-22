/**
 * Built-in Jira / Confluence tools on demand. The full set is 44 tools and
 * ~6k tokens of JSON schema in every request, while chats mostly call a
 * handful of them. Here only the core tools stay as real tools; the rest go
 * through two dispatchers per product:
 *
 * - `<product>_read`  — every other read tool (allowed in Plan / Ask);
 * - `<product>_write` — every write tool (hidden in Plan / Ask, approval as
 *   a write via `isMcpReadonlyTool`).
 *
 * The dispatcher description carries a compact catalog (name, params, first
 * sentence); `describe: true` returns the full schema of one tool. Lazy mode
 * (`agentPanel.mcp.lazyTools`): core tools move behind the dispatchers too and
 * the catalog is names only. vscode-free.
 */

export interface AtlassianCompactOptions {
  /** Names-only dispatchers, no direct core tools. */
  lazy?: boolean;
}

export interface AtlassianToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Called often enough (session history) to keep as direct tools. */
export const ATLASSIAN_CORE_TOOLS: ReadonlySet<string> = new Set([
  "jira_search",
  "jira_get_issue",
  "confluence_search",
  "confluence_get_page",
  "confluence_get_page_children",
]);

const DISPATCH_SUFFIXES = ["_read", "_write"] as const;

export function atlassianDispatcherNames(prefix: string): string[] {
  return DISPATCH_SUFFIXES.map((s) => `${prefix}${s}`);
}

function firstSentence(text: string): string {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  const m = flat.match(/^(.{20,110}?[.!?])(\s|$)/);
  if (m) {
    return m[1].trim();
  }
  return flat.length > 110 ? `${flat.slice(0, 109).trimEnd()}…` : flat;
}

function paramList(schema: Record<string, unknown>): string {
  const props =
    schema && typeof schema.properties === "object" && schema.properties
      ? Object.keys(schema.properties as Record<string, unknown>)
      : [];
  const required = new Set(
    Array.isArray(schema?.required) ? (schema.required as string[]) : []
  );
  // Long parameter lists: required ones + "…" (describe gives the rest).
  if (props.length > 4) {
    const req = props.filter((p) => required.has(p)).map((p) => `${p}*`);
    return [...req, "…"].join(", ");
  }
  return props.map((p) => (required.has(p) ? `${p}*` : p)).join(", ");
}

/** One catalog row: `- name(params) — first sentence`. Shared with toolsOnDemand.ts. */
export function catalogLine(def: AtlassianToolDef): string {
  return `- ${def.name}(${paramList(def.inputSchema)}) — ${firstSentence(def.description)}`;
}

/**
 * Topic keywords (incl. Russian) so a request like «спиши 2ч» or «переведи в
 * работу» maps to the right dispatcher — the catalog below is English.
 */
const DISPATCHER_TOPICS: Record<string, Record<"read" | "write", string>> = {
  jira: {
    read: "Topics: проекты, поля задачи, допустимые значения, переходы статусов, списания времени / worklog, Tempo «Вид работ» и аккаунты, пользователи, доски, спринты, коммиты / ветки задачи, типы связей.",
    write: "Topics: списать / изменить / удалить время (worklog, Tempo «Вид работ»), комментарий, сменить статус (взять в работу, закрыть), назначить исполнителя, создать / изменить задачу, связать задачи, спринт / бэклог.",
  },
  confluence: {
    read: "Topics: комментарии и вложения страницы, пространства, текущий пользователь.",
    write: "Topics: создать / обновить страницу, дописать раздел, комментарий, метки.",
  },
};

/** Lazy read dispatchers also carry the core tools — name them first. */
const LAZY_READ_TOPICS: Record<string, string> = {
  jira: "Jira: поиск задач (JQL), карточка задачи, комментарии, статусы, worklog, спринты.",
  confluence: "Confluence: поиск и чтение страниц, дочерние страницы, комментарии, вложения.",
};

function dispatcherTool(
  prefix: string,
  name: string,
  kind: "read" | "write",
  defs: AtlassianToolDef[],
  lazy = false
): AtlassianToolDef {
  const intro = lazy
    ? kind === "read"
      ? "Read-only tools of this server — use only when the task needs it."
      : "Write tools of this server (change data visible to the team — only when the user asked for it)."
    : kind === "read"
      ? "More read-only tools of this server. Call with tool + arguments."
      : "Write tools of this server (change data visible to the team — only when the user asked for it). Call with tool + arguments.";
  const topics = [
    lazy && kind === "read" ? LAZY_READ_TOPICS[prefix] : "",
    DISPATCHER_TOPICS[prefix]?.[kind] || "",
  ]
    .filter(Boolean)
    .join(" ");
  const catalog = lazy
    ? [
        "Call with describe: true first to get a tool's description and schema, then call with tool + arguments. Tool names from rules / skills are called through here.",
        `Tools: ${defs.map((d) => d.name).join(", ")}.`,
      ]
    : [
        "`*` = required, `…` = more optional params. Unsure about arguments → call with describe: true first (returns the full schema). Tool names from rules / skills that are not in your tool list are called through here.",
        ...defs.map(catalogLine),
      ];
  return {
    name,
    description: [intro, ...(topics ? [topics] : []), ...catalog].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        tool: {
          type: "string",
          enum: defs.map((d) => d.name),
          description: "Tool to run",
        },
        arguments: {
          type: "object",
          description: "Arguments of that tool",
        },
        describe: {
          type: "boolean",
          description: "Return the tool's full schema instead of running it",
        },
      },
      required: ["tool"],
    },
  };
}

/**
 * Core tools as-is + `<prefix>_read` / `<prefix>_write` dispatchers for the
 * rest. Tools outside `<prefix>_*` are left untouched.
 */
export function compactAtlassianToolDefs(
  prefix: string,
  defs: AtlassianToolDef[],
  writeTools: ReadonlySet<string>,
  options: AtlassianCompactOptions = {}
): AtlassianToolDef[] {
  const lazy = options.lazy === true;
  const core: AtlassianToolDef[] = [];
  const reads: AtlassianToolDef[] = [];
  const writes: AtlassianToolDef[] = [];
  for (const def of defs) {
    if (
      !def.name.startsWith(`${prefix}_`) ||
      (!lazy && ATLASSIAN_CORE_TOOLS.has(def.name))
    ) {
      core.push(def);
    } else if (writeTools.has(def.name)) {
      writes.push(def);
    } else {
      reads.push(def);
    }
  }
  const [readName, writeName] = atlassianDispatcherNames(prefix);
  return [
    ...core,
    ...(reads.length ? [dispatcherTool(prefix, readName, "read", reads, lazy)] : []),
    ...(writes.length
      ? [dispatcherTool(prefix, writeName, "write", writes, lazy)]
      : []),
  ];
}

export type AtlassianDispatch =
  | { kind: "direct" }
  | { kind: "call"; tool: string; args: Record<string, unknown> }
  | { kind: "result"; text: string };

/**
 * Resolve a call by tool name: a dispatcher → the inner tool (or its schema),
 * anything else → direct. A read dispatcher never runs a write tool.
 */
export function resolveAtlassianDispatch(
  prefix: string,
  toolName: string,
  args: Record<string, unknown>,
  defs: AtlassianToolDef[],
  writeTools: ReadonlySet<string>,
  options: AtlassianCompactOptions = {}
): AtlassianDispatch {
  const [readName, writeName] = atlassianDispatcherNames(prefix);
  if (toolName !== readName && toolName !== writeName) {
    return { kind: "direct" };
  }
  const lazy = options.lazy === true;
  const wantWrite = toolName === writeName;
  const inner = String(args.tool || "").trim();
  const def = defs.find((d) => d.name === inner);
  const allowed = defs
    .filter((d) => lazy || !ATLASSIAN_CORE_TOOLS.has(d.name))
    .filter((d) => writeTools.has(d.name) === wantWrite)
    .map((d) => d.name);
  if (!def || !allowed.includes(inner)) {
    const hint = !lazy && ATLASSIAN_CORE_TOOLS.has(inner)
      ? ` ${inner} is a direct tool — call it by name.`
      : writeTools.has(inner) && !wantWrite
        ? ` ${inner} changes data — use ${writeName}.`
        : "";
    return {
      kind: "result",
      text: JSON.stringify({
        error: `Unknown tool "${inner}" for ${toolName}.${hint}`,
        allowed,
      }),
    };
  }
  if (args.describe === true) {
    return {
      kind: "result",
      text: JSON.stringify({
        tool: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
      }),
    };
  }
  // Some models send `arguments` as a JSON string.
  let raw: unknown = args.arguments;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = undefined;
    }
  }
  const innerArgs =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return { kind: "call", tool: def.name, args: innerArgs };
}
