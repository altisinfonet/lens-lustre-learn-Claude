# JUDGING PANEL SAFETY GATE — READ-ONLY · 2026-08-21

**Purpose:** prove or refute, before any production write, that revoking the 27 anon
INSERT/UPDATE/DELETE grants (Row 9) cannot break a legitimate judge workflow.
**Method:** every write path into the nine judging tables traced from the live production
catalog — `pg_proc` bodies, `pg_trigger`, `pg_policy` with role sets and predicates,
`pg_roles` attributes, view updatability, column constraints. Nothing modified. No test row
created. No RLS, function, trigger or data touched.
**Withdrawn:** the prior phrase "cannot break anything by mechanism". Replaced below by the
actual trace.

---

## 1. ROLE ATTRIBUTES (the ground the whole argument stands on)

| role | BYPASSRLS | note |
|---|---|---|
| `anon` | **false** | RLS always applies to it |
| `authenticated` | **false** | RLS always applies to it |
| `postgres` (owner of all 9 tables, all writer functions, all views) | **true** | definer paths ignore RLS |
| `service_role` | **true** | untouched by Row 9 |

All nine tables: owner `postgres`, `relrowsecurity = true`. (`relforcerowsecurity = false`,
which matters only for `postgres` itself — irrelevant to anon.)

## 2. COMPLETE WRITER INVENTORY

A body-scan of **every function in schema `public`** (`pg_proc.prosrc`, corrected `\y`
word-boundary regex) for INSERT/UPDATE/DELETE against any of the nine tables found
**exactly six writers — and all six are SECURITY DEFINER, owned by `postgres`:**

| function | writes to | EXECUTE anon / authd | internal guard (read from body) |
|---|---|---|---|
| `mirror_system_tag_to_decision` (trigger) | judge_decisions, v3_mirror_log | true / true (irrelevant: trigger) | fires only on judge_tag_assignments DML — itself gated below |
| `auto_create_judging_rounds` (trigger) | judging_rounds | true / true (trigger) | fires on `competitions` DML — admin-gated by that table's policies |
| `apply_decision_to_remaining` | judge_decisions | **true / true** | `IF _caller IS NULL THEN RAISE 'Authentication required'`; then admin-or-assigned-judge check — **anon call fails at line 1** |
| `backfill_tag_decision_drift_admin` | judge_decisions | **true / true** | `IF v_caller IS NULL OR NOT has_role(admin) THEN RAISE 'admin only'` — **anon call fails at line 1** |
| `judge_apply_single_tag` | judge_tag_assignments | **false / false** | not client-callable at all |
| `admin_purge_orphan_user_data` | judge_decisions, judge_sessions, judge_tag_assignments | **false / false** | not client-callable at all |

**Zero SECURITY INVOKER functions write to any of the nine.** That is the decisive fact: no
function-mediated or trigger-mediated write anywhere in the schema depends on the *caller's*
table grants. Every one executes as `postgres` and is untouched by an anon revoke.

(`judging_write_decision_atomic` — C2's critical RPC — does **not** write any of the nine
directly; its judging writes land via `judge_apply_single_tag`/the mirror trigger and it
updates `competition_entries` state. Unaffected by Row 9 either way. ⚠ Side observation,
outside this gate's scope: it is anon-EXECUTABLE and the first 1,200 chars of its body show
input validation but **no caller-authentication guard**; the remaining ~1,200 chars are
unread. Flagged for its own review — not acted on, not part of Row 9.)

## 3. EVERY WRITE PATH, CLASSIFIED AS INSTRUCTED

