const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isParallelSafeTool,
  planToolWaves,
} = require("../out/toolParallel.js");

test("read-only built-ins are parallel-safe", () => {
  assert.equal(isParallelSafeTool("read_file"), true);
  assert.equal(isParallelSafeTool("list_files"), true);
  assert.equal(isParallelSafeTool("get_diagnostics"), true);
  assert.equal(isParallelSafeTool("fetch_url"), true);
  assert.equal(isParallelSafeTool("open_external"), true);
  assert.equal(isParallelSafeTool("delegate_task"), true);
  assert.equal(isParallelSafeTool("write_file"), false);
  assert.equal(isParallelSafeTool("search_replace"), false);
  assert.equal(isParallelSafeTool("run_command"), false);
});

test("planToolWaves groups consecutive delegate_task probes", () => {
  assert.deepEqual(
    planToolWaves(["delegate_task", "delegate_task", "delegate_task", "write_file"]),
    [[0, 1, 2], [3]]
  );
});

test("readonly MCP tools are parallel-safe", () => {
  assert.equal(isParallelSafeTool("mcp__demo__list_items"), true);
  assert.equal(isParallelSafeTool("mcp__demo__create_ticket"), false);
});

test("planToolWaves groups consecutive reads", () => {
  assert.deepEqual(
    planToolWaves([
      "read_file",
      "read_file",
      "write_file",
      "search_replace",
      "read_file",
      "run_command",
    ]),
    [[0, 1], [2], [3], [4], [5]]
  );
});
