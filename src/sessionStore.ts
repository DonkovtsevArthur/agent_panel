import type { MessageAttachment } from "./attachments";
import type { ChatMessage } from "./openaiClient";

export type UiMessageRole =
  | "user"
  | "assistant"
  | "system"
  | "tool"
  | "error"
  | "review";

export type { MessageAttachment };

/** Persisted structured step for tool / compaction / retry replay in the webview. */
export interface UiMessageStep {
  stepId: string;
  kind: "tool" | "compaction" | "retry" | "thinking" | "text";
  toolCallId?: string;
  name?: string;
  argsPreview?: string;
  status?: "queued" | "running" | "done" | "error";
  resultPreview?: string;
  text?: string;
  attempt?: number;
  maxAttempts?: number;
}

export interface UiMessage {
  role: UiMessageRole;
  text: string;
  attachments?: MessageAttachment[];
  /** Thinking / reasoning text (Kimi etc.), shown as a collapsible block. */
  reasoning?: string;
  /** Structured agent step (tool cards, compaction, retry) for history replay. */
  step?: UiMessageStep;
}

export interface ChatSession {
  id: string;
  title: string;
  selectedModel: string;
  /** Agent / Plan / Ask (или custom mode id) для этого чата. */
  selectedMode?: string;
  lastTurnModel?: string;
  history: ChatMessage[];
  uiMessages: UiMessage[];
  updatedAt: number;
  /** Если задано — чат в архиве и скрыт из основного списка */
  archivedAt?: number;
  /** Последний известный расход контекста (токены). */
  contextTokens?: number;
  /** Чат, от которого ответвились. */
  parentChatId?: string;
  /** Индекс ui-сообщения в родителе, от которого создана ветка. */
  branchedFromUiIndex?: number;
  /** Последняя позиция скролла в окне чата. */
  scrollTop?: number;
}

export interface AgentRecord {
  id: string;
  name: string;
  /** Активный чат агента (текущая ветка). */
  chatId: string;
  /** Все чаты/ветки агента (включая chatId). */
  chatIds: string[];
  updatedAt: number;
  /** Если задано — агент в архиве и скрыт из основного списка */
  archivedAt?: number;
}

export type PanelScreen = "agents" | "chat" | "archive" | "settings";

export interface AgentsStoreV2 {
  version: 2;
  agents: AgentRecord[];
  chats: Record<string, ChatSession>;
  activeAgentId: string;
  activeChatId: string;
  screen: PanelScreen;
}

/** Старый формат одной сессии. */
export interface PersistedSessionV1 {
  selectedModel: string;
  history: ChatMessage[];
  uiMessages: UiMessage[];
  updatedAt: number;
}

