---
name: verify-endpoint
description: Verify an HTTP API endpoint after changing it — happy path, validation, auth, error codes — using the http_request tool. Load after adding/changing a route, controller, handler, or when the user asks to check an API.
---

# Verify endpoint

Call the API yourself instead of asking the user to curl it.

## 1. Find where it runs

- Base URL: turn-context dev runtime map (docker-compose services/ports), `.env` key names (`PORT`, `API_URL`), framework defaults, or the README. Values from `.env` are redacted — ask the user if you need a real value.
- If the service is not running, start it in a terminal (or ask the user to) and wait for the "listening" line. Do not kill processes you did not start.
- `http_request` only reaches localhost / 127.0.0.1 and hosts in `agentPanel.http.allowedHosts`. For other hosts, tell the user to add the host there.

## 2. Test matrix (minimum)

| Case | Expect |
|------|--------|
| Happy path with realistic body | 2xx, response shape matches the code/DTO |
| Missing / invalid required field | 400/422 with a useful message, nothing written |
| No auth / wrong user (if protected) | 401 / 403, not 200 or 500 |
| Not found id | 404, not 500 |
| Repeat the same write (idempotency, duplicates) | Documented behavior |

Add cases for whatever you changed specifically (new field, new filter, pagination edge).

## 3. Rules

- Never put real secrets or production tokens in headers — they land in the chat. Use dev/test credentials from seed or fixture files, or ask the user.
- Do not call destructive endpoints (DELETE, bulk updates) against shared/staging data without asking.
- If a check fails: fix the code, re-run the **same** request, show before → after.

## 4. Report

Table of `method path → status → verdict`, plus any bugs found and fixed.
