const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  selectCatalogSkills,
  harborSkillsRulesForLanguage,
  appendSkillsRuntimeNudge,
  SKILL_RULES_MAX_SKILLS,
} = require("../out/harborSkills.js");
const {
  appendSkillUsage,
  buildSkillUsageEntry,
  skillNameFromToolInput,
  skillUsageLogPath,
  summarizeSkillUsage,
} = require("../out/skillUsageLog.js");

const BUNDLED = path.join(__dirname, "..", "bundled-skills");

function skill(name, source, bundled) {
  return { name, description: `${name} desc`, source, ...(bundled ? { bundled: true } : {}) };
}

test("selectCatalogSkills keeps everything under the cap", () => {
  const list = [skill("b", "global"), skill("a", "workspace")];
  const out = selectCatalogSkills(list);
  assert.deepEqual(out.dropped, []);
  assert.equal(out.skills.length, 2);
});

test("selectCatalogSkills drops by source priority, not alphabet", () => {
  const list = [
    skill("a-extra", "extra"),
    skill("b-own-global", "global"),
    skill("c-bundled", "global", true),
    skill("z-workspace", "workspace"),
  ];
  const out = selectCatalogSkills(list, 2);
  assert.deepEqual(
    out.skills.map((s) => s.name),
    ["c-bundled", "z-workspace"]
  );
  assert.deepEqual(out.dropped, ["a-extra", "b-own-global"]);
});

test("catalog rules and nudge use the same selection", () => {
  const list = [];
  for (let i = 0; i < SKILL_RULES_MAX_SKILLS; i++) {
    list.push(skill(`a${String(i).padStart(2, "0")}-extra`, "extra"));
  }
  list.push(skill("zz-workspace", "workspace"));
  const rules = harborSkillsRulesForLanguage(list, "en");
  const nudge = appendSkillsRuntimeNudge("hi", list, "en");
  assert.match(rules, /zz-workspace/);
  assert.match(nudge, /zz-workspace/);
  const { dropped } = selectCatalogSkills(list);
  assert.equal(dropped.length, 1);
  assert.doesNotMatch(rules, new RegExp(`- ${dropped[0]} `));
});

test("bundled skill descriptions fit the catalog and parse as YAML", () => {
  const yaml = require("yaml");
  for (const dir of fs.readdirSync(BUNDLED)) {
    const file = path.join(BUNDLED, dir, "SKILL.md");
    if (!fs.existsSync(file)) {
      continue;
    }
    const m = fs.readFileSync(file, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
    assert.ok(m, `${dir}: frontmatter`);
    const meta = yaml.parse(m[1]);
    assert.equal(meta.name, dir, `${dir}: name matches folder`);
    assert.ok(meta.description, `${dir}: description`);
  }
  // New skills keep their «not for X» boundary inside the 240-char cap.
  for (const dir of ["explain-codebase", "design-options", "resolve-merge-conflicts"]) {
    const text = fs.readFileSync(path.join(BUNDLED, dir, "SKILL.md"), "utf8");
    const desc = yaml.parse(text.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1]).description;
    assert.ok(desc.length < 240, `${dir}: ${desc.length} chars`);
  }
});

test("design-options and writing-plans point at each other", () => {
  const read = (d) => fs.readFileSync(path.join(BUNDLED, d, "SKILL.md"), "utf8");
  const design = read("design-options");
  const plans = read("writing-plans");
  assert.match(design.split("\n").find((l) => l.startsWith("description:")), /writing-plans/);
  assert.match(plans.split("\n").find((l) => l.startsWith("description:")), /design-options/);
  assert.match(design, /Never put a `<proposed_plan>` block/);
});

test("skill usage log entries and summary", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "harbor-skill-usage-"));
  assert.equal(skillNameFromToolInput({ skill: " design-options " }), "design-options");
  assert.equal(skillNameFromToolInput(null), "");
  const entry = buildSkillUsageEntry({
    workspaceRoot: "/Users/x/my-repo",
    chatId: "chat-1234567890abcdef",
    mode: "plan",
    model: "m",
    loaded: ["design-options", "design-options", "writing-plans"],
    catalog: 26,
    userText: "как лучше  сделать\n" + "x".repeat(400),
    now: new Date("2026-10-19T10:00:00Z"),
  });
  assert.equal(entry.ws, "my-repo");
  assert.equal(entry.chat.length, 12);
  assert.deepEqual(entry.loaded, ["design-options", "writing-plans"]);
  assert.ok(entry.prompt.length <= 160);
  assert.ok(entry.prompt.startsWith("как лучше сделать x"));

  appendSkillUsage(entry, { baseDir: base });
  appendSkillUsage({ ...entry, loaded: [] }, { baseDir: base });
  const summary = summarizeSkillUsage(fs.readFileSync(skillUsageLogPath(base), "utf8") + "garbage\n");
  assert.deepEqual(summary, {
    turns: 2,
    turnsWithSkill: 1,
    loads: { "design-options": 1, "writing-plans": 1 },
  });

  appendSkillUsage(entry, { baseDir: base, maxBytes: 10 });
  assert.ok(fs.existsSync(skillUsageLogPath(base) + ".1"));
  assert.equal(summarizeSkillUsage(fs.readFileSync(skillUsageLogPath(base), "utf8")).turns, 1);
  fs.rmSync(base, { recursive: true, force: true });
});

test("listHarborSkills marks seeded global skills as bundled", () => {
  const { listHarborSkills } = require("../out/harborSkills.js");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "harbor-skills-home-"));
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const root = path.join(home, ".harbor", "skills");
    for (const name of ["seeded", "own"]) {
      fs.mkdirSync(path.join(root, name), { recursive: true });
      fs.writeFileSync(
        path.join(root, name, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${name} skill\n---\n`
      );
    }
    fs.writeFileSync(
      path.join(root, ".harbor-bundled.json"),
      JSON.stringify({ skills: { seeded: "hash" } })
    );
    const list = listHarborSkills(path.join(home, "ws"), {
      enabled: true,
      workspaceEnabled: true,
      globalEnabled: true,
      extraDirectories: [],
      disabledExtraDirectories: [],
      disabled: [],
    });
    const byName = Object.fromEntries(list.map((s) => [s.name, s]));
    assert.equal(byName.seeded.bundled, true);
    assert.equal(byName.own.bundled, undefined);
  } finally {
    process.env.HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