export interface AgentListItem {
  id: string;
  chatId: string;
  name: string;
  model: string;
  preview: string;
  updatedAt: number;
  active: boolean;
  contextUsed: number;
  selectedModel: string;
  /** Нет пользовательских/assistant сообщений — можно удалить без архива. */
  empty: boolean;
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function chatHasMessages(uiMessages: UiMessage[] | undefined): boolean {
  if (!Array.isArray(uiMessages) || !uiMessages.length) {
    return false;
  }
  return uiMessages.some(
    (m) =>
      (m.role === "user" || m.role === "assistant") &&
      String(m.text || "").trim().length > 0
  );
}

function selectionFenceLabel(info: string): string {
  const match = String(info || "")
    .trim()
    .match(/^(\d+):(\d+):(\S+)/);
  if (!match) {
    return "";
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  const file = match[3];
  return start === end ? `${file}:${start}` : `${file}:${start}–${end}`;
}

/** Короткий plain-text текст для названий и превью в списках. */
export function summarizeMarkdownText(value: string): string {
  const source = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!source) {
    return "";
  }

  let fenceFallback = "";
  const withoutFences = source.replace(
    /```([^\n`]*)\n([\s\S]*?)```/g,
    (_match, info: string, body: string) => {
      if (!fenceFallback) {
        fenceFallback =
          selectionFenceLabel(info) ||
          String(body || "")
            .split("\n")
            .map((line) => line.trim())
            .find(Boolean) ||
          "";
      }
      return "\n";
    }
  );

  // Старые автозаголовки могли сохраниться уже обрезанными посреди code fence.
  const unmatchedSelection = withoutFences.match(
    /^\s*```(\d+:\d+:\S+)(?:\s+|$)/
  );
  if (unmatchedSelection && !fenceFallback) {
    fenceFallback = selectionFenceLabel(unmatchedSelection[1]);
  }

  const plain = withoutFences
    .replace(/^\s*```\d+:\d+:\S+(?:\s+|$)/, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, "")
    .replace(/[*_~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return plain || fenceFallback;
}

function truncateSummary(value: string, maxLength: number): string {
  const text = summarizeMarkdownText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function previewFromMessages(uiMessages: UiMessage[]): string {
  for (let i = uiMessages.length - 1; i >= 0; i--) {
    const msg = uiMessages[i];
    if (msg.role === "assistant" || msg.role === "user") {
      const text = truncateSummary(msg.text, 80);
      if (text) {
        return text;
      }
    }
  }
  return "Empty chat";
}

function isDefaultTitle(value: string | undefined): boolean {
  const title = String(value || "").trim();
  return !title || title === "New Agent" || title === "New Chat";
}

function isMeaningfulTitle(value: string | undefined): boolean {
  return !isDefaultTitle(value) && String(value || "").trim() !== "Chat";
}

function titleFromMessages(uiMessages: UiMessage[]): string {
  const firstUser = uiMessages.find((m) => m.role === "user" && m.text.trim());
  if (!firstUser) {
    return "New Agent";
  }
  return truncateSummary(firstUser.text, 48) || "New Agent";
}

export function getAgentDisplayName(
  agent: AgentRecord,
  chat: ChatSession | undefined
): string {
  const rawName = String(agent.name || "");
  if (rawName.includes("```") && chat) {
    return titleFromMessages(chat.uiMessages);
  }
  return truncateSummary(rawName, 48) || "New Agent";
}

/** Нормализует id режима чата; пустое → agent. */
export function normalizeSelectedMode(mode: unknown): string {
  const id = typeof mode === "string" ? mode.trim() : "";
  return id || "agent";
}

function createEmptyChat(selectedModel = ""): ChatSession {
  const now = Date.now();
  return {
    id: uid("chat"),
    title: "New Agent",
    selectedModel,
    selectedMode: "agent",
    history: [],
    uiMessages: [],
    updatedAt: now,
  };
}

export function getAgentChatIds(agent: AgentRecord): string[] {
  const fromList = Array.isArray(agent.chatIds) ? agent.chatIds : [];
  const ids = fromList.length
    ? fromList
    : agent.chatId
      ? [agent.chatId]
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  if (agent.chatId && !seen.has(agent.chatId)) {
    out.unshift(agent.chatId);
  }
  return out;
}

export function findAgentByChatId(
  store: AgentsStoreV2,
  chatId: string
): AgentRecord | undefined {
  if (!chatId) {
    return undefined;
  }
  return store.agents.find((a) => getAgentChatIds(a).includes(chatId));
}

export function createEmptyAgent(selectedModel = ""): {
  agent: AgentRecord;
  chat: ChatSession;
} {
  const chat = createEmptyChat(selectedModel);
  const now = Date.now();
  return {
    agent: {
      id: uid("agent"),
      name: "New Agent",
      chatId: chat.id,
      chatIds: [chat.id],
      updatedAt: now,
    },
    chat,
  };
}

type LegacyAgentRecord = Partial<AgentRecord> & {
  chatIds?: string[];
  chatId?: string;
};

function uniqueAgentId(id: string, used: Set<string>): string {
  let next = id || uid("agent");
  while (used.has(next)) {
    next = uid("agent");
  }
  used.add(next);
  return next;
}

