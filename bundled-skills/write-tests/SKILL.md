---
name: write-tests
description: Write or extend automated tests that match the project's existing test framework and style. Load when the user asks to add tests, cover a function/bug with tests, or increase coverage. Check workspace rules first — some projects/models forbid writing tests.
---

# Write tests

First check `AGENTS.md` / workspace rules: if they say not to write tests (for this model or at all), stop and tell the user.

## 1. Learn the project's conventions

- Framework and runner: `package.json` scripts, `pytest.ini` / `pyproject.toml`, `go test`, JUnit, etc.
- Read 1–2 **neighbouring** test files for the same layer: file naming and location, imports (source vs compiled output), fixtures/factories, assertion style, how mocks are done.
- Copy those conventions exactly. Do not introduce a new framework, assertion library, or snapshot tool.

## 2. Decide what to test

- Public behavior, not private helpers. Use `code_nav` `references` to see how callers use the unit.
- Cases: happy path, boundaries (empty, zero, max, unicode), invalid input/errors, and the specific bug being fixed (a regression test that fails before the fix).
- Prefer real objects over mocks; mock only I/O boundaries (network, clock, filesystem, randomness). Freeze time and seed randomness.

## 3. Write

- One behavior per test; name states the expectation (`returns 404 when user is missing`).
- Arrange / act / assert, no logic (loops/ifs) in tests unless table-driven is the project style.
- No sleeps — use fake timers or await the actual signal.
- Never weaken or delete existing assertions to make a suite green.

## 4. Run

- Run only the new/affected test file first (if running tests is allowed in this session), then the related suite.
- A regression test should fail without the fix — verify when cheap.
- Report: tests added (names), command used, result. If something unrelated fails, report it (file:line + assertion), do not fix it silently.
