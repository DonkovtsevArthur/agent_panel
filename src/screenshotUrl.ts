/**
 * Headless page screenshot + visible text for http(s) URLs.
 * Uses playwright-core with a system Chromium-based browser
 * (Chrome / Edge / Arc / Brave / Chromium) — no bundled browser in the VSIX.
 * vscode-free so unit tests can import helpers without the VS Code module.
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync, readdirSync } from "fs";
import * as os from "os";
import * as path from "path";
import type { SplitMcpToolResult } from "./mcp/resultFormat";

export const SCREENSHOT_URL_TEXT_MAX = 12_000;
export const SCREENSHOT_URL_DEFAULT_TIMEOUT_MS = 25_000;
export const SCREENSHOT_URL_VIEWPORT = { width: 1280, height: 800 } as const;

/** Where Playwright downloads Chromium on first use (not inside the VSIX). */
export function playwrightBrowsersDir(homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".harbor-agents", "ms-playwright");
}

/** Playwright channel names tried first (when installed). */
export const SCREENSHOT_BROWSER_CHANNELS = [
  "chrome",
  "msedge",
  "chromium",
] as const;

export type ScreenshotBrowserChannel =
  (typeof SCREENSHOT_BROWSER_CHANNELS)[number];

const FIGMA_HOST_RE = /(?:^|\.)figma\.com$/i;

/** macOS / Linux / Windows paths for Chromium-family browsers (incl. Arc/Brave). */
export function listSystemBrowserExecutablePaths(
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir()
): string[] {
  if (platform === "darwin") {
    // Prefer browsers that support Chromium headless well.
    // Arc is omitted: it often fails headless ("browser has been closed").
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      path.join(
        homeDir,
        "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      ),
    ];
  }
  if (platform === "win32") {
    const local = process.env.LOCALAPPDATA || "";
    const pf = process.env.PROGRAMFILES || "C:\\Program Files";
    const pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    return [
      path.join(pf, "Google/Chrome/Application/chrome.exe"),
      path.join(pf86, "Google/Chrome/Application/chrome.exe"),
      path.join(local, "Google/Chrome/Application/chrome.exe"),
      path.join(pf, "Microsoft/Edge/Application/msedge.exe"),
      path.join(pf86, "Microsoft/Edge/Application/msedge.exe"),
      path.join(local, "BraveSoftware/Brave-Browser/Application/brave.exe"),
    ];
  }
  // linux
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/usr/bin/brave-browser",
    "/snap/bin/chromium",
  ];
}

