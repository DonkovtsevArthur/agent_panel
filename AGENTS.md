# Harbor Agents (vscode-agent-panel)

VS Code extension: sidebar agent panel with OpenAI-compatible APIs, tools, MCP, local per-workspace sessions.

Marketplace / UI name: **Harbor Agents** · Russian: **Гавань агентов**. Publisher id in package may differ from display name.

## Orientation

Short map. Details for every row (MCP presets, tools on demand, skills seeding, project memory, prompt suggestions…): `docs/architecture.md`.

| Area | Where |
|------|--------|
| Extension entry / webview host | `src/extension.ts`, `src/agentPanelProvider.ts` |
| Agent turn | `src/agentLoop.ts` → `runClineAgentTurn` in `src/clineRuntime.ts` |
| Turn context (editor/git/diagnostics/rules) | `src/turnContext.ts` |
| Cline fork / bundle | `vendor/cline/` (`vendor/README.md`), `scripts/bundle-cline.js` → `out/clineBundle.js` |
| MCP → Cline tools | `src/clineMcpTools.ts`, `src/mcp/*` (Jira / Confluence native presets, tools on demand, agent rules) |
| Modes / plan card | `src/modes.ts`, `src/planImplement.ts` |
| Step events (UI cards) | `src/agentSteps.ts` |
| Vision | `src/figmaVisionHelper.ts`, `src/inspectImagesTool.ts` |
| Sessions | `src/sessionStore.ts` (`workspaceState`) |
| Config / models | `src/config.ts`, `src/modelCapabilities.ts`, `src/modelRouting.ts` |
| Utility LLM calls (titles, suggestions) | `src/openaiClient.ts`, `src/chatTitle.ts`, `src/promptSuggestion.ts` |
| Commit message / commit + push | `src/commitMessage.ts`, `src/commitAndPush.ts` |
| Workspace rules loader | `src/workspaceRules.ts` |
| Skills | `src/harborSkills.ts`, `bundled-skills/`, `.harbor/skills/` (incl. `cline-sdk` reference) |
| Project memory | `src/projectMemory.ts`, `src/learnedErrors.ts` |
| Webview UI | sources `media/src/panel/NN-*.js` → `node scripts/build-panel.js` → `media/panel.js` (never edit the built file) |
| Shared core / protocol | `packages/harbor-core/`, `packages/harbor-host-protocol/`; in-process `src/harborCoreInProcess.ts` |
| JetBrains / Figma | `jetbrains/` (`docs/jetbrains-port.md`), `figma/` (`docs/figma-plugin.md`) |
| Unit tests | `tests/*.test.js` (Node test runner against `out/`) |

## Commands agents should know

```bash
npm run compile          # tsc + MCP + Cline + (optional) sidecar bundles → out/
npm run build:sidecar    # Node sidecar for JetBrains only
npm run build:figma      # Figma plugin → figma/dist (does not touch media/panel.js / VSIX)
npm run figma:host       # Local Cline sidecar for Figma (http://127.0.0.1:17891)
npm run build:core       # packages/harbor-host-protocol + harbor-core
npm test                 # compile + node --test tests/*.test.js
npm run lint             # tsc --noEmit
```

JetBrains: see `docs/jetbrains-port.md` and `jetbrains/README.md`. Figma: see `docs/figma-plugin.md` and `figma/README.md`. Shared logic belongs in `packages/harbor-core` / protocol; IDE shells stay thin. **Figma UI is a separate cut bundle** (`media/src/panel-figma/` via `scripts/build-panel-figma.js`) — never ship IDE panel modules into `figma/dist`. **VS Code regression gate** is required before merging shared changes (checklist in `docs/jetbrains-port.md`).

After panel UI/logic changes: bump `version` in `package.json`, **delete old** `vscode-agent-panel-*.vsix` (and JetBrains `harbor-agents-*.zip` when packaging that), package with vsce, uninstall/remove installed `local.vscode-agent-panel-*`, install into **VS Code** (not Cursor), then **Developer: Reload Window**. Details: `.cursor/rules/vscode-build-and-workspace.mdc`.

