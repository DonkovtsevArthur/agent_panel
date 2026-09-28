---
name: create-rule
description: >-
  Create Harbor / workspace rules for persistent AI guidance. Use when adding
  coding standards, project conventions, AGENTS.md, or .cursor/rules/*.mdc
  files that Harbor loads every turn.
---

# Creating workspace rules (Harbor)

Rules are **always-on** context (unlike skills, which load on demand).
Harbor injects matched rules into the agent turn from:

- `AGENTS.md` at the workspace root
- `.cursor/rules/*.mdc` (optional frontmatter `globs` / `alwaysApply`)

## When to use a rule vs a skill

| Need | Use |
|------|-----|
| Style, bans, “how we work in this repo” | Rule (`AGENTS.md` / `.cursor/rules`) |
| Rare specialized workflow | Skill (`.harbor/skills`) |

## Gather requirements

1. **Purpose** — what must the agent always respect?
2. **Scope** — whole repo or file globs?
3. **Priority** — hard ban vs soft preference?
4. **Examples** — short good/bad snippets if helpful

## AGENTS.md

Prefer a focused table of orientation + a short “MUST / MUST NOT” list.
Keep it scannable; link to docs instead of pasting novels.

## `.cursor/rules/*.mdc`

```markdown
---
description: Short summary for humans
globs: "**/*.ts"
alwaysApply: false
---

# Rule title

…
```

- `alwaysApply: true` — every turn
- `globs` — only when matching files are in play
- No Cursor product comparisons in user-facing Harbor copy

## Harbor product constraints (when editing this repo)

If the workspace is Harbor Agents itself, follow existing `.cursor/rules`
(agent-edit-policy, no Cursor branding in product text, Material icons,
VS Code + WebStorm parity, build flow). Do not invent conflicting rules.
