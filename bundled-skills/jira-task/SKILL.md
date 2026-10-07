---
name: jira-task
description: Work on a Jira ticket end to end via the Jira MCP (mcp-atlassian) — read the issue, plan, implement, and update the ticket. Load when the user gives a Jira key (e.g. PROJ-123), a Jira link, or asks to pick up / update a task.
---

# Jira task workflow

Requires the Jira MCP server (Settings → MCP Servers → Jira preset). If its tools are missing, tell the user to connect it there — do not scrape Jira pages.

MCP tools are server-prefixed in the tool list (e.g. `<server>__jira_get_issue`). Typical mcp-atlassian tools: `jira_get_issue`, `jira_search` (JQL), `jira_add_comment`, `jira_get_transitions`, `jira_transition_issue`.

## 1. Read the ticket

- `jira_get_issue` with the key. Read: summary, description, acceptance criteria, comments (latest decisions often live there), linked issues / epic, attachments list.
- Linked or parent issues matter for scope — fetch them if the description refers to them.
- Extract a short checklist of acceptance criteria. If criteria are missing or contradictory, ask the user before coding.

## 2. Plan against the repo

- Find the affected code (search + `code_nav`). Map each acceptance criterion → files to change.
- In Plan mode, output the plan and stop. In Agent mode, show the short checklist and proceed.

## 3. Implement

- Follow workspace rules (`AGENTS.md`). Keep the diff scoped to the ticket.
- Mention the ticket key in your summary so commit messages / PR titles can reference it (e.g. `PROJ-123: …`). Do not commit or push via shell unless the user asks.

## 4. Update the ticket — only with permission

Writing to Jira is visible to the team. **Ask before** each write:

- `jira_add_comment`: short summary — what changed, how verified, open questions. No secrets, no internal file paths unless the team expects them.
- Status change: call `jira_get_transitions` first, then `jira_transition_issue` with the exact transition id the user approved.

## 5. Report

Acceptance criteria → done / not done / needs decision.
