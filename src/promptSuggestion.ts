import { completeUtilityText } from "./chatTitle";
import { getConfig } from "./config";
import { resolveUiLanguage } from "./i18n";
import type { UiMessage } from "./sessionStore";

const MAX_SUGGESTION_CHARS = 120;
const MAX_SUGGESTION_WORDS = 16;
const MAX_USER_EXCERPT = 400;
const MAX_ASSISTANT_EXCERPT = 1200;
const RECENT_MESSAGES = 6;
const inflightChatIds = new Set<string>();

function excerpt(text: string, max: number): string {
  const plain = String(text || "").replace(/\s+/g, " ").trim();
  if (plain.length <= max) {
    return plain;
  }
  return `${plain.slice(0, max - 1).trim()}…`;
}

/**
 * Normalise the utility model reply into one short composer line.
 * Returns "" when the model declined (NONE) or produced something unusable.
 */
export function cleanPromptSuggestion(raw: string): string {
  let text =
    String(raw || "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) || "";
  text = text.replace(/^(user|пользователь)\s*:\s*/i, "");
  text = text.replace(/^["«»“”'`]+|["«»“”'`]+$/g, "").trim();
  if (!text || /^(none|нет|null|n\/a)\.?$/i.test(text)) {
    return "";
  }
  if (text.length > MAX_SUGGESTION_CHARS) {
    return "";
  }
  if (text.split(/\s+/).filter(Boolean).length > MAX_SUGGESTION_WORDS) {
    return "";
  }
  return text;
}

export function shouldSuggestPrompt(uiMessages: UiMessage[]): boolean {
  const list = uiMessages || [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const msg = list[i];
    if (msg.role === "assistant") {
      return Boolean(String(msg.text || "").trim());
    }
    if (msg.role === "user") {
      return false;
    }
  }
  return false;
}

function buildSuggestionPrompt(uiMessages: UiMessage[]): {
  system: string;
  user: string;
} {
  const lines: string[] = [];
  for (const msg of (uiMessages || []).slice(-RECENT_MESSAGES)) {
    const text = String(msg.text || "").trim();
    if (!text) {
      continue;
    }
    if (msg.role === "user") {
      lines.push(`User: ${excerpt(text, MAX_USER_EXCERPT)}`);
    } else if (msg.role === "assistant") {
      lines.push(`Assistant: ${excerpt(text, MAX_ASSISTANT_EXCERPT)}`);
    }
  }
  const lang = resolveUiLanguage(getConfig().language);
  const language =
    lang === "ru"
      ? "Write it in Russian unless the user clearly writes in another language."
      : "Write it in the language the user writes in.";
  return {
    system: [
      "You predict the next message the user will type to a coding agent, shown as ghost text in their input box.",
      "Reply with that message only: one short line (3-12 words), in the user's own voice and style, as an instruction or question to the agent.",
      "Prefer the obvious next step: answer the agent's question, approve the proposed plan, ask to run/verify, or continue the work.",
      `${language} No quotes, no prefixes, no explanations.`,
      "If there is no clear next step, reply with NONE.",
    ].join(" "),
    user: lines.join("\n"),
  };
}

/**
 * One call to the chat's selected model after a successful turn. Never throws: returns ""
 * when disabled, skipped, the model declined, or the call failed.
 */
export async function maybeGeneratePromptSuggestion(
  chatId: string,
  uiMessages: UiMessage[],
  options: {
    modelId: string;
    signal?: AbortSignal;
    /** Diagnostics sink (Output channel); never required. */
    onDebug?: (line: string) => void;
  }
): Promise<string> {
  const debug = options.onDebug || (() => undefined);
  const id = String(chatId || "").trim();
  if (!id || inflightChatIds.has(id)) {
    debug(`skip: ${id ? "already in flight" : "no chat id"}`);
    return "";
  }
  if (!getConfig().promptSuggestions.enabled) {
    debug("skip: disabled in settings");
    return "";
  }
  const modelId = String(options.modelId || "").trim();
  if (!modelId) {
    debug("skip: no model selected");
    return "";
  }
  if (!shouldSuggestPrompt(uiMessages)) {
    const roles = (uiMessages || []).slice(-4).map((m) => m.role).join(",");
    debug(`skip: last turn has no assistant text (last roles: ${roles})`);
    return "";
  }
  inflightChatIds.add(id);
  try {
    const raw = await completeUtilityText(buildSuggestionPrompt(uiMessages), {
      modelId,
      signal: options.signal,
      maxTokens: 64,
      temperature: 0.3,
    });
    const cleaned = cleanPromptSuggestion(raw);
    debug(
      `model ${modelId} → raw ${JSON.stringify(String(raw).slice(0, 200))}` +
        (cleaned ? "" : " (rejected: empty/NONE/too long)")
    );
    return cleaned;
  } catch (error) {
    debug(
      `model ${modelId} failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return "";
  } finally {
    inflightChatIds.delete(id);
  }
}
