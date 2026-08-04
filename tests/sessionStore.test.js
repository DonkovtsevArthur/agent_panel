const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createDefaultStore,
  branchChatFromMessage,
  archiveAgentInStore,
  restoreAgentInStore,
  deleteAgentBranch,
  deleteAllArchivedAgentsFromStore,
  buildArchiveList,
  formatListTime,
  createEmptyAgent,
  searchChatMessages,
  summarizeMarkdownText,
  buildAgentsList,
  getAgentDisplayName,
  capUiMessageReasoning,
  collapseOldToolUiMessages,
  touchChat,
  MAX_PERSISTED_UI_REASONING_CHARS,
} = require("../out/sessionStore.js");

test("branchChatFromMessage creates an isolated branch and activates it", () => {
  const store = createDefaultStore("gpt-4.1");
  const agent = store.agents[0];
  const rootChat = store.chats[agent.chatId];
  rootChat.uiMessages = [
    { role: "user", text: "First prompt" },
    { role: "assistant", text: "First answer" },
    { role: "user", text: "Second prompt" },
  ];
  rootChat.history = [
    { role: "user", content: "First prompt" },
    { role: "assistant", content: "First answer" },
    { role: "user", content: "Second prompt" },
  ];
  rootChat.contextTokens = 123;
  rootChat.selectedMode = "plan";

  const branched = branchChatFromMessage(
    store,
    agent.id,
    rootChat.id,
    1,
    rootChat.history,
    rootChat.uiMessages
  );

  assert.ok(branched);
  assert.equal(store.activeChatId, branched.id);
  assert.equal(store.activeAgentId, agent.id);
  assert.deepEqual(
    branched.uiMessages.map((msg) => msg.text),
    ["First prompt", "First answer"]
  );
  assert.equal(branched.parentChatId, rootChat.id);
  assert.equal(branched.contextTokens, 123);
  assert.equal(branched.selectedMode, "plan");
  assert.deepEqual(agent.chatIds, [rootChat.id, branched.id]);
});

test("normalizeSelectedMode defaults empty to agent", () => {
  const {
    normalizeSelectedMode,
    migrateToStoreV2,
  } = require("../out/sessionStore.js");
  assert.equal(normalizeSelectedMode(""), "agent");
  assert.equal(normalizeSelectedMode("  "), "agent");
  assert.equal(normalizeSelectedMode(undefined), "agent");
  assert.equal(normalizeSelectedMode("plan"), "plan");
  assert.equal(normalizeSelectedMode(" ask "), "ask");

  const migrated = migrateToStoreV2(
    {
      version: 2,
      agents: [
        {
          id: "a1",
          name: "Test",
          chatId: "c1",
          chatIds: ["c1"],
          updatedAt: 1,
        },
      ],
      chats: {
        c1: {
          id: "c1",
          title: "Test",
          selectedModel: "gpt-4.1",
          history: [],
          uiMessages: [],
          updatedAt: 1,
        },
      },
      activeAgentId: "a1",
      activeChatId: "c1",
      screen: "chat",
    },
    "gpt-4.1"
  );
  assert.equal(migrated.chats.c1.selectedMode, "agent");
});

test("archive and restore keep chat visibility invariants", () => {
  const store = createDefaultStore("gpt-4.1");
  const agent = store.agents[0];
  const chat = store.chats[agent.chatId];

  assert.equal(archiveAgentInStore(store, agent.id), true);
  assert.ok(agent.archivedAt);
  assert.ok(chat.archivedAt);

  assert.equal(restoreAgentInStore(store, agent.id), true);
  assert.equal(agent.archivedAt, undefined);
  assert.equal(chat.archivedAt, undefined);
});

test("deleteAgentBranch rewires child branches to a surviving parent", () => {
  const store = createDefaultStore("gpt-4.1");
  const agent = store.agents[0];
  const rootChat = store.chats[agent.chatId];
  rootChat.uiMessages = [
    { role: "user", text: "Root question" },
    { role: "assistant", text: "Root answer" },
  ];
  rootChat.history = [
    { role: "user", content: "Root question" },
    { role: "assistant", content: "Root answer" },
  ];

  const branchA = branchChatFromMessage(
    store,
    agent.id,
    rootChat.id,
    1,
    rootChat.history,
    rootChat.uiMessages
  );
  assert.ok(branchA);
  const branchB = branchChatFromMessage(
    store,
    agent.id,
    branchA.id,
    1,
    branchA.history,
    branchA.uiMessages
  );
  assert.ok(branchB);

  assert.equal(deleteAgentBranch(store, agent.id, branchA.id), true);
  assert.equal(store.chats[branchB.id].parentChatId, rootChat.id);
  assert.ok(!store.chats[branchA.id]);
});

test("searchChatMessages respects scope, role and query length", () => {
  const store = createDefaultStore("gpt-4.1");
  const agent = store.agents[0];
  const chat = store.chats[agent.chatId];
  chat.uiMessages = [
    { role: "user", text: "Need MCP reconnect help" },
    { role: "assistant", text: "Let's inspect reconnect flow" },
  ];

  assert.equal(
    searchChatMessages(store, { query: "m", activeAgentId: agent.id }).length,
    0
  );

  const userHits = searchChatMessages(store, {
    query: "reconnect",
    scope: "current",
    role: "user",
    activeAgentId: agent.id,
  });
  assert.equal(userHits.length, 1);
  assert.equal(userHits[0].role, "user");
  assert.equal(userHits[0].chatId, chat.id);
});

