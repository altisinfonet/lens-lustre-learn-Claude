# CG-2 first results — two production fixes, both harness-proven first (2026-08-14)

Applied under the owner's blanket authorisation ("grant all permission"),
recorded in evidence. Newest production migration: `20260814175927`.

## 1. `20260814175909` — the 136-table class of verbs RLS cannot refuse
Found while auditing the competition tables: **136 public tables** (posts,
competition_entries, judging_rounds included) granted TRUNCATE + REFERENCES +
TRIGGER to anon/authenticated via legacy default privileges. RLS governs only
SELECT/INSERT/UPDATE/DELETE — no policy can refuse the other three.

Honest exploitability: PostgREST exposes no TRUNCATE verb, so not
member-reachable through the API today; a standing landmine, closed while
cheap. Harness round-trip (revoke → verify → rollback → re-apply, idempotent),
then production: **136 → 0**, member traffic verbs intact (`true ×4` on
posts), service_role untouched.

## 2. `20260814175927` — the max-entries race, demonstrated then closed
With the VERBATIM production trigger on the harness: two concurrent
transactions, same member, `max_entries_per_user=1` → **both admitted (2
rows)**. Sequential control correctly refused, isolating concurrency as the
cause.

Fix: `pg_advisory_xact_lock(hashtextextended(user:competition))` before the
count — same-member-same-competition submissions serialize; everyone else
unaffected (proven: concurrent different member admitted). Re-ran the
identical race with the fix: **1 row, second insert refused**. One variable
changed: the lock. Rollback restores the racy original verbatim (its header
says so loudly).

Filename drifts #10 and #11 (this time via a failed `git mv` on untracked
files — repaired in a follow-up commit; lesson: stage before renaming).

## Where CG stands
| Matrix item | Status |
|---|---|
| Score immutability | GUARDED, verified (round lock + range + audit trail) |
| Bypass containment | VERIFIED — no member path to `app.bypass_round_lock` |
| Vote uniqueness | GUARDED (hard constraint) |
| Round-row writes | Admin-only via RLS (restrictive policies read and confirmed) |
| Max-entries race | **CLOSED, proven** |
| Non-RLS verb class | **CLOSED, 136→0** |
| Judge authz / isolation / winner determinism / award stacking | CG-2 harness, still queued |

## Standing owner items (unchanged)
Bug list (opens F) · repo attach w/ push (≈50 commits) · app-build trigger
when batch declared complete · Razorpay sandbox creds (W1).
