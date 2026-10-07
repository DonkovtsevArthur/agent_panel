/**
 * "URL + token and it works": pre-flight for the Jira (mcp-atlassian) MCP
 * server, run in Node before the Python process starts.
 *
 * - finds `uvx` outside the GUI PATH (~/.local/bin, Homebrew, …);
 * - probes `GET /rest/api/2/myself` with the PAT, trusting only the public
 *   roots Python ships with (certifi ≈ Node's bundled roots);
 * - on an untrusted corporate certificate exports the OS trust store into
 *   ~/.harbor/ca-bundle.pem and points REQUESTS_CA_BUNDLE / SSL_CERT_FILE at it;
 * - when the system resolver returns a wrong / public endpoint (VPN DNS
 *   bypassed by fallback 8.8.8.8), asks the private (VPN) nameservers and pins
 *   the host for the Python process via a tiny sitecustomize shim
 *   (HARBOR_HOST_OVERRIDES) — TLS still validates against the real hostname.
 *
 * Results are runtime-only env: never stored in settings or written to
 * AGENTS.md / shared MCP configs. vscode-free so tests can import it.
 */

import { execFile } from "child_process";
import { createHash } from "crypto";
import * as dns from "dns";
import * as fs from "fs";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import * as tls from "tls";

const PROBE_TIMEOUT_MS = 8_000;
const HARBOR_DIR = path.join(os.homedir(), ".harbor");
export const JIRA_CA_BUNDLE_PATH = path.join(HARBOR_DIR, "ca-bundle.pem");
const PYTHON_SHIM_DIR = path.join(HARBOR_DIR, "python-shim");

export interface JiraPreflightResult {
  ok: boolean;
  /** User-facing error (Russian + English hint) when ok=false. */
  error?: string;
  /** Resolved command (absolute uvx path when it is not on PATH). */
  command?: string;
  /** Runtime env for the MCP process (CA bundle, host pin, shim). */
  env: Record<string, string>;
  /** Jira display name from /myself. */
  user?: string;
  caBundle?: boolean;
  /** Jira's certificate is not trusted by public roots (corporate CA). */
  corporateCa?: boolean;
  hostOverride?: { host: string; ip: string };
  /** CAs that validated Jira (for the built-in REST client). */
  ca?: string | string[];
  /** VPN-DNS address to pin (built-in client), when system DNS is wrong. */
  pinIp?: string;
}

// —— uvx ——

const HARBOR_UV_BIN = path.join(HARBOR_DIR, "uv", "bin");

function windowsBinDirs(): string[] {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const roaming = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  const out = [
    path.join(home, ".local", "bin"), // official uv installer default
    path.join(home, "scoop", "shims"),
    path.join(local, "Microsoft", "WinGet", "Links"),
    path.join(local, "Programs", "uv"),
    path.join(home, ".cargo", "bin"),
  ];
  // pip install --user uv → %APPDATA%\Python\Python3xx\Scripts, python.org → %LOCALAPPDATA%\Programs\Python\Python3xx\Scripts
  for (const root of [path.join(roaming, "Python"), path.join(local, "Programs", "Python")]) {
    try {
      for (const d of fs.readdirSync(root)) {
        out.push(path.join(root, d, "Scripts"));
      }
    } catch {
      // not installed
    }
  }
  return out;
}

function candidateBinDirs(extraPath = ""): string[] {
  const home = os.homedir();
  const fromPath = `${String(process.env.PATH || "")}${path.delimiter}${extraPath}`
    .split(path.delimiter)
    .filter(Boolean);
  return [
    ...fromPath,
    ...(process.platform === "win32"
      ? windowsBinDirs()
      : [
          path.join(home, ".local", "bin"),
          path.join(home, ".cargo", "bin"),
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin",
        ]),
    HARBOR_UV_BIN,
  ];
}

