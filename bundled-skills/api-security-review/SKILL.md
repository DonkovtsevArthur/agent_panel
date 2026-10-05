---
name: api-security-review
description: Security review for HTTP APIs and backend handlers. Load when adding or reviewing endpoints, auth checks, validation, file uploads, or any code path that touches user input.
---

# API security review

## Access control

- Every endpoint has an explicit auth decision: public, authenticated, or role-checked. No "added later".
- **Object-level authorization** (IDOR): owning user checked on every fetch/update by id, not just "is logged in".
- Admin/internal endpoints are gated by role AND not routed through public gateways by accident.

## Input handling

- Validate at the boundary (schema/types/ranges); reject early with 4xx.
- Injection: SQL/NoSQL (parameterized queries), command (no shell strings from input), template/LDAP/XPath.
- **Mass assignment**: bind only an allowlist of fields from request bodies — never spread user JSON onto a model.
- Path traversal on any user-supplied filename/path (`../`, absolute paths, symlinks).

## Secrets & responses

- No secrets in code, URLs, logs, or error responses; `.env` files never committed.
- Error responses: generic message to the client, details (stack traces, SQL, internal hosts) only to logs.
- SSRF: when the server fetches a user-supplied URL — allowlist schemes/hosts, block private ranges unless intentional, cap redirects.

## Session & transport

- Cookies: `HttpOnly`, `Secure`, `SameSite` set explicitly; auth tokens not in `localStorage` for server-rendered apps.
- Rate limiting on auth/password/reset endpoints; constant-time comparison for tokens.
- CORS: explicit origin allowlist, no reflected `*` with credentials.
- PII minimized in logs (no passwords, tokens, payment data — even partial).

Report as `endpoint → risk → exploit sketch → fix`. Do not mark an endpoint "safe" because validation exists somewhere upstream — verify this handler.
