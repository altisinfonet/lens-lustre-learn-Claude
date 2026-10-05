# F-P35-1 · take back table privileges no client uses (D1, T1) · `20261005_0001`

**Findings.**
- **F-P35-1** (SEC triage 2026-10-04, LOW · grant hygiene): `_v3_preflight_snapshot_*` grant `anon`/`authenticated` ALL.
- **SEC-OFF2-2** (INFO): `post_comments` and `reports` grant `anon` ALL. SEC: fold into this revoke.

**Read on staging (2026-10-05, read-only):**
- All six tables: `anon`, `authenticated` and `service_role` = `arwdDxtm`, RLS on.
- The snapshots are touched only by `hard-delete-competition` and `detect-orphan-files`, both through the **service-role** client. `src/` never queries them; only the generated types name them.
- Anon **reads** comments: policy `Users can view comments on visible posts`, TO public.
- `reports` has no anon policy.

## What changes (privileges only; no row, policy or column)
| Table | anon | authenticated |
|---|---|---|
| 4 × `_v3_preflight_snapshot_*` | nothing (was ALL) | nothing (was ALL) |
| `post_comments` | **SELECT only** (was ALL) | SELECT/INSERT/UPDATE/DELETE (TRUNCATE/REFERENCES/TRIGGER/MAINTAIN taken) |
| `reports` | nothing (was ALL) | SELECT/INSERT/UPDATE/DELETE (TRUNCATE/REFERENCES/TRIGGER/MAINTAIN taken) |

- Every touched ACL is saved first (`public.f_p35_1_acl_before`), so the rollback restores exactly the same (table, grantee, privilege) set on any lane, then drops the saved copy.
- A snapshot absent on a lane is skipped with a NOTICE.
- The physical DROP of the snapshots stays in A-4c.

## Proof — `fp351-run-tests.sh` → `fp351-transcript.txt` (ALL CASES PASS)
**Fail-first, live on staging (read-only):** the PROBE logic run against staging's catalog, 2026-10-05 → `PROBE FAIL F-P35-1`, 75 hit lines.

**Fail-first, scratch (staging's ACL + RLS):**
- The PROBE refuses (75 hits).
- **anon `TRUNCATE public.reports` SUCCEEDS** and empties the table: TRUNCATE is not under RLS. It needs a direct SQL session; PostgREST never sends it.
- authenticated can TRUNCATE a judging snapshot.

**After 0001:**
- Every one of those is `permission denied`.
- The app's paths still work: anon reads comments; a member comments, edits and deletes own; reports and reads own reports; service_role still reads the snapshots.

**PROBE mutants** (each red, each undone): anon INSERT re-granted · anon SELECT on reports · authenticated TRUNCATE · a snapshot re-opened · a grant to PUBLIC · the app's anon read over-revoked (G4) · RLS off.

**Lanes and rollback:**
- Lane guard refuses with no lane.
- Rollback restores the ACL set exactly; the PROBE is red again.
- On a lane missing a snapshot, the apply skips it and the rollback restores that lane's ACL exactly.
- Re-apply works.

**Production:** not read by D1. `_control\out\D1\F-P35-1-PRODUCTION-ACL-READ.sql` (read-only) gives the Owner one SELECT to run before the production dispatch, as SEC asked.
