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
