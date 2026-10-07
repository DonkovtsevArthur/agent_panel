---
name: code-review
description: Review a diff, branch, or set of files for correctness bugs. Load when the user asks to review changes, check a PR, "find bugs", or before suggesting a commit.
---

# Code review (correctness)

Goal: find real bugs that would break behavior. Style nits only when asked.

## 1. Collect the change

- Uncommitted work: `git status` + `git diff` (and `git diff --staged`). Branch: `git diff <base>...HEAD` (base = default branch unless the user names one).
- Read every changed hunk **with surrounding code**, not just the `+` lines. For changed functions, use `code_nav` `references` to see callers — a signature or semantics change breaks them.
- Large diffs (> ~15 files): split by area and review in parallel with `spawn_agent` (one child per area, same checklist, each returns findings with file:line). Merge and dedupe the results yourself.

## 2. Checklist

- **Logic**: inverted conditions, off-by-one, wrong operator, missed `else` / default branch, early `return` skipping cleanup.
- **Null / empty**: optional values dereferenced, empty arrays/strings, `0` treated as falsy, missing keys.
- **Async**: missing `await`, unhandled rejections, races on shared state, stale closures, listeners/timers never disposed.
- **Errors**: swallowed exceptions, wrong error type, partial writes on failure, retries without backoff/limit.
- **Contracts**: changed API/DTO/event shape without updating all producers/consumers; changed defaults; persisted data format changes without migration.
- **Resources**: unclosed files/connections/streams, unbounded caches/queues, O(n²) on user-sized input.
- **Security**: untrusted input reaching SQL/shell/paths/HTML — load `api-security-review` / `sql-review` if the diff touches those areas.
- **Tests**: does any existing test cover the changed branch? Flag untested risky paths (do not write tests unless asked).

## 3. Verify before reporting

Every finding must name a concrete failure: input/state → wrong result/crash. If you cannot construct one, drop it or mark it as a question. Re-read the code once more for each finding — false positives cost the reviewer more than misses.

## 4. Report

Most severe first. Per finding:

`path:line` — **what is wrong** — scenario that triggers it — suggested fix (short snippet if helpful).

End with a one-line verdict (e.g. "2 blocking bugs, 1 question"). Do not edit files unless the user asked for fixes.
