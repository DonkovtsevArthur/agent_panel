---
name: db-migration-review
description: Database migration review — safety, locks, rollback. Load when writing or reviewing schema migrations (Flyway, Liquibase, Prisma migrate, Django, Alembic, Rails).
---

# Migration review

## Locks & table rewrites

- `ALTER TABLE` on a big table can take an exclusive lock and rewrite the whole table (dropping/retyping columns, changing NULLability). Prefer additive changes.
- New indexes on large tables: create `CONCURRENTLY` (Postgres) / `ONLINE` (MySQL/Oracle) — and check whether the migration runner runs outside a transaction for that (Flyway needs it explicitly).
- Renames: deploy as add-new → backfill → switch reads → drop-old. A single `RENAME` breaks the running app version.

## Ordering (expand → contract)

1. **Expand**: additive change only (new nullable column, new table, new index). Old code keeps working.
2. **Migrate**: backfill in batches (`UPDATE ... LIMIT` / keyset batches) — never one giant UPDATE in a transaction.
3. **Contract**: only after no running code reads the old shape (add `NOT NULL` + default after backfill, drop columns in a later release).

## Common traps

- `NOT NULL` on an existing column without a default/backfill → fails on old rows and old writers.
- Default values added with the column get "frozen" for existing rows in some engines (Postgres < 11 rewrites; MySQL 8 instant DDL caveats).
- Unique index creation fails mid-deploy on duplicate data — dedupe first, then add the constraint.
- Replication lag: long migrations block replicas; check `lock_timeout` / `statement_timeout` on the migration session.

## Rollback

- Every migration has a tested down path or a documented manual rollback.
- Dry-run on prod-like data volume — timing on a laptop means nothing.

Report as `migration file → risk (lock/rewrite/ordering) → safer sequence`.
