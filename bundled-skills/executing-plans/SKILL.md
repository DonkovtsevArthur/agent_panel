---
name: executing-plans
description: Implement an agreed plan step by step. Load when the message starts with [[harbor:implement_plan]] / «Реализуй следующий план:» (Build from a Plan card) or the user asks to implement a plan from the chat.
---

# Executing plans

The plan is an agreement with the user. Implement **it**, not a better idea you get halfway through. When reality disagrees with the plan, stop and say so.

## 1. Before the first edit

- Read the whole plan once. Note Goal, Constraints, Affected files, Steps, Verification.
- Open every file the plan names and confirm the code still looks as the plan assumes (names, signatures, line ranges). The repo may have changed since planning.
- Create the step list with `update_todo` — one item per plan step, same order, first one `in_progress`.
- Plan has gaps ("TBD", a step with no file, a name defined nowhere) or a step contradicts workspace rules → ask before starting, not in the middle.

## 2. One step at a time

For each step:

1. Make exactly the change the step describes — files, names, signatures, values as written.
2. Run the step's **Check** (command, `http_request`, `@problems` / type-check, `code_nav` references). Only checks the workspace rules allow; otherwise note it as "not run".
3. Mark the step `done` in `update_todo`, set the next one `in_progress`.

No refactors, renames, or cleanups the plan does not list — mention them in the final report instead.

## 3. When the plan does not fit

Stop and ask (short message: what the plan says, what you found, 1–2 options) when:

- a file / function / API the plan relies on does not exist or behaves differently;
- a step's check fails and the fix would change the approach, not just a typo;
- following the step would break a Constraint or a workspace rule;
- the step turns out much bigger than planned (new files, new dependencies, other modules).

A small, obvious adjustment (an import path, a renamed local variable) — make it and list it under "Deviations" in the report.

## 4. Finish

- Run the plan's **Verification** section (follow `verification-before-completion`).
- Re-read the Goal: does the result actually achieve it?
- Report:
  - steps done (all `update_todo` items `done`, or which are not and why);
  - how each was verified, and what was not run + the command to run it;
  - deviations from the plan;
  - follow-ups you noticed but did not do.

Do not commit or push unless the user asks.
