# Harbor Agents (vscode-agent-panel)

VS Code extension: sidebar agent panel with OpenAI-compatible APIs, tools, MCP, local per-workspace sessions.

Marketplace / UI name: **Harbor Agents** · Russian: **Гавань агентов**. Publisher id in package may differ from display name.

## Orientation

| Area | Where |
|------|--------|
| Extension entry | `src/extension.ts` |
| Webview host / UI messages | `src/agentPanelProvider.ts` |
| Agent turn entry | `src/agentLoop.ts` → `runClineAgentTurn` (`src/clineRuntime.ts`) |
| Turn context (editor/git/diagnostics) | `src/turnContext.ts` |
| Cline fork (runtime source) | `vendor/cline/` — see `vendor/README.md` |
| Cline CJS bundle | `scripts/bundle-cline.js` → `out/clineBundle.js` |
| Harbor UI + ClineCore session host | `docs/cline-full-runtime-migration.md` |
| Harbor MCP → Cline tools | `src/clineMcpTools.ts` — Figma/custom MCP via `listOpenAiTools` + `createTool` |
| Step events (UI cards) | `src/agentSteps.ts` |
| Modes (Agent / Plan / Ask) | `src/modes.ts` — UI labels + mode ids; Cline maps Agent→`act`, Plan/Ask→`plan` |
| Vision (images) | Attachments → Cline `userImages` when the chat model has vision. If not (e.g. GLM-5.2), Harbor runs a Settings vision model under the hood and injects a text description (`figmaVisionHelper.ts`). If that is not enough, the text model calls `inspect_images` (not `spawn_agent` — children inherit the same model). |
| Plan → Agent (Build) UI | `src/planImplement.ts` — Plan card only for implementation plans (`<proposed_plan>` / Goal+Steps); Q&A and status stay plain chat. Marker `[[harbor:implement_plan]]`, Plan.md helpers |
| Session store (workspaceState) | `src/sessionStore.ts` |
| Config / providers / models | `src/config.ts` |
| OpenAI-compatible client | `src/openaiClient.ts` (utility paths e.g. commit message; chat turns use Cline gateway) |
| Model capabilities / routing | `src/modelCapabilities.ts`, `src/modelRouting.ts` |
| Commit message generation | `src/commitMessage.ts` |
| Commit + push from review tags | `src/commitAndPush.ts` |
| Workspace rules loader | `src/workspaceRules.ts` (`AGENTS.md` + `.cursor/rules/*.mdc`) — used by commit utility path |
| Agent Skills | `src/harborSkills.ts` + Settings → Skills; dirs `<workspace>/.harbor/skills`, `~/.harbor/skills`, plus `agentPanel.skills.extraDirectories`. Per-source toggles: `workspaceEnabled` / `globalEnabled` / `disabledExtraDirectories`. No auto-scan of `.agents` / `.cline` / `.cursor` skill trees. Runtime: Cline `skills` tool via `clineRuntime` `localRuntime.userInstructionService`. |
| Cline SDK reference (workspace skill) | `.harbor/skills/cline-sdk/` — upstream Cline SDK docs (`cline/sdk-skill`, Apache-2.0) as a workspace skill. Provides ClineCore / Agent API reference for Harbor agents during development. Covers: tools, events, plugins, providers, scheduling, multi-agent, production. Note: upstream docs, not our `vendor/cline/` fork — some patterns may differ. |
| MCP / Figma | `src/mcp/*`, Settings → MCP Servers |
| Webview UI (generated) | `media/panel.js` — built from `media/src/panel/NN-*.js`, `media/panel.css` (HostBridge: `__harborHost \|\| acquireVsCodeApi`) |
| Webview UI sources | `media/src/panel/NN-*.js` — edit these, not `media/panel.js` directly. Rebuild with `node scripts/build-panel.js` (plain concatenation in fixed module order, no minification/esbuild — tests and the JetBrains plugin depend on exact function names/text in the built `media/panel.js`). Not wired into `npm run compile`; run it explicitly after editing a module. |
| Host protocol (shared) | `packages/harbor-host-protocol/` (+ `src/hostProtocol.ts` for VS Code) |
| Harbor core / sidecar | `packages/harbor-core/` → `out/harborSidecar.js` (`npm run build:sidecar`) |
| JetBrains / WebStorm plugin | `jetbrains/` — JCEF Tool Window + Kotlin host; see `docs/jetbrains-port.md` |
| VS Code in-process core | `src/harborCoreInProcess.ts` (no sidecar process) |
| Unit tests | `tests/*.test.js` (Node test runner against `out/`) |

## Commands agents should know

```bash
npm run compile          # tsc + MCP + Cline + (optional) sidecar bundles → out/
npm run build:sidecar    # Node sidecar for JetBrains only
npm run build:core       # packages/harbor-host-protocol + harbor-core
npm test                 # compile + node --test tests/*.test.js
npm run lint             # tsc --noEmit
```

