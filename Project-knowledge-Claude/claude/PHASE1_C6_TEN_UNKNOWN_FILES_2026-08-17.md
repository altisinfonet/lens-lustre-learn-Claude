# PHASE 1 · CONTROL CYCLE 6 — the 10 UNKNOWN migrations

Read-only. No production change, no ledger insert, no execution.
All ten files read in full.

## Why my classifier missed them (so the gap is not repeated)

Every one of the ten HAS a recognisable effect. Three regex anchors were too
strict:

- `^\s*alter\s+…` — these files write `BEGIN ALTER PUBLICATION …` on one line,
  so `ALTER` is not at line start.
- `DROP TRIGGER` / `DROP FUNCTION` were in **no** category at all; only
  `DROP TABLE|COLUMN|SCHEMA|TRUNCATE` were classified as destructive.
- `^\s*(grant|revoke)` — file 9 issues its REVOKEs from inside
  `EXECUTE format('REVOKE …')`, so the keyword never begins a line.

---

## FILE-BY-FILE

### 1 · `20260325140648` — **GREEN**
`ALTER PUBLICATION supabase_realtime ADD TABLE` × 3 (friendships,
gift_announcements, admin_notifications), each wrapped in
`EXCEPTION WHEN duplicate_object THEN NULL`.
**Effects:** configuration (realtime).
**Evidence:** friendships ✓, gift_announcements ✓ in the publication.
`admin_notifications` is absent — **and that is correct**: migration
`20260526115730` later runs `ALTER PUBLICATION … DROP TABLE
public.admin_notifications`. Cumulative state matches Git exactly.
**Replay:** idempotent by construction.

### 2 · `20260325141234` — **GREEN**
Same pattern, 15 tables. **All 15 present.** Idempotent.

### 3 · `20260419153948` — **GREEN**
`DROP TRIGGER trg_sync_entry_status_from_decision` + `DROP FUNCTION
sync_entry_status_from_decision()`. *"Remove single-photo → entry-status sync
(violates per-photo policy)."*
**Evidence:** both **ABSENT**. **Replay:** `IF EXISTS`, idempotent.

### 4 · `20260421043147` — **GREEN**
Drops the older 7-argument overload of `admin_wallet_credit`, which caused a
PostgREST `PGRST203` ambiguity that made admin gift credits silently no-op.
**Evidence:** production has **exactly one** overload, with **8** arguments.
**Replay:** `IF EXISTS`, idempotent.

### 5 · `20260424122637` — **AMBER**
```sql
DO $$ DECLARE r text; BEGIN r := public._diag_emit_test();
     RAISE NOTICE 'DIAG RESULT: %', r; END $$;
```
A diagnostic probe. **It writes nothing and leaves nothing behind**, so its
historical application is **not provable in principle** — no evidence could
exist either way.
**Why AMBER and not GREEN:** `_diag_emit_test` was dropped by file 6 and is
**ABSENT** today. Replaying this file now **raises an error** and aborts a
directory-ordered apply at this point.

### 6 · `20260424122750` — **AMBER**
A DO block that emits participant + admin notifications for one specific
`photo_verification_requests` row (`c6a16757-…`), then `DROP FUNCTION
public._diag_emit_test()`.
**Effects:** DML with side effects (notification rows) + function drop.
**Evidence it RAN:** `_diag_emit_test` is **ABSENT** — nothing else in Git drops
it. That is solid proof of application.
**Why AMBER:** the notification emission itself is not provable now, and
**replay is guaranteed to fail** — `photo_verification_requests` was dropped on
2026-04-27 and no longer exists.

### 7 · `20260429071225` — **RED**
```sql
DROP TRIGGER IF EXISTS trg_mirror_system_tag_to_decision_ins ON public.judge_tag_assignments;
DROP TRIGGER IF EXISTS trg_mirror_system_tag_to_decision_del ON public.judge_tag_assignments;
```
**Production still has BOTH triggers.**
Only `20260425045036` creates them; **nothing in Git recreates them** after the
drop. So the drop's effect is not present.

Two candidate explanations, and I cannot separate them from available evidence:

- the migration never ran; or
- the old pipeline applied files in commit order rather than version order, so
  the DROP (0429) ran **before** the CREATE (0425), leaving the triggers alive.

**UNKNOWN which.** Either way the recorded intent is unsatisfied in production.

### 8 · `20260430150937` — **GREEN**
`DROP FUNCTION IF EXISTS public._phase4_validate(uuid);`
**Evidence:** **ABSENT**. Idempotent.

### 9 · `20260504132638` — **RED, and it is a live security gap**
*"B1b-MUST-DO: Strip anon write/admin privileges on 9 judging tables."*
Loops 9 tables issuing `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
TRIGGER … FROM anon`.

**Measured now — 27 write grants remain:**

| table | anon holds | RLS | write policies |
|---|---|---|---|
| judge_decisions | INSERT, UPDATE, DELETE | on | 6 |
| judge_scores | INSERT, UPDATE, DELETE | on | 7 |
| judge_sessions | INSERT, UPDATE, DELETE | on | 5 |
| judge_tag_assignments | INSERT, UPDATE, DELETE | on | 5 |
| judging_config | INSERT, UPDATE, DELETE | on | 4 |
| judging_rounds | INSERT, UPDATE, DELETE | on | 4 |
| judging_tags | INSERT, UPDATE, DELETE | on | 4 |
| v3_mirror_log | INSERT, UPDATE, DELETE | on | **0** |
| v3_stage_catalog | INSERT, UPDATE, DELETE | on | 5 |

No later migration re-grants these; the only post-dated `anon` grants in Git are
`SELECT` on `hashtags` and `categories`. So this migration's effect is absent.

**Stated precisely, without overclaiming.** RLS is enabled on all nine, so the
row layer is still in front of every write, and `v3_mirror_log` has zero write
policies — RLS-on with no policy denies all writes. **This is a missing
defence-in-depth layer, not a demonstrated exploit.** I have not attempted a
write to test it, and will not: the grant and policy state above is sufficient
evidence, and testing would mutate production.

### 10 · `20260504143316` — **GREEN**
Drops the legacy duplicate trigger `tr_mirror_system_tag_to_decision`, keeping
the canonical `trg_` one.
**Evidence:** legacy **ABSENT** ✓, canonical **PRESENT** ✓ — exactly the
intended end state. Idempotent.

---

## COUNTS

**GREEN 6 · AMBER 2 · RED 2**

| | files |
|---|---|
| GREEN — safe to baseline | `20260325140648`, `20260325141234`, `20260419153948`, `20260421043147`, `20260430150937`, `20260504143316` |
| AMBER — applied, effect unprovable, replay now FAILS | `20260424122637`, `20260424122750` |
| RED — intent not present in production | `20260429071225`, `20260504132638` |

## RECALCULATED TOTALS

```
total migration files      618
unique versions            618
duplicates                   0
production ledger           19
Git-only set               599
proposed baseline count    599   ← unchanged in size; 2 of them now carry a RED flag
```

Category I is now **0**: all ten are classified.

---

## WHAT THE TWO RED FILES ACTUALLY MEAN

**They are not a ledger problem. They are outstanding production work that got
lost**, and the ledger merely made them visible.

- Baseline them → the drop and the revoke never happen. Production keeps two
  live mirror triggers and nine tables with anon write grants. **Status quo.**
- Refuse to baseline them → a future directory-ordered apply executes both:
  removes two live triggers, and revokes the anon grants.

For **#9** that second outcome is the *desired* one. For **#7** it would silently
remove triggers that are live today and whose removal nobody has re-approved.

**Recommendation, offered because you asked for advice:** do not let the ledger
decision carry these. Treat them as their own reviewed change —

1. `20260504132638` (anon write grants) should be **re-applied deliberately** as
   a security cycle, with the authorized/unauthorized both-sides test rule 14
   requires: judges must still be able to write, anon must not.
2. `20260429071225` (mirror triggers) needs a **decision first**: are those two
   triggers wanted today? `20260504143316` already de-duplicated this same
   mirror mechanism, which suggests the area was reworked after 0429. Until that
   is answered it stays **UNKNOWN**, and I will not convert it to APPLIED.

Everything else in the 599 remains eligible. **No ledger row was written.**