export function resolveExistingBrowserExecutable(
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir(),
  exists: (p: string) => boolean = existsSync
): string | undefined {
  for (const candidate of listSystemBrowserExecutablePaths(platform, homeDir)) {
    if (exists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Locate Playwright-managed Chromium under browsersDir
 * (…/chromium-NNNN/chrome-mac-arm64/Google Chrome for Testing.app/…).
 */
export function resolveManagedChromiumExecutable(
  browsersDir: string = playwrightBrowsersDir(),
  exists: (p: string) => boolean = existsSync
): string | undefined {
  if (!exists(browsersDir)) {
    return undefined;
  }
  let entries: string[] = [];
  try {
    entries = readdirSync(browsersDir);
  } catch {
    return undefined;
  }
  const chromiumDirs = entries
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort()
    .reverse();
  for (const dir of chromiumDirs) {
    const root = path.join(browsersDir, dir);
    const candidates = [
      path.join(
        root,
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
      ),
      path.join(
        root,
        "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
      ),
      path.join(root, "chrome-linux/chrome"),
      path.join(root, "chrome-linux64/chrome"),
      path.join(root, "chrome-win64/chrome.exe"),
      path.join(root, "chrome-win/chrome.exe"),
    ];
    for (const candidate of candidates) {
      if (exists(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

export function parseScreenshotHttpUrl(raw: string): URL {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    throw new Error("Пустой URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Некорректный URL");
  }
  const scheme = parsed.protocol.replace(":", "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    throw new Error("Разрешены только http и https");
  }
  return parsed;
}

/** Figma designs need MCP get_screenshot / get_design_context, not a browser SPA shell. */
export function isFigmaDesignUrl(url: string | URL): boolean {
  try {
    const host = (typeof url === "string" ? new URL(url) : url).hostname;
    return FIGMA_HOST_RE.test(host);
  } catch {
    return /figma\.com/i.test(String(url || ""));
  }
}

export function formatScreenshotUrlToolText(payload: {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  note?: string;
}): string {
  const body = String(payload.text || "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, SCREENSHOT_URL_TEXT_MAX);
  const lines = [
    `ok: true`,
    `url: ${payload.url}`,
    `finalUrl: ${payload.finalUrl}`,
    `title: ${payload.title || "(none)"}`,
    payload.note ? `note: ${payload.note}` : "",
    "",
    "## Visible page text (after JS render)",
    body || "(empty — page may require login or block headless browsers)",
  ].filter((line, index, all) => !(line === "" && all[index - 1] === ""));
  return lines.join("\n");
}

export function formatScreenshotUrlError(message: string, url?: string): string {
  return JSON.stringify({
    ok: false,
    url: url || undefined,
    error: message,
    note:
      "screenshot_url needs a headless Chromium browser. " +
      "Install Google Chrome / Microsoft Edge / Brave, or allow Harbor to download Playwright Chromium into ~/.harbor-agents/ms-playwright on first use. " +
      "For figma.com use Figma MCP (get_design_context + get_screenshot). " +
      "For plain HTML/metadata without a screenshot, use fetch_url.",
  });
}

let chromiumInstallPromise: Promise<void> | null = null;

/** Download Playwright Chromium once into ~/.harbor-agents/ms-playwright. */
export async function ensurePlaywrightChromiumInstalled(options?: {
  browsersDir?: string;
  cliPath?: string;
}): Promise<void> {
  const browsersDir = options?.browsersDir || playwrightBrowsersDir();
  mkdirSync(browsersDir, { recursive: true });
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersDir;

  if (!chromiumInstallPromise) {
    const cli =
      options?.cliPath ||
      path.join(
        path.dirname(require.resolve("playwright-core/package.json")),
        "cli.js"
      );
    chromiumInstallPromise = new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [cli, "install", "chromium"], {
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersDir },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `playwright install chromium failed (exit ${code}): ${stderr.slice(0, 500)}`
            )
          );
        }
      });
    }).finally(() => {
      // Allow a later retry if install failed.
    });
  }
  try {
    await chromiumInstallPromise;
  } catch (error) {
    chromiumInstallPromise = null;
    throw error;
  }
}

type PlaywrightBrowser = {
  newContext: (opts?: {
    viewport?: { width: number; height: number };
  }) => Promise<{
    newPage: () => Promise<{
      setDefaultTimeout: (ms: number) => void;
      goto: (
        url: string,
        opts?: { waitUntil?: string; timeout?: number }
      ) => Promise<unknown>;
      title: () => Promise<string>;
      evaluate: (fn: string | (() => unknown)) => Promise<unknown>;
      screenshot: (opts?: {
        type?: string;
        fullPage?: boolean;
      }) => Promise<Buffer>;
      url: () => string;
      close: () => Promise<void>;
    }>;
    close: () => Promise<void>;
  }>;
  close: () => Promise<void>;
};

/**
 * Open url in a headless system browser, capture PNG + visible text.
 * Returns the same shape as MCP screenshot tools so the agent loop can
 * deliver pixels via pendingVisionImageUrls / vision helper.
 */
export async function captureUrlScreenshot(options: {
  url: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<SplitMcpToolResult> {
  if (options.signal?.aborted) {
    return {
      text: formatScreenshotUrlError("Aborted"),
      imageDataUrls: [],
    };
  }

  let parsed: URL;
  try {
    parsed = parseScreenshotHttpUrl(options.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      text: formatScreenshotUrlError(message),
      imageDataUrls: [],
    };
  }

  if (isFigmaDesignUrl(parsed)) {
    return {
      text: formatScreenshotUrlError(
        "figma.com designs: use Figma MCP get_design_context + get_screenshot (not screenshot_url). screenshot_url only renders a login/SPA shell for Figma.",
        parsed.toString()
      ),
      imageDataUrls: [],
    };
  }

  const timeoutMs =
    typeof options.timeoutMs === "number" &&
    Number.isFinite(options.timeoutMs) &&
    options.timeoutMs > 0
      ? Math.min(options.timeoutMs, 60_000)
      : SCREENSHOT_URL_DEFAULT_TIMEOUT_MS;

  // Pin browsers dir BEFORE requiring playwright-core — the package reads
  // PLAYWRIGHT_BROWSERS_PATH at load time. Channel launches (system Chrome)
  // still use the OS browser; managed Chromium uses this cache.
  const browsersDir = playwrightBrowsersDir();
  mkdirSync(browsersDir, { recursive: true });
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersDir;

  // Lazy require so the extension activates without loading playwright until
  // the tool is actually called.
  let chromium: {
    launch: (opts: {
      channel?: string;
      executablePath?: string;
      headless?: boolean;
    }) => Promise<PlaywrightBrowser>;
  };
  try {
    // Clear require cache if an earlier import locked a different browsers path
    // (e.g. Cursor sandbox PLAYWRIGHT_BROWSERS_PATH).
    try {
      const resolved = require.resolve("playwright-core");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      delete require.cache[resolved];
    } catch {
      // ignore
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pw = require("playwright-core") as {
      chromium: typeof chromium;
    };
    chromium = pw.chromium;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      text: formatScreenshotUrlError(
        `playwright-core is not available: ${message}`,
        parsed.toString()
      ),
      imageDataUrls: [],
    };
  }

  type LaunchAttempt =
    | { kind: "channel"; channel: ScreenshotBrowserChannel }
    | { kind: "executable"; executablePath: string }
    | { kind: "managed" };

  const attempts: LaunchAttempt[] = SCREENSHOT_BROWSER_CHANNELS.map(
    (channel) => ({ kind: "channel" as const, channel })
  );
  const executable = resolveExistingBrowserExecutable();
  if (executable) {
    attempts.push({ kind: "executable", executablePath: executable });
  }
  // Last resort: Playwright-managed Chromium in ~/.harbor-agents/ms-playwright
  // (downloaded on first use if missing).
  attempts.push({ kind: "managed" });

  const runWithBrowser = async (
    browser: PlaywrightBrowser
  ): Promise<SplitMcpToolResult> => {
    const context = await browser.newContext({
      viewport: { ...SCREENSHOT_URL_VIEWPORT },
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(timeoutMs);
      // Prefer networkidle for SPAs; fall back to domcontentloaded on timeout.
      try {
        await page.goto(parsed.toString(), {
          waitUntil: "networkidle",
          timeout: timeoutMs,
        });
      } catch {
        await page.goto(parsed.toString(), {
          waitUntil: "domcontentloaded",
          timeout: timeoutMs,
        });
      }

      const title = String((await page.title()) || "").trim();
      // Pass evaluate source as a string so tsc does not need DOM lib types.
      const visibleText = String(
        (await page.evaluate(
          "(document.body || document.documentElement)?.innerText || \"\""
        )) || ""
      ).trim();
      const finalUrl = String(page.url() || parsed.toString());
      const png = await page.screenshot({
        type: "png",
        fullPage: false,
      });

      const base64 = Buffer.isBuffer(png)
        ? png.toString("base64")
        : Buffer.from(png as ArrayBuffer).toString("base64");
      const dataUrl = `data:image/png;base64,${base64}`;
      const text = formatScreenshotUrlToolText({
        url: parsed.toString(),
        finalUrl,
        title,
        text: visibleText,
        note:
          "Rendered with a headless browser. A PNG screenshot is attached for vision. " +
          "Use both the visible text below AND the screenshot for layout, colors, and labels. " +
          "For figma.com use Figma MCP instead.",
      });
      return { text, imageDataUrls: [dataUrl] };
    } finally {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  };

  let lastLaunchError = "";
  for (const attempt of attempts) {
    if (options.signal?.aborted) {
      return {
        text: formatScreenshotUrlError("Aborted", parsed.toString()),
        imageDataUrls: [],
      };
    }
    try {
      if (attempt.kind === "managed") {
        process.env.PLAYWRIGHT_BROWSERS_PATH = browsersDir;
        let executablePath = resolveManagedChromiumExecutable(browsersDir);
        if (!executablePath) {
          await ensurePlaywrightChromiumInstalled({ browsersDir });
          if (options.signal?.aborted) {
            return {
              text: formatScreenshotUrlError("Aborted", parsed.toString()),
              imageDataUrls: [],
            };
          }
          executablePath = resolveManagedChromiumExecutable(browsersDir);
        }
        if (!executablePath) {
          throw new Error(
            `Managed Chromium not found under ${browsersDir} after install`
          );
        }
        // Launch by absolute path — ignores ambient PLAYWRIGHT_BROWSERS_PATH
        // (e.g. Cursor sandbox cache) that would otherwise break managed mode.
        const browser = await chromium.launch({
          executablePath,
          headless: true,
        });
        return await runWithBrowser(browser);
      }

      const browser = await chromium.launch({
        ...(attempt.kind === "channel"
          ? { channel: attempt.channel }
          : { executablePath: attempt.executablePath }),
        headless: true,
      });
      return await runWithBrowser(browser);
    } catch (error) {
      lastLaunchError =
        error instanceof Error ? error.message : String(error || "");
      // Try next launch attempt (browser not installed / launch failed).
      continue;
    }
  }

  return {
    text: formatScreenshotUrlError(
      lastLaunchError
        ? `Could not launch a browser (${lastLaunchError}). Tried Playwright channels (${SCREENSHOT_BROWSER_CHANNELS.join(", ")}), system Chrome/Edge/Brave paths, and managed Chromium under ~/.harbor-agents/ms-playwright.`
        : `Could not launch a browser. Tried Playwright channels (${SCREENSHOT_BROWSER_CHANNELS.join(", ")}), system Chrome/Edge/Brave paths, and managed Chromium under ~/.harbor-agents/ms-playwright.`,
      parsed.toString()
    ),
    imageDataUrls: [],
  };
}
