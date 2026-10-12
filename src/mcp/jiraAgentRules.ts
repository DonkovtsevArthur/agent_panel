/**
 * Jira / Confluence (mcp-atlassian) integration helpers: keep the PAT out of
 * settings and, after a verified connection, write a portable "how to reach
 * Jira / Confluence" rule into
 * the workspace AGENTS.md plus ready MCP configs for other agent tools
 * (.mcp.json, .cursor/mcp.json, .vscode/mcp.json). Secrets never reach disk —
 * configs reference the token through env vars / VS Code input prompts.
 *
 * vscode-free so unit tests can import it.
 */

import * as fs from "fs";
import * as path from "path";

export const JIRA_TOKEN_ENV = "JIRA_PERSONAL_TOKEN";
export const JIRA_URL_ENV = "JIRA_URL";
export const JIRA_MCP_SERVER_KEY = "jira";
export const CONFLUENCE_TOKEN_ENV = "CONFLUENCE_PERSONAL_TOKEN";
export const CONFLUENCE_URL_ENV = "CONFLUENCE_URL";

export type AtlassianProduct = "jira" | "confluence";

/** Per-product names: env vars, rule block markers, MCP config key, examples. */
export interface AtlassianProductSpec {
  id: AtlassianProduct;
  label: string;
  urlEnv: string;
  tokenEnv: string;
  /** Alternative shell var teams use for the PAT. */
  altTokenEnv: string;
  sslVerifyEnv: string;
  /** Pseudo-command of the built-in REST client. */
  nativeCommand: string;
  serverKey: string;
  apiLabel: string;
  curlExample: (url: string) => string;
  searchExample: (url: string) => string;
}

export const ATLASSIAN_PRODUCTS: Record<AtlassianProduct, AtlassianProductSpec> = {
  jira: {
    id: "jira",
    label: "Jira",
    urlEnv: JIRA_URL_ENV,
    tokenEnv: JIRA_TOKEN_ENV,
    altTokenEnv: "JIRA_API_TOKEN",
    sslVerifyEnv: "JIRA_SSL_VERIFY",
    nativeCommand: "harbor-jira",
    serverKey: JIRA_MCP_SERVER_KEY,
    apiLabel: "Jira Server / Data Center, REST API v2",
    curlExample: (url) => `${url}/rest/api/2/issue/<KEY>`,
    searchExample: (url) => `${url}/rest/api/2/search?jql=...`,
  },
  confluence: {
    id: "confluence",
    label: "Confluence",
    urlEnv: CONFLUENCE_URL_ENV,
    tokenEnv: CONFLUENCE_TOKEN_ENV,
    altTokenEnv: "CONFLUENCE_API_TOKEN",
    sslVerifyEnv: "CONFLUENCE_SSL_VERIFY",
    nativeCommand: "harbor-confluence",
    serverKey: "confluence",
    apiLabel: "Confluence Server / Data Center, REST API",
    curlExample: (url) => `${url}/rest/api/content/<PAGE_ID>?expand=body.storage`,
    searchExample: (url) => `${url}/rest/api/content/search?cql=...`,
  },
};

function specOf(info: { product?: AtlassianProduct }): AtlassianProductSpec {
  return ATLASSIAN_PRODUCTS[info.product || "jira"];
}

function sectionMarkers(product: AtlassianProduct = "jira"): [string, string] {
  return [`<!-- harbor:${product}:start -->`, `<!-- harbor:${product}:end -->`];
}

/**
 * Env keys that are safe to keep in settings and to write into AGENTS.md /
 * shared MCP configs. Everything else on a Jira server is treated as a
 * secret (SecretStorage only) — guessing by name leaked `KEY=<pat>` once.
 */
const JIRA_PUBLIC_ENV_KEYS = new Set([
  JIRA_URL_ENV,
  "JIRA_SSL_VERIFY",
  CONFLUENCE_URL_ENV,
  "CONFLUENCE_SSL_VERIFY",
  "CONFLUENCE_SPACES_FILTER",
  "REQUESTS_CA_BUNDLE",
  "SSL_CERT_FILE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "READ_ONLY_MODE",
  "ENABLED_TOOLS",
  "JIRA_PROJECTS_FILTER",
  "MCP_VERBOSE",
  "MCP_VERY_VERBOSE",
]);


