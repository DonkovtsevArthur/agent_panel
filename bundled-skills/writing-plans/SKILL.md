---
name: writing-plans
description: Write an implementation plan for a multi-step change before touching code. Load in Plan mode when the user asks for a plan, or when a feature / refactor spans several files or components and needs agreement on the approach first.
---

# Writing plans

Write the plan for an implementer who has not seen this codebase or this conversation. They can write idiomatic code once they know the decisions; what they cannot know is **what you decided**: which files, which names and signatures, which exact values from the request, how each step is checked. Put those in the plan, nothing more.

## Before writing

- Explore first: read the files you will touch, `code_nav` `references` for what you will change, nearby code that does something similar. A plan built on guesses about the code is worse than no plan.
- Read workspace rules (`AGENTS.md`, `.cursor/rules`, `.harbor` rules) for constraints the plan must respect: platforms that must change together, forbidden actions, required version bumps, test policy.
- Unclear request, or several reasonable approaches → ask the user before writing the plan. Questions never go inside the plan.
- Request spans independent subsystems → propose separate plans, one per subsystem.

## Output format (Harbor Plan card)

Reply with the plan wrapped in `<proposed_plan>…</proposed_plan>` (no attributes). Harbor shows it as the Plan card with **Build** and keeps the Plan.md file itself — do not write plan files with tools.

```markdown
<proposed_plan>
## Goal
One sentence: what will work after this change.

## Approach
2–3 sentences: the design and why this one.

## Constraints
- Project-wide requirements that apply to every step (platform parity, versions, naming / copy rules), exact values copied from the request or rules.

## Affected files
- `path/to/file.ts` — what changes and why
- `path/to/new-file.ts` (new) — responsibility

## Steps
1. **<Component>: <change>** — `path/to/file.ts`
   - Interface: `functionName(param: Type): ReturnType` (what later steps rely on)
   - Values / behavior the request pins exactly
   - Check: the command, request, or diagnostic that shows this step works
2. …

## Risks / edge cases
- Inputs or conditions the request implies but no step checks yet, most likely first — and which step handles each.

## Verification
- How the whole change will be checked at the end (commands, `http_request`, manual check in the IDE). Mark what needs the user's go-ahead (build, tests, packaging) if workspace rules make those opt-in.
</proposed_plan>
```

## What a step contains

A step is done when the implementer can write exactly one reasonable thing from it — unambiguous, not complete:

- **Code step:** file, exact signature, the values the request fixes. No function bodies unless the algorithm is not determined by the signature and checks.
- **Check step:** the command / request and what output means success.
- **Reference to another step:** use the names from that step's Interface line; do not repeat its code.
- Tests: include test steps only when the project has tests for this area and workspace rules allow writing them.
- No commit / push steps — committing is the user's call.

## Self-review before replying

1. **Coverage:** every point of the request maps to a step. Add a step for any gap.
2. **No empty lines:** remove "TBD", "handle edge cases", "add validation", "update tests as needed" — replace with the concrete decision or drop it.
3. **Consistency:** names and signatures match across steps (`clearLayers()` in step 3 is not `clearAllLayers()` in step 7).
4. **Proportion:** the plan is shorter than the code it describes. Mostly code blocks → replace bodies with signatures and checks.

After the plan, one short line: what you recommend checking in it before **Build** (the riskiest decision).

---
Adapted from `writing-plans` in [obra/superpowers](https://github.com/obra/superpowers) (MIT, © 2025 Jesse Vincent; see `LICENSE` in this folder).
