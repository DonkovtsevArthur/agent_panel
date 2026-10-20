---
name: resolve-merge-conflicts
description: Resolve git merge / rebase / cherry-pick / stash conflicts keeping both sides' changes. Load when git reports CONFLICT, files contain <<<<<<< markers, or the user asks to «разрулить конфликты».
---

# Resolve merge conflicts

Goal: the result keeps the intent of **both** sides. Taking one side wholesale is a decision for the user, not a shortcut.

## 1. Understand the situation

- `git status` — which operation is in progress (merge / rebase / cherry-pick / stash pop / revert) and the list of conflicted files («both modified», «deleted by them», …).
- What each side is: for a merge `ours` = current branch, `theirs` = branch being merged; **for a rebase they are swapped** (`ours` = upstream being rebased onto, `theirs` = your commit being replayed). State this explicitly before reasoning about sides.
- Many conflicted files → resolve one at a time; start with the ones others depend on (types, shared modules).

## 2. Learn the intent of each side

For each conflicted file:

- `git log --oneline -n 5 <base>..<side> -- <file>` on both sides (`git merge-base HEAD MERGE_HEAD`, or `REBASE_HEAD` / `CHERRY_PICK_HEAD` for other operations) — what each side was trying to do.
- `git diff <base> <side> -- <file>` for the whole-file change on each side, not only the conflict hunk: a rename or moved function on one side explains a confusing hunk.
- Read the full file around each hunk; conflict markers hide context.

## 3. Resolve

- Edit the file to the combined result: both behaviors kept, names / signatures consistent with the side that refactored them. Remove every `<<<<<<<`, `=======`, `>>>>>>>` (and `|||||||` with diff3).
- Real contradiction (both sides change the same logic differently, or one deletes what the other modifies) → stop and ask the user which behavior wins; show both versions in 2–3 lines each.
- Lockfiles / generated files (`package-lock.json`, `yarn.lock`, build output): do not hand-merge — regenerate with the project's tool after the source files are resolved (ask first if that needs network or a long install).
- Do not use `git checkout --ours/--theirs`, `git restore` or `git reset` on a whole file without the user's explicit OK — it silently drops the other side.

## 4. Verify

- `git diff --check` and a search for leftover markers (`<<<<<<<`, `>>>>>>>`) in the resolved files.
- IDE diagnostics / type-check / the tests that cover the touched files, as the project allows.
- Re-read semantic merges: code that merged textually clean but now calls a renamed function or a removed field.

## 5. Hand over

- `git add <file>` only for the files you resolved — by explicit path, never `git add -A` / `.`.
- Do **not** run `git commit`, `git merge --continue`, `git rebase --continue`, `git cherry-pick --continue` or `--abort` — they create or discard commits; that is the user's step (Harbor's **Commit and push** or their own git).
- Report: per file — what each side changed and how it was combined, anything decided by assumption, verification result, and the exact next command for the user (e.g. `git rebase --continue`).
