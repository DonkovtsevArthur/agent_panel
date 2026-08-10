# Harbor fork notes — TabCoder

Upstream: [alexandrevilain/tabcoder](https://github.com/alexandrevilain/tabcoder)  
Pinned snapshot: `f6a90c0499dd13e5180dc33d655850ffeed5c041` (main, 2026-08-10)  
License: Apache-2.0 — see `LICENSE`, `NOTICE`.

## What Harbor uses

| From TabCoder | Role |
|---------------|------|
| `src/autocomplete/defaultHoleFiller.ts` (+ `holeFiller.ts`) | Hole-fill prompts / XML completion tags |
| Debounce / skip filters / accept tracking from `src/vscode/completionProvider.ts` | Inline completion UX |

Runtime lives in Harbor `src/tabAutocomplete*.ts` (adapted from the files above). LLM calls go through Harbor `openaiClient` + Settings providers — **not** TabCoder AI SDK.

## What Harbor does NOT use

- Vercel AI SDK (`ai`, `@ai-sdk/*`, `ai-sdk-mistral-fim`, `ai-sdk-ollama`)
- `src/providers/*` (OpenAI/Ollama/Codestral wrappers)
- AI Profiles / `ProfileService` / SecretStorage API keys
- TabCoder Command Palette profile commands
- Codestral FIM path (`MistralFimHoleFiller`) — first iteration uses `DefaultHoleFiller` only

Do **not** `npm install` TabCoder dependencies into the Harbor root for this feature.

## Sync

1. Replace `vendor/tabcoder` with a fresh upstream snapshot.
2. Keep this file + LICENSE/NOTICE.
3. Re-port any autocomplete UX fixes into `src/tabAutocomplete*.ts`.
