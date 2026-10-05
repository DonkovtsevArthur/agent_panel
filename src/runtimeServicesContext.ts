/**
 * `[Harbor turn context]` block: dev runtime map from repo files —
 * docker-compose services/ports and `.env` key NAMES (values never leave the
 * machine). Heuristic indentation parser (no YAML dependency). Pure fs —
 * no vscode import.
 */
import * as fs from "fs";
import * as path from "path";
import { collectFilesByGlobs } from "./globFiles";

const COMPOSE_GLOBS = [
  "docker-compose*.yml",
  "docker-compose*.yaml",
  "compose*.yml",
  "compose*.yaml",
];

/** Root-level `.env*` candidates, in display order. */
const ENV_CANDIDATES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.example",
];

const MAX_COMPOSE_FILES = 2;
const MAX_SERVICES = 20;
const MAX_PORTS_PER_SERVICE = 8;
const MAX_ENV_FILES = 3;
const MAX_KEYS_SHOWN = 40;
const ENV_READ_BYTES = 16_000;

export interface ComposeServiceInfo {
  name: string;
  image: string;
  ports: string[];
  build: boolean;
}

/**
 * Minimal docker-compose services parse: top-level `services:` block,
 * 2-space-indented service keys, `image:` / `build:` / `ports:` entries.
 * Good enough for a context map — not a YAML parser.
 */
export function parseComposeServices(text: string): ComposeServiceInfo[] {
  const lines = String(text || "").split(/\r?\n/);
  const services: ComposeServiceInfo[] = [];
  let inServices = false;
  let current: ComposeServiceInfo | null = null;
  let inPorts = false;
  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) {
      continue;
    }
    const indent = (line.match(/^\s*/) || [""])[0].length;
    if (indent === 0) {
      if (/^services:\s*$/.test(line.trim())) {
        inServices = true;
      } else if (inServices) {
        break;
      }
      continue;
    }
    if (!inServices) {
      continue;
    }
    if (indent <= 2) {
      const service = line.match(/^ {2}([\w.-]+):\s*(.*)$/);
      if (service && !service[2]) {
        if (services.length >= MAX_SERVICES) {
          break;
        }
        current = { name: service[1], image: "", ports: [], build: false };
        services.push(current);
        inPorts = false;
      }
      continue;
    }
    if (!current) {
      continue;
    }
    const listItem = line.match(/^\s*-\s*(.+)$/);
    if (listItem && inPorts && indent >= 4) {
      if (current.ports.length < MAX_PORTS_PER_SERVICE) {
        current.ports.push(listItem[1].trim().replace(/^["']|["']$/g, ""));
      }
      continue;
    }
    const kv = line.match(/^\s*(image|build|ports):\s*(.*)$/);
    if (kv) {
      inPorts = kv[1] === "ports";
      if (kv[1] === "image" && !current.image) {
        current.image = kv[2].trim().replace(/^["']|["']$/g, "");
      } else if (kv[1] === "build") {
        current.build = true;
      }
    } else if (indent > 4) {
      inPorts = false;
    }
  }
  return services;
}

/** Unique `.env` key names (values are intentionally not read). */
export function parseEnvKeyNames(text: string): string[] {
  const keys: string[] = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && !keys.includes(m[1])) {
      keys.push(m[1]);
      if (keys.length >= 80) {
        break;
      }
    }
  }
  return keys;
}

function formatServices(services: ComposeServiceInfo[]): string {
  return services
    .map((s) => {
      const bits: string[] = [];
      if (s.image) {
        bits.push(`image: ${s.image}`);
      } else if (s.build) {
        bits.push("build");
      }
      if (s.ports.length) {
        bits.push(`ports: ${s.ports.join(", ")}`);
      }
      return bits.length ? `${s.name} (${bits.join("; ")})` : s.name;
    })
    .join(", ");
}

/**
 * Build the dev runtime block. Returns "" when the workspace has neither
 * compose files nor `.env` candidates.
 */
export function buildRuntimeServicesMessage(roots: string[]): string {
  const normalizedRoots = roots
    .map((r) => String(r || "").trim())
    .filter(Boolean);
  if (!normalizedRoots.length) {
    return "";
  }
  const rows: string[] = [];

  const composeRefs = collectFilesByGlobs(
    normalizedRoots,
    COMPOSE_GLOBS,
    { maxFiles: MAX_COMPOSE_FILES, maxDepth: 2 }
  );
  for (const ref of composeRefs) {
    try {
      const text = fs.readFileSync(ref.abs, "utf8");
      const services = parseComposeServices(text);
      if (services.length) {
        rows.push(
          `- docker-compose ${ref.rel}: ${formatServices(services)}`
        );
      }
    } catch {
      /* unreadable — skip */
    }
  }

  const root = normalizedRoots[0];
  let envShown = 0;
  for (const name of ENV_CANDIDATES) {
    if (envShown >= MAX_ENV_FILES) {
      break;
    }
    const abs = path.join(root, name);
    let text: string;
    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile() || stat.size > ENV_READ_BYTES) {
        continue;
      }
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const keys = parseEnvKeyNames(text);
    if (!keys.length) {
      continue;
    }
    const shown = keys.slice(0, MAX_KEYS_SHOWN).join(", ");
    const more = keys.length > MAX_KEYS_SHOWN ? ` (+${keys.length - MAX_KEYS_SHOWN} more)` : "";
    rows.push(
      `- ${name}: ${shown}${more} — names only, values never included`
    );
    envShown += 1;
  }

  if (!rows.length) {
    return "";
  }
  return [
    "Dev runtime context (from repo files; no live connections):",
    ...rows,
  ].join("\n");
}
