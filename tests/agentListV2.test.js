const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createDefaultStore,
  buildAgentsList,
  setAgentPinnedInStore,
  duplicateAgentInStore,
  archiveAgentInStore,
  migrateToStoreV2,
} = require("../out/sessionStore.js");
const {
  reviewSeedPathsForChat,
  pendingDiffByAgent,
  AgentPendingDiffTracker,
} = require("../out/agentPendingDiff.js");

test("setAgentPinnedInStore pins, unpins and surfaces pinned in the list", () => {
  const store = createDefaultStore("m");
  const agent = store.agents[0];
  assert.equal(setAgentPinnedInStore(store, agent.id, true), true);
  assert.ok(agent.pinnedAt > 0);
  assert.equal(buildAgentsList(store)[0].pinned, true);
  assert.equal(setAgentPinnedInStore(store, agent.id, false), true);
  assert.equal(agent.pinnedAt, undefined);
  assert.equal(buildAgentsList(store)[0].pinned, false);
  assert.equal(setAgentPinnedInStore(store, "missing", true), false);
  archiveAgentInStore(store, agent.id);
  assert.equal(setAgentPinnedInStore(store, agent.id, true), false);
});

test("pinnedAt survives store migration", () => {
  const store = createDefaultStore("m");
  const agent = store.agents[0];
  setAgentPinnedInStore(store, agent.id, true);
  const migrated = migrateToStoreV2(JSON.parse(JSON.stringify(store)));
  const again = (migrated.agents || []).find((a) => a.id === agent.id);
  assert.ok(again && again.pinnedAt > 0);
});

test("buildAgentsList exposes the chat mode", () => {
  const store = createDefaultStore("m");
  store.chats[store.agents[0].chatId].selectedMode = "plan";
  assert.equal(buildAgentsList(store)[0].mode, "plan");
});

test("duplicateAgentInStore copies the active chat into a new first agent", () => {
  const store = createDefaultStore("m");
  const source = store.agents[0];
  const chat = store.chats[source.chatId];
  chat.uiMessages = [
    { role: "user", text: "Hello" },
    { role: "assistant", text: "Hi" },
  ];
  chat.history = [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi" },
  ];
  chat.lastAgentEditedPaths = ["src/a.ts"];
  source.name = "Export";
  const activeBefore = store.activeAgentId;

  const created = duplicateAgentInStore(store, source.id, " (copy)");
  assert.ok(created);
  assert.equal(store.agents[0].id, created.agent.id);
  assert.equal(created.agent.name, "Export (copy)");
  assert.notEqual(created.chat.id, chat.id);
  assert.deepEqual(
    created.chat.uiMessages.map((m) => m.text),
    ["Hello", "Hi"]
  );
  assert.equal(created.chat.lastAgentEditedPaths, undefined);
  // Copy is independent of the source.
  created.chat.uiMessages.push({ role: "user", text: "more" });
  assert.equal(chat.uiMessages.length, 2);
  // Host opens the copy itself — the store does not switch the active agent.
  assert.equal(store.activeAgentId, activeBefore);
});

test("reviewSeedPathsForChat collects unique review paths", () => {
  const paths = reviewSeedPathsForChat([
    { role: "user", text: "x" },
    {
      role: "review",
      text: JSON.stringify({ files: [{ path: "a.ts" }, { path: "b.ts" }] }),
    },
    { role: "review", text: JSON.stringify([{ path: "b.ts" }, { path: "c.ts" }]) },
    { role: "review", text: "not json" },
  ]);
  assert.deepEqual(paths, ["a.ts", "b.ts", "c.ts"]);
});

test("pendingDiffByAgent sums only still-dirty seed paths per agent", () => {
  const seeds = new Map([
    ["a1", ["src/a.ts", "src/b.ts"]],
    ["a2", ["src/c.ts"]],
  ]);
  const out = pendingDiffByAgent(seeds, [
    { path: "src/a.ts", added: 10, removed: 2, created: false },
    { path: "./src/b.ts", added: 5, removed: 0, created: false },
  ]);
  assert.deepEqual(out.get("a1"), { added: 15, removed: 2, files: 2 });
  assert.equal(out.has("a2"), false);
});

test("AgentPendingDiffTracker resolves once for all agents and notifies on change", async () => {
  const store = createDefaultStore("m");
  const chat = store.chats[store.agents[0].chatId];
  chat.uiMessages = [
    { role: "user", text: "do it" },
    { role: "review", text: JSON.stringify({ files: [{ path: "x.ts" }] }) },
  ];
  let calls = 0;
  let changes = 0;
  let dirty = [{ path: "x.ts", added: 3, removed: 1, created: false }];
  const tracker = new AgentPendingDiffTracker(
    () => store,
    () => {
      changes += 1;
    },
    async (paths) => {
      calls += 1;
      assert.deepEqual(paths, ["x.ts"]);
      return dirty;
    }
  );
  await tracker.refresh();
  assert.deepEqual(tracker.get(store.agents[0].id), {
    added: 3,
    removed: 1,
    files: 1,
  });
  assert.equal(changes, 1);
  await tracker.refresh();
  assert.equal(changes, 1, "no notify when nothing changed");
  dirty = [];
  await tracker.refresh();
  assert.equal(tracker.get(store.agents[0].id), undefined);
  assert.equal(changes, 2);
  assert.equal(calls, 3);
  tracker.dispose();
});
