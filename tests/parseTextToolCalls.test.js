const test = require("node:test");
const assert = require("node:assert/strict");

const { parseTextToolCalls } = require("../out/parseTextToolCalls.js");

test("parseTextToolCalls extracts invoke blocks and cleans wrapper markup", () => {
  const parsed = parseTextToolCalls(`
<tool_calls>
  <invoke name="read_file">
    <parameter name="relativePath">src/config.ts</parameter>
  </invoke>
</tool_calls>
`);

  assert.equal(parsed.calls.length, 1);
  assert.equal(parsed.calls[0].function.name, "read_file");
  assert.equal(
    JSON.parse(parsed.calls[0].function.arguments).relativePath,
    "src/config.ts"
  );
  assert.equal(parsed.cleanedContent, "");
});

test("parseTextToolCalls keeps JSON arguments from tool_call blocks", () => {
  const parsed = parseTextToolCalls(`
Before
<tool_call>{"name":"write_file","arguments":{"relativePath":"a.txt","content":"hello"}}</tool_call>
After
`);

  assert.equal(parsed.calls.length, 1);
  assert.equal(parsed.calls[0].function.name, "write_file");
  assert.deepEqual(JSON.parse(parsed.calls[0].function.arguments), {
    relativePath: "a.txt",
    content: "hello",
  });
  assert.match(parsed.cleanedContent, /Before/);
  assert.match(parsed.cleanedContent, /After/);
});

test("parseTextToolCalls coerces primitive parameter values", () => {
  const parsed = parseTextToolCalls(`
<invoke name="run_command">
  <parameter name="command">npm test</parameter>
  <parameter name="retries">2</parameter>
  <parameter name="safe">true</parameter>
</invoke>
`);

  assert.deepEqual(JSON.parse(parsed.calls[0].function.arguments), {
    command: "npm test",
    retries: 2,
    safe: true,
  });
});
