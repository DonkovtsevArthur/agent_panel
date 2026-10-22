const test = require("node:test");
const assert = require("node:assert/strict");

const {
  GENNADIY_KEYCLOAK_DEFAULT,
  startKeycloakDeviceFlow,
  pollKeycloakDeviceToken,
  refreshKeycloakToken,
  gennadiyAuthStorePath,
} = require("../out/keycloakDeviceAuth.js");

test("startKeycloakDeviceFlow builds PKCE device request", async () => {
  let captured;
  const fetchFn = async (url, init) => {
    captured = { url, init };
    return new Response(
      JSON.stringify({
        device_code: "dev-1",
        user_code: "ABCD-EFGH",
        verification_uri: "https://sso.example/device",
        verification_uri_complete: "https://sso.example/device?user_code=ABCD-EFGH",
        expires_in: 600,
        interval: 1,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  const start = await startKeycloakDeviceFlow(GENNADIY_KEYCLOAK_DEFAULT, fetchFn);
  assert.equal(start.deviceCode, "dev-1");
  assert.equal(start.userCode, "ABCD-EFGH");
  assert.ok(start.verificationUriComplete.includes("user_code=ABCD-EFGH"));
  assert.ok(start.codeVerifier.length > 20);
  assert.match(String(captured.init.body), /code_challenge_method=S256/);
  assert.match(String(captured.init.body), /client_id=gennadiy-df/);
  assert.match(captured.url, /protocol\/openid-connect\/auth\/device$/);
});

test("pollKeycloakDeviceToken waits pending then returns tokens", async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    if (calls < 2) {
      return new Response(JSON.stringify({ error: "authorization_pending" }), {
        status: 400,
      });
    }
    return new Response(
      JSON.stringify({
        access_token: "hdr.payload.sig",
        refresh_token: "refresh-1",
        expires_in: 300,
      }),
      { status: 200 }
    );
  };
  const tokens = await pollKeycloakDeviceToken(
    {
      deviceCode: "dev-1",
      userCode: "ABCD",
      verificationUri: "https://x",
      verificationUriComplete: "https://x",
      expiresIn: 60,
      interval: 0,
      codeVerifier: "verifier",
    },
    GENNADIY_KEYCLOAK_DEFAULT,
    { fetchFn }
  );
  assert.equal(tokens.access, "hdr.payload.sig");
  assert.equal(tokens.refresh, "refresh-1");
  assert.ok(tokens.expires > Date.now());
});

test("gennadiyAuthStorePath points at CLI store", () => {
  assert.match(gennadiyAuthStorePath(), /gennadiy[/\\]auth\.json$/);
});

test("refreshKeycloakToken exchanges offline refresh token", async () => {
  const fetchFn = async (url, init) => {
    assert.match(String(init.body), /grant_type=refresh_token/);
    assert.match(String(init.body), /refresh_token=refresh-old/);
    return new Response(
      JSON.stringify({
        access_token: "a.b.c",
        refresh_token: "refresh-new",
        expires_in: 1800,
      }),
      { status: 200 }
    );
  };
  const tokens = await refreshKeycloakToken(
    "refresh-old",
    GENNADIY_KEYCLOAK_DEFAULT,
    fetchFn
  );
  assert.equal(tokens.access, "a.b.c");
  assert.equal(tokens.refresh, "refresh-new");
  assert.ok(tokens.expires > Date.now() + 1500 * 1000);
});
