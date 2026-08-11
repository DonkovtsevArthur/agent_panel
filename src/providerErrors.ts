/**
 * Turn noisy LiteLLM / vLLM / OpenRouter traces into short UI copy.
 * Pure — no vscode dependency (safe for unit tests later).
 */

export type ProviderErrorLanguage = "en" | "ru";

/** Drop LiteLLM fallback spam that drowns the real cause. */
export function stripLiteLlmFallbackSpam(raw: string): string {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/\s*No fallback model group found[\s\S]*$/i, "")
    .replace(/\s*Available Model Group Fallbacks[\s\S]*$/i, "")
    .replace(/\s*Error doing the fallback:[\s\S]*$/i, "")
    .replace(/\s*Fallbacks=\[[^\]]*\]\.?/gi, "")
    .replace(/\s*Received Model Group=[^\s.]+\.?/gi, "")
    .trim();
}

function stripLiteLlmTypePrefixes(raw: string): string {
  let text = String(raw || "").trim();
  for (let i = 0; i < 5; i++) {
    const next = text
      .replace(/^(?:litellm\.)?[A-Za-z]*Error:\s*/i, "")
      .replace(/^OpenrouterException\s*-\s*/i, "")
      .replace(/^upstream\s+(\d+)\s*:\s*/i, "API $1: ")
      .trim();
    if (next === text) {
      break;
    }
    text = next;
  }
  return text;
}

/**
 * Pull the human message out of LiteLLM / OpenRouter / balancer JSON blobs.
 * Example: `OpenrouterException - {"error":{"message":"Превышена квота…"}}`
 */
export function extractGatewayErrorMessage(raw: string): string | undefined {
  const text = String(raw || "");
  if (!text) {
    return undefined;
  }

  for (const candidate of findJsonObjects(text)) {
    try {
      const msg = pickErrorMessage(JSON.parse(candidate));
      if (msg) {
        return msg;
      }
    } catch {
      /* keep scanning */
    }
  }

  const m = text.match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (m) {
    const unescaped = m[1]
      .replace(/\\n/g, " ")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .trim();
    if (unescaped && unescaped.length <= 500) {
      return unescaped;
    }
  }
  return undefined;
}

function pickErrorMessage(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const row = parsed as Record<string, unknown>;
  const err = row.error;
  if (typeof err === "string" && err.trim()) {
    return err.trim();
  }
  if (err && typeof err === "object") {
    const inner = err as Record<string, unknown>;
    if (typeof inner.message === "string" && inner.message.trim()) {
      return inner.message.trim();
    }
    if (inner.error && typeof inner.error === "object") {
      const deeper = (inner.error as Record<string, unknown>).message;
      if (typeof deeper === "string" && deeper.trim()) {
        return deeper.trim();
      }
    }
  }
  if (typeof row.message === "string" && row.message.trim()) {
    // Avoid taking generic outer wrappers like litellm exception class names.
    const msg = row.message.trim();
    if (!/^(?:NotFoundError|BadRequestError|APIError)\b/i.test(msg)) {
      return msg;
    }
  }
  return undefined;
}

/** Brace-matched JSON objects in a noisy log line (last → first). */
function findJsonObjects(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") {
      continue;
    }
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          out.push(text.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
  }
  return out.reverse();
}

function extractModelGroup(raw: string): string | undefined {
  const m =
    String(raw || "").match(/model_group=([^\s.,]+)/i) ||
    String(raw || "").match(/Received Model Group=([^\s.,]+)/i);
  const id = m?.[1]?.trim();
  return id || undefined;
}

/** Drop LiteLLM fallback spam; prefer embedded gateway message when present. */
export function compactLiteLlmNoise(raw: string): string {
  const stripped = stripLiteLlmFallbackSpam(raw);
  const embedded = extractGatewayErrorMessage(stripped);
  if (embedded) {
    return embedded;
  }
  return stripLiteLlmTypePrefixes(stripped);
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message || "";
  }
  return String(error || "");
}

