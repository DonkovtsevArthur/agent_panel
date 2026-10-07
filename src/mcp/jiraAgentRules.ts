/**
 * Jira (mcp-atlassian) integration helpers: keep the PAT out of settings and,
 * after a verified connection, write a portable "how to reach Jira" rule into
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

const SECTION_START = "<!-- harbor:jira:start -->";
const SECTION_END = "<!-- harbor:jira:end -->";
const VSCODE_TOKEN_INPUT_ID = "jira-personal-token";

/**
 * Env keys that are safe to keep in settings and to write into AGENTS.md /
 * shared MCP configs. Everything else on a Jira server is treated as a
 * secret (SecretStorage only) — guessing by name leaked `KEY=<pat>` once.
 */
const JIRA_PUBLIC_ENV_KEYS = new Set([
  JIRA_URL_ENV,
  "JIRA_SSL_VERIFY",
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

/** Token keys mcp-atlassian understands; only these go into shared configs. */
const JIRA_TOKEN_ENV_KEYS = [JIRA_TOKEN_ENV, "JIRA_API_TOKEN"];

export function isSecretEnvKey(key: string): boolean {
  return !JIRA_PUBLIC_ENV_KEYS.has(key.toUpperCase());
}

/** True for stdio servers that run mcp-atlassian or carry JIRA_URL. */
export function isJiraMcpServer(options: {
  transport?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}): boolean {
  if (options.transport === "http") {
    return false;
  }
  const parts = [options.command || "", ...(options.args || [])];
  if (parts.some((p) => /mcp-atlassian|^harbor-jira$/i.test(p))) {
    return true;
  }
  return Boolean(options.env && JIRA_URL_ENV in options.env);
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
  return Object.entries(info.env).filter(
    ([k, v]) => k !== JIRA_URL_ENV && !isSecretEnvKey(k) && String(v).trim()
  );
}

function secretKeysOf(info: JiraAgentRuleInfo): string[] {
  const keys = info.secretKeys.filter((k) => JIRA_TOKEN_ENV_KEYS.includes(k));
  return keys.length ? keys : [JIRA_TOKEN_ENV];
}

/** Shell env var a secret key is read from on other machines. */
function sourceEnvOf(info: JiraAgentRuleInfo, key: string): string {
  return key === JIRA_TOKEN_ENV && info.tokenSourceEnv
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
  return /^(false|0|no)$/i.test(String(info.env.JIRA_SSL_VERIFY || "").trim())
    ? " -k"
    : "";
}

/** Pick the env var that holds the PAT in the user's shell, if any. */
export function detectJiraTokenSourceEnv(
  env: Record<string, string | undefined>
): string {
  if (env[JIRA_TOKEN_ENV]) {
    return JIRA_TOKEN_ENV;
  }
  if (env.JIRA_API_TOKEN) {
    return "JIRA_API_TOKEN";
  }
  return JIRA_TOKEN_ENV;
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
  const url = info.url.replace(/\/+$/, "");
  const command = [portableCommand(info.command), ...info.args].join(" ");
  const secretKeys = secretKeysOf(info);
  const tokenVar = sourceEnvOf(info, secretKeys[0]);
  const tls = curlTlsFlag(info);
  const envParts = [
    `\`${JIRA_URL_ENV}=${url}\``,
    ...secretKeys.map((k) => `\`${k}=$${sourceEnvOf(info, k)}\``),
    ...publicEnvEntries(info).map(([k, v]) => `\`${k}=${v}\``),
  ];
  const lines = [
    SECTION_START,
    "## Jira — connection (MCP)",
    "",
    "_Auto-generated by Harbor Agents after a verified connection. Re-connecting Jira in Harbor rewrites this block._",
    "",
    `- Instance: ${url} (Jira Server / Data Center, REST API v2).`,
    `- Auth: Personal Access Token as HTTP header \`Authorization: Bearer <token>\`. The token is never stored in the repo — read it from the env var \`${tokenVar}\`; never print, log or commit it.`,
    `- MCP server: \`${command}\` with env ${envParts.join(", ")}.`,
    "- Harbor Agents itself uses its built-in Jira tools (REST API from the IDE, no Python / uv); other tools use the MCP server above.",
    "- Ready MCP configs in this repo: `.mcp.json` (Claude Code), `.cursor/mcp.json`, `.vscode/mcp.json` (VS Code / Copilot). They take the token from the environment / an input prompt.",
    `- Without MCP: \`curl -s${tls} -H "Authorization: Bearer $${tokenVar}" "${url}/rest/api/2/issue/<KEY>"\`, search via \`${url}/rest/api/2/search?jql=...\`. Bearer only — Basic auth is not used.`,
    ...(tls
      ? [
          `- TLS: the server uses a corporate CA. Python / Node clients do not read the OS keychain — point \`REQUESTS_CA_BUNDLE\` and \`SSL_CERT_FILE\` (Node: \`NODE_EXTRA_CA_CERTS\`) at a PEM bundle with the corporate root; Harbor exports one to \`~/${HARBOR_CA_BUNDLE_REL}\`.`,
        ]
      : []),
    ...(info.hostOverride
      ? [
          `- Network: Jira is reachable only via VPN. Public DNS returns an external proxy with an expired certificate; the right address comes from the VPN DNS (${info.hostOverride.ip} at verification time). If a client fails with "certificate has expired", the VPN DNS is bypassed — on macOS add \`/etc/resolver/${info.hostOverride.host.split(".").slice(-2).join(".")}\` with the VPN nameservers.`,
        ]
      : []),
    `- Verified: ${info.verifiedAt} (${info.verifiedHow}).`,
    SECTION_END,
  ];
  return lines.join("\n");
}

/** Replace the Harbor Jira block, or append it to the end. */
export function upsertJiraSection(content: string, section: string): string {
  const start = content.indexOf(SECTION_START);
  const end = content.indexOf(SECTION_END);
  if (start >= 0 && end > start) {
    return (
      content.slice(0, start) +
      section +
      content.slice(end + SECTION_END.length)
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
    [JIRA_URL_ENV]: info.url.replace(/\/+$/, ""),
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
      [JIRA_MCP_SERVER_KEY]: {
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
      [JIRA_MCP_SERVER_KEY]: {
        command: portableCommand(info.command),
        args: info.args,
        env: serverEnv(info, (k) => `\${env:${k}}`, "${userHome}"),
      },
    },
  };
}

/** VS Code `.vscode/mcp.json` — token via a password input prompt. */
export function mergeVscodeMcpJson(existing: JsonObject, info: JiraAgentRuleInfo): JsonObject {
  const secretKeys = secretKeysOf(info);
  const inputId = (key: string) =>
    key === JIRA_TOKEN_ENV
      ? VSCODE_TOKEN_INPUT_ID
      : `jira-${key.toLowerCase().replace(/_/g, "-")}`;
  const prevInputs = Array.isArray(existing.inputs) ? existing.inputs : [];
  const ourIds = new Set(secretKeys.map(inputId));
  const inputs = [
    ...prevInputs.filter((i) => !ourIds.has(String(asObject(i).id || ""))),
    ...secretKeys.map((key) => ({
      type: "promptString",
      id: inputId(key),
      description: `Jira ${key}`,
      password: true,
    })),
  ];
  return {
    ...existing,
    inputs,
    servers: {
      ...asObject(existing.servers),
      [JIRA_MCP_SERVER_KEY]: {
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
  agentsContent: string
): string {
  const root = path.resolve(workspaceRoot);
  const linkRe = /\]\(\s*(?:\.\/)?([^)\s#]*jira[^)\s#]*\.md)\s*\)/gi;
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
    ruleRel = resolveJiraRuleTarget(workspaceRoot, agentsContent);
    const rulePath = path.join(workspaceRoot, ruleRel);
    const current =
      ruleRel === "AGENTS.md" ? agentsContent : fs.readFileSync(rulePath, "utf8");
    const next = upsertJiraSection(current, buildJiraAgentsSection(info));
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