| # | Path | Classification | Currently works for a judge? | Affected by Row 9? |
|---|---|---|---|---|
| 1 | Judge UI → PostgREST direct table writes with a member JWT (the path the policies "Judges can insert own scores/decisions/sessions", "Judges can assign tags", "Admins can manage…" exist for) | **authenticated direct table write** | yes — this is the designed path | **NO.** Revoke names `anon` only; `has_table_privilege('authenticated', …)` verified **true** on all nine, before and untouched after |
| 2 | `apply_decision_to_remaining`, `backfill_tag_decision_drift_admin` called with a JWT | **SECURITY DEFINER RPC** | yes (admin / assigned judge) | **NO** — run as `postgres` |
| 3 | Mirror trigger, round-creation trigger, `refresh_score_cache`, audit triggers | **trigger-owned write** | yes | **NO** — all SECDEF/`postgres`; no invoker trigger functions exist (§2) |
| 4 | Edge functions / admin tooling on `service_role` | **admin/service-role write** | yes | **NO** — service_role BYPASSRLS + own grants, not named in the revoke |
| 5a | Direct anon table write (no JWT) | **anonymous write** | **already fails today** — see §4 | Failure layer moves from RLS to grant. Same outcome: refused |
| 5b | Anon write **through the three `owner_safe` views** | **anonymous write (definer-view channel)** | **structurally blocked** — see §5 | **NO** — view writes execute as the view owner (`postgres`); base-table anon grants are not consulted on that path at all |

## 4. WHY NO ANON WRITE SUCCEEDS TODAY (path 5a, proven not asserted)

- RLS enabled on all nine; anon has no BYPASSRLS.
- Write policies, complete inventory with role sets: **every** INSERT/UPDATE/DELETE/ALL policy
  on eight of the nine is scoped to `authenticated`. The single exception found by this gate:
  **`judging_config` carries two `PUBLIC`-role policies** (PUBLIC includes anon) — but their
  predicates are `has_role(auth.uid(), 'admin')`, and for anon `auth.uid()` is NULL → false.
  No permissive policy passes → write denied.
- `v3_mirror_log`: one admin-read policy only; writes deny-all.
- Therefore: **there is no working anonymous judge flow to break, because no anonymous write
  into any of the nine can currently commit.** The revoke changes the refusal layer, not the
  refusal.
- Corollary worth recording: `judging_config` is where Row 9 does its most real work — today
  that table's anon-write defence is a single policy predicate; after Row 9 it is predicate
  **plus** grant.

## 5. NEW SUB-FINDING (V1) — the definer-view write channel: blocked, but thinner than it should be

The three `owner_safe` views are **auto-updatable** (`pg_relation_is_updatable` = 28:
insert/update/delete), `security_invoker` off, owner `postgres` (BYPASSRLS), **CHECK OPTION:
NONE**, and `anon` (and `authenticated`) hold INSERT/UPDATE/DELETE **on the views**.
Writes through such a view use the **owner's** rights on the base table — RLS bypassed.

What blocks it today, verified per view:
- **INSERT:** every view omits `judge_id`, and `judge_id` is **NOT NULL with no default** in
  all three base tables (plus `decision`, `round_number`, `tag_id`, `comment`, `entry_id` as
  applicable) → any INSERT through the view fails on NOT NULL before commit. Secondarily,
  `entry_id` FKs into `competition_entries`, which holds 0 rows.
- **UPDATE/DELETE:** constrained to rows visible through the view; the view's WHERE requires
  `ce.user_id = auth.uid()`, NULL for anon → zero rows addressable.

**Verdict on V1: not exploitable as defined today — but the protection is a column-shape
accident (NOT NULL, no CHECK OPTION), not a control.** A future view edit that exposes
`judge_id`, or a column default added to it, silently opens a definer-rights anon write
channel that bypasses both RLS and the Row 9 revoke. Recommended, as its **own** reviewed
change, not folded into Row 9: revoke INSERT/UPDATE/DELETE on the four views from
`anon`/`authenticated` (they are read surfaces; nothing legitimate writes through them), and/or
set `WITH CHECK OPTION`. Not executed. Not designed further here — scope discipline.

## 6. THE HONEST LIMITS, AND WHY THEY DO NOT CHANGE THE VERDICT

1. **The judge UI client code was not read** (no repository access this session). Immaterial
   to this gate, by exhaustion: whatever the UI calls, it calls either **with** a JWT
   (paths 1–2, proven unaffected) or **without** one (path 5, proven already-failing). There
   is no third role it can present. A UI read at HEAD remains listed for row 9's CI half.
