import type { ChatMessage } from "./openaiClient";

export type UiMessageRole =
  | "user"
  | "assistant"
  | "system"
  | "tool"
  | "error"
  | "review";

export interface UiMessage {
  role: UiMessageRole;
  text: string;
}

export interface ChatSession {
  id: string;
  title: string;
  selectedModel: string;
  history: ChatMessage[];
  uiMessages: UiMessage[];
  updatedAt: number;
  /** Если задано — чат в архиве и скрыт из основного списка */
  archivedAt?: number;
  /** Последний известный расход контекста (токены). */
  contextTokens?: number;
}

export interface AgentRecord {
  id: string;
  name: string;
  chatId: string;
  updatedAt: number;
  /** Если задано — агент в архиве и скрыт из основного списка */
  archivedAt?: number;
}

export type PanelScreen = "agents" | "chat" | "archive";

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
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function previewFromMessages(uiMessages: UiMessage[]): string {
  for (let i = uiMessages.length - 1; i >= 0; i--) {
    const msg = uiMessages[i];
    if (msg.role === "assistant" || msg.role === "user") {
      const text = String(msg.text || "").replace(/\s+/g, " ").trim();
      if (text) {
        return text.length > 80 ? `${text.slice(0, 80)}…` : text;
      }
    }
  }
  return "Пустой чат";
}

function isDefaultTitle(value: string | undefined): boolean {
  const title = String(value || "").trim();
  return !title || title === "Новый агент" || title === "Новый чат";
}

function isMeaningfulTitle(value: string | undefined): boolean {
  return !isDefaultTitle(value) && String(value || "").trim() !== "Чат";
}

