# PHASE 1 · ROW 9 — ANON JUDGING GRANTS: DESIGN PACKAGE (NOT EXECUTED)

**Item:** re-apply the lost intent of `20260504132638` ("B1b-MUST-DO: strip anon write
privileges on 9 judging tables") as a deliberate, gated security cycle — per C6's own
recommendation, not as a ledger-baseline side effect.
**State machine position:** AUDIT ✅ (Closure Audit Rev 4, Finding C) → **DESIGN (this
document)** → RED TEST defined below → IMPLEMENT **STOPPED — production write, awaiting
explicit owner authorization (governing rule 6)** → VERIFY → CI → REGRESSION → CLOSE.
**Nothing in this document has been applied.**

---

## 1. RED BASELINE — measured 2026-08-21, this session, immediately before design

`has_table_privilege('anon', …)` on all nine tables:

| table | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER | SELECT |
|---|---|---|---|---|---|---|---|
| judge_decisions | **true** | **true** | **true** | false | false | false | true |
| judge_scores | **true** | **true** | **true** | false | false | false | true |
| judge_sessions | **true** | **true** | **true** | false | false | false | true |
| judge_tag_assignments | **true** | **true** | **true** | false | false | false | true |
| judging_config | **true** | **true** | **true** | false | false | false | true |
| judging_rounds | **true** | **true** | **true** | false | false | false | true |
| judging_tags | **true** | **true** | **true** | false | false | false | true |
| v3_mirror_log | **true** | **true** | **true** | false | false | false | true |
| v3_stage_catalog | **true** | **true** | **true** | false | false | false | true |

**27 write grants — identical to C6's 2026-08-17 measurement.** This is the RED state the
migration must turn green, and the execution-time precheck must reproduce it exactly or ABORT.

**Defence-in-depth context (why this is a layer, not an exploit):** RLS is enabled on all nine;
every write policy is scoped to `authenticated` (Rev 4, Finding C part 2); `v3_mirror_log`'s only
policy is admin-read. The row layer holds. This migration restores the grant layer in front of it.

**Why now is the cheapest it will ever be:** `competition_entries` holds **0 rows** — the judging
subsystem is empty. No live judging traffic exists to regress.

## 2. WHY REVOKING anon CANNOT BREAK ANYTHING — argued from mechanism

1. **No legitimate anon write path exists by design.** Judging writes go through authenticated
   clients (RLS-gated) or SECURITY DEFINER functions. Definer functions execute as their owner
   (`postgres`), whose privileges are untouched — `mirror_system_tag_to_decision`,
   `refresh_score_cache`, the round-lock triggers all keep working identically.
2. **anon SELECT is not touched.** The one intentional anon read (`judging_tags` R4 award
   definitions policy) and the four postgres-owned views are unaffected.
3. **Scope is exactly the original migration's intent** — same 9 tables, same 6 privileges,
   nothing widened, nothing narrowed (SELECT was deliberately excluded then; excluded now).
4. Revoking a privilege that is already absent (TRUNCATE/REFERENCES/TRIGGER) is a no-op —
   the statement is idempotent.

## 3. THE MIGRATION — proposed, UNAPPLIED

Name: `anon_judging_write_revoke_reapply`. Version: assigned by the connector at apply time;
the repo ledger file is then renamed to the server-assigned version (standing procedure —
and the known drift trap: `20260817170000`→`20260818011014`, `20260820090000`→`20260820060649`).

```sql
-- Re-applies the lost intent of 20260504132638 (C6 file 9, RED).
-- Grant-layer only. No RLS, policy, function, trigger, or data change.
do $$
declare
  t text;
  n int;
begin
  -- PRECHECK (RED gate): exactly 27 anon write grants must exist, else ABORT.
  select count(*) into n
  from (values ('judge_decisions'),('judge_scores'),('judge_sessions'),
               ('judge_tag_assignments'),('judging_config'),('judging_rounds'),
               ('judging_tags'),('v3_mirror_log'),('v3_stage_catalog')) tabs(tbl)
  cross join (values ('INSERT'),('UPDATE'),('DELETE')) privs(p)
  where has_table_privilege('anon', 'public.'||tabs.tbl, privs.p);
  if n <> 27 then
    raise exception 'ROW9-001: expected 27 anon write grants, found % — state moved since design; re-audit', n;
  end if;

  foreach t in array array['judge_decisions','judge_scores','judge_sessions',
                           'judge_tag_assignments','judging_config','judging_rounds',
                           'judging_tags','v3_mirror_log','v3_stage_catalog']
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on public.%I from anon', t);
  end loop;

  -- POSTCHECK: zero anon write grants must remain, else ABORT (rolls back the whole DO).
  select count(*) into n
  from (values ('judge_decisions'),('judge_scores'),('judge_sessions'),
               ('judge_tag_assignments'),('judging_config'),('judging_rounds'),
               ('judging_tags'),('v3_mirror_log'),('v3_stage_catalog')) tabs(tbl)
  cross join (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) privs(p)
  where has_table_privilege('anon', 'public.'||tabs.tbl, privs.p);
  if n <> 0 then
    raise exception 'ROW9-002: % anon write grants survived the revoke', n;
  end if;
end $$;
```

Both gates are inside the DO block, so a failed postcheck aborts the transaction and applies
nothing — matching the harness discipline (refuse a RED baseline; refuse a non-green outcome).

**Rollback (exact, held ready, NOT part of the migration):**
```sql
do $$
declare t text;
begin
  foreach t in array array['judge_decisions','judge_scores','judge_sessions',
                           'judge_tag_assignments','judging_config','judging_rounds',
                           'judging_tags','v3_mirror_log','v3_stage_catalog']
  loop
    execute format('grant insert, update, delete on public.%I to anon', t);
  end loop;
end $$;
```
Restores exactly the 27 measured grants (TRUNCATE/REFERENCES/TRIGGER were already absent, so
they are not re-granted). File destination: `supabase/rollback/`, never `supabase/migrations/`
(the C1 misplaced-rollback trap).

## 4. VERIFICATION PLAN — both sides, per C6's rule-14 requirement

Immediately after apply, read-only:

1. **Unauthorized side:** the §1 matrix re-run → every write cell **false** on all 9; SELECT
   unchanged (**true** on all 9).
2. **Authorized side:** `has_table_privilege('authenticated', …, 'INSERT'/'UPDATE'/'DELETE')`
   → still **true** on all 9 (grants intact; RLS policies remain the row gate). Plus
   `has_function_privilege('postgres', 'mirror_system_tag_to_decision'::regproc, 'EXECUTE')` true.
3. **Functional probe, aborted transaction** (BUILD-1106 pattern — nothing committed):
   inside `begin … rollback`, as postgres, insert/delete a probe row through a definer path to
   prove trigger-owned writes still function. Judging tables are empty, so this is the only
   functional check available; the honest limit is recorded: a real judge journey is Phase 3
   device-matrix work.
4. **Advisor re-run:** `get_advisors(security)` — expect no new findings; the 4
   `security_definer_view` ERRORs remain (they are a recorded design decision, Rev 4).
5. **Snapshot equality:** policies/triggers/functions/tables counts identical before and after —
   this migration touches the ACL layer only.

## 5. WHAT CLOSES ROW 9, AND WHAT STILL DOESN'T

This migration + §4 closes the **production** half. The row is CLOSED only when, additionally:

- the migration file lands in the repo (renamed to the server-assigned version) via the web-UI
  transport with blob-SHA verification, and passes the 7 CI gates — the `securityDefinerGrants`
  gate reads it;
- the version is recorded so the future row-7 baseline treats `20260504132638` correctly: the
  original stays **excluded** from the 597-row baseline (its intent now lives in the new
  migration; baselining the old one would be recording as applied something that never was).

## 6. STOP POINT — exact authorizations required (governing rule 6)

1. **OWNER: authorize `apply_migration` of §3 against production.** One statement, grant-layer
   only, gated both ends, rollback in hand. Say "apply row 9" and it runs, followed immediately
   by §4 items 1–2, 4–5 (item 3 on request — it writes inside an aborted transaction; approve it
   separately or skip it).
2. **OWNER: land the repo file** afterwards (Chrome or your own commit) so CI locks it.

Not proceeding past this line without #1.
