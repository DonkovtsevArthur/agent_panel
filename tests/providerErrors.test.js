const test = require("node:test");
const assert = require("node:assert/strict");

const {
  explainKnownProviderError,
  humanizeProviderError,
  isAuthLikeProviderError,
  isModelAccessProviderError,
  isQuotaLikeProviderError,
} = require("../out/providerErrors.js");

test("isAuthLikeProviderError detects status 401/403", () => {
  assert.equal(isAuthLikeProviderError({ status: 401, message: "nope" }), true);
  assert.equal(isAuthLikeProviderError({ status: 403, message: "nope" }), true);
  assert.equal(isAuthLikeProviderError({ status: 500, message: "boom" }), false);
});

test("isAuthLikeProviderError detects API 401 / Unauthorized text", () => {
  assert.equal(isAuthLikeProviderError("API 401: Unauthorized"), true);
  assert.equal(isAuthLikeProviderError("API 403: Forbidden"), true);
  assert.equal(
    isAuthLikeProviderError("Incorrect API key provided: sk-***"),
    true
  );
  assert.equal(
    isAuthLikeProviderError(
      'OpenrouterException - {"error":{"message":"invalid api key"}}'
    ),
    true
  );
  assert.equal(
    isAuthLikeProviderError("AI_APICallError: Unauthorized"),
    true
  );
});

test("isAuthLikeProviderError ignores TLS rejectUnauthorized flag", () => {
  assert.equal(
    isAuthLikeProviderError("unable to verify: rejectUnauthorized=false"),
    false
  );
  assert.equal(
    isAuthLikeProviderError({ status: 502, message: "bad gateway" }),
    false
  );
});

test("explainKnownProviderError explains auth failures in ru/en", () => {
  const ru = explainKnownProviderError("API 401: Unauthorized", "ru");
  assert.match(ru, /401\/403/);
  assert.match(ru, /API Key/i);
  assert.match(ru, /Настройки/);

  const en = explainKnownProviderError("API 401: Unauthorized", "en");
  assert.match(en, /401\/403/);
  assert.match(en, /API key/i);
  assert.match(en, /Settings/i);
});

test("humanizeProviderError prefers auth explanation", () => {
  const text = humanizeProviderError(
    "API 401: Unauthorized\nlong litellm noise",
    "ru"
  );
  assert.match(text, /Модель отклонила ключ API/);
  assert.ok(!/long litellm noise/i.test(text));
});

test("isQuotaLikeProviderError still works for 429", () => {
  assert.equal(isQuotaLikeProviderError("API 429: quota exceeded"), true);
  assert.equal(isAuthLikeProviderError("API 429: quota exceeded"), false);
});

test("model-access 403 is not auth (no login prompt)", () => {
  const msg =
    "API 403: No team has access to the requested model: DeepSeek-V4-Flash. Checked teams={WebSSO gennadiy-df}";
  assert.equal(isModelAccessProviderError(msg), true);
  assert.equal(isAuthLikeProviderError(msg), false);
  assert.equal(isAuthLikeProviderError({ status: 403, message: msg }), false);
  const explained = explainKnownProviderError(msg, "ru");
  assert.match(explained, /не выдана вашей команде/);
  assert.ok(!/401\/403/.test(explained));
});
