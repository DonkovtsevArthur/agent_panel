---
name: sql-review
description: Review SQL queries and ORM database access for performance and correctness. Load when writing or reviewing SQL, query builders, repositories, or ORM code that hits a database.
---

# SQL / DB access review

## Query performance

- **N+1**: a loop (or lazy relation access) issuing one query per item. Batch with `IN (...)`, a JOIN, or a prefetch; verify with SQL logs, not by eye.
- `SELECT *` on wide tables — select only the columns used.
- Columns filtered (`WHERE`), joined, or sorted (`ORDER BY`) must have a supporting index; check the real DDL, not assumptions.
- Deep `OFFSET` pagination — prefer keyset pagination (`WHERE id > $last`).
- Count queries on every page load — cache or approximate when exact counts are not required.

## Correctness

- Transactions around read-modify-write sequences; watch for lost updates without `SELECT ... FOR UPDATE` or optimistic versioning.
- Timezones: compare timestamps in one timezone (usually UTC) end to end.
- NULL semantics: `NOT IN (subquery)` breaks on NULLs; explicit `COALESCE` / `IS DISTINCT FROM` where needed.
- String-built SQL — parameterize everything; dynamic identifiers (table/column names) must come from an allowlist, never from user input.
- Limits on unbounded queries (`LIMIT` / `FETCH FIRST`) even when "the table is small today".

## How to report

Group findings as `query → problem → why it hurts → concrete fix (SQL or ORM snippet)`. Verify claims against the actual schema (@db) — do not invent columns or indexes.
