# P33 — the eleven SECURITY DEFINER relations, one disposition each

**Measured on staging (`fpszggreishhuvdpkmdr`, PostgreSQL 17.6) on 2026-09-25,
SELECT only.** App readers re-derived at `c583431` with a shape-independent
scan of `src/**`, `supabase/functions/**`, `functions/**`, `scripts/**`,
`public/**`, `tools/**` (quoted relation name preceded within 300 characters by
`.from`, `.rpc` or a `rest/v1/` path; `src/integrations/supabase/types.ts`
excluded as generated). Database readers from `pg_depend` → `pg_proc`, plus
`pg_policy` and `cron.job`. Behaviour measured on the PostgreSQL 17.11 fixture
in `p33-fixture.sql`; the transcript is `p33-test-transcript.txt`.

All eleven are `SECURITY DEFINER` (`reloptions` is NULL, so `security_invoker`
is unset) and owned by `postgres`, which is `BYPASSRLS` on Supabase. **A
definer view does not consult its base tables' RLS. The SELECT grant is the
only control any of them has.** That is the premise of every line below.

`20260910_0033` (PR #292, applied to staging) already removed INSERT, UPDATE,
DELETE, TRUNCATE, REFERENCES and TRIGGER from `anon` and `authenticated` on all
eleven. Measured post-state, unchanged today:
`anon=r  authenticated=r  postgres=arwdDxtm  service_role=arwdDxtm`, zero
PUBLIC ACL entries. This file is about the remaining `r`.

---

## ⚑ FOR THE OWNER — three questions, no change made

These are flagged, not acted on. Each is a product decision about what the
public is *supposed* to see, and D1 does not get to make it.

### ⚑ 1 — `profiles_public.is_suspended` is readable by anonymous visitors

`profiles_public` projects 20 of `profiles_public_data`'s 23 columns to `anon`.
One of them is `is_suspended`. Any logged-out visitor can enumerate which
members are suspended. That may be intended (a suspended badge) or it may be a
moderation state that was never meant to leave the admin surface.
**Question: should `is_suspended` be in the anonymous projection?**

### ⚑ 2 — `entry_final_votes.adjustment_total` exposes admin vote adjustments

`entry_final_votes` returns `real_votes`, `adjustment_total` and `final_votes`
side by side. `adjustment_total` is the sum of `admin_vote_adjustments` — the
amount an administrator added to or subtracted from a photo's real count.
Publishing `final_votes` is a product decision; publishing the *correction* next
to it lets any visitor compute exactly how much a photo's score was altered by
hand, and for which photos.
**Question: should `adjustment_total` (and `real_votes`) be in the view that
`anon` reads, or should the public view return `final_votes` alone?**

### ⚑ 3 — NEW. `profiles_public` is not an effective control, because the app
### reads the base table directly

`profiles_public_data` is a **TABLE**, not a view. It has RLS enabled with the
policy *"Anon can view limited public profile data"*, `USING (true)` — so `anon`
can read **every row and every column of it**, including the three columns
`profiles_public` deliberately omits: `is_banned`, `last_active_at`,
`notification_sound_enabled`.

The 20-column projection is therefore a convention, not a boundary, and the
codebase does not follow it: `profiles_public` has **one** call site
(`src/pages/Referrals.tsx:88`) while `profiles_public_data` has **thirteen**,
including `src/lib/profilesPublic.ts:32` — the helper whose name says it is the
public-profile accessor — and two edge functions.

This is out of scope for 0036, 0042 and 0037: it is a change to an RLS policy on
a base table, and it would move the app's most-used profile read. It is raised
here because closing or keeping `profiles_public` has almost no security effect
while that policy stands, and the file should not imply otherwise.
**Question: should the `USING (true)` anon policy on `profiles_public_data` be
narrowed to the 20 published columns' worth of rows, with the 13 call sites
moved to `profiles_public`?**

(For contrast, `profiles` — which holds address, phone and national ID — has RLS
with **no** anon SELECT policy. It is not anon-reachable. This finding is about
`profiles_public_data` only.)

---

## CLOSED by `20260910_0036` — five

Each has **zero app readers of any kind**, and every database reader it does
have is itself `SECURITY DEFINER`, which runs as `postgres` and therefore does
not consult the caller's grant. Group 3 of the test suite proves that rather
than asserting it: before 0036 a direct read as `anon` and as `authenticated`
succeeds; after 0036 both raise `42501`; a definer wrapper and `service_role`
still read. Without the "before" half, `42501` would prove nothing (C-34).

### 1. `judging_progression_audit` — view — **CLOSED**

No row filter at all. Returns every entry's title, status, stored progression
decision and the decision its tags imply, for every competition, published or
not. A logged-out visitor could read the outcome of a competition that is still
being judged.
App readers: 0. Database readers: 0. Policies: 0. Cron: 0.
Nothing consumes it. It is an audit surface that was left world-readable.

### 2. `v_judging_drift` — view — **CLOSED**

No row filter. A five-way UNION that returns `judge_id` alongside the tag and
the decision, per entry, per round. Anonymous readers could reconstruct who
judged what, before publication — which is the one thing a blind judging process
is meant to prevent.
App readers: 0. Database readers: 1 — `get_judging_drift_admin`, SECURITY
DEFINER. Policies: 0. Cron: 0.

### 3. `entry_public_status` — view — **CLOSED**

The only one of the five that *has* a filter: a status allow-list, OR
`has_role(auth.uid(), 'admin')`. It is closed anyway, because nothing reads it
directly.
App readers: 0. Database readers: 8, **all SECURITY DEFINER** —
`get_derived_status_drift_admin`, `get_entry_status_drift_admin`,
`get_entry_status_drift_summary_admin`, `get_gated_entry_status`,
`get_gated_status_runtime_drift_admin`, `get_result_visibility_invariant_admin`,
`recompute_entry_public_status`, `trg_recompute_publish_fanout`.
Policies: 0. Cron: 0.

### 4. `entry_vote_counts` — **materialised** view — **CLOSED**

Relkind `m`, which is why the migration's precondition checks relkind per
relation instead of assuming `v`. No row filter. Exposes `real_votes`,
`adjustment_votes` and `final_votes` per entry — see Owner question 2; this
relation is closed outright, so that question is about `entry_final_votes` only.
App readers: 0. Database readers: 1 — `get_entry_vote_counts`, SECURITY
DEFINER. Policies: 0. Cron: 0.

### 5. `entry_final_votes_legacy` — view — **CLOSED**

No row filter. An aggregate over `entry_final_votes`.
App readers: 0. Database readers: 0. Policies: 0. Cron: 0.
No reader of any kind, in the application or in the catalogue. Named "legacy"
and behaving like it.

---

## KEPT — six

### 6. `judge_comments_owner_safe` — view — **KEPT · OPEN — fixed by `20260910_0042`**

Intended: a member reads the judges' comments on their own entry, once the round
is published. Actual: the `EXISTS` correlates `crp.competition_id =
ce.competition_id` and `ce.user_id = auth.uid()`, and then requires
`crp.published_at IS NOT NULL` — **on any row of `competition_round_publish` for
that competition**. There is no correlation between the published round and the
comment's round. So as soon as *one* round of a competition is published, the
owner can read the judges' comments on their entry from **every** round,
including rounds still being judged.

This is the Auditor's finding C-A19, raised by D1 on 2026-09-25 and confirmed
independently. It is **not** fixed by 0036 — 0036 changes no definition — and it
is not fixed by keeping the grant either. `20260910_0042` adds the round
correlation.

App readers: `src/hooks/dashboard/useDashboardData.ts:186`,
`src/pages/SubmissionDetail.tsx:374`. Database readers: 0.
The grant is kept because both call sites are live member-facing reads; closing
it would break the dashboard and the submission page without fixing the leak.

### 7. `judge_decisions_owner_safe` — view — **KEPT · correct**

The same intent as §6, implemented correctly: its `EXISTS` carries
`AND crp.round_number = jd.round_number` as well as the owner and publication
checks. Measured on the fixture, side by side with §8 on identical data: for
member A's round-3 rows in a competition whose round 3 is **not** published,
this view returns **0** and `judge_tag_assignments_owner_safe` returns **1**.

Cross-member tests (suite group 1): as A, only A's published-round decision,
none of B's rows, nothing from the unpublished round; as B, the mirror; as
anonymous with no `uid`, zero rows. Each is falsified by a loosened copy —
`jdos_loose_uid` (owner check removed) and `jdos_loose_round` (round correlation
removed, i.e. the C-A19 defect transplanted onto this view). All four loosened
runs go RED.

App readers: `src/pages/SubmissionDetail.tsx:382`. Database readers: 0.

### 8. `judge_tag_assignments_owner_safe` — view — **KEPT · OPEN — fixed by `20260910_0042`**

The same defect as §6, in the same shape: `competition_id` correlated,
`round_number` not. A published round 1 exposes the owner's round-3 tags.
Reproduced as group 0 of the suite, at value `1` where §7 returns `0`.

App readers: `src/components/EntryTagStamps.tsx:39`,
`src/hooks/competition/useCompetitionDetail.ts:181`,
`src/hooks/dashboard/useDashboardData.ts:184`,
`src/pages/SubmissionDetail.tsx:372` — four live member-facing reads.
Database readers: 0.

### 9. `judge_tag_assignments_public_r4` — view — **KEPT · public by design**

Anonymous visitors are *meant* to see round-4 award tags; that is the results
page. Two restrictions make that safe, and both are tested (suite group 2): the
tag must be award-family and round 4 in `v3_stage_catalog` with `is_active`, and
the entry's competition must have round 4 **published**.

As anonymous: exactly the two award tags of the published competition —
including another member's, which is the point of a public results view — no
non-award tag, and nothing from the competition whose round 4 exists but is
unpublished. Falsified by `jtapr4_loose_family` (award-family test removed) and
`jtapr4_loose_publish` (publication test removed); both go RED. The fixture
carries a second competition specifically so "unpublished round 4" is a row that
could have been returned rather than an absence (C-34).

App readers: `src/pages/PublicProfile.tsx:383`. Database readers: 0.

### 10. `profiles_public` — view — **KEPT · two Owner questions above (⚑1, ⚑3)**

A 20-column projection of `profiles_public_data`, omitting `is_banned`,
`last_active_at` and `notification_sound_enabled`. Keeping it is not in
question — public profiles are a public feature — but see ⚑1 for
`is_suspended` and ⚑3 for the fact that the projection is bypassed by 13 direct
reads of the base table, which anon RLS permits in full.

App readers: `src/pages/Referrals.tsx:88`. Database readers: 0.
No change made by 0036, 0042 or 0037.

### 11. `entry_final_votes` — view — **KEPT · one Owner question above (⚑2)**

Per-photo `real_votes`, `adjustment_total` and `final_votes`. Vote counts are a
public product feature; the admin adjustment shown next to them is the question
(⚑2).

App readers: `src/hooks/judging/usePhotoVoteCount.ts:54`,
`supabase/functions/entry-final-votes/index.ts:78`. Database readers: the
`entry_final_votes_legacy` view depends on it, and that view is closed by 0036 —
a view's dependency on another view is resolved as the owner, so closing the
legacy view does not affect this one, and closing this one is not proposed.
No change made by 0036.

---

## Summary

| # | relation | kind | app readers | db readers | disposition |
|---|----------|------|-------------|-----------|-------------|
| 1 | `judging_progression_audit` | v | 0 | 0 | **CLOSED** by 0036 |
| 2 | `v_judging_drift` | v | 0 | 1 (DEFINER) | **CLOSED** by 0036 |
| 3 | `entry_public_status` | v | 0 | 8 (all DEFINER) | **CLOSED** by 0036 |
| 4 | `entry_vote_counts` | m | 0 | 1 (DEFINER) | **CLOSED** by 0036 |
| 5 | `entry_final_votes_legacy` | v | 0 | 0 | **CLOSED** by 0036 |
| 6 | `judge_comments_owner_safe` | v | 2 | 0 | KEPT · **OPEN — fixed by 0042** |
| 7 | `judge_decisions_owner_safe` | v | 1 | 0 | KEPT · correct, tested |
| 8 | `judge_tag_assignments_owner_safe` | v | 4 | 0 | KEPT · **OPEN — fixed by 0042** |
| 9 | `judge_tag_assignments_public_r4` | v | 1 | 0 | KEPT · public by design, tested |
| 10 | `profiles_public` | v | 1 | 0 | KEPT · ⚑1, ⚑3 |
| 11 | `entry_final_votes` | v | 2 | 1 view dep | KEPT · ⚑2 |

Five closed, six kept, two of the six carrying an OPEN defect that `0042` fixes,
three Owner questions raised and not acted on.
