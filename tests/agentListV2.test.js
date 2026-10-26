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
  agentLineDelta,
  agentLineEditsForChat,
  hashLine,
  lineSetsFromText,
  parseUnifiedDiffLines,
  reviewLinesOf,
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

test("parseUnifiedDiffLines collects added/removed lines per file", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 1..2 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1 +1,2 @@",
    "-old",
    "+new",
    "+--- not a header",
    "diff --git a/b.ts b/b.ts",
    "@@ -3,0 +4 @@",
    "+x",
  ].join("\n");
  const out = parseUnifiedDiffLines(diff);
  assert.deepEqual([...out.keys()], ["src/a.ts", "b.ts"]);
  assert.deepEqual(out.get("src/a.ts").r, { [hashLine("old")]: 1 });
  assert.deepEqual(out.get("src/a.ts").a, {
    [hashLine("new")]: 1,
    [hashLine("--- not a header")]: 1,
  });
});

test("agentLineDelta keeps only lines the turn itself added", () => {
  const start = new Map([["a.ts", lineSetsFromText("theirs\n")]]);
  const end = new Map([["a.ts", lineSetsFromText("theirs\nmine\nmine\n")]]);
  const delta = agentLineDelta(start, end, ["a.ts", "missing.ts"]);
  assert.deepEqual(delta, { "a.ts": { a: { [hashLine("mine")]: 2 }, r: {} } });
});

function reviewWithLines(lines) {
  return {
    role: "review",
    text: JSON.stringify({ files: Object.keys(lines).map((path) => ({ path })), lines }),
  };
}

test("pendingDiffByAgent counts only the agent's own still-dirty lines", () => {
  const mine = agentLineEditsForChat([
    reviewWithLines({ "src/a.ts": { a: { [hashLine("m1")]: 1 }, r: { [hashLine("gone")]: 1 } } }),
    reviewWithLines({ "src/a.ts": { a: { [hashLine("m2")]: 1 }, r: {} } }),
  ]);
  const live = new Map([
    // m2 уже закоммичен; t1/t2 — чужие правки в том же файле.
    ["./src/a.ts", {
      a: { [hashLine("m1")]: 1, [hashLine("t1")]: 1, [hashLine("t2")]: 1 },
      r: { [hashLine("gone")]: 1 },
    }],
  ]);
  const out = pendingDiffByAgent(new Map([["a1", mine], ["a2", new Map()]]), live);
  assert.deepEqual(out.get("a1"), { added: 1, removed: 1, files: 1 });
  assert.equal(out.has("a2"), false);
  assert.equal(pendingDiffByAgent(new Map([["a1", mine]]), new Map()).size, 0);
});

test("reviewLinesOf reads lines and tolerates legacy payloads", () => {
  const lines = { "a.ts": { a: { x: 1 }, r: {} } };
  assert.deepEqual(reviewLinesOf(JSON.stringify({ files: [], lines })), lines);
  assert.equal(reviewLinesOf(JSON.stringify([{ path: "a.ts" }])), undefined);
  assert.equal(reviewLinesOf("not json"), undefined);
});

test("AgentPendingDiffTracker resolves once for all agents and notifies on change", async () => {
  const store = createDefaultStore("m");
  const chat = store.chats[store.agents[0].chatId];
  chat.uiMessages = [
    { role: "user", text: "do it" },
    reviewWithLines({ "x.ts": { a: { [hashLine("l1")]: 1, [hashLine("l2")]: 1 }, r: {} } }),
  ];
  let calls = 0;
  let changes = 0;
  let live = new Map([["x.ts", lineSetsFromText("l1\nl2\nforeign\n")]]);
  const tracker = new AgentPendingDiffTracker(
    () => store,
    () => {
      changes += 1;
    },
    async (paths) => {
      calls += 1;
      assert.deepEqual(paths, ["x.ts"]);
      return live;
    }
  );
  await tracker.refresh();
  assert.deepEqual(tracker.get(store.agents[0].id), {
    added: 2,
    removed: 0,
    files: 1,
  });
  assert.equal(changes, 1);
  await tracker.refresh();
  assert.equal(changes, 1, "no notify when nothing changed");
  // Агент закоммитил свои строки — осталась только чужая правка.
  live = new Map([["x.ts", lineSetsFromText("foreign\n")]]);
  await tracker.refresh();
  assert.equal(tracker.get(store.agents[0].id), undefined);
  assert.equal(changes, 2);
  assert.equal(calls, 3);
  tracker.dispose();
});
