---
name: verification-before-completion
description: Evidence before claims. Load before saying work is done, fixed, passing, or working — before the final summary of a code change, after a sub-agent reports success, and before suggesting the user commit.
---

# Verification before completion

No "done", "fixed", "works", or "tests pass" without fresh evidence from **this turn**. A claim without a check is a guess — say it is a guess.

## The gate

Before any statement about the state of the work:

1. **Identify** what proves the claim (a command, a request, a diagnostics check, a re-read of the diff).
2. **Run** it now, in full — not a previous run, not a partial subset.
3. **Read** the output: exit code, failure count, the actual response body.
4. **Report** what the output shows. Confirmed → state it with the evidence. Not confirmed → state the real status.

## What counts as evidence

| Claim | Needs | Not enough |
|-------|-------|------------|
| Types / lint clean | `@problems` or the project's type-check, 0 new errors | "the edit looks right" |
| Tests pass | Test command output with 0 failures | an older run, "should pass" |
| Build succeeds | Build command, exit 0 | lint passing |
| Endpoint works | `http_request` → expected status + body (see `verify-endpoint`) | handler code changed |
| Bug fixed | The original reproduction now behaves correctly | code changed near the symptom |
| Refactor complete | `code_nav` `references` on the new name matches the old count | rename tool reported success |
| Sub-agent finished | You re-read the files / diff it touched | its own "done" message |
| Requirements met | Re-read the request, tick off each point | "tests pass" |

## When you cannot verify

Workspace rules may forbid running build / tests / packaging without an explicit request, or the environment may not allow it (no DB, no VPN, no running server). Then:

- Do **not** run it anyway, and do **not** claim it passes.
- Say plainly what was **not** verified and give the exact command the user can run.
- Still do the checks that are allowed (IDE diagnostics, `code_nav`, re-reading the changed code).

## Stop signals

Rewrite the sentence if you are about to write any of these without evidence from this turn:

- "should work", "probably", "seems to", "looks correct"
- "Done!", "Fixed!", "All good" before running a check
- trusting a tool's or sub-agent's success message instead of looking at the result
- one quick check standing in for the full one

## Final summary shape

- What changed (files).
- How it was verified: the command / request and its result.
- What was **not** verified and why, plus the command to run.

---
Adapted from `verification-before-completion` in [obra/superpowers](https://github.com/obra/superpowers) (MIT, © 2025 Jesse Vincent; see `LICENSE` in this folder).
