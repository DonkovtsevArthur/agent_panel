# Harbor Agents for Figma

Designer-focused Harbor host (Agent / Ask / Plan + canvas tools). Isolated from VS Code / WebStorm builds.

## Quick start

```bash
npm run build:figma
```

In **Figma Desktop** (not the browser):

1. Remove any old «Harbor Agents» under **Plugins → Development** (right‑click → Remove).
2. **Plugins → Development → Import plugin from manifest…**
3. Choose this file exactly:  
   `…/vscode-agent-panel/figma/manifest.json`  
   (folder must contain `manifest.json`, `code.js`, `ui.html` side by side)
4. Run **Plugins → Development → Harbor Agents**

You should see a toast «Harbor Agents» and a panel.

### If you see «An error occurred while loading the plugin environment»

That toast often means Figma’s plugin **sandbox** failed to start (not a Harbor JS exception). Check:

1. Import the tiny smoke plugin:  
   `…/vscode-agent-panel/figma-smoke/manifest.json`  
   - If **Smoke also fails** → Figma/network (VPN/proxy/firewall). Try hotspot, or another machine. Other plugins will fail the same way.
   - If **Smoke works** → re-import Harbor after `npm run build:figma` (Remove old entry first).
2. Console stack with only `figma_app__… runNextPlugin` (no `code.js` line) = environment, not our logic.
3. `code.js` embeds UI as **chunked** `__HTML_UI__` when Dev Mode leaves `__html__` empty (large `ui.html`). After `npm run build:figma`, **Plugins → Development → Reload**.

## Layout

| Path | Role |
|------|------|
| `manifest.json` | Plugin entry (`code.js` + `ui.html`) |
| `code.js` | Main thread (selection + storage) |
| `ui.html` | Panel UI (built from shell + panel-figma) |
| `src/` | Optional TS sources (not required to run) |

See [`../docs/figma-plugin.md`](../docs/figma-plugin.md).