function normalizeChat(chat: ChatSession, fallbackModel: string): ChatSession {
  const next: ChatSession = {
    ...chat,
    title: chat.title || titleFromMessages(chat.uiMessages || []),
    selectedModel: chat.selectedModel || fallbackModel,
    selectedMode: normalizeSelectedMode(chat.selectedMode),
    history: Array.isArray(chat.history) ? chat.history : [],
    uiMessages: Array.isArray(chat.uiMessages) ? chat.uiMessages : [],
    updatedAt: chat.updatedAt || Date.now(),
  };
  if (chat.parentChatId) {
    next.parentChatId = chat.parentChatId;
  }
  if (typeof chat.branchedFromUiIndex === "number") {
    next.branchedFromUiIndex = chat.branchedFromUiIndex;
  }
  if (typeof chat.scrollTop === "number" && Number.isFinite(chat.scrollTop)) {
    next.scrollTop = chat.scrollTop;
  }
  return next;
}

function normalizeAgents(
  rawAgents: LegacyAgentRecord[],
  chats: Record<string, ChatSession>,
  activeAgentId: string,
  activeChatId: string
): { agents: AgentRecord[]; activeAgentId: string } {
  const agents: AgentRecord[] = [];
  const used = new Set<string>();
  const referencedChatIds = new Set<string>();
  let nextActiveAgentId = activeAgentId;

  for (const rawAgent of rawAgents) {
    const rawIds = Array.isArray(rawAgent.chatIds)
      ? rawAgent.chatIds
      : rawAgent.chatId
        ? [rawAgent.chatId]
        : [];
    const chatIds = rawIds.filter((chatId) => {
      if (!chats[chatId]) {
        return false;
      }
      referencedChatIds.add(chatId);
      return true;
    });
    if (!chatIds.length) {
      continue;
    }

    const id = uniqueAgentId(rawAgent.id || "", used);
    let chatId =
      rawAgent.chatId && chatIds.includes(rawAgent.chatId)
        ? rawAgent.chatId
        : chatIds[0];
    if (rawAgent.id === activeAgentId) {
      nextActiveAgentId = id;
      if (chatIds.includes(activeChatId)) {
        chatId = activeChatId;
      }
    }

    const latestChatUpdated = Math.max(
      ...chatIds.map((cid) => chats[cid]?.updatedAt || 0),
      0
    );
    agents.push({
      id,
      name: rawAgent.name || "New Agent",
      chatId,
      chatIds,
      updatedAt: Math.max(rawAgent.updatedAt || 0, latestChatUpdated),
      archivedAt: rawAgent.archivedAt,
    });
  }

  for (const [chatId, chat] of Object.entries(chats)) {
    if (referencedChatIds.has(chatId)) {
      continue;
    }
    const id = uniqueAgentId(`agent_${chatId}`, used);
    if (chatId === activeChatId) {
      nextActiveAgentId = id;
    }
    agents.push({
      id,
      name: isMeaningfulTitle(chat.title) ? chat.title : "New Agent",
      chatId,
      chatIds: [chatId],
      updatedAt: chat.updatedAt || Date.now(),
      archivedAt: chat.archivedAt,
    });
  }

  return { agents, activeAgentId: nextActiveAgentId };
}

