---
name: pr-description
description: Write a pull request title and description (and optional changelog entry) from the actual diff and commits. Load when the user asks for a PR description, PR text, release notes, or changelog entry.
---

# PR description

Describe what the diff really does — never what the chat intended but did not land.

## 1. Collect

- `git log --oneline <base>..HEAD` and `git diff --stat <base>...HEAD` (base = default branch unless specified). Include uncommitted changes only if the user says the PR will include them.
- Read the diff of non-trivial files. Check for a PR template: `.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE/*`, `docs/` — if present, fill **its** sections.
- Ticket key from branch name / commits (e.g. `PROJ-123`) → reference it.
- Match the repo language for PRs/commits (see `AGENTS.md` / recent commits).

## 2. Title

Imperative, ≤ 72 chars, the user-visible effect: `Add retry to webhook delivery`, not `Fix stuff` / `Update files`. Prefix with the ticket key if the repo does that.

## 3. Body (when no template)

```markdown
## Why
1–3 sentences: problem or goal.

## What changed
- Grouped bullets by area, user-visible effect first.

## How to test
Concrete steps / commands / endpoints.

## Risks / notes
Migrations, config flags, breaking changes, follow-ups. Omit if none.
```

- Mention breaking changes, new env vars/config, and migrations explicitly — reviewers miss them otherwise.
- No secrets, internal hostnames, or tokens from the diff.

## 4. Changelog (if asked or the repo keeps one)

Follow the existing `CHANGELOG.md` format and version header style; one line per user-visible change.

Output the text for the user to paste. Do not open the PR, push, or post anything unless the user asks.
