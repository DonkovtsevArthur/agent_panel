---
name: systematic-debugging
description: Root cause before any fix. Load for bugs without a clear error (wrong result, regression «раньше работало», flaky / intermittent, slow) or after a failed fix attempt. Concrete error / stack trace → debug-from-logs.
---

# Systematic debugging

No fix before the root cause is found. A patch on the symptom is a failed fix, even if the symptom disappears.

If there is a concrete error / stack trace / log, follow `debug-from-logs` first; this skill covers what happens when that is not enough.

## 1. Investigate

- **Read everything.** Full error text, all warnings, the whole stack, not just the top line.
- **Reproduce reliably.** Smallest command, test, or `http_request` that shows the problem. Intermittent → find what changes between runs (order, timing, data, env, cache). Cannot reproduce → gather more data or ask the user; do not guess.
- **Check what changed.** Turn context (recently edited files, git branch / HEAD), `git diff`, `git log -p` on the suspect file, dependency and config changes.
- **Multi-component flows** (UI → API → service → DB, host → sidecar, build → package): find *which boundary* breaks before reading code in depth. Check what enters and leaves each layer — request / response via `http_request`, a temporary log line, env actually seen by the process. One run with probes beats five guesses.
- **Trace the bad value back.** `code_nav` `references` / `definition` / `hover` from where it is wrong to where it is produced. Fix at the source, not where it surfaces.

## 2. Compare with working code

- Find a similar path in the repo that works (another endpoint, another handler, the same code on the default branch).
- List **every** difference between working and broken, including the ones that "can't matter".
- If you follow a library / framework pattern, read the reference fully, not a skim.

## 3. One hypothesis at a time

- State it: "X is the cause because Y."
- Test it with the smallest change or probe — one variable at a time.
- Wrong → new hypothesis from the new evidence. Do not stack another fix on top of an unconfirmed one.
- Say "I don't understand X yet" instead of patching around it.

## 4. Fix and verify

- Prove the failure first: the reproduction from step 1 fails before the fix. Add an automated test only if the project and workspace rules allow writing tests (see `write-tests`); otherwise a reproduction command or request is the proof.
- One change that addresses the root cause. No "while I'm here" refactors or cleanup in the same diff — mention them instead.
- Rerun the reproduction and nearby checks; follow `verification-before-completion` before saying it is fixed.
- Remove temporary probes / log lines.

## 5. Three failed fixes → stop

If the same issue survived three fix attempts, or every fix exposes a new problem somewhere else, the design is probably wrong, not the last line you touched. Stop editing, summarise for the user what you tried and what each attempt showed, and discuss the approach before a fourth attempt.

## Stop signals → back to step 1

- "Quick fix now, investigate later"
- "Let's just try changing X"
- several changes at once, then run the tests
- proposing fixes before tracing where the value comes from
- "one more attempt" after two failures

## If there truly is no code-level cause

Timing, environment, or an external service: write down what you checked, add proper handling (timeout, retry, clear error message) and logging that will catch it next time. Most "no root cause" findings are an unfinished investigation — be sure first.

If the cause was a non-obvious project quirk, save it with `remember`.

---
Adapted from `systematic-debugging` in [obra/superpowers](https://github.com/obra/superpowers) (MIT, © 2025 Jesse Vincent; see `LICENSE` in this folder).