export function isSecretEnvKey(key: string): boolean {
  return !JIRA_PUBLIC_ENV_KEYS.has(key.toUpperCase());
}

interface ServerShape {
  transport?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Which Atlassian product a stdio server talks to: the built-in
 * `harbor-jira` / `harbor-confluence`, or mcp-atlassian / *_URL env
 * (mcp-atlassian with only CONFLUENCE_URL → Confluence).
 */
export function atlassianProductOf(options: ServerShape): AtlassianProduct | undefined {
  if (options.transport === "http") {
    return undefined;
  }
  const command = String(options.command || "");
  if (/^harbor-confluence$/i.test(command)) {
    return "confluence";
  }
  if (/^harbor-jira$/i.test(command)) {
    return "jira";
  }
  const env = options.env || {};
  const parts = [command, ...(options.args || [])];
  const atlassian = parts.some((p) => /mcp-atlassian/i.test(p));
  if (CONFLUENCE_URL_ENV in env && !(JIRA_URL_ENV in env)) {
    return "confluence";
  }
  if (atlassian || JIRA_URL_ENV in env) {
    return "jira";
  }
  return undefined;
}

/** True for stdio servers that run mcp-atlassian or carry JIRA_URL. */
export function isJiraMcpServer(options: ServerShape): boolean {
  return atlassianProductOf(options) === "jira";
}

/** Split env into plain (settings) and secret (SecretStorage) parts. */
export function splitSecretEnv(env: Record<string, string> | undefined): {
  env: Record<string, string>;
  secretEnv: Record<string, string>;
} {
  const plain: Record<string, string> = {};
  const secretEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env || {})) {
    if (isSecretEnvKey(key)) {
      if (String(value || "").trim()) {
        secretEnv[key] = String(value).trim();
      }
    } else {
      plain[key] = value;
    }
  }
  return { env: plain, secretEnv };
}

export interface JiraAgentRuleInfo {
  /** Default "jira". */
  product?: AtlassianProduct;
  url: string;
  command: string;
  args: string[];
  /** Non-secret env from the Harbor config (secrets are dropped here). */
  env: Record<string, string>;
  /** Secret env keys the server needs (values never written). */
  secretKeys: string[];
  /**
   * Shell env var that holds the PAT on developer machines (e.g. a team
   * convention `JIRA_API_TOKEN`); configs map it into `JIRA_PERSONAL_TOKEN`.
   * Defaults to the server's own key.
   */
  tokenSourceEnv?: string;
  /** Jira uses a corporate CA (clients need a PEM bundle with its root). */
  corporateCa?: boolean;
  /** System DNS gave a wrong endpoint; Harbor pinned the VPN-DNS address. */
  hostOverride?: { host: string; ip: string };
  /** ISO date (YYYY-MM-DD). */
  verifiedAt: string;
  /** Short human description of how the connection was verified. */
  verifiedHow: string;
}

function portableCommand(command: string): string {
  // Absolute paths (/Users/me/.local/bin/uvx) are machine-specific.
  return path.isAbsolute(command) ? path.basename(command) : command;
}

function publicEnvEntries(info: JiraAgentRuleInfo): Array<[string, string]> {
  const spec = specOf(info);
  return Object.entries(info.env).filter(
    ([k, v]) =>
      k !== spec.urlEnv &&
      k !== JIRA_URL_ENV &&
      k !== CONFLUENCE_URL_ENV &&
      !isSecretEnvKey(k) &&
      String(v).trim()
  );
}

/** Token keys mcp-atlassian understands; only these go into shared configs. */
function secretKeysOf(info: JiraAgentRuleInfo): string[] {
  const spec = specOf(info);
  const known = [spec.tokenEnv, spec.altTokenEnv];
  const keys = info.secretKeys.filter((k) => known.includes(k));
  return keys.length ? keys : [spec.tokenEnv];
}

