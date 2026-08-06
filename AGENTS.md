# Harbor Agents (vscode-agent-panel)

VS Code extension: sidebar agent panel with OpenAI-compatible APIs, tools, MCP, local per-workspace sessions.

Marketplace / UI name: **Harbor Agents** · Russian: **Гавань агентов**. Publisher id in package may differ from display name.

## Orientation

| Area | Where |
|------|--------|
| Extension entry | `src/extension.ts` |
| Webview host / UI messages | `src/agentPanelProvider.ts` |
| Agent turn entry | `src/agentLoop.ts` → `runClineAgentTurn` (`src/clineRuntime.ts`) |
| Cline fork (runtime source) | `vendor/cline/` — see `vendor/README.md` |
| Cline CJS bundle | `scripts/bundle-cline.js` → `out/clineBundle.js` |
| Step events (UI cards) | `src/agentSteps.ts` |
| Modes (Agent / Plan / Ask) | `src/modes.ts` — UI labels + mode ids; Cline maps Agent→`act`, Plan/Ask→`plan` |
| Vision whole-turn route | `src/visionTurnRoute.ts` + `src/claimedEdits.ts` |
| Plan → Agent (Build) UI | `src/planImplement.ts` — marker `[[harbor:implement_plan]]`, Plan.md helpers, strip wrapper for cards |
| Session store (workspaceState) | `src/sessionStore.ts` |
| Config / providers / models | `src/config.ts` |
| OpenAI-compatible client | `src/openaiClient.ts` (utility paths e.g. commit message; chat turns use Cline gateway) |
| Model capabilities / routing | `src/modelCapabilities.ts`, `src/modelRouting.ts` |
| Commit message generation | `src/commitMessage.ts` |
| Commit + push from review tags | `src/commitAndPush.ts` |
| Workspace rules loader | `src/workspaceRules.ts` (`AGENTS.md` + `.cursor/rules/*.mdc`) — used by commit utility path |
| MCP / Figma | `src/mcp/*`, Settings → MCP Servers |
| Webview UI | `media/panel.js`, `media/panel.css` |
| Unit tests | `tests/*.test.js` (Node test runner against `out/`) |

## Commands agents should know

```bash
npm run compile          # tsc + MCP bundle + Cline CJS bundle → out/
npm test                 # compile + node --test tests/*.test.js
npm run lint             # tsc --noEmit
```

After panel UI/logic changes: bump `version` in `package.json`, package with vsce, install into **VS Code** (not Cursor), then **Developer: Reload Window**. Details: `.cursor/rules/vscode-build-and-workspace.mdc`.

## Runtime (what every chat model gets)

All chat models use the **Cline Agent** path (`src/clineRuntime.ts` → `@cline/sdk` / fork in `vendor/cline`):

- Mode map: Harbor **Agent** → Cline `act`; Harbor **Plan** / **Ask** → Cline `plan` (read-focused tools + plan system prompt; user toggles back to Agent to implement).
- Tools: Cline builtins (`read_files`, `search_codebase`, `run_commands`, `editor`, …) via `createBuiltinTools` + `ToolPresets`.
- Providers: Harbor Settings `providers[].baseUrl/apiKey` → Cline `openai-compatible`.
- UI events: Cline runtime events → Harbor `onStep` / `onAssistantDelta` / `onReview` (webview unchanged).
- Auto-approve tools (`yolo` policies) for Harbor UX (no per-tool QuickPick yet).
- The old Harbor main-like brain (`agentLoopMainLike`, plan-quality, honestFinale, screenshot-first, explore budgets, …) has been **removed**.

### Modes — what is allowed (UI)

| Mode | Harbor UI | Cline runtime |
|------|-----------|---------------|
| **Agent** | Full chrome | `act` — edits + shell |
| **Plan** | Plan chrome / Build | `plan` — explore, no editor |
| **Ask** | Ask chrome | `plan` — same read-focused tools |

**Never silently switch Agent → Ask** in the UI (`agentPanelProvider.ts` keeps `modeForRun = selectedMode`).

## Product constraints (always)

- Target runtime is **VS Code**. Do not brand or compare the product to Cursor in user-facing copy (README, nls, toasts, Marketplace). See `.cursor/rules/no-cursor-branding.mdc`.
- Panel icons: **Material Symbols Outlined** only. See `.cursor/rules/material-icons.mdc`.
- Agent list / chats live in **`workspaceState`** (`agentPanel.session.v2`), one store per workspace — not `globalState` (except one-shot migration).

## What agents MAY change in this repo

- Feature / bugfix code under `src/`, `media/`, `tests/` related to the user’s task.
- `package.json` `version` when packaging a VSIX for the user.
- `AGENTS.md` and `.cursor/rules/*.mdc` when documenting real product/runtime rules.
- `package.nls*.json` / UI copy when the task is about wording (still no Cursor branding).
- `vendor/cline/` when patching the Cline fork (then rebuild SDK / `out/clineBundle.js`).

## What agents MUST NOT do

### Git / SCM

- Do **not** run `git commit` or `git push` via shell tools unless the user explicitly asks (panel **Commit and push** tag is the product path: `commitAndPush.ts`).
- Do **not** use `git add --all` / `git add -A` / `git add .` / `git commit -a` unless the user explicitly asks to include every local change.
- Broad discard only when the user clearly asks to discard **all** local changes.

### Product / branding

- Invent Cursor comparisons in product text.
- Install the built VSIX with a `code` binary that points to Cursor (`/usr/local/bin/code` is often wrong).
- Write agent sessions into `globalState` as the primary store.

### Editing honesty

- Do not claim files were edited unless tools actually wrote them this turn.
- Do not claim Figma/URL access is impossible when MCP / Cline tools can reach them; if Figma MCP is disconnected, say to connect in Settings → MCP Servers (PAT).

## Coding norms for this repo

- Prefer focused diffs; match existing TypeScript / webview style.
- Pure logic that tests can import should avoid top-level `vscode` requires (lazy-require or keep helpers free of the API).
- Commit messages for this repo: Russian, when the user asks to commit.

## Model: `builtin:zai-coding-plan/GLM-5.2` operating constraints

This rule applies specifically when the active model is **`builtin:zai-coding-plan/GLM-5.2`** (the current agent).

- **Do NOT write unit tests** (`tests/*.test.js` or any other test code). Tests are written/maintained by other contributors / the user. If existing tests break as a side effect of a code change, *report* the failures (file:line + assertion) to the user — do **not** edit the test files to make them green. Do not add new test cases on your own initiative.
- **Do NOT run the build / package step** (`npm run compile`, `npx vsce package`, VSIX install, `npm test`) unless the user **explicitly** asks for it. Finishing a task is not a trigger for build/test/package — stop after the code edits and a brief summary. When the user asks to «собери» / «build» / «run tests» / «package», do it then, not before.
- Code edits should still be correct and type-safe (the agent is responsible for the quality of its own `src/` / `media/` changes); the constraint is only about the *build/test/package* actions being opt-in, not automatic.
