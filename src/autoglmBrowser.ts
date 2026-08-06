/**
 * AutoGLM browser_task — spawn `autoglm run`, poll processing/result files.
 * vscode-free helpers are unit-tested; spawn uses Node child_process.
 */
import { spawn } from "child_process";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";

export const AUTOGLM_CONFIG_DIR = path.join(
  os.homedir(),
  ".openclaw-autoclaw"
);
export const AUTOGLM_CONFIG_PATH = path.join(AUTOGLM_CONFIG_DIR, "config.json");

export const AUTOGLM_CHROME_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/autoglm/jelniggicmclhfgnlapbkgfibmgelfnp";
export const AUTOGLM_EDGE_EXTENSION_URL =
  "https://microsoftedge.microsoft.com/addons/detail/autoglm/ljlnbmmmgnflklegiafalpieckpihffn";

export const AUTOGLM_BROWSER_HINT =
  "AutoGLM browser_task is enabled (Settings → Browser agent). " +
  "Use browser_task ONCE per turn for multi-step work in the user's real Chrome/Edge " +
  "(shopping, login flows, search across sites, forms). Pass the user's task mostly verbatim; optional startUrl. " +
  "Use headless browser_navigate / browser_snapshot / browser_click for localhost or short UI checks. " +
  "If browser_task returns config_required or extension timeout, tell the user to install the AutoGLM extension " +
  `(Chrome: ${AUTOGLM_CHROME_EXTENSION_URL} · Edge: ${AUTOGLM_EDGE_EXTENSION_URL}) ` +
  "and confirm Settings → Browser agent (enabled, browser, auto-approve).";

export type AutoglmBrowserKind = "chrome" | "edge";

export type AutoglmTaskStatus =
  | "ok"
  | "failed"
  | "config_required"
  | "timeout"
  | "aborted"
  | "error";

export type AutoglmTaskResult = {
  ok: boolean;
  status: AutoglmTaskStatus;
  summary: string;
  processingPath?: string;
  resultPath?: string;
  screenshotPath?: string;
  configPrompts?: string;
  extensionInstall?: {
    chrome: string;
    edge: string;
  };
  error?: string;
};

const DEFAULT_TIMEOUT_MS = 1_800_000; // 30 min (matches autoglm default --timeout 1800)
const DEFAULT_POLL_MS = 3_000;

/** Expand ~/ and resolve absolute path. */
export function expandHomePath(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed === "~") {
    return os.homedir();
  }
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function isExecutableFile(filePath: string): boolean {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) {
      return false;
    }
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve AutoGLM binary: Settings path → PATH candidates → skill dist fallbacks.
 */
