# N7 "also follows N people you know": fixture (local Postgres 16, never run against a lane)

**Base.** `n4_stg` (`p32.lane=staging`) and `n4_prod` (`p32.lane=production`). Added: `public.follows`, shaped as in
`20260227113944`, with its RLS policy "Anyone can view follows". Also added Supabase's standard grant of
`auth.uid()` to anon and authenticated; the first run failed without it, which was a fixture gap.

| Step | staging-shaped | production-shaped |
|---|---|---|
| PROBE before apply | FAIL (function missing) | FAIL |
| apply | OK | OK |
| PROBE after apply | PASS | PASS |

| Case (staging-shaped; ME follows P1 and P2) | Result |
|---|---|
| X follows P1, P2, P3 (and ME); Y follows P3 (and ME) | X → 2, Y → 0 |
| an unknown id; NULL input; empty input | 0; no rows; no rows |
| 80 ids sent | 50 rows (capped) |
| signed out (role authenticated, no uid); anon | no rows; permission denied |
| the same id twice | **before the fix: 1 row, count 4 (doubled)**; after: 1 row, count 2 |
| rollback → PROBE; re-apply → PROBE | FAIL; PASS |

The function is SECURITY INVOKER, so it runs under the caller's own rights and RLS and can reveal nothing a member
couldn't already read.