function titleFromMessages(uiMessages: UiMessage[]): string {
  const firstUser = uiMessages.find((m) => m.role === "user" && m.text.trim());
  if (!firstUser) {
    return "Новый агент";
  }
  const text = firstUser.text.replace(/\s+/g, " ").trim();
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

function createEmptyChat(selectedModel = ""): ChatSession {
  const now = Date.now();
  return {
    id: uid("chat"),
    title: "Новый агент",
    selectedModel,
    history: [],
    uiMessages: [],
    updatedAt: now,
  };
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
      name: "Новый агент",
      chatId: chat.id,
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
  return {
    ...chat,
    title: chat.title || titleFromMessages(chat.uiMessages || []),
    selectedModel: chat.selectedModel || fallbackModel,
    history: Array.isArray(chat.history) ? chat.history : [],
    uiMessages: Array.isArray(chat.uiMessages) ? chat.uiMessages : [],
    updatedAt: chat.updatedAt || Date.now(),
  };
}

function flattenAgents(
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
    const chatIds = Array.isArray(rawAgent.chatIds)
      ? rawAgent.chatIds
      : rawAgent.chatId
        ? [rawAgent.chatId]
        : [];
    const existingChatIds = chatIds.filter((chatId) => {
      if (!chats[chatId]) {
        return false;
      }
      referencedChatIds.add(chatId);
      return true;
    });

    existingChatIds.forEach((chatId, index) => {
      const chat = chats[chatId];
      const single = existingChatIds.length === 1;
      const baseName = rawAgent.name || "Новый агент";
      const name =
        single || index === 0
          ? baseName
          : isMeaningfulTitle(chat.title)
            ? chat.title
            : baseName;
      const id =
        single || index === 0
          ? uniqueAgentId(rawAgent.id || "", used)
          : uniqueAgentId(`${rawAgent.id || "agent"}_${chatId}`, used);
      if (rawAgent.id === activeAgentId && chatId === activeChatId) {
        nextActiveAgentId = id;
      }
      agents.push({
        id,
        name: name || "Новый агент",
        chatId,
        updatedAt: Math.max(rawAgent.updatedAt || 0, chat.updatedAt || 0),
        archivedAt: rawAgent.archivedAt || chat.archivedAt,
      });
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
      name: isMeaningfulTitle(chat.title) ? chat.title : "Новый агент",
      chatId,
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
    const flattened = flattenAgents(
      store.agents as LegacyAgentRecord[],
      chats,
      store.activeAgentId || "",
      store.activeChatId || ""
    );
    return {
      version: 2,
      agents: flattened.agents,
      chats,
      activeAgentId: flattened.activeAgentId || flattened.agents[0]?.id || "",
      activeChatId: store.activeChatId || "",
      screen:
        store.screen === "chat"
          ? "chat"
          : store.screen === "archive"
            ? "archive"
            : "agents",
    };
  }

  const v1 = raw as PersistedSessionV1 | undefined;
  if (v1 && (Array.isArray(v1.history) || Array.isArray(v1.uiMessages))) {
    const chat: ChatSession = {
      id: uid("chat"),
      title: titleFromMessages(v1.uiMessages || []),
      selectedModel: v1.selectedModel || fallbackModel,
      history: Array.isArray(v1.history) ? v1.history : [],
      uiMessages: Array.isArray(v1.uiMessages) ? v1.uiMessages : [],
      updatedAt: v1.updatedAt || Date.now(),
    };
    const agent: AgentRecord = {
      id: uid("agent"),
      name: isMeaningfulTitle(chat.title) ? chat.title : "Новый агент",
      chatId: chat.id,
      updatedAt: chat.updatedAt,
    };
    return {
      version: 2,
      agents: [agent],
      chats: { [chat.id]: chat },
      activeAgentId: agent.id,
      activeChatId: chat.id,
      screen: "agents",
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
    screen: "agents",
  };
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
  if (Array.isArray(next.uiMessages) && next.uiMessages.length) {
    next.title = titleFromMessages(next.uiMessages);
  }
  store.chats[chatId] = next;

  const agent = store.agents.find((a) => a.chatId === chatId);
  if (agent) {
    agent.updatedAt = next.updatedAt;
    if (isDefaultTitle(agent.name) && isMeaningfulTitle(next.title)) {
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
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((agent) => {
      const chat = store.chats[agent.chatId];
      return {
        id: agent.id,
        chatId: agent.chatId,
        name: agent.name,
        model: chat?.selectedModel || "",
        preview: chat ? previewFromMessages(chat.uiMessages) : "Пустой чат",
        updatedAt: agent.updatedAt,
        active: agent.id === store.activeAgentId,
        contextUsed:
          typeof chat?.contextTokens === "number" && chat.contextTokens > 0
            ? chat.contextTokens
            : 0,
        selectedModel: chat?.selectedModel || "",
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
  if (
    !agent ||
    agent.archivedAt ||
    !chat ||
    chat.archivedAt ||
    agent.chatId !== chat.id
  ) {
    pickFallbackActive(store);
  }
}

/** Архивирует агента и его единственный чат. */
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
  const chat = store.chats[agent.chatId];
  if (chat && !chat.archivedAt) {
    chat.archivedAt = now;
    chat.updatedAt = now;
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
        name: agent.name,
        preview: chat ? previewFromMessages(chat.uiMessages) : "",
        archivedAt: agent.archivedAt || chat?.archivedAt || agent.updatedAt,
      };
    });
}

export function countArchived(store: AgentsStoreV2): number {
  return buildArchiveList(store).length;
}

/** Восстанавливает агента и его единственный чат из архива. */
export function restoreAgentInStore(
  store: AgentsStoreV2,
  agentId: string
): boolean {
  const agent = store.agents.find((a) => a.id === agentId);
  const chat = agent ? store.chats[agent.chatId] : undefined;
  if (!agent || !chat || (!agent.archivedAt && !chat.archivedAt)) {
    return false;
  }
  const now = Date.now();
  agent.archivedAt = undefined;
  agent.updatedAt = now;
  chat.archivedAt = undefined;
  chat.updatedAt = now;
  return true;
}

/** Безвозвратно удаляет агента и его чат. */
export function deleteAgentFromStore(
  store: AgentsStoreV2,
  agentId: string
): boolean {
  const agent = store.agents.find((a) => a.id === agentId);
  if (!agent) {
    return false;
  }
  delete store.chats[agent.chatId];
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
    return d.toLocaleTimeString("ru-RU", {
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
    return "вчера";
  }
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
