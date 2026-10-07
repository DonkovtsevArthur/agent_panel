---
name: dependency-upgrade
description: Upgrade project dependencies safely — read changelogs for breaking changes, upgrade one at a time, verify. Load when the user asks to update/bump packages, fix npm audit / Dependabot / CVE alerts, or migrate to a new major version.
---

# Dependency upgrade

## 1. Inventory

- Package manager from the lockfile: `package-lock.json` (npm), `pnpm-lock.yaml`, `yarn.lock`, `poetry.lock`, `uv.lock`, `go.sum`, Gradle/Maven files. Use **that** manager only; never mix lockfiles.
- List candidates: `npm outdated` / `pnpm outdated` / `pip list --outdated` / `./gradlew dependencyUpdates` (if the plugin exists), or the security report the user gave (`npm audit`, Dependabot alert).
- Classify: patch / minor / **major**. Security fixes first.

## 2. Before each major upgrade

- Read the changelog / release notes / migration guide for every version between current and target (fetch the GitHub releases page or `CHANGELOG.md`).
- List breaking changes that affect this repo: search for the removed/renamed APIs with search + `code_nav` `references`.
- Check peer dependencies and engine requirements (Node/Python/JDK version).
- If the migration is large, propose a plan and ask before starting.

## 3. Upgrade

- One package (or one tightly coupled group, e.g. `@babel/*`) per step.
- Use the manager's command (`npm install pkg@x.y.z`) so the lockfile updates consistently; do not hand-edit lockfiles.
- Apply code changes required by the migration guide.
- Never use `--force` / `--legacy-peer-deps` / ignore-scripts workarounds without telling the user why.

## 4. Verify

- Install from clean if cheap, type-check, build, run tests — whatever the project allows in this session.
- For audit fixes, re-run the audit and show the alert is gone.
- If a step breaks and the fix is not obvious, revert that package and continue with the others; report it.

## 5. Report

Table: `package old → new → breaking changes handled → verification`. List skipped packages with the reason.
