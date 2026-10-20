const test = require("node:test");
const assert = require("node:assert/strict");

const { createTurnScopedValue } = require("../out/turnScopedValue.js");
const {
  withInspectableImages,
  getInspectableImages,
} = require("../out/inspectImagesContext.js");
const {
  createHarborContextBreakdownExtension,
  withContextBreakdownSink,
} = require("../out/contextBreakdownExtension.js");

/**
 * A reader registered outside any scope — its `.then` continuation runs
 * without the ALS store, like a Cline event-emitter callback.
 */
function outsideReader(read) {
  let fire;
  const result = new Promise((resolve) => {
    fire = resolve;
  }).then(() => read());
  return { fire: () => fire(), result };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("turnScopedValue: ALS value wins, even when empty", async () => {
  const scoped = createTurnScopedValue();
  const gateB = deferred();
  const runB = scoped.run(["b"], () => gateB.promise);
  await scoped.run([], async () => {
    assert.deepEqual(scoped.get(), []);
  });
  gateB.resolve();
  await runB;
  assert.equal(scoped.get(), undefined);
});

test("turnScopedValue: fallback only with exactly one open turn", async () => {
  const scoped = createTurnScopedValue();
  const gateA = deferred();
  const gateB = deferred();

  const alone = outsideReader(() => scoped.get());
  const runA = scoped.run("a", async () => {
    alone.fire();
    await gateA.promise;
  });
  assert.equal(await alone.result, "a");

  const overlap = outsideReader(() => scoped.get());
  const runB = scoped.run("b", async () => {
    overlap.fire();
    await gateB.promise;
  });
  // Two chats running: never hand A's value to B (or back).
  assert.equal(await overlap.result, undefined);

  // A finishes first — B must keep its value (old LIFO restore dropped it).
  gateA.resolve();
  await runA;
  assert.equal(scoped.get(), "b");

  gateB.resolve();
  await runB;
  assert.equal(scoped.get(), undefined);
});

test("turnScopedValue: scope closes when fn rejects or throws", async () => {
  const scoped = createTurnScopedValue();
  await assert.rejects(
    scoped.run("x", async () => {
      throw new Error("boom");
    })
  );
  assert.throws(() =>
    scoped.run("y", () => {
      throw new Error("sync");
    })
  );
  assert.equal(scoped.get(), undefined);
});

test("inspect images: parallel turns do not see each other's images", async () => {
  const gateA = deferred();
  const imgA = "data:image/png;base64,AAAA";
  const imgB = "data:image/png;base64,BBBB";
  const runA = withInspectableImages([imgA], async () => {
    await gateA.promise;
    assert.deepEqual(getInspectableImages(), [imgA]);
  });
  await withInspectableImages([imgB], async () => {
    assert.deepEqual(getInspectableImages(), [imgB]);
  });
  gateA.resolve();
  await runA;
  assert.deepEqual(getInspectableImages(), []);
});

test("context breakdown: overlapping turns skip ambiguous fallback", async () => {
  const ext = createHarborContextBreakdownExtension();
  const seenA = [];
  const seenB = [];
  const gateA = deferred();
  const gateB = deferred();
  const request = { systemPrompt: "s", tools: [], messages: [] };

  const runA = withContextBreakdownSink(
    (r) => seenA.push(r),
    () => gateA.promise
  );
  const outside = outsideReader(() => ext.hooks.beforeModel({ request }));
  const runB = withContextBreakdownSink(
    (r) => seenB.push(r),
    async () => {
      ext.hooks.beforeModel({ request });
      outside.fire();
      await gateB.promise;
    }
  );
  await outside.result;
  assert.equal(seenA.length, 0);
  assert.equal(seenB.length, 1);

  gateA.resolve();
  gateB.resolve();
  await Promise.all([runA, runB]);
});
