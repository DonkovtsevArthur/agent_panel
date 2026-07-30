# Harbor Agents (vscode-agent-panel)

VS Code extension: sidebar agent panel with OpenAI-compatible APIs, tools, MCP, local per-workspace sessions.

Marketplace / UI name: **Harbor Agents** · Russian: **Гавань агентов**. Publisher id in package may differ from display name.

## Orientation

| Area | Where |
|------|--------|
| Extension entry | `src/extension.ts` |
| Webview host / UI messages | `src/agentPanelProvider.ts` |
| Agent turn entry | `src/agentLoop.ts` → always `runMainLikeAgentTurn` |
| Main-like loop (all models) | `src/agentLoopMainLike.ts` |
| Main-like tools (+ URL) | `src/mainLikeTools.ts` |
| Tool round policy (nudge/cut/extend) | `src/toolRoundPolicy.ts` |
| Broader tool impl (fetch_url etc.) | `src/tools.ts` |
| Modes (Agent / Plan / Ask) | `src/modes.ts` |
| Session store (workspaceState) | `src/sessionStore.ts` |
| Config / providers / models | `src/config.ts` |
| OpenAI-compatible client | `src/openaiClient.ts` (all models: non-stream main-like JSON) |
| Model routing / utility models | `src/modelRouting.ts` |
| Vision routing (images under the hood) | `agentPanel.visionRouting.preferredModelIds` → `VISION_MODEL_PREFERENCE` |
| Commit message generation | `src/commitMessage.ts` |
| Commit + push from review tags | `src/commitAndPush.ts` |
| Workspace rules loader | `src/workspaceRules.ts` (`AGENTS.md` + `.cursor/rules/*.mdc`) |
| Webview UI | `media/panel.js`, `media/panel.css` |
| Unit tests | `tests/*.test.js` (Node test runner against `out/`) |

## Commands agents should know

```bash
npm run compile          # tsc + MCP bundle → out/
npm test                 # compile + node --test tests/*.test.js
npm run lint             # tsc --noEmit
```

After panel UI/logic changes: bump `version` in `package.json`, package with vsce, install into **VS Code** (not Cursor), then **Developer: Reload Window**. Details: `.cursor/rules/vscode-build-and-workspace.mdc`.

## Runtime (what every chat model gets)

All chat models use the **main-like** path:

- Short context: system + editor + **workspace rules** (`AGENTS.md` + `.cursor/rules`, via `loadWorkspaceRules`, cap ~8k) + mode prompt + history + user (no prefetch / explore handoff in the loop). Skip rules injection when the turn is rewriting `AGENTS.md`.
- HTTP: plain JSON `chat/completions`, **no** `stream` field.
- Built-in tools from `mainLikeTools.ts`:
  - always: `list_files`, `read_file`, `write_file`, `run_command`
  - URL: `fetch_url`, `open_external` (when the user message has http(s) / Figma URL)
  - plus connected **MCP** tools (e.g. Figma) when enabled in Settings

Do **not** tell the user that external URLs / Figma are unavailable when `fetch_url` / `open_external` / Figma MCP tools are in the tool list.

### Modes — what is allowed

| Mode | May edit files? | Tools |
|------|-----------------|--------|
| **Agent** | Yes (`write_file`) | Full main-like set + MCP (Figma) |
| **Plan** | No | `list_files`, `read_file`, `fetch_url`, `open_external` + **all connected MCP** (incl. Figma) |
| **Ask** | No | Same as Plan (MCP/Figma included; no `write_file` / `run_command`) |

**Never silently switch Agent → Ask.** The UI mode is the mode for the turn (`agentPanelProvider.ts`).

### Tool-round policy

- After **2** explore-only rounds (`list_files` / `read_file` only): soft nudge — stop reading, write or answer.
- After **4** explore-only rounds: hard-cut — no more explore; write-only or final answer.
- If the turn is productive (`write_file` / `run_command`) and the round budget ends: auto-extend once (+8 rounds).

### Commit message generation (SCM / Commit and push)

Not the chat-selected model. Uses `selectUtilityModel` preference order:

1. `DeepSeek-V4-Flash`
2. `Qwen3-Coder-Next`
3. `Gemini 2.5 Flash`
4. `Gemma-4-31b`

else any enabled “light” model, else `defaultModel`.

## Product constraints (always)

- Target runtime is **VS Code**. Do not brand or compare the product to Cursor in user-facing copy (README, nls, toasts, Marketplace). See `.cursor/rules/no-cursor-branding.mdc`.
- Panel icons: **Material Symbols Outlined** only. See `.cursor/rules/material-icons.mdc`.
- Agent list / chats live in **`workspaceState`** (`agentPanel.session.v2`), one store per workspace — not `globalState` (except one-shot migration).

## What agents MAY change in this repo

- Feature / bugfix code under `src/`, `media/`, `tests/` related to the user’s task.
- `package.json` `version` when packaging a VSIX for the user.
- `AGENTS.md` and `.cursor/rules/*.mdc` when documenting real product/runtime rules.
- `package.nls*.json` / UI copy when the task is about wording (still no Cursor branding).

## What agents MUST NOT do

### Git / SCM

- Do **not** run `git commit` or `git push` via `run_command` (blocked). After edits, tell the user to use the panel **Commit and push** tag (`commitAndPush.ts`).
- Do **not** use `git add --all` / `git add -A` / `git add .` / `git commit -a` unless the user explicitly asks to include every local change.
- Broad discard (`git restore .`, `git clean -fd`, `git reset --hard`) only when the user clearly asks to discard **all** local changes.
- Explicit chat «запушь» / «выполни push» is handled outside the LLM (`gitCommandPolicy.ts`).

### Product / branding

- Invent Cursor comparisons in product text.
- Install the built VSIX with a `code` binary that points at Cursor (`/usr/local/bin/code` is often wrong).
- Write agent sessions into `globalState` as the primary store.

### Editing honesty

- Do not claim files were edited unless `write_file` actually ran successfully in this turn (real +/− lines).
- Main-like loop enforces this via `decideHonestFinale` in `agentLoopMainLike.ts` (nudge → retry tools, else replace with honest user-visible message).
- Do not claim Figma/URL access is impossible when the corresponding tools are available; if Figma MCP is disconnected, say to connect in Settings → MCP Servers (PAT).

## Coding norms for this repo

- Prefer focused diffs; match existing TypeScript / webview style.
- Pure logic that tests can import should avoid top-level `vscode` requires (lazy-require or keep helpers free of the API).
- Commit messages for this repo: Russian, when the user asks to commit.
- Changed-files review should include shell-side edits when possible (`turnFileChanges.ts`), not only `write_file`.