export function migrateToStoreV2(
  raw: unknown,
  fallbackModel = ""
): AgentsStoreV2 {
  if (raw && typeof raw === "object" && (raw as AgentsStoreV2).version === 2) {
    const store = raw as AgentsStoreV2 & { expandedAgentIds?: string[] };
    if (!Array.isArray(store.agents) || !store.chats || typeof store.chats !== "object") {
      return createDefaultStore(fallbackModel);
    }
    const chats = Object.fromEntries(
      Object.entries(store.chats || {}).map(([id, chat]) => [
        id,
        normalizeChat(chat as ChatSession, fallbackModel),
      ])
    );
    const normalized = normalizeAgents(
      store.agents as LegacyAgentRecord[],
      chats,
      store.activeAgentId || "",
      store.activeChatId || ""
    );
    return {
      version: 2,
      agents: normalized.agents,
      chats,
      activeAgentId: normalized.activeAgentId || normalized.agents[0]?.id || "",
      activeChatId: store.activeChatId || "",
      screen:
        store.screen === "chat"
          ? "chat"
          : store.screen === "archive"
            ? "archive"
            : store.screen === "settings"
              ? "settings"
              : "agents",
    };
  }

  const v1 = raw as PersistedSessionV1 | undefined;
  if (v1 && (Array.isArray(v1.history) || Array.isArray(v1.uiMessages))) {
    const chat: ChatSession = {
      id: uid("chat"),
      title: titleFromMessages(v1.uiMessages || []),
      selectedModel: v1.selectedModel || fallbackModel,
      selectedMode: "agent",
      history: Array.isArray(v1.history) ? v1.history : [],
      uiMessages: Array.isArray(v1.uiMessages) ? v1.uiMessages : [],
      updatedAt: v1.updatedAt || Date.now(),
    };
    const agent: AgentRecord = {
      id: uid("agent"),
      name: isMeaningfulTitle(chat.title) ? chat.title : "New Agent",
      chatId: chat.id,
      chatIds: [chat.id],
      updatedAt: chat.updatedAt,
    };
    return {
      version: 2,
      agents: [agent],
      chats: { [chat.id]: chat },
      activeAgentId: agent.id,
      activeChatId: chat.id,
      screen: "chat",
    };
  }

  return createDefaultStore(fallbackModel);
}

export function createDefaultStore(fallbackModel = ""): AgentsStoreV2 {
  const { agent, chat } = createEmptyAgent(fallbackModel);
  return {
    version: 2,
    agents: [agent],
    chats: { [chat.id]: chat },
    activeAgentId: agent.id,
    activeChatId: chat.id,
    screen: "chat",
  };
}

export function cloneStore(store: AgentsStoreV2): AgentsStoreV2 {
  return JSON.parse(JSON.stringify(store)) as AgentsStoreV2;
}

export function getActiveChat(store: AgentsStoreV2): ChatSession | undefined {
  return store.chats[store.activeChatId];
}

export function touchChat(
  store: AgentsStoreV2,
  chatId: string,
  patch: Partial<ChatSession>
): void {
  const chat = store.chats[chatId];
  if (!chat) {
    return;
  }
  const next: ChatSession = {
    ...chat,
    ...patch,
    updatedAt: Date.now(),
  };
  // Ветки держат своё имя («Ветка N»); не перетирать первым сообщением — у форков оно одинаковое.
  if (
    !next.parentChatId &&
    Array.isArray(next.uiMessages) &&
    next.uiMessages.length
  ) {
    next.title = titleFromMessages(next.uiMessages);
  }
  store.chats[chatId] = next;

  const agent = findAgentByChatId(store, chatId);
  if (agent) {
    agent.updatedAt = next.updatedAt;
    if (
      !next.parentChatId &&
      isDefaultTitle(agent.name) &&
      isMeaningfulTitle(next.title)
    ) {
      agent.name = next.title;
    }
  }
}

export function buildAgentsList(store: AgentsStoreV2): AgentListItem[] {
  return [...store.agents]
    .filter((agent) => {
      const chat = store.chats[agent.chatId];
      return Boolean(chat) && !agent.archivedAt && !chat.archivedAt;
    })
    .map((agent) => {
      const chat = store.chats[agent.chatId];
      return {
        id: agent.id,
        chatId: agent.chatId,
        name: getAgentDisplayName(agent, chat),
        model: chat?.selectedModel || "",
        preview: chat ? previewFromMessages(chat.uiMessages) : "Empty chat",
        updatedAt: agent.updatedAt,
        active: agent.id === store.activeAgentId,
        contextUsed:
          typeof chat?.contextTokens === "number" && chat.contextTokens > 0
            ? chat.contextTokens
            : 0,
        selectedModel: chat?.selectedModel || "",
        empty: !chatHasMessages(chat?.uiMessages),
      };
    });
}

