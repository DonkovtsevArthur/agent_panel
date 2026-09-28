/**
 * Trust-on-first-use pin store: one PEM chain per HTTPS host under
 * ~/.harbor/certs/pinned/. Pure fs/os/path logic — no vscode import — so
 * tests and utility paths that require openaiClient keep working in plain
 * Node (see the "no top-level vscode requires" coding norm).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const pinnedCaCache = new Map<string, string>();

export function pinnedDir(): string {
  return path.join(os.homedir(), ".harbor", "certs", "pinned");
}

export function safeHostname(hostname: string): string | undefined {
  const host = hostname.toLowerCase();
  return /^[a-z0-9.-]+$/.test(host) && host.length <= 253 ? host : undefined;
}

/** Pinned CA chain (PEM) for a host, or undefined. Shared across all shells. */
export function getPinnedCaForHost(hostname: string): string | undefined {
  const host = safeHostname(hostname);
  if (!host) {
    return undefined;
  }
  if (pinnedCaCache.has(host)) {
    return pinnedCaCache.get(host) || undefined;
  }
  let pem = "";
  try {
    const raw = fs.readFileSync(path.join(pinnedDir(), `${host}.pem`), "utf8");
    if (raw.includes("BEGIN CERTIFICATE")) {
      pem = raw;
    }
  } catch {
    /* missing pin — normal */
  }
  pinnedCaCache.set(host, pem);
  return pem || undefined;
}

/** Persist a chain for the host and refresh the cache. False on write failure. */
export function savePinnedCaForHost(hostname: string, pem: string): boolean {
  const host = safeHostname(hostname);
  if (!host || !pem.includes("BEGIN CERTIFICATE")) {
    return false;
  }
  try {
    fs.mkdirSync(pinnedDir(), { recursive: true });
    fs.writeFileSync(path.join(pinnedDir(), `${host}.pem`), pem, {
      mode: 0o600,
    });
    pinnedCaCache.set(host, pem);
    return true;
  } catch {
    return false;
  }
}
