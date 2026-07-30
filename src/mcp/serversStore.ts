import * as vscode from "vscode";
import {
  McpServerConfig,
  sanitizeMcpServerId,
  slugifyMcpServerId,
} from "./types";

const CONFIG_KEY = "mcp.servers";
const SECRET_ENV_PREFIX = "agentPanel.mcp.env.";
const SECRET_TOKEN_PREFIX = "agentPanel.mcp.token.";

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((v) => String(v || "").trim())
    .filter(Boolean);
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = String(k || "").trim();
    if (!key) {
      continue;
    }
    out[key] = String(v ?? "");
  }
  return out;
}

export function normalizeMcpServerConfig(
  raw: unknown,
  reservedIds: Set<string> = new Set(["figma"])
): McpServerConfig | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const row = raw as Record<string, unknown>;
  const name =
    typeof row.name === "string" && row.name.trim()
      ? row.name.trim()
      : "";
  if (!name) {
    return undefined;
  }
  let id =
    typeof row.id === "string" && row.id.trim()
      ? sanitizeMcpServerId(row.id)
      : slugifyMcpServerId(name);
  if (!id || reservedIds.has(id)) {
    id = slugifyMcpServerId(`${name}-${Date.now().toString(36)}`);
  }
  const transport = row.transport === "http" ? "http" : "stdio";
  const cfg: McpServerConfig = {
    id,
    name,
    enabled: row.enabled !== false,
    transport,
  };
  if (transport === "http") {
    const url = typeof row.url === "string" ? row.url.trim() : "";
    if (!url) {
      return undefined;
    }
    cfg.url = url;
  } else {
    const command = typeof row.command === "string" ? row.command.trim() : "";
    if (!command) {
      return undefined;
    }
    cfg.command = command;
    cfg.args = asStringArray(row.args);
    cfg.env = asStringRecord(row.env);
    if (typeof row.cwd === "string" && row.cwd.trim()) {
      cfg.cwd = row.cwd.trim();
    }
  }
  return cfg;
}

export function readMcpServerConfigs(): McpServerConfig[] {
  const cfg = vscode.workspace.getConfiguration("agentPanel");
  const raw = cfg.get<unknown>("mcp.servers");
  const list = Array.isArray(raw) ? raw : [];
  const out: McpServerConfig[] = [];
  const seen = new Set<string>(["figma"]);
  for (const item of list) {
    const normalized = normalizeMcpServerConfig(item, seen);
    if (!normalized || seen.has(normalized.id)) {
      continue;
    }
    seen.add(normalized.id);
    out.push(normalized);
  }
  return out;
}

export async function writeMcpServerConfigs(
  servers: McpServerConfig[]
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("agentPanel");
  const payload = servers.map((s) => {
    const row: Record<string, unknown> = {
      id: s.id,
      name: s.name,
      enabled: s.enabled !== false,
      transport: s.transport,
    };
    if (s.transport === "http") {
      row.url = s.url || "";
    } else {
      row.command = s.command || "";
      row.args = s.args || [];
      row.env = s.env || {};
      if (s.cwd) {
        row.cwd = s.cwd;
      }
    }
    return row;
  });
  await cfg.update(
    CONFIG_KEY,
    payload,
    vscode.ConfigurationTarget.Global
  );
}

export async function getServerBearerToken(
  secrets: vscode.SecretStorage,
  serverId: string
): Promise<string | undefined> {
  const value = await secrets.get(`${SECRET_TOKEN_PREFIX}${serverId}`);
  return value?.trim() || undefined;
}

export async function setServerBearerToken(
  secrets: vscode.SecretStorage,
  serverId: string,
  token: string
): Promise<void> {
  const key = `${SECRET_TOKEN_PREFIX}${serverId}`;
  const trimmed = token.trim();
  if (!trimmed) {
    try {
      await secrets.delete(key);
    } catch {
      // ignore
    }
    return;
  }
  await secrets.store(key, trimmed);
}

export async function getServerSecretEnv(
  secrets: vscode.SecretStorage,
  serverId: string
): Promise<Record<string, string>> {
  const raw = await secrets.get(`${SECRET_ENV_PREFIX}${serverId}`);
  if (!raw) {
    return {};
  }
  try {
    return asStringRecord(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function setServerSecretEnv(
  secrets: vscode.SecretStorage,
  serverId: string,
  env: Record<string, string>
): Promise<void> {
  const key = `${SECRET_ENV_PREFIX}${serverId}`;
  const cleaned = asStringRecord(env);
  if (!Object.keys(cleaned).length) {
    try {
      await secrets.delete(key);
    } catch {
      // ignore
    }
    return;
  }
  await secrets.store(key, JSON.stringify(cleaned));
}

export async function deleteServerSecrets(
  secrets: vscode.SecretStorage,
  serverId: string
): Promise<void> {
  try {
    await secrets.delete(`${SECRET_TOKEN_PREFIX}${serverId}`);
  } catch {
    // ignore
  }
  try {
    await secrets.delete(`${SECRET_ENV_PREFIX}${serverId}`);
  } catch {
    // ignore
  }
}

/** Parse "KEY=value" lines into a record. */
export function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) {
      out[key] = value;
    }
  }
  return out;
}

export function envToLines(env: Record<string, string> | undefined): string {
  if (!env) {
    return "";
  }
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

export function parseArgsInput(text: string): string[] {
  const raw = String(text || "").trim();
  if (!raw) {
    return [];
  }
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return asStringArray(parsed);
    } catch {
      // fall through
    }
  }
  return raw.split(/\s+/).filter(Boolean);
}