function pickFallbackActive(store: AgentsStoreV2): void {
  const visible = store.agents.filter((a) => !a.archivedAt);
  for (const agent of visible) {
    const chat = store.chats[agent.chatId];
    if (chat && !chat.archivedAt) {
      store.activeAgentId = agent.id;
      store.activeChatId = agent.chatId;
      return;
    }
  }
  store.activeAgentId = visible[0]?.id || "";
  store.activeChatId = "";
}

/** Если активный агент/чат в архиве — переключает на видимый. */
export function ensureActiveVisible(store: AgentsStoreV2): void {
  const agent = store.agents.find((a) => a.id === store.activeAgentId);
  const chat = store.chats[store.activeChatId];
  const ids = agent ? getAgentChatIds(agent) : [];
  if (
    !agent ||
    agent.archivedAt ||
    !chat ||
    chat.archivedAt ||
    !ids.includes(store.activeChatId)
  ) {
    pickFallbackActive(store);
    return;
  }
  if (agent.chatId !== store.activeChatId) {
    agent.chatId = store.activeChatId;
  }
  if (!Array.isArray(agent.chatIds) || !agent.chatIds.length) {
    agent.chatIds = ids;
  }
}

/** Архивирует агента и все его чаты/ветки. */
export function archiveAgentInStore(
  store: AgentsStoreV2,
  agentId: string
): boolean {
  const agent = store.agents.find((a) => a.id === agentId);
  if (!agent || agent.archivedAt) {
    return false;
  }

  const now = Date.now();
  agent.archivedAt = now;
  agent.updatedAt = now;
  for (const chatId of getAgentChatIds(agent)) {
    const chat = store.chats[chatId];
    if (chat && !chat.archivedAt) {
      chat.archivedAt = now;
      chat.updatedAt = now;
    }
  }

  if (store.activeAgentId === agentId) {
    pickFallbackActive(store);
  }

  return true;
}

export interface ArchiveAgentItem {
  id: string;
  name: string;
  preview: string;
  archivedAt: number;
}

export function buildArchiveList(store: AgentsStoreV2): ArchiveAgentItem[] {
  return store.agents
    .filter((agent) => {
      const chat = store.chats[agent.chatId];
      return Boolean(chat) && (Boolean(agent.archivedAt) || Boolean(chat?.archivedAt));
    })
    .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0))
    .map((agent) => {
      const chat = store.chats[agent.chatId];
      return {
        id: agent.id,
        name: getAgentDisplayName(agent, chat),
        preview: chat ? previewFromMessages(chat.uiMessages) : "",
        archivedAt: agent.archivedAt || chat?.archivedAt || agent.updatedAt,
      };
    });
}

/** Восстанавливает агента и все его чаты/ветки из архива. */
export function restoreAgentInStore(
  store: AgentsStoreV2,
  agentId: string
): boolean {
  const agent = store.agents.find((a) => a.id === agentId);
  if (!agent) {
    return false;
  }
  const chatIds = getAgentChatIds(agent);
  const chats = chatIds
    .map((id) => store.chats[id])
    .filter((c): c is ChatSession => Boolean(c));
  if (!chats.length) {
    return false;
  }
  if (!agent.archivedAt && chats.every((c) => !c.archivedAt)) {
    return false;
  }
  const now = Date.now();
  agent.archivedAt = undefined;
  agent.updatedAt = now;
  for (const chat of chats) {
    chat.archivedAt = undefined;
    chat.updatedAt = now;
  }
  return true;
}

