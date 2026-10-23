const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createGennadiyApiKeyResolver,
  refreshGennadiyAccessToken,
  setGennadiyRefreshHooks,
  startGennadiyKeepAlive,
  withGennadiyToken,
  wrapFetchWithGennadiyAuth,
} = require("../out/gennadiyTokenRefresh.js");

function useTempStore(keycloak) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harbor-gennadiy-"));
  process.env.XDG_DATA_HOME = dir;
  const file = path.join(dir, "gennadiy", "auth.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ keycloak }));
  return {
    read: () => JSON.parse(fs.readFileSync(file, "utf8")).keycloak,
  };
}

function tokenResponse(access, refresh = "refresh-new") {
  return new Response(
    JSON.stringify({
      access_token: access,
      refresh_token: refresh,
      expires_in: 1800,
    }),
    { status: 200 }
  );
}

test.afterEach(() => setGennadiyRefreshHooks({}));

test("refreshGennadiyAccessToken keeps a live token without network", async () => {
  useTempStore({
    access: "live",
    refresh: "r1",
    expires: Date.now() + 20 * 60_000,
  });
  let calls = 0;
  const token = await refreshGennadiyAccessToken({
    fetchFn: async () => {
      calls++;
      return tokenResponse("never");
    },
  });
  assert.equal(token, "live");
  assert.equal(calls, 0);
});

test("refreshGennadiyAccessToken refreshes near expiry once for concurrent callers", async () => {
  const store = useTempStore({
    access: "old",
    refresh: "r1",
    expires: Date.now() + 10_000,
  });
  let calls = 0;
  const refreshed = [];
  setGennadiyRefreshHooks({ onRefreshed: (access) => refreshed.push(access) });
  const fetchFn = async (_url, init) => {
    calls++;
    assert.match(String(init.body), /refresh_token=r1/);
    return tokenResponse("new");
  };
  const [a, b] = await Promise.all([
    refreshGennadiyAccessToken({ fetchFn }),
    refreshGennadiyAccessToken({ fetchFn }),
  ]);
  assert.equal(a, "new");
  assert.equal(b, "new");
  assert.equal(calls, 1);
  assert.deepEqual(refreshed, ["new"]);
  assert.equal(store.read().access, "new");
  assert.equal(store.read().refresh, "refresh-new");
});

test("refreshGennadiyAccessToken reports invalid_grant as rejected", async () => {
  useTempStore({ access: "old", refresh: "r1", expires: Date.now() - 1000 });
  const rejected = [];
  setGennadiyRefreshHooks({ onRejected: (err) => rejected.push(err) });
  const token = await refreshGennadiyAccessToken({
    fetchFn: async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
  });
  assert.equal(token, "");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].oauthError, "invalid_grant");
});

test("refreshGennadiyAccessToken times out a hung token endpoint", async () => {
  useTempStore({ access: "old", refresh: "r1", expires: Date.now() - 1000 });
  const rejected = [];
  setGennadiyRefreshHooks({ onRejected: (err) => rejected.push(err) });
  const started = Date.now();
  const token = await refreshGennadiyAccessToken({
    timeoutMs: 50,
    fetchFn: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
      }),
  });
  assert.equal(token, "");
  assert.ok(Date.now() - started < 2000);
  // A timeout is not a revoked session — no re-login prompt.
  assert.equal(rejected.length, 0);
});

test("withGennadiyToken replaces bearer and x-api-key headers", () => {
  const bearer = withGennadiyToken("https://gw/v1", {
    headers: { Authorization: "Bearer stale", "Content-Type": "application/json" },
  }, "fresh");
  assert.equal(bearer.headers.authorization, "Bearer fresh");
  assert.equal(bearer.headers["content-type"], "application/json");

  const anthropic = withGennadiyToken("https://gw/v1", {
    headers: { "x-api-key": "stale" },
  }, "fresh");
  assert.equal(anthropic.headers["x-api-key"], "fresh");
  assert.equal(anthropic.headers.authorization, undefined);
});

