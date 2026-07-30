const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createDefaultStore,
  branchChatFromMessage,
  archiveAgentInStore,
  restoreAgentInStore,
  deleteAgentBranch,
  searchChatMessages,
  summarizeMarkdownText,
  buildAgentsList,
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
  assert.deepEqual(agent.chatIds, [rootChat.id, branched.id]);
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
});
