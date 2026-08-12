# @harbor packages

| Package | Purpose |
|---------|---------|
| `harbor-host-protocol` | Shared webview ↔ host ↔ sidecar message types |
| `harbor-core` | Host ports, HarborCore facade, stdio JSON-RPC sidecar |

Build:

```bash
npm run build:protocol
npm run build:core
npm run build:sidecar   # → ../../out/harborSidecar.js
```

See `docs/jetbrains-port.md`.
