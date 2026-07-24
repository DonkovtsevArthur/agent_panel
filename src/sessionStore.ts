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
  chatIds: string[];
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
  /** UI: какие агенты раскрыты в списке */
  expandedAgentIds: string[];
}

/** Старый формат одной сессии. */
export interface PersistedSessionV1 {
  selectedModel: string;
  history: ChatMessage[];
  uiMessages: UiMessage[];
  updatedAt: number;
}

export interface AgentListChatItem {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
  active: boolean;
}

export interface AgentListItem {
  id: string;
  name: string;
  model: string;
  preview: string;
  updatedAt: number;
  open: boolean;
  active: boolean;
  chats: AgentListChatItem[];
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

function titleFromMessages(uiMessages: UiMessage[]): string {
  const firstUser = uiMessages.find((m) => m.role === "user" && m.text.trim());
  if (!firstUser) {
    return "Новый чат";
  }
  const text = firstUser.text.replace(/\s+/g, " ").trim();
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

export function createEmptyChat(selectedModel = ""): ChatSession {
  const now = Date.now();
  return {
    id: uid("chat"),
    title: "Новый чат",
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
      chatIds: [chat.id],
      updatedAt: now,
    },
    chat,
  };
}

export function migrateToStoreV2(
  raw: unknown,
  fallbackModel = ""
): AgentsStoreV2 {
  if (raw && typeof raw === "object" && (raw as AgentsStoreV2).version === 2) {
    const store = raw as AgentsStoreV2;
    if (!Array.isArray(store.agents) || typeof store.chats !== "object") {
      return createDefaultStore(fallbackModel);
    }
    return {
      version: 2,
      agents: store.agents,
      chats: store.chats || {},
      activeAgentId: store.activeAgentId || store.agents[0]?.id || "",
      activeChatId: store.activeChatId || "",
      screen:
        store.screen === "chat"
          ? "chat"
          : store.screen === "archive"
            ? "archive"
            : "agents",
      expandedAgentIds: Array.isArray(store.expandedAgentIds)
        ? store.expandedAgentIds
        : [],
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
      name: "Основной агент",
      chatIds: [chat.id],
      updatedAt: chat.updatedAt,
    };
    return {
      version: 2,
      agents: [agent],
      chats: { [chat.id]: chat },
      activeAgentId: agent.id,
      activeChatId: chat.id,
      screen: "agents",
      expandedAgentIds: [agent.id],
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
    expandedAgentIds: [agent.id],
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

  const agent = store.agents.find((a) => a.chatIds.includes(chatId));
  if (agent) {
    agent.updatedAt = next.updatedAt;
  }
}

export function buildAgentsList(store: AgentsStoreV2): AgentListItem[] {
  const expanded = new Set(store.expandedAgentIds);
  return [...store.agents]
    .filter((agent) => !agent.archivedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((agent) => {
      const chats = agent.chatIds
        .map((id) => store.chats[id])
        .filter((c): c is ChatSession => Boolean(c) && !c.archivedAt)
        .sort((a, b) => b.updatedAt - a.updatedAt);

      const top = chats[0];
      return {
        id: agent.id,
        name: agent.name,
        model: top?.selectedModel || "",
        preview: top ? previewFromMessages(top.uiMessages) : "Нет чатов",
        updatedAt: agent.updatedAt,
        open: chats.length > 0 && expanded.has(agent.id),
        active: agent.id === store.activeAgentId,
        chats: chats.map((c) => ({
          id: c.id,
          title: c.title || "Новый чат",
          preview: previewFromMessages(c.uiMessages),
          updatedAt: c.updatedAt,
          active: c.id === store.activeChatId,
        })),
      };
    });
}

function activeChatsOf(store: AgentsStoreV2, agent: AgentRecord): string[] {
  return agent.chatIds.filter((id) => {
    const chat = store.chats[id];
    return Boolean(chat) && !chat.archivedAt;
  });
}

function pickFallbackActive(store: AgentsStoreV2): void {
  const visible = store.agents.filter((a) => !a.archivedAt);
  for (const agent of visible) {
    const chats = activeChatsOf(store, agent);
    if (chats.length) {
      store.activeAgentId = agent.id;
      store.activeChatId = chats[0];
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
    !agent.chatIds.includes(chat.id)
  ) {
    pickFallbackActive(store);
  }
}

/** Архивирует чат. Если это был активный — переключает на другой. */
export function archiveChatInStore(
  store: AgentsStoreV2,
  agentId: string,
  chatId: string
): boolean {
  const agent = store.agents.find((a) => a.id === agentId);
  const chat = store.chats[chatId];
  if (!agent || !chat || !agent.chatIds.includes(chatId) || chat.archivedAt) {
    return false;
  }

  chat.archivedAt = Date.now();
  chat.updatedAt = chat.archivedAt;
  agent.updatedAt = chat.archivedAt;

  const remaining = activeChatsOf(store, agent);
  if (!remaining.length) {
    store.expandedAgentIds = store.expandedAgentIds.filter((id) => id !== agentId);
  }

  if (store.activeChatId === chatId) {
    if (remaining.length) {
      store.activeChatId = remaining[0];
      store.activeAgentId = agent.id;
    } else {
      pickFallbackActive(store);
    }
  }

  return true;
}

/** Архивирует агента (и все его чаты). */
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
  for (const id of agent.chatIds) {
    const chat = store.chats[id];
    if (chat && !chat.archivedAt) {
      chat.archivedAt = now;
      chat.updatedAt = now;
    }
  }
  store.expandedAgentIds = store.expandedAgentIds.filter((id) => id !== agentId);

  if (store.activeAgentId === agentId) {
    pickFallbackActive(store);
  }

  return true;
}

export interface ArchiveChatItem {
  id: string;
  title: string;
  preview: string;
  archivedAt: number;
}

export interface ArchiveAgentItem {
  id: string;
  name: string;
  archivedAt: number;
  chats: ArchiveChatItem[];
}

export interface ArchiveOrphanChatItem {
  agentId: string;
  agentName: string;
  chat: ArchiveChatItem;
}

export interface ArchiveList {
  agents: ArchiveAgentItem[];
  orphanChats: ArchiveOrphanChatItem[];
}

export function buildArchiveList(store: AgentsStoreV2): ArchiveList {
  const agents: ArchiveAgentItem[] = store.agents
    .filter((a) => Boolean(a.archivedAt))
    .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0))
    .map((agent) => {
      const chats = agent.chatIds
        .map((id) => store.chats[id])
        .filter((c): c is ChatSession => Boolean(c) && Boolean(c.archivedAt))
        .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0))
        .map((c) => ({
          id: c.id,
          title: c.title || "Новый чат",
          preview: previewFromMessages(c.uiMessages),
          archivedAt: c.archivedAt || c.updatedAt,
        }));
      return {
        id: agent.id,
        name: agent.name,
        archivedAt: agent.archivedAt || agent.updatedAt,
        chats,
      };
    });