/** vLLM behind LiteLLM without auto tool-calling flags. */
export function isVllmAutoToolChoiceError(message: string): boolean {
  const text = String(message || "");
  return (
    /enable-auto-tool-choice/i.test(text) ||
    /tool-call-parser/i.test(text) ||
    /"auto"\s+tool\s+choice\s+requires/i.test(text)
  );
}

export function isQuotaLikeProviderError(message: string): boolean {
  return /квот|quota|rate.?limit|resource_error|too many requests|\b429\b|request limit|лимит запросов/i.test(
    String(message || "")
  );
}

/**
 * Known gateway misconfigurations → short actionable text.
 * Returns undefined when we have nothing better than the compact raw message.
 */
export function explainKnownProviderError(
  error: unknown,
  lang: ProviderErrorLanguage = "en"
): string | undefined {
  const raw = errorText(error);
  const stripped = stripLiteLlmFallbackSpam(raw);
  const embedded = extractGatewayErrorMessage(stripped) || "";
  const haystack = `${stripped}\n${embedded}`;

  if (!stripped && !embedded) {
    return undefined;
  }

  if (isVllmAutoToolChoiceError(haystack)) {
    if (lang === "ru") {
      return [
        "Сервер модели отклонил tool_choice «auto».",
        "На vLLM нужны флаги --enable-auto-tool-choice и --tool-call-parser",
        "(для Qwen2.5 обычно hermes).",
        "Пока флаги не включены — выберите другую модель или попросите админа гейтвея.",
      ].join(" ");
    }
    return [
      'This model server rejected tool_choice "auto".',
      "On vLLM enable --enable-auto-tool-choice and --tool-call-parser",
      "(for Qwen2.5 usually hermes).",
      "Until then, pick another model or ask the gateway admin to enable tool calling.",
    ].join(" ");
  }

  if (isQuotaLikeProviderError(haystack)) {
    const modelGroup = extractModelGroup(raw);
    const core =
      embedded ||
      (lang === "ru" ? "Превышена квота запросов" : "Request quota exceeded");
    if (lang === "ru") {
      const withModel = modelGroup
        ? /для модели|модели\s+\S+/i.test(core)
          ? core
          : `${core.replace(/\.*$/, "")} для модели ${modelGroup}`
        : core.replace(/\.*$/, "");
      if (/выберите другую|подождите|сброса лимита/i.test(withModel)) {
        return withModel;
      }
      return `${withModel}. Выберите другую модель или подождите сброса лимита.`;
    }
    const withModel = modelGroup
      ? /\bfor\b|\bmodel\b/i.test(core)
        ? core
        : `${core.replace(/\.*$/, "")} for model ${modelGroup}`
      : core.replace(/\.*$/, "");
    if (/pick another|try again|wait for/i.test(withModel)) {
      return withModel;
    }
    return `${withModel}. Pick another model or wait for the quota to reset.`;
  }

  return undefined;
}

/**
 * Preferred UI string for a provider failure: known explanation, else compact
 * raw text (LiteLLM fallback noise stripped).
 */
export function humanizeProviderError(
  error: unknown,
  lang: ProviderErrorLanguage = "en",
  max = 480
): string {
  const explained = explainKnownProviderError(error, lang);
  if (explained) {
    return explained.length > max
      ? `${explained.slice(0, Math.max(0, max - 1))}…`
      : explained;
  }
  const compact = compactLiteLlmNoise(errorText(error));
  if (!compact) {
    return "";
  }
  return compact.length > max ? `${compact.slice(0, Math.max(0, max - 1))}…` : compact;
}

/**
 * Full upstream payload for the error "?" disclosure.
 * Returned only when it adds information beyond the short UI string.
 */
export function providerErrorDetail(
  error: unknown,
  humanized: string
): string | undefined {
  const raw = errorText(error).trim();
  const short = String(humanized || "").trim();
  if (!raw || raw === short) {
    return undefined;
  }
  return raw;
}
