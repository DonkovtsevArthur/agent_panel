/**
 * Turn noisy LiteLLM / vLLM / OpenRouter traces into short UI copy.
 * Pure — no vscode dependency (safe for unit tests later).
 */

export type ProviderErrorLanguage = "en" | "ru";

/** Drop LiteLLM fallback spam that drowns the real cause. */
export function compactLiteLlmNoise(raw: string): string {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/\s*No fallback model group found[\s\S]*$/i, "")
    .replace(/\s*Available Model Group Fallbacks[\s\S]*$/i, "")
    .replace(/\s*Error doing the fallback:[\s\S]*$/i, "")
    .replace(/\s*Fallbacks=\[[^\]]*\]\.?/gi, "")
    .trim();
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

/**
 * Known gateway misconfigurations → short actionable text.
 * Returns undefined when we have nothing better than the compact raw message.
 */
export function explainKnownProviderError(
  error: unknown,
  lang: ProviderErrorLanguage = "en"
): string | undefined {
  const compact = compactLiteLlmNoise(errorText(error));
  if (!compact) {
    return undefined;
  }

  if (isVllmAutoToolChoiceError(compact)) {
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
    return explained;
  }
  const compact = compactLiteLlmNoise(errorText(error));
  if (!compact) {
    return "";
  }
  return compact.length > max ? `${compact.slice(0, Math.max(0, max - 1))}…` : compact;
}