/** Безвозвратно удаляет агента и все его чаты/ветки. */
export function deleteAgentFromStore(
  store: AgentsStoreV2,
  agentId: string
): boolean {
  const agent = store.agents.find((a) => a.id === agentId);
  if (!agent) {
    return false;
  }
  for (const chatId of getAgentChatIds(agent)) {
    delete store.chats[chatId];
  }
  store.agents = store.agents.filter((a) => a.id !== agentId);
  if (store.activeAgentId === agentId) {
    pickFallbackActive(store);
  }
  return true;
}

export function formatListTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return "yesterday";
  }
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

export interface ChatBranchItem {
  id: string;
  label: string;
  active: boolean;
  canDelete: boolean;
  parentChatId?: string;
}

function cloneUiMessage(msg: UiMessage): UiMessage {
  const next: UiMessage = { role: msg.role, text: msg.text };
  if (msg.attachments?.length) {
    next.attachments = msg.attachments.map((a) => ({ ...a }));
  }
  if (msg.reasoning) {
    next.reasoning = msg.reasoning;
  }
  return next;
}

function cloneHistoryMessage(msg: ChatMessage): ChatMessage {
  const next: ChatMessage = { ...msg };
  if (msg.attachments?.length) {
    next.attachments = msg.attachments.map((a) => ({ ...a }));
  }
  if (Array.isArray(msg.tool_calls)) {
    next.tool_calls = msg.tool_calls.map((t) => ({
      ...t,
      function: { ...t.function },
    }));
  }
  return next;
}

/** Префикс истории/UI до сообщения включительно — для новой ветки. */
export function historyPrefixForBranch(
  history: ChatMessage[],
  uiMessages: UiMessage[],
  endInclusive: number
): { history: ChatMessage[]; uiMessages: UiMessage[] } | undefined {
  if (
    !Number.isInteger(endInclusive) ||
    endInclusive < 0 ||
    endInclusive >= uiMessages.length
  ) {
    return undefined;
  }
  const target = uiMessages[endInclusive];
  if (!target || (target.role !== "user" && target.role !== "assistant")) {
    return undefined;
  }
  if (target.role === "assistant" && !String(target.text || "").trim()) {
    return undefined;
  }

  const uiSlice = uiMessages.slice(0, endInclusive + 1).map(cloneUiMessage);
  let users = 0;
  let lastPairRole: "user" | "assistant" | null = null;
  for (const m of uiSlice) {
    if (m.role === "user") {
      users += 1;
      lastPairRole = "user";
    } else if (m.role === "assistant" && String(m.text || "").trim()) {
      lastPairRole = "assistant";
    }
  }
  if (users === 0) {
    return undefined;
  }
  const histLen =
    lastPairRole === "assistant" ? users * 2 : Math.max(0, users * 2 - 1);
  return {
    history: history
      .slice(0, Math.min(histLen, history.length))
      .map(cloneHistoryMessage),
    uiMessages: uiSlice,
  };
}

export function buildBranchesList(
  store: AgentsStoreV2,
  agentId: string
): ChatBranchItem[] {
  const agent = store.agents.find((a) => a.id === agentId);
  if (!agent) {
    return [];
  }
  const agentName = String(agent.name || "").trim() || "Agent";
  const ids = getAgentChatIds(agent);
  const canDelete =
    ids.filter((id) => {
      const chat = store.chats[id];
      return Boolean(chat) && !chat.archivedAt;
    }).length > 1;
  return ids
    .map((id, index) => {
      const chat = store.chats[id];
      if (!chat || chat.archivedAt) {
        return null;
      }
      // Корень — «Основная»; форки — «Имя агента · 2», «· 3», …
      const label =
        index === 0 ? "Main" : `${agentName} · ${index + 1}`;
      const item: ChatBranchItem = {
        id,
        label,
        active: id === store.activeChatId,
        canDelete,
      };
      if (chat.parentChatId) {
        item.parentChatId = chat.parentChatId;
      }
      return item;
    })
    .filter((b): b is ChatBranchItem => Boolean(b));
}

/**
 * Создаёт ветку от сообщения: копия префикса диалога, исходный чат не трогается.
 */