## Runtime (what every chat model gets)

All chat models run on the **ClineCore local session host** (`src/clineRuntime.ts` → `@cline/sdk` 0.0.75 / fork in `vendor/cline`). One Harbor chat = one interactive Cline session; a new session starts on regenerate/edit or when the mode / model / MCP / prompt fingerprint changes. Harbor Agent → Cline `act`; Plan / Ask (and `tools: "readonly"` custom modes) → Cline `plan`.

Settings → runtime wiring (sub-agents, parallel tool calls, auto compact, prompt cache, approvals, checkpoints, `@`-mentions, ripgrep, `http_request`, `code_nav`, slash commands, model limits, telemetry): `docs/architecture.md` → «Runtime wiring». Do **not** advertise the `reasoning` capability to Cline (breaks openai-compatible gateways) and keep the vendor patches listed in `vendor/README.md` on re-fork.

### Modes — what is allowed (UI)

| Mode | Harbor UI | Cline runtime |
|------|-----------|---------------|
| **Agent** | Full chrome | `act` — edits + shell; optional `spawn_agent` when Settings parallel agents is on |
| **Plan** | Plan chrome / Build (card only when the finale is an implementation plan, not Q&A) | `plan` — explore, no editor; optional read-focused `spawn_agent` |
| **Ask** | Ask chrome | `plan` — same read-focused tools; optional read-focused `spawn_agent` |

**Never silently switch Agent → Ask** in the UI (`agentPanelProvider.ts` keeps `modeForRun = selectedMode`).

## Product constraints (always)

- Target runtime is **VS Code**. Do not brand or compare the product to Cursor in user-facing copy (README, nls, toasts, Marketplace). See `.cursor/rules/no-cursor-branding.mdc`.
- Panel icons: **Material Symbols Outlined** only. See `.cursor/rules/material-icons.mdc`.
- Agent list / chats live in **`workspaceState`** (`agentPanel.session.v2`), one store per workspace — not `globalState` (except one-shot migration).
- **VS Code + WebStorm parity:** when changing plugin logic (chat, modes, settings, MCP, tools, sessions, panel UI), apply it for both IDE shells in the same change — prefer shared `media/` / `packages/`; mirror host-only fixes in `src/` and `jetbrains/`. See `.cursor/rules/vscode-webstorm-parity.mdc` and `docs/jetbrains-port.md`.

## What agents MAY change in this repo

- Feature / bugfix code under `src/`, `media/`, `tests/`, `packages/`, `jetbrains/` related to the user’s task.
- `package.json` `version` when packaging a VSIX for the user.
- `AGENTS.md` and `.cursor/rules/*.mdc` when documenting real product/runtime rules.
- `package.nls*.json` / UI copy when the task is about wording (still no Cursor branding).
- `vendor/cline/` when patching the Cline fork (then rebuild SDK / `out/clineBundle.js`).

## What agents MUST NOT do

### Git / SCM

- Do **not** run `git commit` or `git push` via shell tools unless the user explicitly asks (panel **Commit and push** tag is the product path: `commitAndPush.ts`). Act mode enforces this in code via Harbor's `beforeTool` git guard (`gitCommandGuardExtension.ts`); Plan/Ask also get Cline's plan command-guard.
- Do **not** use `git add --all` / `git add -A` / `git add .` / `git commit -a` unless the user explicitly asks to include every local change (same Harbor git guard).
- Broad discard only when the user clearly asks to discard **all** local changes (same guard).

### Product / branding

- Invent Cursor comparisons in product text.
- Install the built VSIX with a `code` binary that points to Cursor (`/usr/local/bin/code` is often wrong).
- Write agent sessions into `globalState` as the primary store.

### Editing honesty