  const orphanChats: ArchiveOrphanChatItem[] = [];
  for (const agent of store.agents.filter((a) => !a.archivedAt)) {
    for (const id of agent.chatIds) {
      const chat = store.chats[id];
      if (!chat?.archivedAt) {
        continue;
      }
      orphanChats.push({
        agentId: agent.id,
        agentName: agent.name,
        chat: {
          id: chat.id,
          title: chat.title || "Новый чат",
          preview: previewFromMessages(chat.uiMessages),
          archivedAt: chat.archivedAt,
        },
      });
    }
  }
  orphanChats.sort((a, b) => b.chat.archivedAt - a.chat.archivedAt);

  return { agents, orphanChats };
}

export function countArchived(store: AgentsStoreV2): number {
  const list = buildArchiveList(store);
  return (
    list.agents.length +
    list.agents.reduce((s, a) => s + a.chats.length, 0) +
    list.orphanChats.length
  );
}

/** Восстанавливает агента и все его чаты из архива. */
export function restoreAgentInStore(
  store: AgentsStoreV2,
  agentId: string
): boolean {
  const agent = store.agents.find((a) => a.id === agentId);
  if (!agent || !agent.archivedAt) {
    return false;
  }
  const now = Date.now();
  agent.archivedAt = undefined;
  agent.updatedAt = now;
  for (const id of agent.chatIds) {
    const chat = store.chats[id];
    if (chat) {
      chat.archivedAt = undefined;
      chat.updatedAt = now;
    }
  }
  return true;
}

/** Восстанавливает чат из архива (и агента, если он тоже был в архиве). */
export function restoreChatInStore(
  store: AgentsStoreV2,
  agentId: string,
  chatId: string
): boolean {
  const agent = store.agents.find((a) => a.id === agentId);
  const chat = store.chats[chatId];
  if (!agent || !chat || !agent.chatIds.includes(chatId) || !chat.archivedAt) {
    return false;
  }
  const now = Date.now();
  chat.archivedAt = undefined;
  chat.updatedAt = now;
  if (agent.archivedAt) {
    agent.archivedAt = undefined;
  }
  agent.updatedAt = now;
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