export function branchChatFromMessage(
  store: AgentsStoreV2,
  agentId: string,
  fromChatId: string,
  uiIndex: number,
  sourceHistory: ChatMessage[],
  sourceUi: UiMessage[]
): ChatSession | undefined {
  const agent = store.agents.find((a) => a.id === agentId);
  if (!agent || agent.archivedAt) {
    return undefined;
  }
  const ids = getAgentChatIds(agent);
  if (!ids.includes(fromChatId)) {
    return undefined;
  }
  const source = store.chats[fromChatId];
  if (!source || source.archivedAt) {
    return undefined;
  }

  const prefix = historyPrefixForBranch(sourceHistory, sourceUi, uiIndex);
  if (!prefix || !prefix.uiMessages.length) {
    return undefined;
  }

  const now = Date.now();
  const agentName = String(agent.name || "").trim() || "Agent";
  const branchIndex = ids.length + 1;
  const chat: ChatSession = {
    id: uid("chat"),
    title: `${agentName} · ${branchIndex}`,
    selectedModel: source.selectedModel || "",
    selectedMode: normalizeSelectedMode(source.selectedMode),
    history: prefix.history,
    uiMessages: prefix.uiMessages,
    updatedAt: now,
    parentChatId: fromChatId,
    branchedFromUiIndex: uiIndex,
    contextTokens: source.contextTokens,
  };
  if (source.lastTurnModel) {
    chat.lastTurnModel = source.lastTurnModel;
  }

  store.chats[chat.id] = chat;
  agent.chatIds = [...ids, chat.id];
  agent.chatId = chat.id;
  agent.updatedAt = now;
  store.activeAgentId = agentId;
  store.activeChatId = chat.id;
  return chat;
}

export function switchAgentBranch(
  store: AgentsStoreV2,
  agentId: string,
  chatId: string
): boolean {
  const agent = store.agents.find((a) => a.id === agentId);
  if (!agent || agent.archivedAt) {
    return false;
  }
  const ids = getAgentChatIds(agent);
  if (!ids.includes(chatId)) {
    return false;
  }
  const chat = store.chats[chatId];
  if (!chat || chat.archivedAt) {
    return false;
  }
  agent.chatId = chatId;
  agent.chatIds = ids;
  agent.updatedAt = Date.now();
  store.activeAgentId = agentId;
  store.activeChatId = chatId;
  return true;
}

/** Удаляет ветку. Последнюю ветку агента удалить нельзя. */
export function deleteAgentBranch(
  store: AgentsStoreV2,
  agentId: string,
  chatId: string
): boolean {
  const agent = store.agents.find((a) => a.id === agentId);
  if (!agent || agent.archivedAt) {
    return false;
  }
  const ids = getAgentChatIds(agent);
  if (!ids.includes(chatId) || ids.length < 2) {
    return false;
  }
  const chat = store.chats[chatId];
  if (!chat) {
    return false;
  }

  const remaining = ids.filter((id) => id !== chatId);
  delete store.chats[chatId];

  // Перенаправить дочерние ветки на родителя удалённой (или на первую оставшуюся).
  const fallbackParent = chat.parentChatId && remaining.includes(chat.parentChatId)
    ? chat.parentChatId
    : remaining[0];
  for (const id of remaining) {
    const child = store.chats[id];
    if (child?.parentChatId === chatId) {
      if (fallbackParent && fallbackParent !== id) {
        child.parentChatId = fallbackParent;
      } else {
        delete child.parentChatId;
        delete child.branchedFromUiIndex;
      }
    }
  }

  const nextActive =
    store.activeChatId === chatId || agent.chatId === chatId
      ? chat.parentChatId && remaining.includes(chat.parentChatId)
        ? chat.parentChatId
        : remaining[0]
      : store.activeChatId && remaining.includes(store.activeChatId)
        ? store.activeChatId
        : remaining[0];

  agent.chatIds = remaining;
  agent.chatId = nextActive;
  agent.updatedAt = Date.now();
  store.activeAgentId = agentId;
  store.activeChatId = nextActive;
  return true;
}

