---
name: create-skill
description: >-
  Create Harbor Agent Skills. Use when authoring a new skill or asking about
  SKILL.md structure for Harbor Agents.
---

# Creating Skills in Harbor Agents

Skills are folders with a `SKILL.md` that teach the agent a specialized workflow.
The model sees a short description and loads the full skill via the `skills` tool
only when the task matches.

## Where to put skills

| Scope | Path |
|-------|------|
| This project | `<workspace>/.harbor/skills/<skill-name>/SKILL.md` |
| All projects | `~/.harbor/skills/<skill-name>/SKILL.md` |
| Extra folder | Add in Settings → Skills |

Harbor does **not** auto-scan `.agents/skills`, `.cline/skills`, or `.cursor/skills`.
Put Harbor skills under `.harbor/skills` (or add those trees as an extra folder).

## Before you begin

Ask the user:

1. **Purpose** — what task should this skill unlock?
2. **Scope** — workspace vs global (`~/.harbor/skills`)?
3. **Triggers** — when should the agent load it?
4. **Domain knowledge** — facts the model would not know otherwise
5. **Output format** — templates, checklists, tool order
6. **Existing patterns** — similar skills or repo docs to mirror

## SKILL.md shape

```markdown
---
name: my-skill-name
description: >-
  One or two sentences. Include WHAT it does and WHEN to use it
  (keywords the model can match).
---

# Title

## When to use
…

## Steps
…

## Pitfalls
…
```

Rules:

- `name` should match the folder name (kebab-case).
- `description` is the discovery signal — be specific about triggers.
- Keep the body actionable; prefer Harbor tools (`read_file`, `search_files`,
  `run_commands`, MCP, Figma canvas tools) over product-specific agent APIs.
- After creating a skill, tell the user to open Settings → Skills → Refresh
  (or reopen the panel) if it does not show up yet.

## Do not

- Put long always-on policy in a skill — that belongs in `AGENTS.md` / rules.
- Reference IDE features Harbor does not have (Canvas apps, Cursor Task
  subagents) unless the user is clearly in that other product.