JetBrains: see `docs/jetbrains-port.md` and `jetbrains/README.md`. Shared logic belongs in `packages/harbor-core` / protocol; IDE shells stay thin. **VS Code regression gate** is required before merging shared changes (checklist in `docs/jetbrains-port.md`).

After panel UI/logic changes: bump `version` in `package.json`, package with vsce, install into **VS Code** (not Cursor), then **Developer: Reload Window**. Details: `.cursor/rules/vscode-build-and-workspace.mdc`.

## Runtime (what every chat model gets)

All chat models use the **ClineCore local session host** (`src/clineRuntime.ts` → `@cline/sdk` / fork in `vendor/cline`):

- **SDK version: 0.0.75** (`@cline/sdk` / `node_modules/@cline/*` / `vendor/cline`). See `vendor/README.md` for the patch table and re-fork flow. `scripts/bundle-cline.js` rebuilds `out/clineBundle.js` from the rebuilt dists; no minified-output post-processing.

- Host: `ClineCore.create({ backendMode: "local" })`; one Harbor **chat** = one interactive Cline session (`interactive: true`, `core.send` on follow-ups). New session on regenerate/edit, mode/model/MCP fingerprint change, or workspace switch. Turns without `chatId` stay one-shot (`interactive: false`).
- Mode map: Harbor **Agent** → Cline `act`; Harbor **Plan** / **Ask** → Cline `plan`. Mode is set on `start` so `DefaultRuntimeBuilder` rebuilds tools + plan command-guard. Custom mode `prompt` is injected into the Cline rules slot.
- Tools: Cline builtins via runtime-builder; Harbor MCP as `extraTools` (`disableMcpSettingsTools`). See `docs/cline-full-runtime-migration.md`.
- Turn context: each user prompt gets editor state (active file/cursor/selection/tabs + optional prefetch), enclosing symbol, last terminal/Run output, git snapshot (branch/HEAD/ahead-behind), IDE diagnostics, recently viewed + recently edited paths, glob-matched workspace rules, and inlined `@` / file attachments (`src/turnContext.ts`, `buildInlinedAttachmentsPrompt`).
- Sub-agents: setting `agentPanel.subagents.enabled` (default on) → Cline `enableSpawnAgent: true` (`spawn_agent`) in **Agent, Plan, and Ask**, plus Harbor rules that tell the model to delegate independent parts via `spawn_agent`. When off: no tool and no rules. Children inherit the parent mode preset (Plan/Ask = read-focused + command-guard; Agent = act) and parent thinking/reasoning_effort (openai-compatible path); Harbor strips catalog `reasoning` capability so Anthropic-shaped thinking is not emitted. Harbor MCP `extraTools` are concatenated onto child tools (`vendor/cline/.../spawn-tool.ts`). `enableAgentTeams: true` (multi-agent teams for complex tasks).
- Parallel tool calls: setting `agentPanel.parallelToolCalls.enabled` (default on) → Cline `maxParallelToolCalls: 8` (`toolExecution: "parallel"`). Off → `1` (sequential).
- Auto compact: setting `agentPanel.autoCompact.enabled` (default on) → Cline `compaction: { enabled: true, strategy: "agentic" }`. UI shows compaction step cards from notice events.
- Prompt cache: setting `agentPanel.promptCache.enabled` (default **on**) → model capability `prompt-cache` + gateway provider metadata `routing.promptCache` (model-id route) in the session providerConfig, so the Cline gateway emits Anthropic-style `cache_control` markers on the last user message (`src/clineRuntime.ts` `buildClineModelInfo` / `buildHarborProviderConfig`). Opt-in because only some OpenAI-compatible upstreams accept the marker (LiteLLM/OpenRouter → Claude/Qwen, Anthropic-compatible endpoints); strict OpenAI rejects it with 400. The session `providerConfig.metadata` reaches the gateway only via the vendor patch in `vendor/cline/sdk/packages/core/src/services/llms/handler-factory.ts` (forwarding `metadata` into `createGateway` providerConfigs) — keep it on re-fork. Part of the session fingerprint.
- Auto-approve tools: master setting `agentPanel.tools.autoApprove` (default on) → Cline tool policies. Off → confirm each tool (VS Code modal / WebStorm dialog). Per-group overrides live in `agentPanel.tools.approvals` (`reads` / `web` / `edits` / `commands` / `mcp` / `subagents`); each group can force `true`/`false` or stay `unset` (follow the master flag). Resolution in `src/toolApproval.ts` (`isToolAutoApproved`, `harborToolApprovalsFingerprint`).
- Checkpoints: setting `agentPanel.checkpoints.enabled` (default on) → Cline git checkpoint per run; checkpoint card in chat restores workspace files and offers **Compare** (`core.compareCheckpoint` → `vscode.diff` per changed file; single file opens directly, several go through a QuickPick).
- Focus chain (Harbor-side equivalent of upstream Cline v3.25): setting `agentPanel.focusChain.enabled` (default on) injects a checklist rule into the system prompt (Agent/Plan only) and re-injects the latest assistant markdown checklist into follow-up turns (`src/focusChain.ts`), so long tasks stay on track across tool rounds and compaction. Ask mode is excluded.
- Special `@`-mentions: `@problems` / `@terminal` / `@url <https://…>` inject live IDE snapshots / fetched page content into the Cline user turn (`src/mentions.ts`). Resolved in the composer mention menu and `clineRuntime` turn prompt builder.
- User slash commands: `<workspace>/.harbor/commands/*.md` and `~/.harbor/commands/*.md` expand `/name args` into a prompt template host-side (`src/harborCommands.ts`). Builtins (`/agent` `/plan` `/ask` `/init` `/compact`, webview-handled) take precedence.
- Model info: Harbor resolves each model's `contextWindow` (Settings → capability registry → default) and `maxOutputTokens` (incl. Claude `minimumOutputTokens`), and passes them to Cline as `knownModels[modelId]` + `maxTokensPerTurn` so auto-compact / output caps match the real model. Catalog capabilities stay `tools` (+ `images` when vision); do **not** advertise `reasoning` — that makes Cline emit Anthropic-shaped `thinking` on openai-compatible, which corporate LiteLLM/OpenRouter rejects (`streaming_error`). Reasoning still goes as OpenAI-style `reasoning_effort` via `thinking` + `reasoningEffort` on start.
- Providers: Harbor Settings `providers[].baseUrl/apiKey` → Cline `openai-compatible`.
- UI events: `CoreSessionEvent.agent_event` → Harbor `onStep` / `onAssistantDelta` / `onReview` (webview unchanged).
- Iteration budget: Harbor does **not** pass `maxIterations`; Cline treats unset as unlimited. Setting `agentPanel.maxToolRounds` is deprecated/unused for chat.
- Telemetry: Harbor passes a NoOp `telemetry` + fixed `distinctId` (`clineNoopTelemetry.ts`); Langfuse/OTLP sinks are stubbed in `scripts/bundle-cline.js`. Do **not** delete telemetry trees inside `vendor/cline` on re-fork — see `vendor/README.md`.
- The old Harbor main-like brain (`agentLoopMainLike`, plan-quality, honestFinale, screenshot-first, explore budgets, …) has been **removed**.

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

