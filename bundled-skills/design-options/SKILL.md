---
name: design-options
description: Pick HOW to solve a task when several approaches are viable and none is chosen — compare, recommend, let the user decide. Load for «как лучше», «X или Y», «какой подход». Approach already chosen → writing-plans.
---

# Design options

Output is a decision, not a plan: 2–3 real options, a comparison, one recommendation, and the user's choice. The implementation plan comes after, from `writing-plans`.

## When this skill, when `writing-plans`

| Situation | Skill |
|-----------|-------|
| Approach is open: several viable ways, user has not picked («как лучше сделать», «X или Y», «стоит ли», architecture / library / data-model choice) | **design-options** |
| Approach is fixed: the user named it, picked an option earlier in the chat, or there is one obvious way | **writing-plans** |
| Request mixes both («придумай как и распиши план») | **design-options** first; the plan only after the user picks |

Only one of the two per reply. Never put a `<proposed_plan>` block in a design-options reply — Harbor would show a **Build** card for a decision the user has not made.

## 1. Understand before comparing

- Read the code the decision touches (`code_nav` `references`, nearby code doing something similar) and the workspace rules (`AGENTS.md`, `.cursor/rules`, `.harbor`) — constraints often eliminate options (platform parity, forbidden deps, versions).
- Write down the criteria that matter for *this* request: e.g. effort, risk to existing behavior, performance, maintainability, consistency with the codebase, reversibility. 3–5 criteria, not a generic list.
- Really only one viable option after this → say so in 2–3 sentences and why the others fall away, then hand over to `writing-plans` (or ask whether to plan it). Do not invent strawman options.

## 2. Reply format

```markdown
## Задача
One sentence: what is being decided.

## Варианты
### A. <name>
How it works in this codebase (files / modules it touches) — 2–4 lines.
+ strengths · − weaknesses / risks

### B. <name>
…

## Сравнение
| Критерий | A | B | C |
|----------|---|---|---|
| … | … | … | … |

## Рекомендация
<Option> — why, in 2–3 sentences, tied to the criteria. What would make another option the better pick.

## Что нужно от вас
The one decision (or 1–3 open questions that change the choice).
```

Write headings in the user's language. Keep each option grounded: real file paths, existing helpers it would reuse, what it breaks.

## 3. After the user picks

- Do not start editing in the same reply.
- Next step: in Plan mode load `writing-plans` and use the chosen option as the plan's **Approach**; in Agent mode with a small change, implement directly.
- The user asked to record the decision → short ADR (context, options, decision, consequences) in the place the repo keeps docs (`docs/`, Confluence via `confluence-page`). Do not create ADR files unasked.