export type ChatSearchScope = "current" | "all";
export type ChatSearchRole = "all" | "user" | "assistant";
export type ChatSearchDate = "any" | "today" | "week" | "month";

export interface ChatSearchHit {
  agentId: string;
  agentName: string;
  chatId: string;
  messageIndex: number;
  role: "user" | "assistant";
  snippet: string;
  updatedAt: number;
}

export interface ChatSearchOptions {
  query: string;
  scope?: ChatSearchScope;
  role?: ChatSearchRole;
  date?: ChatSearchDate;
  /** Для scope=current */
  activeAgentId?: string;
  limit?: number;
}

function dateFilterSinceMs(date: ChatSearchDate, now = Date.now()): number | undefined {
  if (date === "any") {
    return undefined;
  }
  const start = new Date(now);
  if (date === "today") {
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  if (date === "week") {
    return now - 7 * 24 * 60 * 60 * 1000;
  }
  return now - 30 * 24 * 60 * 60 * 1000;
}

function makeSearchSnippet(text: string, query: string, radius = 48): string {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (!flat) {
    return "";
  }
  const lower = flat.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) {
    return flat.length > radius * 2 ? `${flat.slice(0, radius * 2)}…` : flat;
  }
  const start = Math.max(0, idx - radius);
  const end = Math.min(flat.length, idx + q.length + radius);
  let snip = flat.slice(start, end);
  if (start > 0) {
    snip = `…${snip}`;
  }
  if (end < flat.length) {
    snip = `${snip}…`;
  }
  return snip;
}

/**
 * Поиск по тексту сообщений агентов workspace.
 * Фильтр по дате опирается на updatedAt чата (у сообщений нет своей метки времени).
 */
export function searchChatMessages(
  store: AgentsStoreV2,
  options: ChatSearchOptions
): ChatSearchHit[] {
  const query = String(options.query || "").trim();
  if (query.length < 2) {
    return [];
  }

  const scope: ChatSearchScope = options.scope === "current" ? "current" : "all";
  const roleFilter: ChatSearchRole =
    options.role === "user" || options.role === "assistant"
      ? options.role
      : "all";
  const date: ChatSearchDate =
    options.date === "today" ||
    options.date === "week" ||
    options.date === "month"
      ? options.date
      : "any";
  const sinceMs = dateFilterSinceMs(date);
  const limit = Math.max(1, Math.min(100, options.limit ?? 50));
  const qLower = query.toLowerCase();
  const hits: ChatSearchHit[] = [];

  const agents =
    scope === "current" && options.activeAgentId
      ? store.agents.filter((a) => a.id === options.activeAgentId)
      : store.agents;

  for (const agent of agents) {
    if (agent.archivedAt) {
      continue;
    }
    for (const chatId of getAgentChatIds(agent)) {
      const chat = store.chats[chatId];
      if (!chat || chat.archivedAt) {
        continue;
      }
      if (typeof sinceMs === "number" && chat.updatedAt < sinceMs) {
        continue;
      }

      const messages = Array.isArray(chat.uiMessages) ? chat.uiMessages : [];
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (!msg || (msg.role !== "user" && msg.role !== "assistant")) {
          continue;
        }
        if (roleFilter !== "all" && msg.role !== roleFilter) {
          continue;
        }
        const text = String(msg.text || "");
        if (!text.toLowerCase().includes(qLower)) {
          continue;
        }
        hits.push({
          agentId: agent.id,
          agentName: agent.name || "Agent",
          chatId: chat.id,
          messageIndex: i,
          role: msg.role,
          snippet: makeSearchSnippet(text, query),
          updatedAt: chat.updatedAt,
        });
        if (hits.length >= limit) {
          return hits;
        }
      }
    }
  }

  return hits;
}
