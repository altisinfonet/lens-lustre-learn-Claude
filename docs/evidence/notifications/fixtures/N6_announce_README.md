# N6 announcements to a chosen group (0220): fixture (local Postgres 16, never run against a lane)

**Base.** The N6 fixture (`n6t`: centre 0110 and admin page 0120, `has_role`/`user_roles`, `auth.uid()` from
`request.jwt.claim.sub`), copied as `n220_stg` and `n220_prod`. The gate (0140) was applied to the copies, as on
the real lanes, and `profiles.is_suspended` was added.

| Step | staging-shaped | production-shaped |
|---|---|---|
| PROBE before apply | FAIL (type not registered) | FAIL |
| apply | OK | OK |
| PROBE after apply | PASS | PASS |

Admin AD; members M1, M2, M3 (M3 suspended).

| Case | Result |
|---|---|
| a member (not admin) sends | refused ("admin only") |
| Announcements row **Off**, "everyone" | `{"sent": 0, "asked": 3}` and no rows. **Nothing reaches anyone while the row is off** |
| a second send within 10 minutes | refused |
| row on for AD and M1, "everyone" | **sent 2**: AD and M1. M2 (row off) and M3 (suspended) get nothing |
| "chosen members" [M2] (row off for M2) | sent 0 |
| "me" | sent 1 (the admin) |
| empty title; message of 301 characters; who = "all"; empty member list | all refused, with plain messages |
| history | each send recorded: who, how many, which admin |
| anon | permission denied |
| rollback → PROBE; re-apply → PROBE | type and function gone, FAIL; PASS |

**Found and fixed while testing.** The first version passed the admin as the actor. The centre's "self" rule
then skipped the admin's own copy: "me" sent 0 and "everyone" missed the admin. The centre log showed
`{self}` for those rows. An announcement is not a person acting on the member, so it now has no actor; who sent
it is in the change history. After the fix, "me" sends 1 and "everyone" sends 2.