## What agents MAY change in this repo

- Feature / bugfix code under `src/`, `media/`, `tests/`, `packages/`, `jetbrains/` related to the user’s task.
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

### Ambiguity — ask before acting

- If the user's request is **ambiguous, vague, or could reasonably be interpreted in multiple ways** — ask a clarifying question before starting work. Do not assume scope, file list, or intent.
- Specifically: when the user asks to translate/edit/refactor "comments" or "code" without naming a concrete set of files — **ask which files** (or whether they mean all files) before editing anything.
- When a task has multiple valid approaches — briefly describe the options and let the user pick, rather than choosing silently.
- This rule applies even in Agent mode. Acting on assumptions wastes user time; one clarifying question upfront is always better than a wrong fix.

## Coding norms for this repo

- Prefer focused diffs; match existing TypeScript / webview style.
- Pure logic that tests can import should avoid top-level `vscode` requires (lazy-require or keep helpers free of the API).
- Commit messages for this repo: Russian, when the user asks to commit.

## Model: `builtin:zai-coding-plan/GLM-5.2` operating constraints

These constraints apply **only** when the model actually serving the session is `builtin:zai-coding-plan/GLM-5.2`. Harbor injects the real selected model id into the session rules (`harborModelIdentityRulesForLanguage` in `src/i18n.ts`); model ids named in workspace docs — including this section — are repo documentation, never your identity. When asked which model you are, answer with the injected active-model id.

- **Do NOT write unit tests** (`tests/*.test.js` or any other test code). Tests are written/maintained by other contributors / the user. If existing tests break as a side effect of a code change, *report* the failures (file:line + assertion) to the user — do **not** edit the test files to make them green. Do not add new test cases on your own initiative.
- **Do NOT run the build / package step** (`npm run compile`, `npx vsce package`, VSIX install, `npm test`) unless the user **explicitly** asks for it. Finishing a task is not a trigger for build/test/package — stop after the code edits and a brief summary. When the user asks to «собери» / «build» / «run tests» / «package», do it then, not before.
- Code edits should still be correct and type-safe (the agent is responsible for the quality of its own `src/` / `media/` changes); the constraint is only about the *build/test/package* actions being opt-in, not automatic.
