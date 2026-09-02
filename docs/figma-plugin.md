# Harbor Agents — Figma plugin

Third Harbor host (alongside VS Code and JetBrains). **Designer** chat inside Figma: Agent / Ask / Plan, selection context, canvas tools, providers settings.

**Cline under the hood:** chat turns run in a **local Node Cline host** (`out/figmaSidecar.js`) — same ClineCore as VS Code. Figma cannot run Node inside the plugin sandbox, so the host is a tiny background process on `127.0.0.1`. After **one-time** install it starts at login (KeepAlive); you do not run a terminal for each session.

## Harbor Figma Host (Cline, once)

```bash
npm run compile                 # first time (builds clineBundle + figmaSidecar)
npm run figma:host:install      # macOS LaunchAgent — background, KeepAlive
```

Then open the plugin as usual. Health: `http://127.0.0.1:17891/v1/health`.

Dev without LaunchAgent: `npm run figma:host:ensure` (starts detached if down).  
Uninstall: `npm run figma:host:uninstall`.

Env: `HARBOR_FIGMA_PORT`, `HARBOR_FIGMA_HOME` (default `~/.harbor/figma`).

## Dev Mode

If you only have Dev Mode (no Design edit rights), the manifest **must** include:

```json
"editorType": ["figma", "figjam", "dev"],
"capabilities": ["inspect"]
```

Without `"inspect"`, clicking the plugin in the Dev Mode sidebar does **nothing** (silent). Console shows: `Plugin not compatible to run in dev handoff panel`.

**Where is the UI?** In Dev Mode, `showUI` does **not** open a floating window. The iframe fills the **right-hand Inspect / Plugins panel**. Look there after the toast — not for a separate modal.

**Writes:** Agent-mode canvas edits require **Design** mode. In Dev Mode, write tools return a clear error; read / focus still work.


| Rule | Detail |
|------|--------|
| Separate artifact | `npm run build:figma` → `figma/dist/` only. Does **not** overwrite `media/panel.js` |
| Cut at build | `scripts/build-panel-figma.js` allowlists `media/src/panel-figma/*` only |
| Main vs UI | `manifest.json`: `main`=`code.js`, `ui`=`ui.html`. Do **not** embed HTML into `code.js` (large string literals crash Figma’s plugin environment) |
| Storage | `figma.clientStorage` keys `harbor.figma.*` — never IDE `workspaceState` / `globalState` |
| Plugin id | `harbor-agents-figma` — not `local.vscode-agent-panel` / JetBrains id |
| Protocol | Additive Figma message types in `packages/harbor-host-protocol` — no version bump |
| Cline host | Local `figmaSidecar` on 127.0.0.1 — **not** embedded in `figma/dist` |
| IDE MCP Figma | Unchanged (`src/mcp/figma.ts` Connect in Settings) |
| Versions | Figma version independent of `package.json` / `jetbrains/build.gradle.kts` |

### Cut list (not in `figma/dist/ui.js`)

- Entire `media/src/panel/*` IDE panel modules
- `06-jetbrains-polyfills.js`
- `12-settings-mcp-skills.js`
- `15-plan-build-scm.js`
- `out/clineBundle.js` / `out/figmaSidecar.js` (run separately as Figma Host)
- `acquireVsCodeApi` host path
- SCM / checkpoint / Commit and push / Figma MCP Connect UI

Smoke after build:

```bash
rg -n "acquireVsCodeApi|composer-scm|figmaConnect|commitAndPush|checkpoint|06-jetbrains|12-settings-mcp|15-plan-build" figma/dist/ui.js
# expect: no matches
```

### IDE regression

Shared protocol/docs changes must not break VS Code or WebStorm. Figma-only code lives under `figma/` + `media/src/panel-figma/` + `src/figma*.ts`. See [jetbrains-port.md](jetbrains-port.md) / [vscode-regression-gate.md](vscode-regression-gate.md) when touching shared packages.

## Dev

```bash
npm run build:figma
npm run figma:host
```

Figma Desktop → **Plugins → Development → Import plugin from manifest…** → `figma/manifest.json`.

After UI changes under `media/src/panel-figma/` or `figma/ui.*`, re-run `build:figma` and **Plugins → Development → Reload**.

## Features

- Ask / Plan / Agent chat with **marked** markdown (same `media/marked.js` as VS Code webview; no IDE file links / plan cards)
- Turns via **Cline** in the local Figma Host (modes map Agent→act, Ask/Plan→plan; IDE builtins disabled)
- **Agent** — full canvas write: create / duplicate / delete, rename, TEXT, fills, opacity, corner radius, geometry, reparent, auto-layout, prototype links.
- **Ask / Plan** — read + focus tools only; Plan ends with Copy brief handoff
- Rich selection JSON (text, fills, layout, instance component) + PNG preview as turn context
- Multi-select: light id/name/size for up to 100 selected roots in turn context (deep trees still capped)
- Click selection chip → `scrollAndZoomIntoView` on canvas
- Fresh selection snapshot before each Send
- Settings: providers, models, language, appearance → `harbor.figma.settings`
- Sessions → `harbor.figma.session`
- **Copy brief** (Plan) — markdown + figma.com node link for IDE handoff

### Canvas tools (via Cline `extraTools` → plugin RPC)