- Do not claim files were edited unless tools actually wrote them this turn.
- Do not claim Figma/URL access is impossible when MCP / Cline tools can reach them; if Figma MCP is disconnected, say to connect in Settings → MCP Servers (PAT).

### Ambiguity — ask before acting

- If the user's request is **ambiguous, vague, or could reasonably be interpreted in multiple ways** — ask a clarifying question before starting work. Do not assume scope, file list, or intent.
- Specifically: when the user asks to translate/edit/refactor "comments" or "code" without naming a concrete set of files — **ask which files** (or whether they mean all files) before editing anything.
- When a task has multiple valid approaches — briefly describe the options and let the user pick, rather than choosing silently.
- If unsure whether existing code, comments, branches, flags, or files are unused / safe to remove — **ask**; do not delete on a guess.
- This rule applies even in Agent mode. Acting on assumptions wastes user time; one clarifying question upfront is always better than a wrong fix.
- **Target platform**: this project has three targets — VS Code, WebStorm (JetBrains), Figma plugin. Each has its own file areas, build commands, and constraints. When the user's request does not explicitly state which target to work on — **ask before starting**: «Задача для VS Code, WebStorm или Figma-плагина?» Do not guess from context. Skip the question only when the user named the platform, the task is clearly about the shared layer (`packages/`, `media/src/panel/`, protocol), or the task is unrelated to plugin code.

## Coding norms for this repo

- Prefer focused diffs; match existing TypeScript / webview style.
- Do **not** delete or “clean up” unrelated code during refactors or feature work unless the user explicitly asked for that cleanup. No drive-by removals of neighbors, comments, seeming-dead helpers, nls keys, or docs.
- Pure logic that tests can import should avoid top-level `vscode` requires (lazy-require or keep helpers free of the API).
- Commit messages for this repo: Russian, when the user asks to commit.

## Supplementary rules (`.cursor/rules/*.mdc`)

Before making changes, read the project rules in `.cursor/rules/`:

| File | Covers |
|------|--------|
| `agent-edit-policy.mdc` | What agents may/must not edit; git via shell forbidden; no drive-by cleanup |
| `vscode-webstorm-parity.mdc` | Plugin logic changes must cover both VS Code and WebStorm |
| `vscode-build-and-workspace.mdc` | Build, package, install flow; agents stored in workspaceState only |
| `no-cursor-branding.mdc` | Never mention Cursor in user-facing copy |
| `material-icons.mdc` | UI icons: Material Symbols Outlined only, local font |

These files are **not** auto-loaded into agent context — read them with `read_file` or `search_files` when the task touches the relevant area.

<!-- harbor:jira:start -->
## Jira — connection (MCP)

_Auto-generated by Harbor Agents after a verified connection. Re-connecting Jira in Harbor rewrites this block._

- Instance: https://jira.severstal.com (Jira Server / Data Center, REST API v2).
- Auth: Personal Access Token as HTTP header `Authorization: Bearer <token>`. The token is never stored in the repo — read it from the env var `JIRA_PERSONAL_TOKEN`; never print, log or commit it.
- MCP server: `uvx mcp-atlassian` with env `JIRA_URL=https://jira.severstal.com`, `JIRA_PERSONAL_TOKEN=$JIRA_PERSONAL_TOKEN`.
- Ready MCP configs in this repo: `.mcp.json` (Claude Code), `.cursor/mcp.json`, `.vscode/mcp.json` (VS Code / Copilot). They take the token from the environment / an input prompt.
- Without MCP: `curl -s -H "Authorization: Bearer $JIRA_PERSONAL_TOKEN" "https://jira.severstal.com/rest/api/2/issue/<KEY>"`, search via `https://jira.severstal.com/rest/api/2/search?jql=...`. Bearer only — Basic auth is not used.
- Verified: 2026-10-06 (jira_search via mcp-atlassian).
<!-- harbor:jira:end -->