export function resolveAutoglmBinary(
  configuredPath?: string,
  pathEnv?: string,
  homeDir?: string
): string | null {
  const home = homeDir || os.homedir();
  const configured = expandHomePath(configuredPath || "");
  if (configured && isExecutableFile(configured)) {
    return configured;
  }

  const pathDirs = String(pathEnv ?? process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  for (const dir of pathDirs) {
    for (const name of ["autoglm", "autoglm-browser-service"]) {
      const candidate = path.join(dir, name);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }

  const fallbacks = [
    path.join(
      home,
      ".agents",
      "skills",
      "autoglm-browser-agent",
      "dist",
      "autoglm-browser-service"
    ),
    path.join(
      home,
      ".cursor",
      "skills",
      "autoglm-browser-agent",
      "dist",
      "autoglm-browser-service"
    ),
    path.join(home, ".local", "bin", "autoglm"),
  ];
  for (const candidate of fallbacks) {
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** Parse stdout for processing-file path. */
export function extractProcessingFilePath(stdout: string): string | null {
  const text = String(stdout || "");
  const labeled = text.match(
    /Processing file:\s*([^\s\n]+task_processing\.md)/i
  );
  if (labeled?.[1]) {
    return expandHomePath(labeled[1].trim());
  }
  const anyPath = text.match(
    /(\S+\/sessions\/[^\s\n]+\/task_processing\.md)/
  );
  if (anyPath?.[1]) {
    return expandHomePath(anyPath[1].trim());
  }
  return null;
}

export function processingToResultPath(processingPath: string): string {
  return String(processingPath || "").replace(
    /task_processing\.md$/i,
    "task_result.md"
  );
}

export function parseAutoglmProcessingStatus(content: string): {
  completed: boolean;
  failed: boolean;
  configRequired: boolean;
} {
  const text = String(content || "");
  return {
    completed: /\[completed\]/i.test(text),
    failed: /\[failed\]/i.test(text),
    configRequired: /\[config_required\]/i.test(text),
  };
}

/** Last image-looking path in result markdown. */
export function extractScreenshotPathFromResult(content: string): string | undefined {
  const text = String(content || "");
  const matches = [
    ...text.matchAll(
      /((?:\/|~\/)[^\s)`"']+\.(?:png|jpe?g|webp))/gi
    ),
  ];
  if (!matches.length) {
    return undefined;
  }
  return expandHomePath(matches[matches.length - 1][1]);
}

export function summarizeAutoglmResult(content: string, maxChars = 8_000): string {
  const text = String(content || "").trim();
  if (!text) {
    return "(empty AutoGLM result)";
  }
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n…[truncated]`;
}

export function looksLikeExtensionTimeout(text: string): boolean {
  return /extension (did not connect|connection timeout)|failed to initialize browser/i.test(
    String(text || "")
  );
}

export type OpenclawAutoglmConfig = {
  browser?: AutoglmBrowserKind;
  auto_approve?: boolean;
  extension_confirmed?: boolean;
};

export async function readOpenclawAutoglmConfig(): Promise<OpenclawAutoglmConfig> {
  try {
    const raw = await fsPromises.readFile(AUTOGLM_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: OpenclawAutoglmConfig = {};
    if (parsed.browser === "chrome" || parsed.browser === "edge") {
      out.browser = parsed.browser;
    }
    if (typeof parsed.auto_approve === "boolean") {
      out.auto_approve = parsed.auto_approve;
    }
    if (typeof parsed.extension_confirmed === "boolean") {
      out.extension_confirmed = parsed.extension_confirmed;
    }
    return out;
  } catch {
    return {};
  }
}

/** Merge fields into ~/.openclaw-autoclaw/config.json (create dir/file if needed). */
export async function mergeOpenclawAutoglmConfig(
  partial: OpenclawAutoglmConfig
): Promise<OpenclawAutoglmConfig> {
  const current = await readOpenclawAutoglmConfig();
  const next: OpenclawAutoglmConfig = { ...current };
  if (partial.browser === "chrome" || partial.browser === "edge") {
    next.browser = partial.browser;
  }
  if (typeof partial.auto_approve === "boolean") {
    next.auto_approve = partial.auto_approve;
  }
  if (typeof partial.extension_confirmed === "boolean") {
    next.extension_confirmed = partial.extension_confirmed;
  }
  await fsPromises.mkdir(AUTOGLM_CONFIG_DIR, { recursive: true });
  await fsPromises.writeFile(
    AUTOGLM_CONFIG_PATH,
    `${JSON.stringify(next, null, 2)}\n`,
    "utf8"
  );
  return next;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await fsPromises.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Run AutoGLM once: spawn CLI, discover processing file, poll until done.
 */
export async function runAutoglmBrowserTask(options: {
  task: string;
  startUrl?: string;
  binaryPath?: string;
  browser?: AutoglmBrowserKind;
  autoApprove?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<AutoglmTaskResult> {
  const task = String(options.task || "").trim();
  if (!task) {
    return {
      ok: false,
      status: "error",
      summary: "browser_task requires a non-empty task",
      error: "browser_task requires a non-empty task",
    };
  }
  // Autoglm rejects double quotes inside --task.
  const safeTask = task.replace(/"/g, "'");

  const binary = resolveAutoglmBinary(options.binaryPath);
  if (!binary) {
    return {
      ok: false,
      status: "error",
      summary:
        "AutoGLM binary not found. Install autoglm (or set Settings → Browser agent → Binary path). " +
        "Expected `autoglm` on PATH or ~/.agents/skills/autoglm-browser-agent/dist/autoglm-browser-service.",
      error: "autoglm binary not found",
      extensionInstall: {
        chrome: AUTOGLM_CHROME_EXTENSION_URL,
        edge: AUTOGLM_EDGE_EXTENSION_URL,
      },
    };
  }

  if (options.signal?.aborted) {
    return {
      ok: false,
      status: "aborted",
      summary: "browser_task aborted before start",
      error: "aborted",
    };
  }

  const args = ["run", "--task", safeTask];
  const startUrl = String(options.startUrl || "").trim();
  if (startUrl) {
    args.push("--start-url", startUrl);
  }
  if (options.browser === "chrome" || options.browser === "edge") {
    args.push("--browser", options.browser);
  }
  if (typeof options.autoApprove === "boolean") {
    args.push("--auto-approve", options.autoApprove ? "true" : "false");
  }

  const timeoutMs = Math.max(
    60_000,
    Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  );
  const pollMs = Math.max(
    1_000,
    Math.floor(options.pollIntervalMs ?? DEFAULT_POLL_MS)
  );

  let stdout = "";
  let stderr = "";
  let childExited = false;
  let exitCode: number | null = null;

  const child = spawn(binary, args, {
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk: Buffer | string) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += String(chunk);
  });
  child.on("exit", (code) => {
    childExited = true;
    exitCode = typeof code === "number" ? code : null;
  });

  const killChild = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  };

  const onAbort = () => killChild();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const started = Date.now();
  let processingPath: string | null = null;

  try {
    // Wait briefly for the processing-file path on stdout.
    while (!processingPath && Date.now() - started < 60_000) {
      if (options.signal?.aborted) {
        throw new Error("aborted");
      }
      processingPath = extractProcessingFilePath(stdout + "\n" + stderr);
      if (processingPath) {
        break;
      }
      if (childExited) {
        break;
      }
      await sleep(500, options.signal);
    }

    // Fallback: newest session task_processing.md
    if (!processingPath) {
      processingPath = await findNewestProcessingFile();
    }

    if (!processingPath) {
      const combined = `${stdout}\n${stderr}`.trim();
      if (/\[config_required\]/i.test(combined)) {
        const configText =
          (await readTextIfExists(
            path.join(AUTOGLM_CONFIG_DIR, "browser_result_config_required.md")
          )) || combined;
        return {
          ok: false,
          status: "config_required",
          summary: summarizeAutoglmResult(configText),
          configPrompts: configText,
          extensionInstall: {
            chrome: AUTOGLM_CHROME_EXTENSION_URL,
            edge: AUTOGLM_EDGE_EXTENSION_URL,
          },
        };
      }
      return {
        ok: false,
        status: "error",
        summary:
          combined ||
          "AutoGLM did not report a processing file. Is the service installed?",
        error: "no processing file",
        extensionInstall: {
          chrome: AUTOGLM_CHROME_EXTENSION_URL,
          edge: AUTOGLM_EDGE_EXTENSION_URL,
        },
      };
    }

    const resultPath = processingToResultPath(processingPath);

    while (Date.now() - started < timeoutMs) {
      if (options.signal?.aborted) {
        throw new Error("aborted");
      }
      const processing = (await readTextIfExists(processingPath)) || "";
      const status = parseAutoglmProcessingStatus(processing);

      if (status.configRequired || /\[config_required\]/i.test(processing)) {
        const configText =
          (await readTextIfExists(
            path.join(AUTOGLM_CONFIG_DIR, "browser_result_config_required.md")
          )) || processing;
        killChild();
        return {
          ok: false,
          status: "config_required",
          summary: summarizeAutoglmResult(configText),
          processingPath,
          resultPath,
          configPrompts: configText,
          extensionInstall: {
            chrome: AUTOGLM_CHROME_EXTENSION_URL,
            edge: AUTOGLM_EDGE_EXTENSION_URL,
          },
        };
      }

      if (status.completed || status.failed || childExited) {
        const resultText =
          (await readTextIfExists(resultPath)) ||
          processing ||
          `${stdout}\n${stderr}`.trim();
        if (
          status.configRequired ||
          /\[config_required\]/i.test(resultText)
        ) {
          return {
            ok: false,
            status: "config_required",
            summary: summarizeAutoglmResult(resultText),
            processingPath,
            resultPath,
            configPrompts: resultText,
            extensionInstall: {
              chrome: AUTOGLM_CHROME_EXTENSION_URL,
              edge: AUTOGLM_EDGE_EXTENSION_URL,
            },
          };
        }
        if (
          status.failed ||
          /\[failed\]/i.test(resultText) ||
          /任务执行失败|task (execution )?failed/i.test(resultText)
        ) {
          const ext = looksLikeExtensionTimeout(resultText + processing);
          return {
            ok: false,
            status: "failed",
            summary: summarizeAutoglmResult(resultText),
            processingPath,
            resultPath,
            screenshotPath: extractScreenshotPathFromResult(resultText),
            error: ext
              ? "Extension connection timeout — install/enable AutoGLM browser extension"
              : "AutoGLM task failed",
            extensionInstall: ext
              ? {
                  chrome: AUTOGLM_CHROME_EXTENSION_URL,
                  edge: AUTOGLM_EDGE_EXTENSION_URL,
                }
              : undefined,
          };
        }
        return {
          ok: true,
          status: "ok",
          summary: summarizeAutoglmResult(resultText),
          processingPath,
          resultPath,
          screenshotPath: extractScreenshotPathFromResult(resultText),
        };
      }

      await sleep(pollMs, options.signal);
    }

    killChild();
    const partial =
      (await readTextIfExists(resultPath)) ||
      (await readTextIfExists(processingPath)) ||
      "";
    return {
      ok: false,
      status: "timeout",
      summary:
        summarizeAutoglmResult(partial) ||
        `browser_task timed out after ${Math.round(timeoutMs / 1000)}s`,
      processingPath,
      resultPath,
      error: "timeout",
    };
  } catch (error) {
    killChild();
    const message = error instanceof Error ? error.message : String(error);
    if (message === "aborted" || options.signal?.aborted) {
      return {
        ok: false,
        status: "aborted",
        summary: "browser_task aborted",
        processingPath: processingPath || undefined,
        error: "aborted",
      };
    }
    return {
      ok: false,
      status: "error",
      summary: message,
      error: message,
      processingPath: processingPath || undefined,
    };
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    if (!childExited) {
      killChild();
    }
    void exitCode;
  }
}

async function findNewestProcessingFile(): Promise<string | null> {
  const sessionsDir = path.join(AUTOGLM_CONFIG_DIR, "sessions");
  let entries: string[] = [];
  try {
    entries = await fsPromises.readdir(sessionsDir);
  } catch {
    return null;
  }
  let best: { path: string; mtime: number } | null = null;
  for (const id of entries) {
    const candidate = path.join(sessionsDir, id, "task_processing.md");
    try {
      const st = await fsPromises.stat(candidate);
      if (!best || st.mtimeMs > best.mtime) {
        best = { path: candidate, mtime: st.mtimeMs };
      }
    } catch {
      // skip
    }
  }
  // Only accept very recent files (last 2 minutes).
  if (best && Date.now() - best.mtime < 120_000) {
    return best.path;
  }
  return null;
}
