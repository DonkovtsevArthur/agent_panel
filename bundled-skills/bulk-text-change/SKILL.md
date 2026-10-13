---
name: bulk-text-change
description: Change the same text in many places (UI wording, messages, comments, terms, translating comments). Load when asked to fix / replace / translate a phrase «везде», in all files, or in all comments.
---

# Bulk text change

The risk is scope: missing an occurrence, or changing one that should stay. Find everything first, agree on the scope, then change.

## 1. Pin down the change

- Exact old text → exact new text. If the user gave an example or a single place, ask whether every form counts: case variants, Russian word forms («группа / группы / группе»), plural, line breaks inside JSX.
- Request is about "comments" or "code" without naming files → ask which files / folders (or confirm "the whole project").

## 2. Find every occurrence

- Search with a pattern wide enough for the variants: case-insensitive, word stems for Russian, optional whitespace / line breaks. Exclude `node_modules`, `dist`, build output, lock files.
- Look beyond components: constants, i18n / message files, error texts, enum labels, tests and snapshots, mocks, docs, e-mail / PDF templates, backend messages served to the UI.
- For identifiers (a constant name, an enum key) use `code_nav` `references` / `rename_symbol` instead of text search — see `safe-refactor`.

## 3. Show the scope before editing

When there are more than a few hits, list them grouped by file (path:line + the line) and mark:

- **change** — clearly the target;
- **ask** — same words, different meaning (another entity, a field name, an API value, a DB/enum value sent to the server);
- **keep** — must not change (API contracts, stored values, third-party text, tests that assert the server's text).

Wait for the user's OK on the "ask" group. Few hits and no ambiguity → proceed and list them in the report.

## 4. Change

- Keep the surrounding style: quotes, punctuation, capitalization at sentence start, non-breaking spaces, typographic quotes «».
- Translating comments: translate meaning, keep code identifiers, links, `TODO` / `FIXME` tags and JSDoc tags (`@param`, `@returns`) as they are; do not touch strings or code.
- Tests / snapshots that assert the old UI text: update them together with the text when the project allows editing tests; otherwise list them as needing an update.

## 5. Verify

- Re-run the step-2 search for the old text: what remains must be exactly the "keep" list.
- Search for the new text: count matches the changed places.
- Type-check / lint if the project allows (`@problems` at least).
- Report: N places in M files, what was intentionally left and why.
