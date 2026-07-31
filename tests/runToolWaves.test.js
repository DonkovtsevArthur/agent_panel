const test = require("node:test");
const assert = require("node:assert/strict");

const { executeToolCallsInOrder } = require("../out/runToolWaves.js");

function call(name, args = "{}", id) {
  return {
    id: id || `call_${name}`,
    type: "function",
    function: { name, arguments: args },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("executeToolCallsInOrder keeps original result order", async () => {
  const toolCalls = [
    call("read_file", '{"relativePath":"a.ts"}', "1"),
    call("write_file", '{"relativePath":"b.ts"}', "2"),
    call("read_file", '{"relativePath":"c.ts"}', "3"),
  ];
  const order = [];
  const executed = await executeToolCallsInOrder({
    toolCalls,
    formatStatus: (name) => ({ phase: "reading", detail: name }),
    invokeOne: async (c) => {
      order.push(c.id);
      if (c.function.name === "read_file") {
        await sleep(20);
      }
      return `ok:${c.id}`;
    },
  });
  assert.deepEqual(
    executed.map((item) => item.result),
    ["ok:1", "ok:2", "ok:3"]
  );
  assert.deepEqual(
    executed.map((item) => item.call.id),
    ["1", "2", "3"]
  );
  assert.deepEqual(order, ["1", "2", "3"]);
});

test("executeToolCallsInOrder runs consecutive reads in parallel", async () => {
  const toolCalls = [
    call("read_file", "{}", "a"),
    call("read_file", "{}", "b"),
    call("list_files", "{}", "c"),
  ];
  const started = [];
  const finished = [];
  const t0 = Date.now();
  const executed = await executeToolCallsInOrder({
    toolCalls,
    formatStatus: (name) => ({ phase: "reading", detail: name }),
    invokeOne: async (c) => {
      started.push(c.id);
      await sleep(80);
      finished.push(c.id);
      return `ok:${c.id}`;
    },
  });
  const elapsed = Date.now() - t0;
  assert.deepEqual(
    executed.map((item) => item.result),
    ["ok:a", "ok:b", "ok:c"]
  );
  // Three 80ms serial awaits would be ~240ms; parallel wave should finish near one delay.
  assert.ok(
    elapsed < 200,
    `expected parallel wave under 200ms, got ${elapsed}ms`
  );
  assert.equal(started.length, 3);
  assert.equal(finished.length, 3);
});

test("executeToolCallsInOrder keeps write_file serial relative to reads", async () => {
  const toolCalls = [
    call("read_file", "{}", "r1"),
    call("read_file", "{}", "r2"),
    call("write_file", "{}", "w"),
    call("read_file", "{}", "r3"),
  ];
  const active = { n: 0, max: 0 };
  await executeToolCallsInOrder({
    toolCalls,
    formatStatus: (name) => ({ phase: "reading", detail: name }),
    invokeOne: async (c) => {
      active.n += 1;
      active.max = Math.max(active.max, active.n);
      await sleep(30);
      active.n -= 1;
      return c.id;
    },
  });
  // First wave can run 2 reads together; write and final read are alone.
  assert.ok(active.max >= 2, "expected parallel reads");
  assert.ok(active.max <= 2, `write must not overlap reads, max=${active.max}`);
});

test("executeToolCallsInOrder emits queued→running→done lifecycle", async () => {
  const toolCalls = [
    call("read_file", "{}", "a"),
    call("read_file", "{}", "b"),
  ];
  const events = [];
  await executeToolCallsInOrder({
    toolCalls,
    formatStatus: (name) => ({ phase: "reading", detail: name }),
    onToolLifecycle: (call, status) => {
      events.push(`${call.id}:${status}`);
    },
    invokeOne: async (c) => `ok:${c.id}`,
  });
  assert.deepEqual(events, [
    "a:queued",
    "b:queued",
    "a:running",
    "b:running",
    "a:done",
    "b:done",
  ]);
});

test("executeToolCallsInOrder marks error lifecycle on error JSON", async () => {
  const toolCalls = [call("write_file", "{}", "w")];
  const events = [];
  await executeToolCallsInOrder({
    toolCalls,
    formatStatus: (name) => ({ phase: "editing", detail: name }),
    onToolLifecycle: (call, status) => {
      events.push(`${call.id}:${status}`);
    },
    invokeOne: async () => JSON.stringify({ error: "denied" }),
  });
  assert.deepEqual(events, ["w:queued", "w:running", "w:error"]);
});