/** Shell env var a secret key is read from on other machines. */
function sourceEnvOf(info: JiraAgentRuleInfo, key: string): string {
  return key === specOf(info).tokenEnv && info.tokenSourceEnv
    ? info.tokenSourceEnv
    : key;
}

/** Harbor's exported OS trust store (public roots + corporate CAs). */
const HARBOR_CA_BUNDLE_REL = ".harbor/ca-bundle.pem";

/** curl TLS flag matching the MCP env (corporate CA / disabled verify). */
function curlTlsFlag(info: JiraAgentRuleInfo): string {
  const ca = String(info.env.REQUESTS_CA_BUNDLE || "").trim();
  if (ca) {
    return ` --cacert "${ca}"`;
  }
  if (info.corporateCa) {
    return ` --cacert ~/${HARBOR_CA_BUNDLE_REL}`;
  }
  return /^(false|0|no)$/i.test(String(info.env[specOf(info).sslVerifyEnv] || "").trim())
    ? " -k"
    : "";
}

/** Pick the env var that holds the PAT in the user's shell, if any. */
export function detectJiraTokenSourceEnv(
  env: Record<string, string | undefined>,
  product: AtlassianProduct = "jira"
): string {
  const spec = ATLASSIAN_PRODUCTS[product];
  if (env[spec.tokenEnv]) {
    return spec.tokenEnv;
  }
  if (env[spec.altTokenEnv]) {
    return spec.altTokenEnv;
  }
  return spec.tokenEnv;
}

/** True when an MCP / Jira error text points at TLS certificate trouble. */
export function looksLikeTlsError(text: string): boolean {
  return /CERTIFICATE_VERIFY_FAILED|SSLError|self[- ]signed|unable to get local issuer|certificate verify failed|SSL:/i.test(
    text
  );
}

export const JIRA_TLS_HINT_EN =
  "Looks like a TLS certificate error (corporate CA). Add REQUESTS_CA_BUNDLE=/path/to/corp-ca.pem to the server env (or, as a last resort, JIRA_SSL_VERIFY=false) and reconnect.";

export function buildJiraAgentsSection(info: JiraAgentRuleInfo): string {
  const spec = specOf(info);
  const [sectionStart, sectionEnd] = sectionMarkers(spec.id);
  const url = info.url.replace(/\/+$/, "");
  const command = [portableCommand(info.command), ...info.args].join(" ");
  const secretKeys = secretKeysOf(info);
  const tokenVar = sourceEnvOf(info, secretKeys[0]);
  const tls = curlTlsFlag(info);
  const envParts = [
    `\`${spec.urlEnv}=${url}\``,
    ...secretKeys.map((k) => `\`${k}=$${sourceEnvOf(info, k)}\``),
    ...publicEnvEntries(info).map(([k, v]) => `\`${k}=${v}\``),
  ];
  const lines = [
    sectionStart,
    `## ${spec.label} — connection (MCP)`,
    "",
    `_Auto-generated by Harbor Agents after a verified connection. Re-connecting ${spec.label} in Harbor rewrites this block._`,
    "",
    `- Instance: ${url} (${spec.apiLabel}).`,
    `- Auth: Personal Access Token as HTTP header \`Authorization: Bearer <token>\`. The token is never stored in the repo — read it from the env var \`${tokenVar}\`; never print, log or commit it.`,
    `- MCP server: \`${command}\` with env ${envParts.join(", ")}.`,
    `- Harbor Agents itself uses its built-in ${spec.label} tools (REST API from the IDE, no Python / uv); other tools use the MCP server above.`,
    "- Ready MCP configs in this repo: `.mcp.json` (Claude Code), `.cursor/mcp.json`, `.vscode/mcp.json` (VS Code / Copilot). They take the token from the environment / an input prompt.",
    `- Without MCP: \`curl -s${tls} -H "Authorization: Bearer $${tokenVar}" "${spec.curlExample(url)}"\`, search via \`${spec.searchExample(url)}\`. Bearer only — Basic auth is not used.`,
    ...(tls
      ? [
          `- TLS: the server uses a corporate CA. Python / Node clients do not read the OS keychain — point \`REQUESTS_CA_BUNDLE\` and \`SSL_CERT_FILE\` (Node: \`NODE_EXTRA_CA_CERTS\`) at a PEM bundle with the corporate root; Harbor exports one to \`~/${HARBOR_CA_BUNDLE_REL}\`.`,
        ]
      : []),
    ...(info.hostOverride
      ? [
          `- Network: ${spec.label} is reachable only via VPN. Public DNS returns an external proxy with an expired certificate; the right address comes from the VPN DNS (${info.hostOverride.ip} at verification time). If a client fails with "certificate has expired", the VPN DNS is bypassed — on macOS add \`/etc/resolver/${info.hostOverride.host.split(".").slice(-2).join(".")}\` with the VPN nameservers.`,
        ]
      : []),
    `- Verified: ${info.verifiedAt} (${info.verifiedHow}).`,
    sectionEnd,
  ];
  return lines.join("\n");
}