2. **Edge-function Deno source not readable from the DB.** Same exhaustion argument: they hold
   either the user's JWT (authenticated), `service_role`, or the anon key (path 5a —
   already-failing today).
3. **The nine tables are empty and no live competition is running** — production has no
   active judging traffic to regress *right now*. The behavioural proof therefore cannot come
   from observing live traffic; it comes from the §7 plan.
4. `judging_write_decision_atomic`'s unread tail (§2 note) — out of Row 9's scope, flagged.

## 7. BEHAVIOURAL TEST PLAN — full Judge Panel workflow, production-safe

**Design: one identical scripted journey, run twice — BEFORE the revoke (baseline) and AFTER
(comparison). PASS = byte-identical row outcomes at every checkpoint. Any divergence = STOP,
rollback (held ready), report.**

The journey (checkpoints = expected production rows, per the G1 discipline):

| step | action (as an assigned test judge, authenticated) | expected DB evidence |
|---|---|---|
| 1 | Login → open Judge Panel | `judge_sessions` +1 row, owner = judge |
| 2 | Open assigned competition & round | reads only: `judging_rounds`, `judging_config` (judge-role read policy), `v3_stage_catalog` visible |
| 3 | Open a submission | `judge_entry_locks` / assignment reads succeed |
| 4 | Score it | `judge_scores` +1 (range + criteria triggers pass); `entry_score_cache` refreshed by trigger |
| 5 | Assign a system tag | `judge_tag_assignments` +1; mirror fires → `judge_decisions` upsert + `v3_mirror_log` rows; round-lock trigger permits (round open) |
| 6 | Write a judge comment | `judge_comments` +1 |
| 7 | Save/submit decision | `judging_write_decision_atomic` path → `competition_entries.progression_decision` set; catalog validation passes |
| 8 | Re-open the panel | state persists; `entry_public_status` shows nothing public (no round published) |
| 9 | Negative side, same run: the same requests replayed **without** the JWT | every write refused, **before and after alike**; after the revoke the refusal is `permission denied` instead of an RLS empty-effect — refusal either way |
| 10 | Round-lock negative: attempt a write into a locked round | `enforce_round_lock` raises — proves trigger-owned controls unaffected |

**Where it can run, in order of preference:**
- **(a) CG-2 replica harness** (`harness/cg2/`, 17 probes, proven 2026-08-14): zero production
  risk; needs repository access (owner runs it, or Chrome). Extend with the before/after pair.
- **(b) Production, dedicated test competition** (test judge account, one entry, purged
  afterwards via the admin path): this is real-device-grade evidence but **creates production
  rows — it runs only on your separate, explicit authorization**, per your instruction.
- **(c) Minimum bar if both are deferred:** the read-only §1–§6 trace plus post-revoke
  privilege matrix. Honest label: mechanism-proof, not behaviour-proof.

---

## VERDICT: **GREEN — safe to authorize Row 9**, with the evidence above.

Every legitimate judge write path is authenticated (grants untouched — verified true on all
nine) or executes as `postgres` (definer functions and triggers — the complete writer
inventory contains no invoker-rights writer). No anonymous write into any of the nine can
currently commit, so no working flow exists on the anon side to break. The one channel that
bypasses RLS (the definer views, V1) does not consult base-table anon grants and is therefore
unaffected by the revoke in either direction — it is reported separately as a hardening
recommendation, not a Row 9 blocker.

Conditions attached to the GREEN, stated rather than implied:
1. The revoke migration keeps its RED-gate precheck (aborts unless exactly the 27 grants are
   found) and zero-survivor postcheck, with rollback in hand.
2. The behavioural plan runs per §7 — (a) or (b) at your choice, (b) only on your separate
   authorization; until one of them runs, the closure record says "mechanism-proven,
   behaviour-pending", not PASS.
3. V1 and the `judging_write_decision_atomic` guard question are tracked as their own items —
   neither blocks Row 9, and neither is quietly bundled into it.

**Nothing was modified. The revoke remains unapplied. Awaiting your ruling.**