test("capUiMessageReasoning truncates long Thinking for persist", () => {
  const messages = [
    { role: "assistant", text: "ok", reasoning: "R".repeat(MAX_PERSISTED_UI_REASONING_CHARS + 500) },
    { role: "user", text: "hi" },
  ];
  assert.equal(capUiMessageReasoning(messages), true);
  assert.equal(messages[0].reasoning.length, MAX_PERSISTED_UI_REASONING_CHARS);
  assert.ok(messages[0].reasoning.endsWith("…"));
  assert.equal(capUiMessageReasoning(messages), false);
});

test("touchChat caps reasoning on uiMessages patch", () => {
  const store = createDefaultStore("gpt-4.1");
  const chatId = store.activeChatId;
  touchChat(store, chatId, {
    uiMessages: [
      {
        role: "assistant",
        text: "done",
        reasoning: "T".repeat(MAX_PERSISTED_UI_REASONING_CHARS + 10),
      },
    ],
  });
  assert.equal(
    store.chats[chatId].uiMessages[0].reasoning.length,
    MAX_PERSISTED_UI_REASONING_CHARS
  );
});

test("collapseOldToolUiMessages keeps recent tools and inserts summary", () => {
  const messages = [
    { role: "user", text: "go" },
    ...Array.from({ length: 20 }, (_, i) => ({
      role: "tool",
      text: `⚙ read_file(${i})`,
      step: { stepId: `t${i}`, kind: "tool", name: "read_file", status: "done" },
    })),
    { role: "assistant", text: "plan" },
  ];
  const next = collapseOldToolUiMessages(messages, { keepRecentTools: 4 });
  assert.notStrictEqual(next, messages);
  const tools = next.filter((m) => m.role === "tool");
  // 1 summary + 4 recent
  assert.equal(tools.length, 5);
  assert.match(tools[0].text, /earlier tools compacted \(16\)/);
  assert.equal(tools[0].step?.kind, "compaction");
  assert.equal(next[0].role, "user");
  assert.equal(next[next.length - 1].role, "assistant");
  assert.equal(
    collapseOldToolUiMessages(messages, { keepRecentTools: 50 }),
    messages
  );
});

test("collapseOldToolUiMessages pins screenshot Plan preflight cards", () => {
  const messages = [
    { role: "user", text: "plan from screenshot" },
    {
      role: "tool",
      text: "⚙ vision_attached_screenshot",
      step: {
        stepId: "vision-1",
        kind: "tool",
        name: "vision_attached_screenshot",
        status: "done",
      },
    },
    {
      role: "tool",
      text: "⚙ screenshot_plan_explore",
      step: {
        stepId: "explore-1",
        kind: "tool",
        name: "screenshot_plan_explore",
        status: "done",
      },
    },
    ...Array.from({ length: 20 }, (_, i) => ({
      role: "tool",
      text: `⚙ read_file(${i})`,
      step: {
        stepId: `t${i}`,
        kind: "tool",
        name: "read_file",
        status: "done",
      },
    })),
  ];
  const next = collapseOldToolUiMessages(messages, { keepRecentTools: 4 });
  const names = next
    .filter((m) => m.role === "tool")
    .map((m) => m.step?.name)
    .filter(Boolean);
  assert.ok(names.includes("vision_attached_screenshot"));
  assert.ok(names.includes("screenshot_plan_explore"));
});

test("list summaries remove markdown and prefer prompt after selection fences", () => {
  const message =
    "```8:8:src/shared/libs/get-weather.ts\nfetchWeather()\n```\n\n**Перепиши** этот вызов";
  assert.equal(summarizeMarkdownText(message), "Перепиши этот вызов");
  assert.equal(
    summarizeMarkdownText("### Result\n- [Open file](https://example.com)"),
    "Result Open file"
  );

  const store = createDefaultStore("gpt-4.1");
  const agent = store.agents[0];
  const chat = store.chats[agent.chatId];
  agent.name = "```8:8:src/shared/libs/get-weather.ts";
  chat.uiMessages = [{ role: "user", text: message }];

  const rows = buildAgentsList(store);
  assert.equal(rows[0].name, "Перепиши этот вызов");
  assert.equal(rows[0].preview, "Перепиши этот вызов");
  assert.equal(
    getAgentDisplayName(agent, chat),
    "Перепиши этот вызов"
  );
});

test("formatListTime localizes yesterday and dates", () => {
  const now = Date.now();
  const yesterday = now - 24 * 60 * 60 * 1000;
  assert.equal(formatListTime(yesterday, "en"), "yesterday");
  assert.equal(formatListTime(yesterday, "ru"), "вчера");
  assert.match(formatListTime(now, "ru"), /^\d{2}:\d{2}$/);
});

test("deleteAllArchivedAgentsFromStore removes only archived agents", () => {
  const store = createDefaultStore("gpt-4.1");
  const keep = store.agents[0];
  keep.name = "Keep me";
  store.chats[keep.chatId].uiMessages = [
    { role: "user", text: "active chat" },
  ];

  const { agent: archived, chat: archivedChat } = createEmptyAgent("gpt-4.1");
  archived.name = "Archived";
  archivedChat.uiMessages = [{ role: "user", text: "old" }];
  store.agents.push(archived);
  store.chats[archivedChat.id] = archivedChat;
  assert.equal(archiveAgentInStore(store, archived.id), true);
  assert.equal(buildArchiveList(store).length, 1);

  const deleted = deleteAllArchivedAgentsFromStore(store);
  assert.equal(deleted, 1);
  assert.equal(buildArchiveList(store).length, 0);
  assert.ok(store.agents.some((a) => a.id === keep.id));
  assert.equal(store.agents.some((a) => a.id === archived.id), false);
});