/** Replace the Harbor Jira / Confluence block, or append it to the end. */
export function upsertJiraSection(
  content: string,
  section: string,
  product: AtlassianProduct = "jira"
): string {
  const [sectionStart, sectionEnd] = sectionMarkers(product);
  const start = content.indexOf(sectionStart);
  const end = content.indexOf(sectionEnd);
  if (start >= 0 && end > start) {
    return (
      content.slice(0, start) +
      section +
      content.slice(end + sectionEnd.length)
    );
  }
  if (!content.trim()) {
    return `# Agent instructions\n\n${section}\n`;
  }
  const sep = content.endsWith("\n\n") ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  return `${content}${sep}${section}\n`;
}

function serverEnv(
  info: JiraAgentRuleInfo,
  secretRef: (key: string) => string,
  homeRef?: string
): Record<string, string> {
  const env: Record<string, string> = {
    [specOf(info).urlEnv]: info.url.replace(/\/+$/, ""),
  };
  if (info.corporateCa && homeRef && !info.env.REQUESTS_CA_BUNDLE) {
    env.REQUESTS_CA_BUNDLE = `${homeRef}/${HARBOR_CA_BUNDLE_REL}`;
    env.SSL_CERT_FILE = `${homeRef}/${HARBOR_CA_BUNDLE_REL}`;
  }
  for (const key of secretKeysOf(info)) {
    env[key] = secretRef(sourceEnvOf(info, key));
  }
  for (const [k, v] of publicEnvEntries(info)) {
    env[k] = v;
  }
  return env;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

/** Claude Code `.mcp.json` — `${VAR}` expands from the environment. */
export function mergeClaudeMcpJson(existing: JsonObject, info: JiraAgentRuleInfo): JsonObject {
  return {
    ...existing,
    mcpServers: {
      ...asObject(existing.mcpServers),
      [specOf(info).serverKey]: {
        command: portableCommand(info.command),
        args: info.args,
        env: serverEnv(info, (k) => `\${${k}}`, "${HOME}"),
      },
    },
  };
}

/** Cursor `.cursor/mcp.json` — `${env:VAR}` expands from the environment. */
export function mergeCursorMcpJson(existing: JsonObject, info: JiraAgentRuleInfo): JsonObject {
  return {
    ...existing,
    mcpServers: {
      ...asObject(existing.mcpServers),
      [specOf(info).serverKey]: {
        command: portableCommand(info.command),
        args: info.args,
        env: serverEnv(info, (k) => `\${env:${k}}`, "${userHome}"),
      },
    },
  };
}

/** VS Code `.vscode/mcp.json` — token via a password input prompt. */
export function mergeVscodeMcpJson(existing: JsonObject, info: JiraAgentRuleInfo): JsonObject {
  const spec = specOf(info);
  const secretKeys = secretKeysOf(info);
  const inputId = (key: string) =>
    key === spec.tokenEnv
      ? `${spec.id}-personal-token`
      : `${spec.id}-${key.toLowerCase().replace(/_/g, "-")}`;
  const prevInputs = Array.isArray(existing.inputs) ? existing.inputs : [];
  const ourIds = new Set(secretKeys.map(inputId));
  const inputs = [
    ...prevInputs.filter((i) => !ourIds.has(String(asObject(i).id || ""))),
    ...secretKeys.map((key) => ({
      type: "promptString",
      id: inputId(key),
      description: `${spec.label} ${key}`,
      password: true,
    })),
  ];
  return {
    ...existing,
    inputs,
    servers: {
      ...asObject(existing.servers),
      [spec.serverKey]: {
        type: "stdio",
        command: portableCommand(info.command),
        args: info.args,
        env: Object.fromEntries(
          Object.entries(serverEnv(info, () => "", "${userHome}")).map(([k, v]) => [
            k,
            secretKeys.includes(k) ? `\${input:${inputId(k)}}` : v,
          ])
        ),
      },
    },
  };
}

export interface JiraAgentFilesResult {
  written: string[];
  skipped: Array<{ file: string; reason: string }>;
}

function mergeJsonFile(
  root: string,
  rel: string,
  merge: (existing: JsonObject) => JsonObject,
  result: JiraAgentFilesResult
): void {
  const abs = path.join(root, rel);
  let existing: JsonObject = {};
  if (fs.existsSync(abs)) {
    const raw = fs.readFileSync(abs, "utf8");
    if (raw.trim()) {
      try {
        existing = asObject(JSON.parse(raw));
      } catch {
        // JSONC (comments / trailing commas) — do not rewrite the user's file.
        result.skipped.push({ file: rel, reason: "not plain JSON" });
        return;
      }
    }
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(merge(existing), null, 2)}\n`, "utf8");
  result.written.push(rel);
}

/**
 * Where the Jira block goes: if AGENTS.md already links a Jira doc
 * (e.g. `docs/agents/jira.md`), extend that doc instead of duplicating
 * a second Jira section in AGENTS.md.
 */
export function resolveJiraRuleTarget(
  workspaceRoot: string,
  agentsContent: string,
  product: AtlassianProduct = "jira"
): string {
  const root = path.resolve(workspaceRoot);
  const linkRe = new RegExp(
    `\\]\\(\\s*(?:\\.\\/)?([^)\\s#]*${product}[^)\\s#]*\\.md)\\s*\\)`,
    "gi"
  );
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(agentsContent))) {
    const abs = path.resolve(root, m[1].replace(/^\/+/, ""));
    if (abs.startsWith(root + path.sep) && fs.existsSync(abs)) {
      return path.relative(root, abs);
    }
  }
  return "AGENTS.md";
}

