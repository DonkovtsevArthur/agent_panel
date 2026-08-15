/**
 * Special `@`-mentions in the composer prompt: `@problems`, `@terminal`,
 * `@url <https://…>` (or bare `@https://…`). Unlike file `@path` mentions
 * (attachments.ts), these inject live IDE snapshots / fetched page content
 * into the Cline user turn.
 */
import * as vscode from "vscode";
import { buildTerminalSnapshotMessage } from "./terminalContext";
import { harborFetch } from "./tlsPolicy";

const PROBLEMS_MAX_ITEMS = 40;
const PROBLEMS_MESSAGE_CHARS = 200;
const URL_FETCH_CHARS = 8_000;
const URL_FETCH_TIMEOUT_MS = 20_000;
const MAX_URLS = 3;

export interface SpecialMentions {
  problems: boolean;
  terminal: boolean;
  urls: string[];
}

export function extractSpecialMentions(text: string): SpecialMentions {
  const raw = String(text || "");
  const urls: string[] = [];
  const pushUrl = (candidate: string) => {
    const url = candidate.trim().replace(/[).,;]+$/, "");
    if (
      /^https?:\/\//i.test(url) &&
      !urls.includes(url) &&
      urls.length < MAX_URLS
    ) {
      urls.push(url);
    }
  };
  // `@url https://example.com/page` and bare `@https://example.com/page`.
  const atUrl = /@(?:url\s+)?(https?:\/\/[^\s<>\"')]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = atUrl.exec(raw))) {
    pushUrl(String(match[1] || ""));
  }
  return {
    problems: /@(problems|diagnostics)\b/i.test(raw),
    terminal: /@(terminal|run)\b/i.test(raw),
    urls,
  };
}

function severityLabel(severity: number): string {
  if (severity === 0) {
    return "error";
  }
  if (severity === 1) {
    return "warning";
  }
  return "";
}

function relativeFromUri(uri: vscode.Uri): string {
  try {
    return vscode.workspace.asRelativePath(uri, false) || uri.fsPath;
  } catch {
    return uri.fsPath;
  }
}

/** All workspace errors/warnings (not limited to open editors). */
export function buildWorkspaceProblemsMessage(): string {
  let entries: Array<
    [
      vscode.Uri,
      Array<{
        severity?: number;
        message?: string;
        range?: { start?: { line?: number } };
      }>,
    ]
  > = [];
  try {
    entries = vscode.languages.getDiagnostics() || [];
  } catch {
    return "";
  }
  const rows: string[] = [];
  for (const [uri, diags] of entries) {
    if (!uri || !Array.isArray(diags) || !diags.length) {
      continue;
    }
    const rel = relativeFromUri(uri);
    for (const diag of diags) {
      const sev = severityLabel(Number(diag.severity));
      if (!sev) {
        continue;
      }
      const line =
        typeof diag.range?.start?.line === "number"
          ? diag.range.start.line + 1
          : undefined;
      const message = String(diag.message || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, PROBLEMS_MESSAGE_CHARS);
      if (!message) {
        continue;
      }
      rows.push(
        line ? `- ${rel}:${line} [${sev}] ${message}` : `- ${rel} [${sev}] ${message}`
      );
      if (rows.length >= PROBLEMS_MAX_ITEMS) {
        break;
      }
    }
    if (rows.length >= PROBLEMS_MAX_ITEMS) {
      break;
    }
  }
  if (!rows.length) {
    return "IDE problems (@problems): no errors or warnings in the workspace.";
  }
  return ["IDE problems (@problems, whole workspace):", ...rows].join("\n");
}

const HTML_ENTITY_MAP: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(nbsp|amp|lt|gt|quot|#39|apos);|&#(\d+);/g,
    (whole, named: string, code: string) => {
      if (named && HTML_ENTITY_MAP[`&${named};`]) {
        return HTML_ENTITY_MAP[`&${named};`];
      }
      if (code) {
        try {
          return String.fromCodePoint(Number(code));
        } catch {
          return whole;
        }
      }
      return whole;
    }
  );
}

/** Minimal HTML → text for fetched pages (no markdown conversion). */
export function htmlToText(html: string): string {
  return decodeEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchUrlAsText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);
  try {
    const response = await harborFetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "User-Agent":
          "Mozilla/5.0 (compatible; HarborAgents/2.0; +vscode-extension)",
      },
    });
    if (!response.ok) {
      return `Failed to fetch ${url}: HTTP ${response.status}`;
    }
    const contentType = String(response.headers?.get("content-type") || "");
    const body = await response.text();
    if (/html/i.test(contentType) || /^\s*<(!doctype|html)/i.test(body)) {
      const text = htmlToText(body);
      if (text) {
        return text.slice(0, URL_FETCH_CHARS);
      }
    }
    return body.slice(0, URL_FETCH_CHARS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Failed to fetch ${url}: ${message}`;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the `[Harbor mentions]` prompt block for special mentions found in
 * the user text. Returns "" when the message has none.
 */
export async function buildSpecialMentionsPrompt(
  userText: string
): Promise<string> {
  const mentions = extractSpecialMentions(userText);
  const parts: string[] = [];

  if (mentions.problems) {
    const problems = buildWorkspaceProblemsMessage();
    if (problems) {
      parts.push(problems);
    }
  }

  if (mentions.terminal) {
    try {
      const terminal = buildTerminalSnapshotMessage();
      if (terminal.trim()) {
        parts.push(terminal.trim());
      } else {
        parts.push(
          "IDE terminal (@terminal): no recent terminal output recorded in this window."
        );
      }
    } catch {
      /* headless / no terminal API */
    }
  }

  for (const url of mentions.urls) {
    const text = await fetchUrlAsText(url);
    parts.push(`Fetched page ${url} (@url):\n\`\`\`\n${text}\n\`\`\``);
  }

  if (!parts.length) {
    return "";
  }
  return ["[Harbor mentions]", ...parts].join("\n\n");
}
