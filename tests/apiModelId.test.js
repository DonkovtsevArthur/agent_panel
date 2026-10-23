const test = require("node:test");
const assert = require("node:assert/strict");

const { apiModelIdFromPicker } = require("../out/apiModelId.js");

test("explicit apiModelId wins over the picker id", () => {
  assert.equal(
    apiModelIdFromPicker("гена/deepseek-v4.1-flash", {
      apiModelId: "deepseek-v4.1-flash-x",
      providerId: "гена",
    }),
    "deepseek-v4.1-flash-x"
  );
});

test("WebStorm row without apiModelId: provider prefix is stripped", () => {
  assert.equal(
    apiModelIdFromPicker("гена/deepseek-v4.1-flash", { providerId: "гена" }),
    "deepseek-v4.1-flash"
  );
});

test("default-provider row keeps its id", () => {
  assert.equal(
    apiModelIdFromPicker("deepseek-v4.1-flash", { providerId: "default" }),
    "deepseek-v4.1-flash"
  );
});

test("unknown row keeps the picker id", () => {
  assert.equal(apiModelIdFromPicker("гена/x", undefined), "гена/x");
});
