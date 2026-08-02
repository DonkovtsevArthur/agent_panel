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
| Step events / ToolResults intent | `src/agentSteps.ts` |
| Mid-turn context prep | `src/prepareRoundMessages.ts` |
| Tool waves (parallel + lifecycle) | `src/runToolWaves.ts`, `src/toolParallel.ts` |
| Main-like tools (+ URL) | `src/mainLikeTools.ts` |
| Tool round policy (nudge/cut/extend) | `src/toolRoundPolicy.ts` |
| Broader tool impl (fetch_url etc.) | `src/tools.ts` |
| Modes (Agent / Plan / Ask) | `src/modes.ts` |
| Session store (workspaceState) | `src/sessionStore.ts` |
| Config / providers / models | `src/config.ts` |
| OpenAI-compatible client | `src/openaiClient.ts` (stream-first SSE, JSON fallback; `toApiMessages` — `content: null` rules) |
| Model capabilities registry | `src/modelCapabilities.ts` (per-model: vision, reasoning, Kimi quirks, `omitContentForToolCalls`) |
| Model routing / utility models | `src/modelRouting.ts` |
| Vision routing (image attachments) | `agentPanel.visionRouting.preferredModelIds` → `VISION_MODEL_PREFERENCE` (whole-turn switch only for attached images) |
| Figma / page screenshot vision | `src/figmaVisionHelper.ts` + `src/screenshotUrl.ts` + `src/visionDelivery.ts` — MCP `get_screenshot` / `screenshot_url` deliver PNG; if Settings preferred vision is set and the chat planner is not in that list, preferred always OCR’s under the hood (planner stays Kimi/etc.); raw pixels only when planner ∈ preferred (or preferred empty + planner has vision). Harbor forces `enableBase64Response` on Figma screenshots; `get_figma_data` is hidden only when `get_design_context`/`get_screenshot` exist (PAT keeps legacy). Kimi page→tab drift after plan-quality nudges → hard replace (no soft Build card) |
| Plan → Agent (Build) | `src/planImplement.ts` — marker `[[harbor:implement_plan]]`; plan = WHAT, repo `read_file` = HOW; plan's optional `**Implementation**` section (props/types/signatures) is the HOW contract the implementer builds against; correction follow-ups get the same discipline |
| Plan quality | Per-item grounding + Component-API grounding (read the target shared UI component's source for exact props/imports) + page→tab / «already exists» / PLAN.md gates (`planQuality.ts`); Figma requires `get_design_context`+`get_screenshot`; `<proposed_plan>` may include an optional `**Implementation**` section; soft explore (no hard-cut); editable plan card; Kimi Plan preserves Figma, shrinks older explore; **no soft-budget / mid-turn «Context compacted»** for Kimi Plan/Ask (`prepareRoundMessages` — gateway shrink + hard ceiling only) |
| Destructive write guard | `src/writeFileGuard.ts` — refuse empty/truncated `write_file` over substantial existing files |
| Discard scope | `src/discardChanges.ts` — «отмени изменения» = last agent paths; «все» = whole dirty; bare «отмени» → ask; successful restore/clean/rm skips write_file honestFinale |
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

- Short context: system + editor + **workspace rules** (`AGENTS.md` + `.cursor/rules`, via `loadWorkspaceRules`, cap ~8k; **Kimi ~12k**) + mode prompt + history + user (no prefetch / explore handoff in the loop). Skip rules injection when the turn is rewriting `AGENTS.md`.
- HTTP: **stream-first** `chat/completions` (SSE); on empty/broken stream → **JSON fallback** (no `stream` field). Retryable 429/5xx use transport backoff; UI gets `onStep` retry cards.
- Turn sequence (Zed-like): structured `onStep` events (thinking / text / tool lifecycle / compaction / retry); after tools, sticky **ToolResults** intent hint; mid-turn `applyContextBudget` (+ optional summary marker). **Kimi Plan/Ask:** no soft-target budget and no mid-turn extractive summary (avoids premature «Context compacted» that drops explore grounding); gateway shrink + hard ceiling still apply.
- **Tool evidence fallback**: when the model fails after tool rounds, `formatToolEvidenceFallbackAnswer` summarizes gathered read/search results instead of showing a bare red error.
- **Thinking collapse**: long Thinking blocks (> 240 chars) auto-collapse when the turn advances to tools/text; user can expand via «Show thinking» toggle.
- **No eager Thinking placeholder**: `requestAssistant` in `agentLoopMainLike.ts` does **not** emit a «Thinking…» placeholder for any model. The Thinking card is created on demand when real `reasoning_content` or inline think-tags (`</welcome>` / `<thought>`) arrive during streaming (`onDelta` / `think-tag filter`). This avoids showing an empty «Thinking…» card for models that never produce reasoning (DeepSeek-V4-Flash, Qwen3-Coder-Next, …). Placeholder-only Thinking cards left over in sealed groups are cleaned up by `dropPlaceholderThinkingSteps` (at seal) and `cleanSealedThinkingPlaceholders` (after assistant text is in the DOM, since `appendMessage` seals groups before appending text).
- **`reasoning_effort` (Claude 3.5+/4 via gateway)**: models matching `claude.*(?:3[-.][5-9]|[4-9])` get OpenAI-style `reasoning_effort` (default `"high"`, overridable per-model via `agentPanel.models[].reasoningEffort`). The gateway enables extended thinking and streams `reasoning_content`, which the model-agnostic `onDelta` handler already renders into the Thinking card. Claude 3.0 (no thinking) and non-Claude models do not send the field.
- **`reasoning_effort` gating on tool rounds (`effectiveReasoningEffort`)**: Anthropic's native API requires echoed `thinking` blocks (with a cryptographic `signature`) on the assistant tool-call turn when extended thinking is on. Our OpenAI-style `reasoning_content` carries no signature, so the corporate gateway returns 500 on re-entry after a tool result — both with and without `stripReasoningOnEcho`. To stay stable, `reasoning_effort` is dropped for any request whose message history already contains a `tool` result or an assistant `tool_calls` turn (`src/reasoningEffort.ts`). Net effect: thinking streams on the first turn (before any tool call); tool rounds and post-tool finales run without extended thinking.
- **`content: null` on assistant tool-call turns (`toApiMessages` / `omitContentForToolCalls`)**: strict gateways (DeepSeek/DaVinci, Anthropic-compat) return 500 when an assistant tool-call turn omits the `content` field entirely. `toApiMessages` (`src/openaiClient.ts`) now emits explicit `content: null` by default for assistant tool-call turns with empty content. **Kimi** is the exception — its gateway 400s on `content: null`, so the `omitContentForToolCalls` capability (set for `/kimi|moonshot/` in `src/modelCapabilities.ts`) makes `toApiMessages` omit the field for Kimi only. Do **not** change this without testing both Kimi (400 on null) and DeepSeek (500 on omitted).
- **Per-chat model isolation (`syncRunChat` / `modelChanged`)**: `this.selectedModel` is a class-level field shared across chats. `syncRunChat` (`agentPanelProvider.ts`) saves the model to `runChatId` when a turn finishes — it must use `this.selectedModel` **only** when `this.store.activeChatId === runChatId`; otherwise use `selectedModelAfterRun` (the model chosen at run start). Without this guard, switching chats mid-run leaks the new chat's model into the old chat. `modelChanged` / `modeChanged` messages from the webview carry `chatId`; the host ignores them if the active chat no longer matches — prevents stale messages from overwriting a newly-switched chat's model.
- Built-in tools from `mainLikeTools.ts`:
  - always: `list_files`, `read_file`, `write_file`, `search_replace`, `run_command`
  - URL: `fetch_url`, `screenshot_url` (headless Chrome/Edge PNG + visible text), `open_external` (when the user message has http(s) / Figma URL)
  - plus connected **MCP** tools (e.g. Figma) when enabled in Settings
  - **Focused edits (Zed-style):** `search_replace` (old_string → new_string, uniqueness required by default; `replace_all` for multi) is the surgical patch tool — it changes only the target fragment and leaves the rest of the file (dependencies, imports, neighboring code) untouched. The `FOCUSED_EDIT_HINT` system message nudges models to prefer `search_replace` for changes to EXISTING files and reserve `write_file` (full rewrite) for creating new files or rewriting entirely. `isMainLikeWriteTool` (`write_file` ∪ `search_replace`) gates productive rounds, edit tracking (`bumpEdit`), the hard-cut allow-list, and the post-edit verification gate — so `search_replace` edits are counted, tracked, and verified exactly like `write_file`.

Do **not** tell the user that external URLs / Figma are unavailable when `fetch_url` / `open_external` / Figma MCP tools are in the tool list.

### Modes — what is allowed

| Mode | May edit files? | Tools |
|------|-----------------|--------|
| **Agent** | Yes (`write_file`) | Full main-like set + MCP (Figma) |
| **Plan** | No | `list_files`, `read_file`, `fetch_url`, `open_external` + **all connected MCP** (incl. Figma) |
| **Ask** | No | Same as Plan (MCP/Figma included; no `write_file` / `run_command`) |

**Never silently switch Agent → Ask.** The UI mode is the mode for the turn (`agentPanelProvider.ts`).

### Tool-round policy

- After **2** explore-only rounds (`list_files` / `read_file` / `search_text`): soft nudge — stop reading, write or answer.
- After **4** explore-only rounds: hard-cut — no more explore; write-only or final answer.
- **Plan mode:** soft grounding reminders only (repeatable); **no hard-cut explore** — finish per-item grounding; ceiling is `maxToolRounds` + incomplete-plan gate.
- If the turn is productive (`write_file` / `run_command`) and the round budget ends: auto-extend once (+8 rounds).
- Soft verify hint (`VERIFY_REPO_FACTS_HINT`): rules are guidance; verify repo facts with tools; prefer multiple `read_file` / `list_files` in one turn (they run in parallel).
- **Kimi:** soft after **4**, hard-cut after **6**; soft nudge **strips** `list_files` / `read_file` (write by the analogous files already read). Before each API call: shrink older tool payloads (`prepareKimiGatewayMessages`) **and** drop `reasoning_content` from older assistant rounds (`dropOlderReasoningBlocks`, keep recent 2) — Zed-like `drop_reasoning_blocks`: API still gets the required placeholder for tool-call rounds via `toApiMessages`, but stale thinking no longer eats context. In **Plan/Ask**, soft-target context budget and mid-turn extractive summary are skipped (hard ceiling only) so explore grounding is not folded away into «Context compacted». Main-like transport: no `temperature`, min `max_tokens`, echo `reasoning_content`. Extra system hint: before new UI/pages, read 1–2 analogous existing files in the same tool round (`buildKimiWorkspaceFollowHint`).
- **Fragile light models** (DeepSeek / Haiku / flash / mini / gemma): before each API call, `prepareFragileGatewayMessages` caps even the latest `read_file` (gateway often 500s on a full `package.json`).

### Post-edit verification (Kimi only, Agent mode)

After successful edits, before the finale, Kimi runs a bounded quality gate (`verificationLoop.ts` via `agentLoopMainLike.ts`):

1. `get_diagnostics` on edited paths (auto if missing)
2. nudge to fix diagnostic errors / import warnings **on those edited paths** (capped retries)
3. one project command from `package.json` scripts, preference **typecheck → lint → build** (not full `test`) — **skipped** for metadata-only edits (`package.json`, nls, changelog, readme, license)
4. if the project command fails but reports only paths **outside** this turn's edits → allow finale (do not fix whole-repo lint debt)

Other models keep the previous behavior (no forced gate). `get_diagnostics` is exposed in main-like tools only when this gate is on.

### Deterministic version bump (no LLM)

When the user asks to change the version in `package.json` («поменяй версию» / follow-up «да» / explicit semver), `runMainLikeAgentTurn` runs a **pre-LLM shortcut** (`resolveVersionBumpForPackageJson` in `src/versionBump.ts`) before any model call:

- Reads `package.json` from the workspace root, applies a targeted regex (no `g` flag) that replaces **only the first** `"version"` occurrence, and writes the file back.
- Dependencies, scripts, and other fields are never touched, bumped, or deleted — the regex physically cannot reach them.
- Reports the edit via `onFileEdit` + `onReview` (so the **Commit and push** tag appears), answers `«version: prev → new»`, and finishes the turn **without calling the LLM**.
- If the version already matches → answers «уже X — менять нечего» (matches `looksLikeRefusedRequestedEdit`).
- Only in **Agent** mode (not Plan/Ask) and only when a workspace root exists; otherwise falls through to the normal LLM path.
- Question requests («какая версия») and unrelated edits («добавь зависимость») return `null` and go to the LLM as usual.
- Bare patch number in the request («поменяй на 22» / «подними до 23» / «поставь на 22») is caught by `looksLikeVersionChangeRequest` and resolved via the new `barePatch` source: `resolveVersionBumpForPackageJson` takes `major.minor` from `package.json` on disk and substitutes the user's number as the patch → `0.0.22`. The model never gets a chance to write a literal `"22"` into the version field.

### package.json version guard (tool-level, no LLM)

Even when the shortcut above is bypassed (unusual phrasing, model-initiated edit), `runMainLikeTool` in `src/mainLikeTools.ts` intercepts `write_file` / `search_replace` whose target is a `package.json`:

- For `write_file`: the new content is validated before the write.
- For `search_replace`: the patch is applied locally (dry-run via `applySearchReplace`), the resulting content is validated, and the write is blocked if the guard fires.
- `validatePackageJsonVersionValue` (in `src/versionBump.ts`, vscode-free, unit-tested) extracts the `"version"` value and rejects non-semver (e.g. bare `"22"`). The tool returns a JSON error telling the model to either set a proper semver or ask the user in plain text — not guess.
- Valid semver and files without a `version` field pass through unchanged.

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
- Plan-quality gate is softened (z.ai-style): when the model emits a `<proposed_plan>` card but `looksLikePlanQualityFailure` still flags it (missing paths / page→tab drift / «already exists» without inventory), the loop nudges up to 2× to self-correct; if it still produces a `<proposed_plan>`, the card is shown to the user with the Build button — NOT replaced with the blocking error. The error message is only used when there is no plan card at all (prose «already exists» / PLAN.md file-write claim).
- Empty model finales never surface bare «(пустой ответ)»: nudge to `write_file` / forced text reply, else `finalizeAssistantText` (edits summary → tool activity → clear error) in `emptyFinale.ts`.
- Do not claim Figma/URL access is impossible when the corresponding tools are available; if Figma MCP is disconnected, say to connect in Settings → MCP Servers (PAT).

## Coding norms for this repo

- Prefer focused diffs; match existing TypeScript / webview style.
- Pure logic that tests can import should avoid top-level `vscode` requires (lazy-require or keep helpers free of the API).
- Commit messages for this repo: Russian, when the user asks to commit.
- Changed-files review should include shell-side edits when possible (`turnFileChanges.ts` / `mergeNewlyDirtyEdits` in main-like), not only `write_file`.
