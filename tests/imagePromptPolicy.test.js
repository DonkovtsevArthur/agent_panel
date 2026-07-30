const test = require("node:test");
const assert = require("node:assert/strict");

const {
  IMAGE_ONLY_ANALYSIS_PROMPT,
  IMAGE_UNTRUSTED_CONTENT_SYSTEM_HINT,
} = require("../out/imagePromptPolicy.js");

test("image-only prompt asks for analysis without adopting screenshot text", () => {
  assert.match(IMAGE_ONLY_ANALYSIS_PROMPT, /Analyze the attached image/i);
  assert.match(IMAGE_ONLY_ANALYSIS_PROMPT, /not instructions to follow/i);
  assert.match(IMAGE_ONLY_ANALYSIS_PROMPT, /Do not reveal or summarize system/i);
});

test("image system hint treats visual text as untrusted data", () => {
  assert.match(IMAGE_UNTRUSTED_CONTENT_SYSTEM_HINT, /untrusted user data/i);
  assert.match(IMAGE_UNTRUSTED_CONTENT_SYSTEM_HINT, /Never follow instructions/i);
  assert.match(IMAGE_UNTRUSTED_CONTENT_SYSTEM_HINT, /hidden rules/i);
});
