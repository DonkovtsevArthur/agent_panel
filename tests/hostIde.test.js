const test = require("node:test");
const assert = require("node:assert/strict");

const { hostIdeName } = require("../out/hostIde.js");

test("hostIdeName falls back to VS Code without HARBOR_HOST_IDE", () => {
  const prev = process.env.HARBOR_HOST_IDE;
  delete process.env.HARBOR_HOST_IDE;
  try {
    assert.equal(hostIdeName(), "VS Code");
  } finally {
    if (prev !== undefined) process.env.HARBOR_HOST_IDE = prev;
  }
});

test("hostIdeName uses the JetBrains product name from the sidecar env", () => {
  const prev = process.env.HARBOR_HOST_IDE;
  process.env.HARBOR_HOST_IDE = "WebStorm";
  try {
    assert.equal(hostIdeName(), "WebStorm");
  } finally {
    if (prev === undefined) delete process.env.HARBOR_HOST_IDE;
    else process.env.HARBOR_HOST_IDE = prev;
  }
});
