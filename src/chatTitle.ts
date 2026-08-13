import { displayAttachmentName } from "./attachments";
import { getConfig, getEnabledModels, resolveModelEndpoint } from "./config";
import { resolveUiLanguage } from "./i18n";
import { selectUtilityModel } from "./modelRouting";
import { getOpenAICompatibleClient } from "./openaiClient";
import {
  applyAgentName,
  applyBranchTabTitle,
  findAgentByChatId,
  resolveAgentNameSource,
  type AgentsStoreV2,
  type AgentNameSource,
  type ChatSession,
  type UiMessage,
} from "./sessionStore";

const SHORT_QUESTION_CHARS = 32;
const MAX_TITLE_CHARS = 40;
const MAX_TITLE_WORDS = 6;
const titleRetryChatIds = new Set<string>();
const tabTitleRetryChatIds = new Set<string>();
const MAX_ASSISTANT_EXCERPT = 400;
const MAX_USER_EXCERPT = 280;
const inflightChatIds = new Set<string>();

export function titleNeedsRetry(title?: string): boolean {
  const text = String(title || "").trim();
  if (!text) {
    return true;
  }
  if (text.length > MAX_TITLE_CHARS) {
    return true;
  }
  if (
    /^(на скриншоте|on the screenshot|this (is|image|screenshot)|в этом (окне|скриншоте))/i.test(
      text
    )
  ) {
    return true;
  }
  if (/[—.!?]/.test(text)) {
    return true;
  }
  return text.split(/\s+/).filter(Boolean).length > MAX_TITLE_WORDS;
}

export function shouldGenerateChatTitle(input: {
  parentChatId?: string;
  nameSource: AgentNameSource;
  currentTitle?: string;
  chatId?: string;
  uiMessages: UiMessage[];
}): boolean {
  if (input.parentChatId) {
    return false;
  }
  if (input.nameSource === "user") {
    return false;
  }
  if (input.nameSource === "generated") {
    const id = String(input.chatId || "").trim();
    if (!titleNeedsRetry(input.currentTitle) || (id && titleRetryChatIds.has(id))) {
      return false;
    }
  } else if (
    input.nameSource !== "default" &&
    input.nameSource !== "first_message"
  ) {
    return false;
  }
  const users = (input.uiMessages || []).filter(
    (m) =>
      m.role === "user" &&
      (String(m.text || "").trim() || (m.attachments && m.attachments.length))
  );
  if (!users.length) {
    return false;
  }
  const hasAssistant = (input.uiMessages || []).some(
    (m) => m.role === "assistant" && String(m.text || "").trim()
  );
  if (!hasAssistant) {
    return false;
  }
  if (users.length >= 2) {
    return true;
  }
  const first = users[0];
  const text = String(first.text || "").trim();
  const hasFile =
    (first.attachments || []).length > 0 || /@[^\s@]+/.test(text);
  return hasFile || text.length < SHORT_QUESTION_CHARS;
}

function messagesAfterFork(
  uiMessages: UiMessage[] | undefined,
  branchedFromUiIndex?: number
): UiMessage[] {
  const ui = uiMessages || [];
  if (typeof branchedFromUiIndex === "number" && branchedFromUiIndex >= 0) {
    return ui.slice(branchedFromUiIndex + 1);
  }
  return ui;
}

export function shouldGenerateBranchTabTitle(input: {
  parentChatId?: string;
  tabTitle?: string;
  chatId?: string;
  uiMessages: UiMessage[];
  branchedFromUiIndex?: number;
}): boolean {
  if (!input.parentChatId) {
    return false;
  }
  const generated = String(input.tabTitle || "").trim();
  if (generated) {
    const id = String(input.chatId || "").trim();
    if (!titleNeedsRetry(generated) || (id && tabTitleRetryChatIds.has(id))) {
      return false;
    }
  }
  const after = messagesAfterFork(input.uiMessages, input.branchedFromUiIndex);
  const hasNewUser = after.some(
    (m) =>
      m.role === "user" &&
      (String(m.text || "").trim() || Boolean(m.attachments?.length))
  );
  const hasAssistantAfter = after.some(
    (m) => m.role === "assistant" && String(m.text || "").trim()
  );
  if (hasNewUser && hasAssistantAfter) {
    return true;
  }
  return (input.uiMessages || []).some(
    (m) =>
      m.role === "user" &&
      (String(m.text || "").trim() || Boolean(m.attachments?.length))
  );
}