/** Absolute path of `name` (uvx) or undefined. */
export function findExecutable(name: string, extraPath = ""): string | undefined {
  if (path.isAbsolute(name)) {
    return fs.existsSync(name) ? name : undefined;
  }
  const exts = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const dir of candidateBinDirs(extraPath)) {
    for (const ext of exts) {
      const full = path.join(dir, name + ext);
      try {
        if (fs.statSync(full).isFile()) {
          return full;
        }
      } catch {
        // keep looking
      }
    }
  }
  return undefined;
}

// —— OS trust store ——

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { maxBuffer: 64 * 1024 * 1024, timeout: 20_000 },
      (_err, stdout) => resolve(String(stdout || ""))
    );
  });
}

/**
 * Windows: the IDE keeps the PATH it was started with, so a uv installed
 * afterwards is invisible — read the current user + machine PATH from the
 * registry and expand %VARS%.
 */
async function windowsRegistryPath(): Promise<string> {
  if (process.platform !== "win32") {
    return "";
  }
  const keys = [
    "HKCU\\Environment",
    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
  ];
  const parts: string[] = [];
  for (const key of keys) {
    const out = await run("reg.exe", ["query", key, "/v", "Path"]);
    const m = /Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i.exec(out);
    if (m) {
      parts.push(
        m[1]
          .trim()
          .replace(/%([^%]+)%/g, (all, name: string) => process.env[name] ?? all)
      );
    }
  }
  return parts.join(path.delimiter);
}

/** Official standalone uv build for this machine (GitHub release asset). */
function uvReleaseAsset(): string | undefined {
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : "";
  if (!arch) {
    return undefined;
  }
  if (process.platform === "win32") {
    return `uv-${arch}-pc-windows-msvc.zip`;
  }
  if (process.platform === "darwin") {
    return `uv-${arch}-apple-darwin.tar.gz`;
  }
  if (process.platform === "linux") {
    return `uv-${arch}-unknown-linux-gnu.tar.gz`;
  }
  return undefined;
}

function httpsGetBuffer(url: string, ca: string | string[], redirects = 6): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent: false, ca, timeout: 60_000 }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(httpsGetBuffer(new URL(res.headers.location, url).toString(), ca, redirects - 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status} for ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`timeout downloading ${url}`)));
    req.on("error", reject);
  });
}

function findFileRecursive(dir: string, name: string): string | undefined {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) {
      return full;
    }
    if (entry.isDirectory()) {
      const hit = findFileRecursive(full, name);
      if (hit) {
        return hit;
      }
    }
  }
  return undefined;
}

/**
 * Download the official uv release into ~/.harbor/uv/bin (SHA-256 checked
 * against the release's .sha256 file). Returns the uvx path or throws.
 */
