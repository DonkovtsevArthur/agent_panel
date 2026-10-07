---
name: debug-from-logs
description: Systematic debugging from an error, stack trace, failing command, or log file. Load when the user reports a bug, crash, exception, failing test/build, or pastes an error / uses @logs, @terminal, @problems.
---

# Debug from logs

Do not guess-and-patch. Reproduce → locate → explain → fix → verify.

## 1. Gather evidence

- Use what the user attached: `@logs [path]` (tail + parsed stack frames), `@terminal` (last command output), `@problems` (IDE diagnostics). Ask for the log path only if none of these exist.
- Note exact error text, first **project** frame in the stack (skip library/framework frames), timestamp, and the input/request that triggered it.
- Check the turn context: recently edited files and git state often point straight at the cause ("it worked before my change").

## 2. Reproduce

- Find the smallest command that shows the failure: one test (`npm test -- -t name`, `pytest path::test`, …), one HTTP call via `http_request`, one script run.
- If you cannot reproduce, say so and list what you tried — do not "fix" a bug you have not seen.

## 3. Locate

- Open the first project frame; read the whole function, not just the line.
- Use `code_nav` (`definition`, `references`, `hover` for types) to follow the bad value back to where it was produced.
- Form **one** hypothesis at a time and test it (targeted log line, narrower input, reading the producer). Remove temporary debug output afterwards.

## 4. Fix

- Fix the root cause, not the symptom (no blanket `try/catch`, no `?.` sprinkled to hide a null that should never be null).
- Keep the diff minimal; mention neighbouring issues instead of fixing them silently.

## 5. Verify and record

- Rerun the exact reproduction command; show it now passes. Run nearby tests if cheap.
- Explain in 2–3 sentences: cause → fix → how verified.
- If the root cause was a non-obvious project quirk (env, tooling, ordering), save it with `remember` so the next chat does not rediscover it.