export function cleanChatTitle(raw: string): string {
  let text = String(raw || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) || "";
  text = text.replace(/^["«»“”'`]+|["«»“”'`]+$/g, "").trim();
  text = text.replace(/[.。]+$/g, "").trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > MAX_TITLE_WORDS) {
    text = words.slice(0, MAX_TITLE_WORDS).join(" ");
  }
  if (text.length > MAX_TITLE_CHARS) {
    text = `${text.slice(0, MAX_TITLE_CHARS - 1).trim()}…`;
  }
  if (!text || /^new (agent|chat)$/i.test(text) || text === "Chat") {
    return "";
  }
  return text;
}

function excerpt(text: string, max: number): string {
  const plain = String(text || "").replace(/\s+/g, " ").trim();
  if (plain.length <= max) {
    return plain;
  }
  return `${plain.slice(0, max - 1).trim()}…`;
}

function completionText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text?: string }).text || "")
        : ""
    )
    .join("");
}

function collectPromptLines(
  uiMessages: UiMessage[],
  maxUsers: number
): string[] {
  const lines: string[] = [];
  let users = 0;
  let lastAssistant = "";
  for (const msg of uiMessages) {
    if (msg.role === "user") {
      const bits = [excerpt(msg.text, MAX_USER_EXCERPT)];
      for (const att of msg.attachments || []) {
        bits.push(`[${att.kind}: ${displayAttachmentName(att)}]`);
      }
      const body = bits.filter(Boolean).join(" ");
      if (!body) {
        continue;
      }
      users += 1;
      if (users <= maxUsers) {
        lines.push(`User: ${body}`);
      }
    } else if (msg.role === "assistant" && String(msg.text || "").trim()) {
      lastAssistant = excerpt(msg.text, MAX_ASSISTANT_EXCERPT);
    }
  }
  if (lastAssistant) {
    lines.push(`Assistant: ${lastAssistant}`);
  }
  return lines;
}

function titleLanguageInstruction(): string {
  const lang = resolveUiLanguage(getConfig().language);
  return lang === "ru"
    ? "Write the label in Russian, even if the chat text is in another language."
    : "Write the label in English, even if the chat text is in another language.";
}

function buildTitlePrompt(uiMessages: UiMessage[]): { system: string; user: string } {
  const lines = collectPromptLines(uiMessages, 3);
  return {
    system:
      `You write a short sidebar chat title. Reply with 2-5 words only, like a notebook label. ${titleLanguageInstruction()} Never a sentence, never describe a screenshot, never start with 'На скриншоте' or 'On the screenshot'. No quotes, no punctuation.`,
    user: lines.join("\n") || "Name this chat.",
  };
}

function formatUiLine(msg: UiMessage | undefined): string {
  if (!msg) {
    return "";
  }
  if (msg.role === "user") {
    const bits = [excerpt(msg.text, MAX_USER_EXCERPT)];
    for (const att of msg.attachments || []) {
      bits.push(`[${att.kind}: ${displayAttachmentName(att)}]`);
    }
    const body = bits.filter(Boolean).join(" ");
    return body ? `User: ${body}` : "";
  }
  if (msg.role === "assistant" && String(msg.text || "").trim()) {
    return `Assistant: ${excerpt(msg.text, MAX_ASSISTANT_EXCERPT)}`;
  }
  return "";
}

function buildBranchTitlePrompt(chat: ChatSession): { system: string; user: string } {
  const ui = chat.uiMessages || [];
  const branchAt = chat.branchedFromUiIndex;
  const after = messagesAfterFork(ui, branchAt);
  const forkedAt =
    typeof branchAt === "number" && branchAt >= 0 ? formatUiLine(ui[branchAt]) : "";
  const before =
    typeof branchAt === "number" && branchAt >= 0
      ? ui.slice(Math.max(0, branchAt - 3), branchAt + 1)
      : ui;
  const original = collectPromptLines(before, 2);
  const branch = collectPromptLines(after, 3);
  const parts: string[] = [];
  if (original.length) {
    parts.push("Conversation:", ...original);
  }
  if (forkedAt) {
    parts.push("Forked at:", forkedAt);
  }
  if (branch.length) {
    parts.push("This branch:", ...branch);
  } else {
    parts.push("This branch: just created, no new messages yet.");
  }
  return {
    system:
      `You write a short tab label for a conversation branch, created immediately when the user forks. Reply with 2-5 words only, like a notebook label. Name the topic they forked from, or the new direction if this branch already has messages. ${titleLanguageInstruction()} Never a sentence, never describe a screenshot, never start with 'На скриншоте' or 'On the screenshot'. No quotes, no punctuation.`,
    user: parts.join("\n"),
  };
}