/** Write the Jira rule section + portable MCP configs under `workspaceRoot`. */
export function writeJiraAgentFiles(
  workspaceRoot: string,
  info: JiraAgentRuleInfo
): JiraAgentFilesResult {
  const result: JiraAgentFilesResult = { written: [], skipped: [] };
  const agentsPath = path.join(workspaceRoot, "AGENTS.md");
  let ruleRel = "AGENTS.md";
  try {
    const agentsContent = fs.existsSync(agentsPath)
      ? fs.readFileSync(agentsPath, "utf8")
      : "";
    ruleRel = resolveJiraRuleTarget(workspaceRoot, agentsContent, specOf(info).id);
    const rulePath = path.join(workspaceRoot, ruleRel);
    const current =
      ruleRel === "AGENTS.md" ? agentsContent : fs.readFileSync(rulePath, "utf8");
    const next = upsertJiraSection(current, buildJiraAgentsSection(info), specOf(info).id);
    if (next !== current) {
      fs.writeFileSync(rulePath, next, "utf8");
    }
    result.written.push(ruleRel);
  } catch (error) {
    result.skipped.push({
      file: ruleRel,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  const jsonTargets: Array<[string, (e: JsonObject) => JsonObject]> = [
    [".mcp.json", (e) => mergeClaudeMcpJson(e, info)],
    [path.join(".cursor", "mcp.json"), (e) => mergeCursorMcpJson(e, info)],
    [path.join(".vscode", "mcp.json"), (e) => mergeVscodeMcpJson(e, info)],
  ];
  for (const [rel, merge] of jsonTargets) {
    try {
      mergeJsonFile(workspaceRoot, rel, merge, result);
    } catch (error) {
      result.skipped.push({
        file: rel,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
