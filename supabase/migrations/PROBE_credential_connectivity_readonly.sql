-- ═══════════════════════════════════════════════════════════════════════════
-- CONNECTIVITY PROBE — READS NOTHING PRIVATE, WRITES NOTHING, CHANGES NOTHING.
--
-- WHY THIS FILE EXISTS.
--
-- `apply-migration.yml` checks four things in order: the branch matches the
-- target, the credential exists, the credential's project ref matches the
-- target, and the requested file is inside the allowlist. All four are checked
-- WITHOUT connecting to the database. The password is only ever tested at the
-- moment psql opens the connection — which, until this file existed, meant the
-- only way to test a credential was to apply a real migration to a live
-- database. That is a bad trade and it is why run #7 of 2026-08-31 sat
-- undiagnosed: every gate was green and the failure was
-- `FATAL: password authentication failed`, one step later.
--
-- This file is the smallest thing that reaches that step honestly. It is not a
-- migration. It has no DDL, no DML, no function, no grant, no policy. It opens
-- a transaction, asks the server four questions about itself, and commits. Run
-- it twice, a hundred times, against either lane — the database is byte for
-- byte what it was before.
--
-- WHAT A GREEN RUN PROVES, AND NOTHING MORE:
--   * the stored connection string authenticates
--   * it reaches the database the target names
--   * the connection supports a multi-statement transaction, which is the
--     whole reason the SESSION pooler (5432) is required and the TRANSACTION
--     pooler (6543) is refused
--
-- It does NOT prove any migration is correct. Nothing here should ever be
-- read as evidence about schema.
--
-- The `PROBE_` prefix follows the existing `UNAPPLIED_` convention in this
-- directory: a name that tells any future reader, at a glance, that the file
-- is not part of the migration sequence.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SELECT
  current_database()                       AS database,
  current_user                             AS connected_as,
  current_setting('server_version')        AS server_version,
  now()                                    AS probe_ran_at;

COMMIT;