| Tool | Modes | Action |
|------|--------|--------|
| `figma_get_selection` | all | Current selection tree |
| `figma_inspect_node` | all | Serialize one node (incl. **x/y**, **absX/absY**, size, fills, layout) |
| `figma_focus_node` | all | Select + zoom |
| `figma_list_frames` | all | List FRAME/COMPONENT on current page (id, name); `selectedOnly` lists current selection |
| `figma_list_components` | all | List COMPONENT / COMPONENT_SET (optional INSTANCE) for design-system swap |
| `figma_list_variables` | all | List local variables + collections (tokens) |
| `figma_find_nodes` | all | Find layers by name/type; includes **parentPath** |
| `figma_layout_report` | all | Overflow / layout health; `needsFollowUp` for completion |
| `figma_apply_recipe` | Agent | Layout recipes: resize_center, center_content, tablet, autolayout, match_reference |
| `figma_batch_tools` | Agent | Up to 12 tool calls in one plugin RPC |
| `figma_get_reactions` | all | Read prototype reactions on a node |
| `figma_set_name` | Agent | Rename |
| `figma_set_text` | Agent | TEXT characters |
| `figma_set_fills` | Agent | Solid fill RGBA 0–1 |
| `figma_set_auto_layout` | Agent | layoutMode / padding / itemSpacing / axis alignment / sizing |
| `figma_align_in_frame` | Agent | Align/distribute children; or set `primaryAxisAlignItems` / `counterAxisAlignItems` on auto-layout frame |
| `figma_set_layout_child` | Agent | Child `layoutAlign` / `layoutGrow` / `layoutSizingHorizontal`/`Vertical` in auto-layout |
| `figma_resize_frame` | Agent | Resize + optional align in one RPC; returns `layoutCheck` |
| `figma_batch_text_replace` | Agent | Search/replace all TEXT in a subtree |
| `figma_match_layout` | Agent | Copy auto-layout/size/children sizing from reference frame |
| `figma_set_constraints` | Agent | MIN/CENTER/MAX/STRETCH/SCALE constraints |
| `figma_set_effects` | Agent | Drop shadow, copy effects, clear |
| `figma_group_nodes` / `figma_ungroup_node` | Agent | Group / ungroup |
| `figma_set_layout_grid` | Agent | Column/row/grid guides on frame |
| `figma_set_prototype_link` | Agent | ON_CLICK (etc.) → NAVIGATE to frame |
| `figma_set_prototype_flow` | Agent | Batch prototype links for a click-through flow |
| `figma_clear_reactions` | Agent | Remove all reactions from a node |
| `figma_create_node` | Agent | Create FRAME / RECTANGLE / ELLIPSE / TEXT |
| `figma_duplicate_node` | Agent | Clone a node (subtree + default offset) |
| `figma_delete_node` | Agent | Delete node(s) by id |
| `figma_set_geometry` | Agent | Position / size |
| `figma_reparent_node` | Agent | Move under another parent |
| `figma_set_opacity` | Agent | Opacity 0–1 |
| `figma_set_corner_radius` | Agent | Corner radius |
| `figma_copy_styles` | Agent | Copy fills/stroke/font/layout from a similar layer |
| `figma_set_stroke` | Agent | Solid stroke + weight |
| `figma_set_font` | Agent | TEXT font family/style/size |
| `figma_apply_edits` | Agent | Batch property edits (max 80) in one RPC |
| `figma_swap_component` | Agent | Swap INSTANCE → another COMPONENT |
| `figma_bind_variable` | Agent | Bind local variable to fill/stroke/spacing/etc. |

**Harbor Skills** (via Cline `skills` tool): bundled `figma-auto-layout`, `figma-resize-playbook`, `figma-prototype-flow`, `figma-layer-naming` in `.harbor/skills/` (copied to `out/figma-skills/` on sidecar bundle). Also scans `~/.harbor/skills`.

**Slash commands** (expanded host-side): `/figma-resize`, `/figma-align-center` from `.harbor/commands/` (bundled to `out/figma-commands/`). Args after the command name are passed as `$ARGUMENTS`.

**Undo:** batch writes (`figma_apply_edits`, `figma_set_prototype_flow`, deletes, single write tools) call `figma.commitUndo()` so one **Edit → Undo** step groups each agent tool batch.

Main thread: `figma/code.logic.js` (`figmaInvokeTool` / `figmaFocusNode`). Sidecar: `src/figmaClineTurn.ts` + `src/figmaCanvasTools.ts`. UI client: `media/src/panel-figma/02b-sidecar-client.js`.

### Performance notes

- Canvas tools run with **up to 8 parallel** Cline tool calls; the UI client does not serialize RPC.
- Prefer `figma_resize_frame`, `figma_align_in_frame`, `figma_apply_edits` (max 80), `figma_find_nodes`, `figma_layout_report` for layout edits.
- Single selected frame at Send: tree depth **4**, up to **30** children, **layoutHealth** in selection JSON.
- **figma_inspect_node** accepts `fields: ["geometry","layout"]` for lighter reads.
- **figma_apply_recipe** / **figma_batch_tools** (≤12 calls, one RPC) for multi-step layout edits.
- Write tools return `layoutCheck` / `needsFollowUp`; **figma_apply_edits** auto-verifies layout ops.
- **Prompt cache** (provider setting) emits Anthropic-style `cache_control` when the upstream accepts it.
- Selection PNG is sent only when the model has **vision**; live selection sync stays light (no PNG).
- Chat shows **TTFT → total** and per-tool durations when available.

## Out of scope (for now)

FigJam write, Community publish, shared version bump with IDE VSIX/zip. Embedding Cline **inside** the Figma plugin sandbox (impossible — needs Node). Rich gradient/image fill authoring (use **figma_copy_styles** / **figma_set_effects** from reference layers).

### Cline sessions

Same as VS Code: one Figma chat (`agent.id`) → one **interactive** Cline session in the local host. Follow-ups (`core.send`) keep prior tool results / node ids so «удали тот столбец» does not re-search. Session resets when mode/model/provider fingerprint changes or the host restarts.
