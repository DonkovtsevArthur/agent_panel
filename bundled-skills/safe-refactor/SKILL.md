---
name: safe-refactor
description: Rename, move, or change the signature of code safely using IDE navigation (code_nav, rename_symbol). Load before renaming symbols, moving files/modules, changing function signatures, or extracting/inlining code.
---

# Safe refactor

Refactors must not change behavior. Use the IDE's semantic index, not text search.

## 1. Map the blast radius first

- `code_nav` `references` on the symbol (pass `path` + `symbol` + `line`). Note count and which packages/modules use it.
- `code_nav` `implementations` for interfaces / abstract methods; `outline` to see the file structure.
- Also grep for **string** uses the index cannot see: reflection, DI tokens, config files, routes, templates, tests with literal names, docs, i18n keys.
- Public API (exported from a package, used over HTTP/IPC, persisted)? Stop and ask — renaming may break external consumers.

## 2. Change

- **Rename**: use `rename_symbol` — it updates all semantic references at once. Then fix the string uses from step 1 by hand.
- **Signature change**: update the definition, then every reference from step 1. Prefer adding an optional parameter / overload over breaking all callers when callers are many.
- **Move file/module**: move, then fix imports reported by `references` / IDE diagnostics. Keep a re-export at the old path only if the user wants a transition period.
- One kind of change per step. Do not mix refactor with behavior changes or cleanup.

## 3. Verify

- Check IDE diagnostics (`@problems`) / type-check (`tsc --noEmit`, `mypy`, etc. — whatever the project uses) — must be no new errors.
- Re-run `code_nav` `references` on the new name: count should match step 1.
- Run the tests that cover touched files if the project allows running tests in this session.
- If something goes wrong, the Harbor checkpoint for this turn can restore files — mention it rather than hand-reverting many files.

## 4. Report

Old → new, number of files/references updated, string uses fixed manually, verification result.
