---
name: explain-codebase
description: Explain how existing code works — a module, a flow, where a value comes from. Load for «как устроено / как работает / откуда берётся / объясни код». Not for bugs (systematic-debugging) or changing code.
---

# Explain codebase

The answer is a map of real code the user can click through, not a retelling of what the code probably does. Every claim points to `path:line` you actually read this turn.

## 1. Pin the question

- Name the exact subject: a symbol, a file, a user-visible behavior («что происходит после нажатия Send»), or a value («откуда берётся `maxTokens`»).
- Too broad («объясни весь проект») → give the top-level map from step 2 and ask which part to go deeper on. Do not read the whole repo.

## 2. Find the entry points

- Start from docs the repo already has: `AGENTS.md`, `README`, `docs/architecture*` — they name the main modules. Trust code over docs when they disagree, and say so.
- Behavior question → find where it starts: command / route / event handler / UI message name. Search for the user-visible string or message type, then `code_nav` `definition`.
- Value question → `code_nav` `references` on the variable or setting key; follow writes, not reads.

## 3. Trace, do not guess

- Follow the path with `code_nav` (`definition`, `references`, `implementations`, `outline`) — semantic navigation beats text search for calls through interfaces and re-exports.
- Batch reads: open the 3–6 files on the path in one go, read only the relevant ranges.
- Stop tracing at framework / library boundaries — name the boundary («дальше это делает Cline SDK, `core.start`»), do not explain library internals unless asked.
- Something you could not confirm (dynamic dispatch, config at runtime, generated code) → mark it as an assumption, not a fact.

## 4. Answer

Shape the reply to the question, usually:

1. **Short answer** — 1–3 sentences: what happens / where the value comes from.
2. **Path** — numbered steps, each `path:line` + what that place does. 3–10 steps; collapse trivial hops.
3. **Key details** — the non-obvious parts: conditions that change the path, defaults, caches, platform differences (e.g. VS Code vs JetBrains host).
4. **Where to change it** (only if the user hints they will) — the 1–2 places an edit would go.

A small diagram (ASCII or mermaid) helps only when there are branches or several processes; skip it for a linear path.

## Rules

- Read-only: do not edit files, run builds, or "fix" what you notice. A real problem found along the way → mention it in one line at the end.
- Full clickable paths, no `...` abbreviations.
- Do not paste large code blocks — quote at most a few lines when the exact expression matters.
