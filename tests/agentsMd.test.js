const test = require("node:test");
const assert = require("node:assert/strict");

const {
  looksLikeAgentsMdRequest,
  buildAgentsMdDraft,
  collectAgentsMdDraftFromMessages,
  canBuildAgentsMdFromMessages,
} = require("../out/agentsMd.js");

test("looksLikeAgentsMdRequest detects create/update prompts", () => {
  assert.equal(
    looksLikeAgentsMdRequest(
      "Изучи репозиторий и создай или обнови файл AGENTS.md"
    ),
    true
  );
  assert.equal(looksLikeAgentsMdRequest("где Modal"), false);
});

test("buildAgentsMdDraft uses package.json and readme", () => {
  const md = buildAgentsMdDraft({
    packageJson: JSON.stringify({
      name: "briefings",
      version: "0.0.18",
      scripts: { dev: "vite", build: "tsc && vite build" },
      dependencies: { react: "18", effector: "23" },
      devDependencies: { vite: "5", typescript: "5" },
    }),
    readme: "Web-приложение для управления инструктажами.\n\nДетали.",
    srcEntries: ["app", "entities", "features", "shared"],
  });
  assert.match(md, /briefings/);
  assert.match(md, /инструктаж/i);
  assert.match(md, /npm run dev/);
  assert.match(md, /src\/app/);
  assert.match(md, /react/);
});

test("turnAlreadyWroteAgentsMd detects successful write", () => {
  const { turnAlreadyWroteAgentsMd } = require("../out/agentsMd.js");
  assert.equal(
    turnAlreadyWroteAgentsMd([
      {
        role: "tool",
        name: "write_file",
        content: JSON.stringify({ ok: true, path: "AGENTS.md", created: true }),
      },
    ]),
    true
  );
  assert.equal(turnAlreadyWroteAgentsMd([]), false);
});

test("collectAgentsMdDraftFromMessages reads tool payloads", () => {
  const messages = [
    {
      role: "tool",
      name: "read_file",
      content: JSON.stringify({
        path: "package.json",
        content: '{"name":"briefings","scripts":{"dev":"vite"}}',
      }),
    },
    {
      role: "tool",
      name: "list_files",
      content: JSON.stringify({
        path: "src",
        items: [
          { name: "app", type: "dir" },
          { name: "shared", type: "dir" },
        ],
      }),
    },
  ];
  assert.equal(canBuildAgentsMdFromMessages(messages), true);
  const draft = collectAgentsMdDraftFromMessages(messages);
  assert.ok(draft.packageJson);
  assert.deepEqual(draft.srcEntries, ["app", "shared"]);
});

test("collectAgentsMdDraftFromMessages skips truncated recovery payloads", () => {
  const messages = [
    {
      role: "tool",
      name: "read_file",
      content: JSON.stringify({
        path: "package.json",
        content: '{"name":"briefings"}\n…[truncated for recovery after model error]',
      }),
    },
    {
      role: "tool",
      name: "read_file",
      content: JSON.stringify({
        path: "README.md",
        content: "Web-приложение для управления инструктажами.",
      }),
    },
  ];
  const draft = collectAgentsMdDraftFromMessages(messages);
  assert.equal(draft.packageJson, undefined);
  assert.ok(draft.readme);
});

test("resolveAgentsMdDraftForRecovery fills holes from disk", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const {
    resolveAgentsMdDraftForRecovery,
    canRecoverAgentsMd,
  } = require("../out/agentsMd.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-md-"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "briefings", version: "0.0.18", scripts: { dev: "vite" } })
  );
  fs.writeFileSync(path.join(root, "README.md"), "Briefings app.\n");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "app.ts"), "");
  const messages = [
    {
      role: "tool",
      name: "read_file",
      content: JSON.stringify({
        path: "package.json",
        content: "x\n…[truncated for recovery after model error]",
      }),
    },
  ];
  assert.equal(canRecoverAgentsMd(messages, root), true);
  const draft = resolveAgentsMdDraftForRecovery(messages, root);
  assert.match(String(draft.packageJson), /briefings/);
  assert.match(String(draft.readme), /Briefings/);
  assert.ok(draft.srcEntries?.includes("app.ts"));
});
