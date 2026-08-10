/**
 * Short LSP snapshot for Tab hole-fill (signature help + hover).
 * Hard timeout so a slow language server never blocks prefetch.
 */

import * as vscode from "vscode";

const DEFAULT_TIMEOUT_MS = 100;
const DEFAULT_MAX_CHARS = 400;

function withTimeout<T>(
  promise: Thenable<T> | Promise<T>,
  ms: number
): Promise<T | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(undefined);
      }
    }, Math.max(20, ms));
    Promise.resolve(promise).then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(undefined);
        }
      }
    );
  });
}

function markdownishToPlain(raw: string): string {
  let t = String(raw || "").replace(/\r\n/g, "\n");
  // Drop fenced language tags but keep code body.
  t = t.replace(/```[\w-]*\n?/g, "").replace(/```/g, "");
  // Strip simple markdown bold/italic/code markers.
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
  t = t.replace(/\*([^*]+)\*/g, "$1");
  t = t.replace(/`([^`]+)`/g, "$1");
  // Collapse blank runs.
  t = t
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line, i, arr) => line.trim() || (i > 0 && arr[i - 1].trim()))
    .join("\n")
    .trim();
  return t;
}

function hoverContentsToText(hover: vscode.Hover): string {
  const parts: string[] = [];
  for (const content of hover.contents) {
    if (typeof content === "string") {
      parts.push(content);
      continue;
    }
    if (content && typeof content === "object" && "value" in content) {
      parts.push(String((content as { value: string }).value || ""));
    }
  }
  return markdownishToPlain(parts.join("\n"));
}

function signatureHelpToText(help: vscode.SignatureHelp): string {
  const signatures = help.signatures || [];
  if (signatures.length === 0) {
    return "";
  }
  const active = Math.min(
    Math.max(0, help.activeSignature || 0),
    signatures.length - 1
  );
  const sig = signatures[active];
  if (!sig) {
    return "";
  }
  const label = String(sig.label || "").trim();
  let doc = "";
  if (typeof sig.documentation === "string") {
    doc = sig.documentation.trim();
  } else if (
    sig.documentation &&
    typeof sig.documentation === "object" &&
    "value" in sig.documentation
  ) {
    doc = String(sig.documentation.value || "").trim();
  }
  const parts = [label];
  if (doc) {
    parts.push(markdownishToPlain(doc).slice(0, 160));
  }
  // Active parameter hint when useful.
  const params = sig.parameters || [];
  const activeParam = Math.min(
    Math.max(0, help.activeParameter || 0),
    Math.max(0, params.length - 1)
  );
  if (params.length > 0 && params[activeParam]) {
    const p = params[activeParam];
    const pLabel =
      typeof p.label === "string"
        ? p.label
        : Array.isArray(p.label)
          ? label.slice(p.label[0], p.label[1])
          : "";
    if (pLabel.trim()) {
      parts.push(`active param: ${pLabel.trim()}`);
    }
  }
  return parts.filter(Boolean).join("\n");
}

/**
 * Best-effort LSP digest at the caret. Returns undefined on timeout / empty.
 */
export async function buildTabLspContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  options?: { timeoutMs?: number; maxChars?: number }
): Promise<string | undefined> {
  if (document.isClosed) {
    return undefined;
  }
  // Untitled / non-file often has no useful language server.
  if (document.uri.scheme !== "file" && document.uri.scheme !== "untitled") {
    return undefined;
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxChars = Math.max(80, options?.maxChars ?? DEFAULT_MAX_CHARS);

  const [signatureHelp, hovers] = await Promise.all([
    withTimeout(
      vscode.commands.executeCommand<vscode.SignatureHelp>(
        "vscode.executeSignatureHelpProvider",
        document.uri,
        position
      ),
      timeoutMs
    ),
    withTimeout(
      vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        document.uri,
        position
      ),
      timeoutMs
    ),
  ]);

  const chunks: string[] = [];
  if (signatureHelp) {
    const sigText = signatureHelpToText(signatureHelp);
    if (sigText) {
      chunks.push(sigText);
    }
  }

  if (hovers && hovers.length > 0) {
    const hoverText = hoverContentsToText(hovers[0]);
    if (hoverText) {
      // Avoid duplicating the same signature line from hover.
      const already = chunks.join("\n");
      if (!already || !already.includes(hoverText.slice(0, 40))) {
        chunks.push(hoverText);
      }
    }
  }

  if (chunks.length === 0) {
    return undefined;
  }

  let out = chunks.join("\n---\n").trim();
  if (out.length > maxChars) {
    out = out.slice(0, maxChars).replace(/\s+\S*$/, "").trimEnd();
  }
  return out || undefined;
}