async function completeUtilityTitle(
  prompts: { system: string; user: string },
  options: {
    fallbackModelId?: string;
    chatModelId?: string;
    signal?: AbortSignal;
  }
): Promise<string> {
  const enabled = getEnabledModels().filter((m) => {
    const endpoint = resolveModelEndpoint(m.id);
    return Boolean(endpoint.baseUrl && endpoint.apiKey);
  });
  const fallback = String(
    options.fallbackModelId || options.chatModelId || ""
  ).trim();
  const modelId =
    selectUtilityModel(enabled, { fallbackModelId: fallback })?.modelId ||
    fallback;
  if (!modelId) {
    return "";
  }
  const endpoint = resolveModelEndpoint(modelId);
  if (!endpoint.baseUrl || !endpoint.apiKey) {
    return "";
  }
  const config = getConfig();
  const client = getOpenAICompatibleClient(endpoint.baseUrl, endpoint.apiKey, {
    rejectUnauthorized: config.rejectUnauthorized,
    caBundlePath: config.caBundlePath,
  });
  const result = await client.chatCompletions(
    {
      model: modelId,
      messages: [
        { role: "system", content: prompts.system },
        { role: "user", content: prompts.user },
      ],
      temperature: 0.2,
      max_tokens: 48,
    },
    options.signal
  );
  return cleanChatTitle(completionText(result.message.content));
}

/**
 * One short utility-model call. Does not throw to callers: returns undefined
 * when skipped, already named, or the model failed.
 * Forks get a tab label; the root chat still names the agent.
 */
export async function maybeGenerateChatTitle(
  store: AgentsStoreV2,
  chatId: string,
  options?: { signal?: AbortSignal; fallbackModelId?: string }
): Promise<string | undefined> {
  const id = String(chatId || "").trim();
  if (!id || inflightChatIds.has(id)) {
    return undefined;
  }
  const chat = store.chats[id];
  const agent = findAgentByChatId(store, id);
  if (!chat || !agent) {
    return undefined;
  }
  if (chat.parentChatId) {
    return generateBranchTabTitle(store, chat, options);
  }
  const nameSource = resolveAgentNameSource(agent, chat);
  if (
    !shouldGenerateChatTitle({
      parentChatId: chat.parentChatId,
      nameSource,
      currentTitle: agent.name,
      chatId: id,
      uiMessages: chat.uiMessages || [],
    })
  ) {
    return undefined;
  }
  if (nameSource === "generated") {
    titleRetryChatIds.add(id);
  }

  inflightChatIds.add(id);
  try {
    const title = await completeUtilityTitle(buildTitlePrompt(chat.uiMessages || []), {
      fallbackModelId: options?.fallbackModelId,
      chatModelId: chat.selectedModel,
      signal: options?.signal,
    });
    if (!title || titleNeedsRetry(title)) {
      return undefined;
    }
    const latest = store.chats[id];
    const latestAgent = findAgentByChatId(store, id);
    if (!latest || !latestAgent) {
      return undefined;
    }
    const source = resolveAgentNameSource(latestAgent, latest);
    if (source === "user" || source === "generated") {
      return undefined;
    }
    if (!applyAgentName(store, latestAgent.id, title, "generated")) {
      return undefined;
    }
    return title;
  } catch {
    return undefined;
  } finally {
    inflightChatIds.delete(id);
  }
}

async function generateBranchTabTitle(
  store: AgentsStoreV2,
  chat: ChatSession,
  options?: { signal?: AbortSignal; fallbackModelId?: string }
): Promise<string | undefined> {
  const id = chat.id;
  if (inflightChatIds.has(id)) {
    return undefined;
  }
  if (
    !shouldGenerateBranchTabTitle({
      parentChatId: chat.parentChatId,
      tabTitle: chat.tabTitle,
      chatId: id,
      uiMessages: chat.uiMessages || [],
      branchedFromUiIndex: chat.branchedFromUiIndex,
    })
  ) {
    return undefined;
  }
  if (String(chat.tabTitle || "").trim()) {
    tabTitleRetryChatIds.add(id);
  }

  inflightChatIds.add(id);
  try {
    const title = await completeUtilityTitle(buildBranchTitlePrompt(chat), {
      fallbackModelId: options?.fallbackModelId,
      chatModelId: chat.selectedModel,
      signal: options?.signal,
    });
    if (!title || titleNeedsRetry(title)) {
      return undefined;
    }
    const latest = store.chats[id];
    if (!latest?.parentChatId) {
      return undefined;
    }
    if (!applyBranchTabTitle(store, id, title)) {
      return undefined;
    }
    return title;
  } catch {
    return undefined;
  } finally {
    inflightChatIds.delete(id);
  }
}
