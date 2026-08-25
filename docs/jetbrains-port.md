# Harbor Agents — JetBrains / WebStorm port

## Architecture

```
JetBrains Tool Window (JCEF)
  └─ media/panel.js  (shared with VS Code; HostBridge via __harborHost)
       ↕ postMessage
  Kotlin HarborHostBridge
       ↕ JSON-RPC stdio
  Node out/harborSidecar.js  (@harbor/core)
       └─ session file store (.idea/harbor/session.v2.json)
       └─ turn runner (wired later to Cline bundle)
```

VS Code stays **in-process**: `src/harborCoreInProcess.ts` → `runAgentTurn` (no sidecar process).

## Layout

| Path | Role |
|------|------|
| `packages/harbor-host-protocol/` | Webview ↔ host ↔ sidecar message contract |
| `packages/harbor-core/` | Ports, HarborCore facade, stdio sidecar |
| `media/panel.js` | Shared UI (`__harborHost \|\| acquireVsCodeApi()`) |
| `media/panel.shell.html` | DOM shell for JetBrains HTML bootstrap |
| `jetbrains/` | Gradle IntelliJ plugin (Tool Window + JCEF + actions) |
| `src/harborCoreInProcess.ts` | VS Code in-process adapter |
| `out/harborSidecar.js` | Bundled sidecar (`npm run build:sidecar`) |

## MVP scope

- Chat UI (Agent / Plan / Ask chrome), settings surface, sessions file store
- MCP list / Figma PAT status hooks
- Commit-from-review message path (host + sidecar stubs)
- VFS refresh after reviews

**Out of scope (MVP):** CodeLens, full Cline turn runner inside sidecar (VS Code already has full turns in-process).

## JCEF rules (WebStorm 2026 remote / OSR)

Do **not** repeat these failures:

| Anti-pattern | Fix |
|--------------|-----|
| Second JCEF / `JDialog` / reparent OSR | Settings **only** in the same tool-window webview |
| `file://` load | `loadHTML(html, "https://harbor.agents/")` |
| Synthetic DOM click bridge | Focus-only (`HarborJcefFocus`); native OSR mouse |
| Many `ready` events | One hydrate + host/sidecar debounce ≥1.5s |
| Missing `--vscode-*` vars | Inject theme CSS (`HarborThemeCss`) |
| Inline base64 fonts (~2.3MB) | MVP without data-URL fonts |

## Dev commands

```bash
# Shared TS packages + sidecar
npm run build:core
npm run build:sidecar

# VS Code extension
npm run compile

# JetBrains plugin (JDK 21)
export JAVA_HOME="/opt/homebrew/opt/openjdk@21"
cd jetbrains && ./gradlew buildPlugin
```

## Settings (JetBrains)

Sidecar reads `.idea/harbor/settings.json` (same shape as VS Code `agentPanel.*`).
Example: [`docs/harbor-settings.example.json`](harbor-settings.example.json).

Sessions: `.idea/harbor/session.v2.json`.

**Skills** (Settings → Skills): discovery only from Harbor roots
`<workspace>/.harbor/skills`, `~/.harbor/skills`, and `skills.extraDirectories` from settings.
Each source can be toggled off (`workspaceEnabled` / `globalEnabled` / `disabledExtraDirectories`) so it is not passed to the model.
Does **not** auto-scan `.agents/skills`, `.cline/skills`, or `.cursor/skills`.
Folder picker / open path are handled in the Kotlin host (`skillsPickDirectory`, `skillsOpenPath`).

```bash
npm run build:sidecar   # → out/harborSidecar.js (~670KB + external out/clineBundle.js)
# Sidecar must run with cwd/out next to clineBundle.js (JetBrains sets HARBOR_* env).
# After skills/runtime changes also rebuild clineBundle (`npm run compile` / bundle-cline)
# so `createUserInstructionConfigService` is exported.
```

Headless turn path: `src/sidecarMain.ts` → `HeadlessPanelHost` → `runAgentTurn` / Cline
(with `vscode` aliased to `src/vscodeHeadlessStub.ts`).

## VS Code regression gate

Before merging any phase that touches `media/`, `packages/`, or `src/` shared paths:

### Automatic

- [ ] `npm run compile`
- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `package.json` `main` still `./out/extension.js`
- [ ] VS Code path does **not** require a sidecar process

### Manual smoke (Reload Window)

- [ ] Panel opens; agents/chat hydrate
- [ ] Agent send + stream + Stop
- [ ] Plan / Ask mode switch
- [ ] Settings save
- [ ] New chat / switch agent

### Full gate (after core in-process / before release)

- [ ] MCP / Figma status
- [ ] Attachments
- [ ] Review / commit message
- [ ] Session survives Reload; per-workspace store

**Rule:** red gate → do not merge to `main`; revert shared changes. JetBrains-only PRs still run `npm run compile`.

## WebStorm acceptance checklist

1. Panel paints in IDE theme (no white flash / wrong `--vscode-*` fallback).
2. Models appear in the picker after start (JSQuery alive).
3. Clicks work: Settings nav, Send, mode/model — no New Agent spam.
4. Checkbox / MCP switch toggles once.
5. Reload Harbor does not multiply agents.
6. Agents list matches `.idea/harbor/session.v2.json` (no ready duplicates).

## Next increments

1. Gradle wrapper in CI `jetbrains` job (`buildPlugin`)
2. JCEF custom scheme for large assets instead of fully inline HTML
3. Expand headless host: MCP connect, attachments picker, OAuth Figma, full settings parity
