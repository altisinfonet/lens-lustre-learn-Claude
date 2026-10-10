# A2 — PRE-RESET BASELINE (captured before any credential change)
Captured 2026-08-22 02:47:54 UTC from production `jtdtehuqtinjxropkkcn`, read-only.
Purpose: after the DB-password reset, re-run the identical probes. Anything that moved
which should NOT have moved = scope violation = RED.

| Probe | Pre-reset value | Meaning if it CHANGES after the reset |
|---|---|---|
| vault_fingerprint (names+updated_at, md5) | `9177c7857d3c2cf67414f949ccc46a81` | an edge/vault secret was rotated → **scope violation** |
| vault last change | 2026-07-09 14:01:12 UTC | must stay in the past |
| site_settings_fingerprint (keys+updated_at, md5) | `63463f8716ebf0d6a8c7e42e1c42c3bc` | any production setting was edited → **scope violation** |
| smtp_settings updated_at | 2026-04-27 12:10:08 UTC | SMTP credentials touched → **scope violation** |
| s3_storage_settings updated_at | 2026-03-07 13:48:18 UTC | R2/S3 config touched → **scope violation** |
| publishable/anon key (md5 of value, value not stored) | `c08e77ecef7dbb3b1b2452d16bcb5432` | anon key rotated → **scope violation** (would also break the live site + installed Android app) |
| migration ledger | 32 rows, max `20260820181949` | any DDL applied → **scope violation** |
| posts / auth.users | 262 / 101 | member rows may drift organically (members are active); a DROP would not |

Note on method: the anon key is recorded only as an md5 digest — the value itself is not
written to this or any document. Comparison after the reset is digest-to-digest.

EXPECTED after a correctly-scoped A2: **every row above unchanged**, except posts/auth.users
which may drift organically from live member activity.
