---
name: work-log
description: Summary of work over a period from git + Jira, and logging / fixing time in Jira / Tempo. Load for «что сделали сегодня / за неделю», standups, status reports, «списать время», worklogs, «Вид работ».
---

# Work summary and time logging

Two jobs, often together: **what was done** (read-only) and **log time** (writes, only after the user confirms).

## 1. Period and person

- Default period: today. Resolve "вчера", "за неделю", "с понедельника" to exact dates (YYYY-MM-DD) and say them.
- Person: the connected Jira user — `jira_get_myself` (also gives the time zone). Git author: `git config user.name` / `user.email`.

## 2. What was done

- **Git:** `git log --since="<from> 00:00" --until="<to> 23:59" --author="<name>" --all --no-merges --pretty="%h %ad %s" --date=short`. Group by branch / ticket key in the message (e.g. `ASUIP-1234`). Uncommitted work: `git status --short`.
- **Jira:** `jira_search` with JQL, e.g.
  - updated by me: `assignee = currentUser() AND updated >= "<from>" ORDER BY updated DESC`;
  - my time already logged: `worklogAuthor = currentUser() AND worklogDate >= "<from>" AND worklogDate <= "<to>"`.
- Merge both into a list per ticket: ticket key + summary → what was done (from commits / status changes), time already logged.
- Work without a ticket key → list separately and ask which ticket it belongs to; do not guess.

Summary format (for a standup / report): short bullet per ticket, plain language, no file paths unless asked. Optionally "Plans / blockers" if the user mentioned them.

## 3. Log time — draft first

Build a draft table and show it **before** any write:

| Ticket | Date | Time | Comment | «Вид работ» / other Tempo attributes |

- Time comes from the user. Commits do not tell how long work took — if the user did not say, ask; you may suggest a split of the day they gave you.
- Check what is already logged for those days (`jira_get_worklogs` / `jira_get_tempo_worklogs`) so you do not double-log.
- Tempo attributes: `jira_get_tempo_attributes` → required ones and allowed values. ACCOUNT-type attributes (often «Вид работ»): allowed values are `jira_get_tempo_accounts` with the ticket's `project_key`. **Never guess an attribute value** — pick from the allowed list or ask.

## 4. Write — after the user says yes

- New entry: `jira_add_worklog` (`issue_key`, `time_spent` like `1h 30m`, `started` as ISO date-time at the right day, `comment`).
- Then set Tempo attributes on it: `jira_get_tempo_worklogs` (find the new worklog id) → `jira_update_tempo_worklog` with `attributes`, e.g. `{"Вид работ": "Разработка"}`.
- Fix an existing entry: `jira_update_worklog` / `jira_update_tempo_worklog`. Remove a wrong one: `jira_delete_worklog`. Do not add a "correcting" second entry.
- One write per row; stop at the first error and report it with the allowed values the tool returned.

## 5. Report

What was logged (ticket, date, time, attributes), total per day, anything skipped or still needing the user's answer.
