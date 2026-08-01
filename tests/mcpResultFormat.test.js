const test = require("node:test");
const assert = require("node:assert/strict");

const {
  splitMcpToolResult,
  joinMcpToolResult,
} = require("../out/mcp/resultFormat.js");

test("splitMcpToolResult extracts base64 image parts and keeps text", () => {
  const split = splitMcpToolResult({
    content: [
      { type: "text", text: "node tree…" },
      {
        type: "image",
        mimeType: "image/png",
        data: "abc123",
      },
    ],
  });
  assert.equal(split.imageDataUrls.length, 1);
  assert.equal(split.imageDataUrls[0], "data:image/png;base64,abc123");
  assert.match(split.text, /node tree/);
  assert.match(split.text, /screenshot image 1/);
  assert.doesNotMatch(split.text, /abc123/);
});

test("splitMcpToolResult supports image_url parts", () => {
  const split = splitMcpToolResult({
    content: [
      {
        type: "image_url",
        image_url: { url: "data:image/jpeg;base64,zzz" },
      },
    ],
  });
  assert.deepEqual(split.imageDataUrls, ["data:image/jpeg;base64,zzz"]);
  assert.match(split.text, /screenshot image 1/);
});

test("joinMcpToolResult notes images without dumping bytes", () => {
  const joined = joinMcpToolResult({
    text: "hello",
    imageDataUrls: ["data:image/png;base64,xx"],
  });
  assert.match(joined, /hello/);
  assert.match(joined, /1 image/);
  assert.doesNotMatch(joined, /base64,xx/);
});