test("wrapFetchWithGennadiyAuth retries once with a fresh token after 401", async () => {
  useTempStore({ access: "t1", refresh: "r1", expires: Date.now() + 20 * 60_000 });
  const seen = [];
  const inner = async (_input, init) => {
    seen.push(init.headers.authorization);
    return new Response("{}", { status: seen.length === 1 ? 401 : 200 });
  };
  const forced = [];
  const refresh = async (options) => {
    forced.push(Boolean(options?.force));
    return options?.force ? "t2" : "t1";
  };
  const res = await wrapFetchWithGennadiyAuth(inner, refresh)(
    "https://gw/v1/chat/completions",
    { method: "POST", body: "{}", headers: { Authorization: "Bearer no-key" } }
  );
  assert.equal(res.status, 200);
  assert.deepEqual(seen, ["Bearer t1", "Bearer t2"]);
  assert.deepEqual(forced, [false, true]);
});

test("wrapFetchWithGennadiyAuth does not replay a stream body", async () => {
  useTempStore({ access: "t1", refresh: "r1", expires: Date.now() + 20 * 60_000 });
  let calls = 0;
  const inner = async () => {
    calls++;
    return new Response("{}", { status: 401 });
  };
  const res = await wrapFetchWithGennadiyAuth(inner, async () => "t1")(
    "https://gw/v1/chat/completions",
    { method: "POST", body: new ReadableStream(), duplex: "half" }
  );
  assert.equal(res.status, 401);
  assert.equal(calls, 1);
});

test("createGennadiyApiKeyResolver leaves other providers untouched", async () => {
  useTempStore({ access: "live", refresh: "r1", expires: Date.now() + 20 * 60_000 });
  const resolve = createGennadiyApiKeyResolver((url) => url.includes("gennadiy"));
  assert.equal(await resolve("https://api.other/v1", "sk-1"), "sk-1");
  assert.equal(await resolve("https://gennadiy.local/v1", "stale"), "live");
});

test("startGennadiyKeepAlive force-refreshes on a timer while enabled", async () => {
  useTempStore({ access: "t1", refresh: "r1", expires: Date.now() + 20 * 60_000 });
  const calls = [];
  let enabled = true;
  const stop = startGennadiyKeepAlive({
    shouldRun: () => enabled,
    firstDelayMs: 5,
    intervalMs: 20,
    refresh: async (options) => {
      calls.push(Boolean(options?.force));
      return "t2";
    },
  });
  await new Promise((r) => setTimeout(r, 60));
  enabled = false;
  const seen = calls.length;
  await new Promise((r) => setTimeout(r, 50));
  stop();
  assert.ok(seen >= 2, `expected first tick + interval ticks, got ${seen}`);
  assert.ok(calls.every(Boolean), "keep-alive refreshes are forced");
  assert.equal(calls.length, seen, "no ticks while disabled");
});

test("startGennadiyKeepAlive skips when there is no refresh token", async () => {
  useTempStore({ access: "t1", expires: Date.now() + 20 * 60_000 });
  let calls = 0;
  const stop = startGennadiyKeepAlive({
    shouldRun: () => true,
    firstDelayMs: 5,
    intervalMs: 20,
    refresh: async () => {
      calls++;
      return "";
    },
  });
  await new Promise((r) => setTimeout(r, 40));
  stop();
  assert.equal(calls, 0);
});

test("clineRuntime: session fetch is the wrapped providerConfig fetch", () => {
  const root = path.join(__dirname, "..");
  const runtime = fs.readFileSync(path.join(root, "out/clineRuntime.js"), "utf8");
  const bundle = fs.readFileSync(path.join(root, "out/clineBundle.js"), "utf8");
  // Cline prefers config.fetch over providerConfig.fetch — so config.fetch
  // must carry the Gennadiy wrapper, otherwise an old chat keeps its expired
  // start-time token and every request fails with 401 Unauthorized.
  assert.match(bundle, /let \w+=\w+\.fetch\?\?\w+\.fetch\?\?\w+;return \w+&&\(\w+\.fetch=\w+\)/);
  assert.match(runtime, /fetch: providerConfig\.fetch,/);
  assert.match(runtime, /providerConfig,\s*\n\s*\},\s*\n\s*\}\);/);
  assert.doesNotMatch(runtime, /fetch: \(?(\w+\.)?harborFetch\)?,/);
});
