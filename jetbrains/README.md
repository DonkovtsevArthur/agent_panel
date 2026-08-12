# Harbor Agents (JetBrains)

## Architecture (thin Kotlin wrapper)

Kotlin does **not** reimplement the chat UI. It only:

1. Serves the same `media/panel.js` + `panel.css` + fonts over `http://127.0.0.1`
2. Loads that URL in one JCEF OSR browser (`loadURL`, not multi-MB `loadHTML` / not `file://`)
3. Bridges `postMessage` via `JBCefJSQuery` ↔ Node sidecar

That is the VS Code webview in a JetBrains shell.

## Build

```bash
# from repo root (JDK 21)
export JAVA_HOME="/opt/homebrew/opt/openjdk@21"
export PATH="$JAVA_HOME/bin:$PATH"
npm run build:sidecar
cd jetbrains
./gradlew buildPlugin
```

Plugin zip: `jetbrains/build/distributions/harbor-agents-*.zip`.

Install in **WebStorm**: Settings → Plugins → ⚙️ → Install Plugin from Disk… → Restart.

## Manual QA (WebStorm)

1. Panel theme matches IDE (not white flash).
2. Models load in picker after start.
3. Settings / Send / mode clicks work; no New Agent spam.
4. Checkboxes toggle once.
5. Reload does not multiply agents.
6. Agents list matches `.idea/harbor/session.v2.json`.
