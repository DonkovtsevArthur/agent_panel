# VS Code regression gate

Copy into the PR description when touching shared Harbor code (`media/`, `packages/`, `src/` adapters).

Full checklist: [docs/jetbrains-port.md](jetbrains-port.md#vs-code-regression-gate).
WebStorm acceptance: [docs/jetbrains-port.md](jetbrains-port.md#webstorm-acceptance-checklist).

## Auto

- [ ] `npm run compile`
- [ ] `npm test`
- [ ] `npm run lint`
- [ ] No required sidecar process on VS Code path

## Smoke (Reload Window)

- [ ] Panel opens
- [ ] Agents / chat hydrate
- [ ] Agent send + Stop
- [ ] Plan / Ask
- [ ] Settings
- [ ] New chat / switch agent

## Full (core / release)

- [ ] MCP / Figma
- [ ] Attachments
- [ ] Review / commit message
- [ ] Session persistence / per-workspace
