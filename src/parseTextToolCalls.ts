import type { ToolCall } from "./openaiClient";

export interface ParsedTextToolCalls {
  calls: ToolCall[];
  cleanedContent: string;
}

const DSML = String.raw`(?:\|DSML\||｜DSML｜)`;

/**
 * Recover tool calls that some models dump as XML/DSML text instead of
 * native OpenAI tool_calls.
 */
export function parseTextToolCalls(raw: string): ParsedTextToolCalls {
  const text = String(raw || "");
  if (!text.trim()) {
    return { calls: [], cleanedContent: text };
  }

  const calls: ToolCall[] = [];
  let cleaned = text;

  cleaned = extractInvokeStyle(cleaned, calls);
  cleaned = extractToolCallJsonBlocks(cleaned, calls);
  cleaned = stripOrphanToolMarkup(cleaned);

  return {
    calls,
    cleanedContent: cleaned.replace(/\n{3,}/g, "\n\n").trim(),
  };
}

function nextCallId(index: number): string {
  return `call_text_${Date.now().toString(36)}_${index}`;
}

function extractInvokeStyle(text: string, calls: ToolCall[]): string {
  const invokeRe = new RegExp(
    `<${DSML}?invoke\\s+name=["']([^"']+)["']\\s*>([\\s\\S]*?)</${DSML}?invoke>`,
    "gi"
  );
  let cleaned = text;
  let m: RegExpExecArray | null;
  const matches: RegExpExecArray[] = [];
  while ((m = invokeRe.exec(text)) !== null) {
    matches.push(m);
  }

  for (const match of matches) {
    const name = String(match[1] || "").trim();
    const body = match[2] || "";
    if (!name) {
      continue;
    }
    const args = parseParameters(body);
    calls.push({
      id: nextCallId(calls.length),
      type: "function",
      function: {
        name,
        arguments: JSON.stringify(args),
      },
    });
    cleaned = cleaned.replace(match[0], "");
  }

  // Drop wrapping tool_calls / function_calls shells left behind
  cleaned = cleaned
    .replace(new RegExp(`<${DSML}?tool_calls\\s*>`, "gi"), "")
    .replace(new RegExp(`</${DSML}?tool_calls\\s*>`, "gi"), "")
    .replace(/<\/?function_calls\s*>/gi, "")
    .replace(/<\/?tool_calls\s*>/gi, "");

  return cleaned;
}

function parseParameters(body: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const paramRe = new RegExp(
    `<${DSML}?parameter\\s+name=["']([^"']+)["'][^>]*>([\\s\\S]*?)</${DSML}?parameter>`,
    "gi"
  );
  let m: RegExpExecArray | null;
  while ((m = paramRe.exec(body)) !== null) {
    const key = String(m[1] || "").trim();
    if (!key) {
      continue;
    }
    args[key] = coerceParamValue(m[2] ?? "");
  }

  // Fallback: plain <parameter name="x"> without DSML prefix
  if (!Object.keys(args).length) {
    const plainRe =
      /<parameter\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/parameter>/gi;
    while ((m = plainRe.exec(body)) !== null) {
      const key = String(m[1] || "").trim();
      if (!key) {
        continue;
      }
      args[key] = coerceParamValue(m[2] ?? "");
    }
  }

  return args;
}

function coerceParamValue(raw: string): unknown {
  const value = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      // keep string
    }
  }
  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === "true";
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return value;
}

function extractToolCallJsonBlocks(text: string, calls: ToolCall[]): string {
  let cleaned = text;
  const blockRe = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  const matches: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    matches.push(m);
  }

  for (const match of matches) {
    const inner = String(match[1] || "").trim();
    const parsed = tryParseToolJson(inner);
    if (!parsed) {
      continue;
    }
    calls.push({
      id: nextCallId(calls.length),
      type: "function",
      function: {
        name: parsed.name,
        arguments:
          typeof parsed.arguments === "string"
            ? parsed.arguments
            : JSON.stringify(parsed.arguments ?? {}),
      },
    });
    cleaned = cleaned.replace(match[0], "");
  }

  return cleaned;
}

function tryParseToolJson(
  inner: string
): { name: string; arguments: unknown } | undefined {
  try {
    const obj = JSON.parse(inner) as {
      name?: unknown;
      function?: { name?: unknown; arguments?: unknown };
      arguments?: unknown;
      parameters?: unknown;
    };
    const name = String(
      obj.name || obj.function?.name || ""
    ).trim();
    if (!name) {
      return undefined;
    }
    const args =
      obj.arguments ??
      obj.parameters ??
      obj.function?.arguments ??
      {};
    return { name, arguments: args };
  } catch {
    // Some models emit name=... lines
    const nameMatch = inner.match(/name\s*[:=]\s*["']?([a-zA-Z0-9_]+)["']?/i);
    if (!nameMatch) {
      return undefined;
    }
    const argsMatch = inner.match(
      /(?:arguments|parameters)\s*[:=]\s*(\{[\s\S]*\})/i
    );
    let args: unknown = {};
    if (argsMatch?.[1]) {
      try {
        args = JSON.parse(argsMatch[1]);
      } catch {
        args = {};
      }
    }
    return { name: nameMatch[1], arguments: args };
  }
}

function stripOrphanToolMarkup(text: string): string {
  return text
    .replace(new RegExp(`</?${DSML}?tool_calls\\s*>`, "gi"), "")
    .replace(new RegExp(`</?${DSML}?invoke\\b[^>]*>`, "gi"), "")
    .replace(new RegExp(`</?${DSML}?parameter\\b[^>]*>`, "gi"), "")
    .replace(/<\/?tool_call\s*>/gi, "")
    .replace(/<\/?function_calls\s*>/gi, "")
    .replace(/<\/?tool_calls\s*>/gi, "");
}
