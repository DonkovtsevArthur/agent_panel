const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  gennadiyAuthJsonPath,
  isGennadiyProvider,
  readGennadiyAccessToken,
  resolveGennadiyApiKey,
} = require("../out/gennadiyAuth.js");

test("isGennadiyProvider matches id / name / baseUrl", () => {
  assert.equal(isGennadiyProvider({ id: "gennadiy" }), true);
  assert.equal(
    isGennadiyProvider({
      baseUrl: "https://gennadiy-test.kube.severstal.severstalgroup.com/gennadiy/v1",
    }),
    true
  );
  assert.equal(isGennadiyProvider({ name: "Gennadiy Gateway" }), true);
  assert.equal(
    isGennadiyProvider({
      id: "default",
      baseUrl: "https://api.openai.com/v1",
    }),
    false
  );
});

test("readGennadiyAccessToken uses CLI auth store", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gennadiy-auth-"));
  const prev = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    assert.equal(gennadiyAuthJsonPath(), path.join(dir, "gennadiy", "auth.json"));
    assert.equal(readGennadiyAccessToken(), "");
    assert.equal(resolveGennadiyApiKey("pasted-key"), "pasted-key");

    fs.mkdirSync(path.join(dir, "gennadiy"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "gennadiy", "auth.json"),
      JSON.stringify({
        keycloak: {
          type: "oauth",
          access: "live-token",
          expires: Date.now() + 3_600_000,
          email: "user@severstal.com",
        },
      })
    );
    assert.equal(readGennadiyAccessToken(), "live-token");
    // Live CLI token wins over a stale pasted key.
    assert.equal(resolveGennadiyApiKey("pasted-key"), "live-token");

    fs.writeFileSync(
      path.join(dir, "gennadiy", "auth.json"),
      JSON.stringify({
        keycloak: {
          type: "oauth",
          access: "expired-token",
          expires: Date.now() - 1000,
        },
      })
    );
    assert.equal(readGennadiyAccessToken(), "");
    assert.equal(resolveGennadiyApiKey("pasted-key"), "pasted-key");
  } finally {
    if (prev === undefined) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = prev;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
