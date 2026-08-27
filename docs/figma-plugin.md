# Harbor Agents — Figma plugin

Third Harbor host (alongside VS Code and JetBrains). **Designer** chat inside Figma: Agent / Ask / Plan, selection context, canvas tools, providers settings. No Cline, no git/terminal/file edits.

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
| IDE MCP Figma | Unchanged (`src/mcp/figma.ts` Connect in Settings) |
| Versions | Figma version independent of `package.json` / `jetbrains/build.gradle.kts` |

### Cut list (not in `figma/dist/ui.js`)

- Entire `media/src/panel/*` IDE panel modules
- `06-jetbrains-polyfills.js`
- `12-settings-mcp-skills.js`
- `15-plan-build-scm.js`
- `out/clineBundle.js`, sidecar, `jetbrains/*`
- `acquireVsCodeApi` host path
- SCM / checkpoint / Commit and push / Figma MCP Connect UI

Smoke after build:

```bash
rg -n "acquireVsCodeApi|composer-scm|figmaConnect|commitAndPush|checkpoint|06-jetbrains|12-settings-mcp|15-plan-build" figma/dist/ui.js
# expect: no matches
```

### IDE regression

Shared protocol/docs changes must not break VS Code or WebStorm. Figma-only code lives under `figma/` + `media/src/panel-figma/`. See [jetbrains-port.md](jetbrains-port.md) / [vscode-regression-gate.md](vscode-regression-gate.md) when touching shared packages.

## Dev

```bash
npm run build:figma
```

Figma Desktop → **Plugins → Development → Import plugin from manifest…** → `figma/manifest.json`.

After UI changes under `media/src/panel-figma/` or `figma/ui.*`, re-run `build:figma` and **Plugins → Development → Reload**.

## Features

- Ask / Plan / Agent chat with **marked** markdown (same `media/marked.js` as VS Code webview; no IDE file links / plan cards)
- **Agent** — read tools + limited write (rename, TEXT characters, solid fills, auto-layout padding/gap). No create/delete/reparent.
- **Ask / Plan** — read + focus tools only; Plan ends with Copy brief handoff
- Rich selection JSON (text, fills, layout, instance component) + PNG preview as turn context
- Click selection chip → `scrollAndZoomIntoView` on canvas
- Fresh selection snapshot before each Send
- Settings: providers, models, language, appearance → `harbor.figma.settings`
- Sessions → `harbor.figma.session`
- **Copy brief** (Plan) — markdown + figma.com node link for IDE handoff

### Canvas tools (via OpenAI-compatible `tools`)

| Tool | Modes | Action |
|------|--------|--------|
| `figma_get_selection` | all | Current selection tree |
| `figma_inspect_node` | all | Serialize one node by id |
| `figma_focus_node` | all | Select + zoom |
| `figma_set_name` | Agent | Rename |
| `figma_set_text` | Agent | TEXT characters |
| `figma_set_fills` | Agent | Solid fill RGBA 0–1 |
| `figma_set_auto_layout` | Agent | layoutMode / padding / itemSpacing |

Main thread: `figma/code.logic.js` (`figmaInvokeTool` / `figmaFocusNode`). UI: `media/src/panel-figma/02-agent-turn.js` tool loop.

## Out of scope (for now)

Create/delete/duplicate nodes, file-wide variables, FigJam write, Cline in plugin, Community publish, shared version bump with IDE VSIX/zip.