export async function installHarborUv(ca: string | string[]): Promise<string> {
  const asset = uvReleaseAsset();
  if (!asset) {
    throw new Error(`no uv build for ${process.platform}/${process.arch}`);
  }
  const base = "https://github.com/astral-sh/uv/releases/latest/download/";
  const archive = await httpsGetBuffer(base + asset, ca);
  const shaText = (await httpsGetBuffer(`${base}${asset}.sha256`, ca)).toString("utf8");
  const expected = shaText.trim().split(/\s+/)[0].toLowerCase();
  const actual = createHash("sha256").update(archive).digest("hex");
  if (!/^[0-9a-f]{64}$/.test(expected) || expected !== actual) {
    throw new Error("uv download checksum mismatch");
  }
  const work = path.join(HARBOR_DIR, "uv", `tmp-${Date.now()}`);
  fs.mkdirSync(work, { recursive: true });
  try {
    const archivePath = path.join(work, asset);
    fs.writeFileSync(archivePath, archive);
    // bsdtar ships with Windows 10+ and unpacks .zip as well.
    const tar = process.platform === "win32"
      ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")
      : "tar";
    await new Promise<void>((resolve, reject) =>
      execFile(tar, ["-xf", archivePath, "-C", work], { timeout: 60_000 }, (err) =>
        err ? reject(err) : resolve()
      )
    );
    fs.mkdirSync(HARBOR_UV_BIN, { recursive: true });
    const ext = process.platform === "win32" ? ".exe" : "";
    for (const bin of ["uv", "uvx"]) {
      const found = findFileRecursive(work, bin + ext);
      if (!found) {
        throw new Error(`${bin}${ext} not found in ${asset}`);
      }
      const dest = path.join(HARBOR_UV_BIN, bin + ext);
      fs.copyFileSync(found, dest);
      fs.chmodSync(dest, 0o755);
    }
    return path.join(HARBOR_UV_BIN, `uvx${ext}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function uvInstallHint(): string {
  if (process.platform === "win32") {
    return 'Установите uv: в PowerShell выполните powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex" (или winget install astral-sh.uv), затем «Сохранить и подключить». / Install uv (PowerShell installer or winget), then reconnect.';
  }
  if (process.platform === "darwin") {
    return "Установите uv: brew install uv (или curl -LsSf https://astral.sh/uv/install.sh | sh), затем «Сохранить и подключить». / Install uv, then reconnect.";
  }
  return "Установите uv: curl -LsSf https://astral.sh/uv/install.sh | sh, затем «Сохранить и подключить». / Install uv, then reconnect.";
}

/** Find uvx (PATH, usual install dirs, registry PATH) or install it. */
async function resolveUvx(
  command: string,
  ca: string | string[]
): Promise<{ command?: string; error?: string }> {
  const name = command || "uvx";
  const found = findExecutable(name) || findExecutable(name, await windowsRegistryPath());
  if (found) {
    return { command: found };
  }
  if (path.basename(name).replace(/\.exe$/i, "").toLowerCase() !== "uvx") {
    return { error: `Команда «${name}» не найдена. / Command "${name}" not found.` };
  }
  try {
    return { command: await installHarborUv(ca) };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      error: `Не найден uvx, и автоматически скачать uv не удалось (${msg}). ${uvInstallHint()}`,
    };
  }
}

/** Proxy env the MCP SDK's default environment drops (uv needs it for PyPI). */
function proxyEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "ALL_PROXY"]) {
    const value = process.env[key] || process.env[key.toLowerCase()];
    if (value) {
      out[key] = value;
    }
  }
  return out;
}

async function readSystemCaPem(): Promise<string> {
  if (process.platform === "darwin") {
    const keychains = [
      "/Library/Keychains/System.keychain",
      "/System/Library/Keychains/SystemRootCertificates.keychain",
      path.join(os.homedir(), "Library", "Keychains", "login.keychain-db"),
    ].filter((k) => fs.existsSync(k));
    return run("/usr/bin/security", ["find-certificate", "-a", "-p", ...keychains]);
  }
  if (process.platform === "win32") {
    const ps =
      "$s=@('Cert:\\LocalMachine\\Root','Cert:\\LocalMachine\\CA','Cert:\\CurrentUser\\Root','Cert:\\CurrentUser\\CA');" +
      "foreach($p in $s){Get-ChildItem $p -ErrorAction SilentlyContinue | ForEach-Object {" +
      "'-----BEGIN CERTIFICATE-----';[Convert]::ToBase64String($_.RawData,'InsertLineBreaks');'-----END CERTIFICATE-----'}}";
    return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps]);
  }
  for (const file of [
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/ca-bundle.pem",
    "/etc/ssl/cert.pem",
  ]) {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      // next
    }
  }
  return "";
}

const CA_BUNDLE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Node's public roots + OS trust store (corporate CAs) → ~/.harbor/ca-bundle.pem.
 * Superset of certifi, so it is always safe to hand to Python. Cached 24h.
 */
export async function exportSystemCaBundle(): Promise<string | undefined> {
  try {
    const st = fs.statSync(JIRA_CA_BUNDLE_PATH);
    if (Date.now() - st.mtimeMs < CA_BUNDLE_MAX_AGE_MS) {
      const cached = fs.readFileSync(JIRA_CA_BUNDLE_PATH, "utf8");
      if (/BEGIN CERTIFICATE/.test(cached)) {
        return cached;
      }
    }
  } catch {
    // export below
  }
  const system = await readSystemCaPem();
  if (!/BEGIN CERTIFICATE/.test(system)) {
    return undefined;
  }
  const pem = `${tls.rootCertificates.join("\n")}\n${system}`.replace(/\r\n/g, "\n");
  fs.mkdirSync(HARBOR_DIR, { recursive: true });
  fs.writeFileSync(JIRA_CA_BUNDLE_PATH, pem, "utf8");
  return pem;
}

// —— Python host pin ——

const SITECUSTOMIZE = `# Harbor Agents: pin hosts for this MCP process (HARBOR_HOST_OVERRIDES=host=ip,...).
import os as _os, socket as _socket
_map = dict(p.split("=", 1) for p in _os.environ.get("HARBOR_HOST_OVERRIDES", "").split(",") if "=" in p)
if _map:
    _orig = _socket.getaddrinfo
    def _harbor_getaddrinfo(host, *args, **kwargs):
        if isinstance(host, str) and host.lower() in _map:
            host = _map[host.lower()]
        return _orig(host, *args, **kwargs)
    _socket.getaddrinfo = _harbor_getaddrinfo
`;

function ensurePythonShim(): string {
  fs.mkdirSync(PYTHON_SHIM_DIR, { recursive: true });
  const file = path.join(PYTHON_SHIM_DIR, "sitecustomize.py");
  try {
    if (fs.readFileSync(file, "utf8") === SITECUSTOMIZE) {
      return PYTHON_SHIM_DIR;
    }
  } catch {
    // write below
  }
  fs.writeFileSync(file, SITECUSTOMIZE, "utf8");
  return PYTHON_SHIM_DIR;
}

// —— private (VPN) nameservers ——

function isPrivateIp(ip: string): boolean {
  return (
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)
  );
}

async function privateNameservers(): Promise<string[]> {
  let text = "";
  if (process.platform === "darwin") {
    text = await run("/usr/sbin/scutil", ["--dns"]);
  } else if (process.platform !== "win32") {
    try {
      text = fs.readFileSync("/etc/resolv.conf", "utf8");
    } catch {
      text = "";
    }
  }
  const found = new Set<string>();
  for (const m of text.matchAll(/nameserver(?:\[\d+\])?\s*:?\s*(\d+\.\d+\.\d+\.\d+)/g)) {
    if (isPrivateIp(m[1])) {
      found.add(m[1]);
    }
  }
  for (const s of dns.getServers()) {
    if (isPrivateIp(s)) {
      found.add(s);
    }
  }
  return [...found].slice(0, 6);
}

async function resolveViaPrivateDns(
  host: string,
  exclude: Set<string>
): Promise<{ ips: string[]; servers: number }> {
  const out: string[] = [];
  const servers = await privateNameservers();
  for (const server of servers) {
    const resolver = new dns.promises.Resolver({ timeout: 2_000, tries: 1 });
    resolver.setServers([server]);
    try {
      for (const ip of await resolver.resolve4(host)) {
        if (!exclude.has(ip) && !out.includes(ip)) {
          out.push(ip);
        }
      }
    } catch {
      // next server
    }
  }
  return { ips: out, servers: servers.length };
}

// —— probe ——

/** `lookup` for https.request that always resolves to `ip` (TLS still checks the hostname). */
export function pinnedLookup(ip: string): https.RequestOptions["lookup"] {
  return ((_h: string, opts: unknown, cb: unknown) => {
    const all = Boolean((opts as { all?: boolean })?.all);
    const done = cb as (...a: unknown[]) => void;
    if (all) {
      done(null, [{ address: ip, family: 4 }]);
    } else {
      done(null, ip, 4);
    }
  }) as unknown as https.RequestOptions["lookup"];
}

type ProbeOutcome =
  | { kind: "http"; status: number; body: string; location?: string }
  | { kind: "error"; code: string; message: string };

function probeMyself(
  baseUrl: string,
  token: string,
  ca: string | string[],
  pinIp?: string
): Promise<ProbeOutcome> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(`${baseUrl.replace(/\/+$/, "")}/rest/api/2/myself`);
    } catch {
      resolve({ kind: "error", code: "BAD_URL", message: "invalid URL" });
      return;
    }
    const lookup = pinIp ? pinnedLookup(pinIp) : undefined;
    const req = https.request(
      url,
      {
        method: "GET",
        agent: false,
        ca,
        lookup,
        servername: url.hostname,
        timeout: PROBE_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          if (chunks.length < 64) {
            chunks.push(c);
          }
        });
        res.on("end", () =>
          resolve({
            kind: "http",
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString("utf8").slice(0, 4000),
            location: String(res.headers.location || "") || undefined,
          })
        );
      }
    );
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    req.on("error", (err: NodeJS.ErrnoException) =>
      resolve({ kind: "error", code: String(err.code || "ERR"), message: err.message })
    );
    req.end();
  });
}

const UNTRUSTED_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
]);
const WRONG_SERVER_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

/** True when the response is Jira's REST API (not an SSO / proxy page). */
function isJiraApiResponse(o: ProbeOutcome): boolean {
  return o.kind === "http" && [200, 401, 403].includes(o.status);
}

function describeFailure(
  host: string,
  o: ProbeOutcome,
  ip?: string,
  vpnDns?: boolean
): string {
  if (vpnDns === false && o.kind === "error" && WRONG_SERVER_CODES.has(o.code)) {
    return `Не удаётся достучаться до внутренней Jira ${host}${ip ? ` (система ведёт на ${ip})` : ""} — похоже, VPN не подключён. Подключите VPN и нажмите «Сохранить и подключить». / Jira is reachable only from the corporate network — connect the VPN.`;
  }
  if (o.kind === "http") {
    if (o.status >= 300 && o.status < 400) {
      return `Jira (${host}) перенаправляет на страницу входа${o.location ? ` (${o.location.slice(0, 120)})` : ""} — похоже, это внешний SSO-прокси, а не Jira. Подключите VPN. / Jira redirects to a login page — connect the VPN.`;
    }
    return `Jira ответила HTTP ${o.status}. / Jira responded HTTP ${o.status}.`;
  }
  if (o.code === "ENOTFOUND" || o.code === "EAI_AGAIN") {
    return `Не удалось найти хост ${host}. Проверьте URL и VPN. / Host not found — check the URL and VPN.`;
  }
  if (o.code === "CERT_HAS_EXPIRED") {
    return `${host}${ip ? ` (${ip})` : ""} отдаёт просроченный сертификат — система обращается не к тому серверу (обычно DNS идёт мимо VPN). Подключите VPN; если не помогло — macOS: sudo mkdir -p /etc/resolver && printf "nameserver <DNS из VPN>\\n" | sudo tee /etc/resolver/${host.split(".").slice(-2).join(".")}. / Expired certificate — the system reaches the wrong server (DNS bypasses the VPN).`;
  }
  if (UNTRUSTED_CODES.has(o.code)) {
    return `Сертификат ${host} не доверенный, а корпоративный CA не найден в системном хранилище. Укажите REQUESTS_CA_BUNDLE=/путь/к/ca.pem в «Дополнительно». / Untrusted certificate and no corporate CA in the OS store.`;
  }
  return `Не удалось подключиться к ${host}: ${o.message}. Проверьте VPN. / Could not reach Jira: ${o.message}.`;
}

/**
 * Validate URL + token and compute runtime env so mcp-atlassian works
 * without the user touching certificates, DNS or PATH.
 */
export async function prepareJiraConnection(options: {
  url: string;
  token: string;
  command: string;
  /** User env already set (REQUESTS_CA_BUNDLE etc. wins over auto). */
  userEnv?: Record<string, string>;
  /** false for the built-in REST client: no uvx / Python env needed. */
  launcher?: boolean;
}): Promise<JiraPreflightResult> {
  const env: Record<string, string> = {};
  const result: JiraPreflightResult = { ok: false, env };
  const base = options.url.trim().replace(/\/+$/, "");
  let host = "";
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    result.error = "Укажите адрес Jira, например https://jira.company.ru / Enter the Jira URL.";
    return result;
  }
  if (!options.token.trim()) {
    result.error =
      "Вставьте Personal Access Token (профиль Jira → Personal Access Tokens). / Paste a Jira Personal Access Token.";
    return result;
  }

  // Python (certifi) does not see the OS store, so always hand it the
  // exported bundle; the probe uses the very same CAs.
  const userCa = options.userEnv?.REQUESTS_CA_BUNDLE || options.userEnv?.SSL_CERT_FILE;
  let ca: string | string[] = [...tls.rootCertificates];
  let caBundlePem: string | undefined;
  if (userCa && fs.existsSync(userCa)) {
    ca = [...tls.rootCertificates, fs.readFileSync(userCa, "utf8")];
  } else {
    caBundlePem = await exportSystemCaBundle();
    if (caBundlePem) {
      ca = caBundlePem;
    }
  }

  let outcome = await probeMyself(base, options.token, ca);

  let pinIp: string | undefined;
  if (!isJiraApiResponse(outcome)) {
    const firstFailure = outcome;
    let systemIps: string[] = [];
    try {
      systemIps = (await dns.promises.lookup(host, { all: true })).map((a) => a.address);
    } catch {
      systemIps = [];
    }
    const privateDns = await resolveViaPrivateDns(host, new Set(systemIps));
    const candidates = privateDns.ips;
    for (const ip of candidates) {
      const pinned = await probeMyself(base, options.token, ca, ip);
      if (isJiraApiResponse(pinned)) {
        outcome = pinned;
        pinIp = ip;
        break;
      }
    }
    if (!pinIp) {
      const wrongServer =
        firstFailure.kind === "error" && WRONG_SERVER_CODES.has(firstFailure.code);
      result.error = describeFailure(
        host,
        firstFailure,
        wrongServer ? systemIps[0] : undefined,
        privateDns.servers > 0
      );
      return result;
    }
  }

  if (outcome.kind !== "http") {
    result.error = describeFailure(host, outcome);
    return result;
  }
  if (outcome.status === 401 || outcome.status === 403) {
    result.error = `Jira не приняла токен (HTTP ${outcome.status}): он неверный или истёк. Создайте новый: ${base}/secure/ViewPersonalAccessTokens.jspa / Token rejected — create a new PAT.`;
    return result;
  }
  // Jira + token are fine — now make sure the MCP launcher exists
  // (installs a private uv into ~/.harbor/uv when none is found).
  result.ca = ca;
  result.pinIp = pinIp;
  if (options.launcher !== false) {
    const uvx = await resolveUvx(options.command || "uvx", ca);
    if (!uvx.command) {
      result.error = uvx.error;
      return result;
    }
    result.command = uvx.command;
    Object.assign(env, proxyEnv());
  }

  try {
    const me = JSON.parse(outcome.body) as { displayName?: string; name?: string };
    result.user = me.displayName || me.name;
  } catch {
    // fine — 200 is enough
  }

  if (userCa) {
    result.corporateCa = true;
  } else if (caBundlePem) {
    const publicOnly = await probeMyself(
      base,
      options.token,
      [...tls.rootCertificates],
      pinIp
    );
    result.corporateCa =
      publicOnly.kind === "error" && UNTRUSTED_CODES.has(publicOnly.code);
  }
  if (caBundlePem) {
    env.REQUESTS_CA_BUNDLE = JIRA_CA_BUNDLE_PATH;
    env.SSL_CERT_FILE = JIRA_CA_BUNDLE_PATH;
    result.caBundle = true;
  }
  if (pinIp) {
    const shim = ensurePythonShim();
    const prevPy = options.userEnv?.PYTHONPATH;
    env.PYTHONPATH = prevPy ? `${shim}${path.delimiter}${prevPy}` : shim;
    env.HARBOR_HOST_OVERRIDES = `${host}=${pinIp}`;
    result.hostOverride = { host, ip: pinIp };
  }
  result.ok = true;
  return result;
}
