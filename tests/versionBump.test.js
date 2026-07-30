const test = require("node:test");
const assert = require("node:assert/strict");

const {
  looksLikeVersionClarification,
  parseVersionClarification,
  looksLikeVersionFollowUpReply,
  resolveTargetVersion,
  resolveVersionBumpFollowUp,
  applyPackageJsonVersion,
  bumpPatchVersion,
  looksLikeRefusedRequestedEdit,
} = require("../out/versionBump.js");
const { decideHonestFinale, MISSING_WRITE_USER_VISIBLE } = require("../out/honestFinale.js");
const { looksLikeUserEditRequest } = require("../out/claimedEdits.js");

const CLARIFY =
  "Уточни, пожалуйста, на какую версию менять? Сейчас в `package.json` стоит **0.0.18** — поднять patch до **0.0.19**, или у тебя есть конкретная версия?";

test("detects version clarification and parses current/suggested", () => {
  assert.equal(looksLikeVersionClarification(CLARIFY), true);
  assert.deepEqual(parseVersionClarification(CLARIFY), {
    current: "0.0.18",
    suggested: "0.0.19",
  });
});

test("resolves short follow-ups to target version", () => {
  assert.equal(looksLikeVersionFollowUpReply("19"), true);
  assert.equal(looksLikeVersionFollowUpReply("да"), true);
  assert.equal(looksLikeVersionFollowUpReply("0.0.19"), true);
  assert.equal(looksLikeVersionFollowUpReply("поменяй ещё что-нибудь"), false);

  const clarification = { current: "0.0.18", suggested: "0.0.19" };
  assert.equal(resolveTargetVersion("19", clarification), "0.0.19");
  assert.equal(resolveTargetVersion("да", clarification), "0.0.19");
  assert.equal(resolveTargetVersion("0.1.0", clarification), "0.1.0");
  assert.equal(bumpPatchVersion("0.0.18"), "0.0.19");
});

test("resolveVersionBumpFollowUp uses last assistant clarification", () => {
  const resolved = resolveVersionBumpFollowUp("19", [
    { role: "user", content: "поменяй версию приложения" },
    { role: "assistant", content: CLARIFY },
  ]);
  assert.ok(resolved);
  assert.equal(resolved.targetVersion, "0.0.19");
});

test("resolveLocalVersionBump patches after version report", () => {
  const {
    looksLikeVersionChangeRequest,
    extractReportedAppVersion,
    resolveLocalVersionBump,
  } = require("../out/versionBump.js");
  assert.equal(looksLikeVersionChangeRequest("давай ее поменяем"), true);
  assert.equal(looksLikeVersionChangeRequest("какая версия сейчас"), false);
  assert.equal(
    extractReportedAppVersion("Версия приложения: **0.0.18** (из `package.json`)."),
    "0.0.18"
  );
  const resolved = resolveLocalVersionBump("давай ее поменяем", [
    { role: "user", content: "какая версия сейчас у приложения?" },
    {
      role: "assistant",
      content: "Версия приложения: **0.0.18** (из `package.json`).",
    },
  ]);
  assert.ok(resolved && "targetVersion" in resolved);
  assert.equal(resolved.targetVersion, "0.0.19");
  assert.equal(resolved.source, "assistant_patch");

  const fromDisk = resolveLocalVersionBump("поменяй версию", []);
  assert.deepEqual(fromDisk, { readPackageAndBumpPatch: true });
});

test("applyPackageJsonVersion replaces top-level version", () => {
  const before = '{\n  "name": "x",\n  "version": "0.0.18",\n  "private": true\n}\n';
  const applied = applyPackageJsonVersion(before, "0.0.19");
  assert.equal(applied.ok, true);
  assert.equal(applied.previous, "0.0.18");
  assert.match(applied.content, /"version": "0.0.19"/);
  const same = applyPackageJsonVersion(applied.content, "0.0.19");
  assert.equal(same.ok, false);
  assert.match(String(same.error), /^already:/);
});

test("looksLikeUserEditRequest catches version bump asks", () => {
  assert.equal(looksLikeUserEditRequest("поменяй версию приложения"), true);
});

test("honest finale nudges refused edit when user asked to change", () => {
  assert.equal(
    looksLikeRefusedRequestedEdit(
      "Версия в package.json уже установлена на 0.0.19 — менять нечего."
    ),
    true
  );
  const decision = decideHonestFinale({
    text: "Версия в package.json уже установлена на 0.0.19 — менять нечего.",
    canEdit: true,
    messages: [],
    userText: "поменяй версию приложения",
    hadSuccessfulWrite: false,
    allowNudgeWrite: true,
  });
  assert.equal(decision.kind, "nudge_write");

  const replaced = decideHonestFinale({
    text: "Версия уже стоит 0.0.19 — менять нечего.",
    canEdit: true,
    messages: [],
    userText: "поменяй версию",
    hadSuccessfulWrite: false,
    allowNudgeWrite: false,
  });
  assert.equal(replaced.kind, "replace");
  assert.equal(replaced.text, MISSING_WRITE_USER_VISIBLE);
});
