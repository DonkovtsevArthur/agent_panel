const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createHarborTodoReminderExtension,
  createTodoReminderState,
  withTodoReminder,
  batchHasTodoCall,
  TODO_REMINDER_AFTER_TOOLS,
} = require("../out/todoReminder.js");

function assistant(calls) {
  return {
    role: "assistant",
    content: calls.map(([id, name]) => ({
      type: "tool-call",
      toolCallId: id,
      toolName: name,
      input: {},
    })),
  };
}

function ctx(messages, id, name) {
  return {
    snapshot: { parentAgentId: null, messages },
    tool: { name },
    toolCall: { toolCallId: id, toolName: name },
    result: { output: "ok" },
  };
}

test("batchHasTodoCall finds update_todo in the same assistant batch", () => {
  const msgs = [assistant([["a", "read_file"], ["b", "update_todo"]])];
  assert.equal(batchHasTodoCall(ctx(msgs, "a", "read_file")), true);
  assert.equal(
    batchHasTodoCall(ctx([assistant([["a", "read_file"]])], "a", "read_file")),
    false
  );
});

test("no reminder when update_todo is last in a sequential batch", async () => {
  const ext = createHarborTodoReminderExtension();
  const calls = [];
  for (let i = 0; i < TODO_REMINDER_AFTER_TOOLS; i += 1) {
    calls.push([`r${i}`, "read_file"]);
  }
  calls.push(["t", "update_todo"]);
  const msgs = [assistant(calls)];
  const state = createTodoReminderState(true, "en");
  await withTodoReminder(state, async () => {
    for (const [id, name] of calls) {
      assert.equal(ext.hooks.afterTool(ctx(msgs, id, name)), undefined);
    }
  });
  assert.equal(state.done, true);
});

test("reminder still fires when no batch has update_todo", async () => {
  const ext = createHarborTodoReminderExtension();
  const state = createTodoReminderState(true, "en");
  let fired;
  await withTodoReminder(state, async () => {
    for (let i = 0; i < TODO_REMINDER_AFTER_TOOLS; i += 1) {
      const msgs = [assistant([[`r${i}`, "read_file"]])];
      fired = ext.hooks.afterTool(ctx(msgs, `r${i}`, "read_file"));
    }
  });
  assert.ok(fired && /update_todo/.test(fired.result.output));
});

const {
  TODO_STALE_AFTER_TOOLS,
  TODO_STALE_AFTER_EDITS,
  TODO_STALE_MAX_REMINDERS,
  todoPlanFromInput,
  currentTodoStep,
} = require("../out/todoReminder.js");

const PLAN = {
  steps: [
    { title: "Reproduce with a test", status: "in_progress" },
    { title: "Fix the source/clock wiring", status: "pending" },
    { title: "Run tests", status: "pending" },
  ],
};

function todoCtx(id, input) {
  return {
    snapshot: { parentAgentId: null, messages: [assistant([[id, "update_todo"]])] },
    tool: { name: "update_todo" },
    toolCall: { toolCallId: id, toolName: "update_todo", input },
    input,
    result: { output: "Plan updated" },
  };
}

function soloCtx(id, name) {
  return ctx([assistant([[id, name]])], id, name);
}

test("todoPlanFromInput / currentTodoStep read the update_todo input", () => {
  const plan = todoPlanFromInput(PLAN);
  assert.equal(plan.length, 3);
  assert.equal(currentTodoStep(plan).title, "Reproduce with a test");
  assert.equal(todoPlanFromInput({}), null);
});

test("stale-plan note fires after edits without update_todo", async () => {
  const ext = createHarborTodoReminderExtension();
  const state = createTodoReminderState(true, "en");
  const fired = [];
  await withTodoReminder(state, async () => {
    ext.hooks.afterTool(todoCtx("t0", PLAN));
    for (let i = 0; i < TODO_STALE_AFTER_EDITS; i += 1) {
      const res = ext.hooks.afterTool(soloCtx(`e${i}`, "editor"));
      if (res) fired.push(res.result.output);
    }
  });
  assert.equal(fired.length, 1);
  assert.match(fired[0], /stale/);
  assert.match(fired[0], /Reproduce with a test/);
});

test("stale-plan note fires after many tool calls, capped per stale stretch", async () => {
  const ext = createHarborTodoReminderExtension();
  const state = createTodoReminderState(false, "ru");
  let count = 0;
  await withTodoReminder(state, async () => {
    ext.hooks.afterTool(todoCtx("t0", PLAN));
    for (let i = 0; i < TODO_STALE_AFTER_TOOLS * (TODO_STALE_MAX_REMINDERS + 2); i += 1) {
      if (ext.hooks.afterTool(soloCtx(`r${i}`, "read_files"))) count += 1;
    }
  });
  assert.equal(count, TODO_STALE_MAX_REMINDERS);
});

test("update_todo refills the stale-note budget for a long Build turn", async () => {
  const ext = createHarborTodoReminderExtension();
  const state = createTodoReminderState(false, "ru");
  let count = 0;
  const burst = (tag) => {
    for (let i = 0; i < TODO_STALE_AFTER_EDITS * (TODO_STALE_MAX_REMINDERS + 1); i += 1) {
      if (ext.hooks.afterTool(soloCtx(`${tag}${i}`, "editor"))) count += 1;
    }
  };
  await withTodoReminder(state, async () => {
    ext.hooks.afterTool(todoCtx("t0", PLAN));
    burst("a");
    ext.hooks.afterTool(todoCtx("t1", PLAN));
    burst("b");
  });
  // Before the fix the second stretch got nothing (budget was per turn).
  assert.equal(count, TODO_STALE_MAX_REMINDERS * 2);
});

test("update_todo resets the stale counters; finished plan stays quiet", async () => {
  const ext = createHarborTodoReminderExtension();
  const state = createTodoReminderState(true, "en");
  let fired = 0;
  await withTodoReminder(state, async () => {
    ext.hooks.afterTool(todoCtx("t0", PLAN));
    for (let i = 0; i < TODO_STALE_AFTER_EDITS - 1; i += 1) {
      if (ext.hooks.afterTool(soloCtx(`a${i}`, "editor"))) fired += 1;
    }
    ext.hooks.afterTool(todoCtx("t1", PLAN));
    for (let i = 0; i < TODO_STALE_AFTER_EDITS - 1; i += 1) {
      if (ext.hooks.afterTool(soloCtx(`b${i}`, "editor"))) fired += 1;
    }
    const done = { steps: PLAN.steps.map((s) => ({ ...s, status: "done" })) };
    ext.hooks.afterTool(todoCtx("t2", done));
    for (let i = 0; i < TODO_STALE_AFTER_TOOLS * 2; i += 1) {
      if (ext.hooks.afterTool(soloCtx(`c${i}`, "editor"))) fired += 1;
    }
  });
  assert.equal(fired, 0);
});
