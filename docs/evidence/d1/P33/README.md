# P33 — Compromised-password + catalogue tidy. Session B forensic re-check and closure evidence.

**Unit:** P33 · Phase 1 · D1
**Session:** SESSION B — Phase-1 gate closure / durability owner, 2026-09-21
**Branch:** `d1/P1-session-b-p30-p31-p33-20260921` off `staging` (`f0377af`)
**Scope of this document:** P33 only. Does not touch P32 objects, migrations, or files.

---

## 0 · Why this document exists — the durability problem, confirmed

Four of P33's five clauses were reported "done" in `claude/2026-09-16-phase1-verified-status.md`
(this Project). **That record is true about live behaviour on 2026-09-16 and false about
durability.** Verified this session, from the repository and the live database, independently:

- `supabase/migrations/` (both `main` and `staging`, searched by filename AND by content) contains
  **no migration file** that revokes grants on `categories_migration_dropped`,
  `posts_dead_host_backup_20260812`, or `get_primary_admin_user_id`. The only committed durable
  artefacts for P33's neighbouring units are P30/P31's (`20260910_0001`, `0003`, `0004`, `0005`).
- `list_migrations` on staging (`fpszggreishhuvdpkmdr`) shows 8 rows dated 2026-09-15, applied
  through the Supabase MCP `apply_migration` tool directly — **not** through
  `apply-migration.yml`, and never captured as `.sql` files in the repository. Two of those eight
  rows are exactly the two P33 clauses this document closes durably:
  `p33_retire_leftover_rls_tables_behaviour` and `p33_get_primary_admin_user_id_revoke_anon`.
- The staging project itself was rebuilt once already (`fpszggreishhuvdpkmdr`, created
  2026-09-11 — the OLD staging project `ztzutckwdhetphwghuzj` was permanently deleted, per
  `claude/supabase-staging-migration-status.md`). The 2026-09-15 MCP applies happened *after* that
  rebuild, so they are not even protected by "staging never gets reset" — it already has been once,
  and there is nothing in the repository that would reproduce these two fixes if it happens again.

**This document's job:** verify the live state is what it's claimed to be, capture it as two
durable, idempotent, rollback-paired migrations, prove them with fixture-based fail-first probes,
and record the two remaining P33 items (cross-member test coverage; the leaked-password ruling) as
decision-ready evidence — without editing any Auditor-owned file.

---

## 1 · The gate, verbatim, and per-clause status after this session

> **P33** — leaked-password protection on; the four definer views read, justified and each covered
> by a cross-member test; the two leftover RLS-enabled tables retired; `plpgsql_check` moved out of
> `public`; `get_primary_admin_user_id` either closed or its exposure written down.
>
> — `docs/gates/GATE_REGISTER.md`, "Five clauses; all five close or the unit does not."

| clause | live state, verified 2026-09-21 | durable in repo, before this session | durable in repo, after this session |
|---|---|---|---|
| 1 · leaked-password protection on | **OFF** — Pro-plan feature; Owner has ruled out the plan upgrade (see §5) | N/A — no code artefact | N/A — recorded as decision-ready evidence only (§5); no gate file touched |
| 2 · four definer views justified + cross-member test | views correctly owner-scoped (§3); **live cross-member proof re-run this session** (§4) with real data; no committed automated test existed | **no** | **partial** — a static regression test added (`src/__tests__/p33DefinerViewPredicates.test.ts`); a live-DB cross-member CI test is not added this session (see §4 "what is not done") |
| 3 · two leftover RLS tables retired | **CLOSED**, confirmed live (§2) | **no migration file** | **yes** — `20260910_0040_p33_retire_leftover_rls_tables.sql` + rollback + `PROBE_p33_leftover_rls_tables_closed.sql` |
| 4 · `plpgsql_check` out of `public` | **CLOSED**, confirmed live: `select extnamespace::regnamespace from pg_extension where extname='plpgsql_check'` → `extensions` | pre-existing (this clause was never live-only; not re-verified as a gap) | unchanged — nothing to durably capture, already correct at install time |
| 5 · `get_primary_admin_user_id` closed or exposure written down | **CLOSED**, confirmed live (§2) | **no migration file** | **yes** — `20260910_0041_p33_get_primary_admin_user_id_revoke_anon.sql` + rollback + `PROBE_p33_get_primary_admin_user_id_closed.sql` |

**P33 does not close this session.** Clause 1 needs an Auditor ruling (decision-ready evidence
supplied, §5). Clause 2's cross-member requirement is only partially durable (§4). Clauses 3 and 5
are now durable and live-proven. This document does not claim `VERIFIED` for any row — only the
Auditor's own instrument run earns that status, per `docs/gates/GATE_REGISTER.md` rule 1.

---

## 2 · Live readings, staging `fpszggreishhuvdpkmdr`, `SELECT` only, 2026-09-21

```
categories_migration_dropped      relacl = {postgres=arwdDxtm/postgres}
posts_dead_host_backup_20260812   relacl = {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
  -- both: relrowsecurity = true, policy_count = 0, anon_select = false, anon_insert = false

get_primary_admin_user_id()       prosecdef=true  provolatile=s
  proacl = {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
  anon_exec = false, PUBLIC entries = 0

plpgsql_check extension           schema = extensions  (not public)
```

Cross-checked against `pg_get_functiondef`/source for `get_primary_admin_user_id()`: the creating
migration (`20260704120420_3d0eaaec-…sql`) already revoked `PUBLIC` and granted only
`authenticated` — the F-62 shape again: `ALTER DEFAULT PRIVILEGES` grants `anon` its own,
independent EXECUTE on every new `public` function, so the PUBLIC-only revoke never closed anon.
Confirmed by grep: no client call site anywhere in `src/` or `supabase/functions/` calls this RPC
directly (the only reference is a generated type in `src/integrations/supabase/types.ts`); two
views/functions call it **internally** from an `authenticated`-reachable context
(`20260719000300_feed_stories_bar.sql`, `20260731000000_public_stories_and_view_counts.sql`), which
is why `authenticated` is kept and `anon` is not.

---

## 3 · The four definer views — read and re-justified, not "fixed" by `security_invoker`

Per the `50mm-developer-1-db-runtime` skill: "The four views are not to be 'fixed' by flipping
`security_invoker` — each is judged by its WHERE clause." Definitions read live, 2026-09-21
(`pg_views`):

| view | scoping predicate | judged by |
|---|---|---|
| `judge_decisions_owner_safe` | `EXISTS (… WHERE ce.id = jd.entry_id AND ce.user_id = auth.uid() AND crp.round_number = jd.round_number AND crp.published_at IS NOT NULL)` | owner-of-entry AND that specific round published |
| `judge_comments_owner_safe` | `EXISTS (… WHERE ce.id = jc.entry_id AND ce.user_id = auth.uid() AND crp.published_at IS NOT NULL)` | owner-of-entry AND competition has any published round |
| `judge_tag_assignments_owner_safe` | `EXISTS (… WHERE ce.id = jta.entry_id AND ce.user_id = auth.uid() AND crp.published_at IS NOT NULL)` | owner-of-entry AND competition has any published round |
| `entry_public_status` | not owner-scoped by design — it is the public results board; gated by `(status IN (…snapshot of "has ever been in the pipeline" statuses…)) OR has_role(auth.uid(),'admin')`, and every derived column (`public_status`, `public_placement`, `public_r4_tags`) is itself conditioned on `latest_published_round`, never on the raw base-table value | publication-gating in the projection, not a row filter — correctly a different shape from the other three, per the 2026-09-16 record's own note that a cross-member test is the wrong instrument for it |

All four use `auth.uid()` (a caller-scoped, per-session value) inside the view body, so their
correctness does not depend on `security_invoker` either way — a `SECURITY DEFINER` reading with an
`auth.uid()`-scoped predicate is not the amplification pattern the gate exists to catch (that
pattern is a definer function/view whose predicate does NOT depend on the caller). Confirmed no
mark/score column is exposed by any of the four (`judge_decisions_owner_safe` returns `decision`
only, never a numeric score; static guarantee already pinned client-side by
`src/test/marks-private.test.ts`).

---

## 4 · Cross-member proof — live, real data, this session

Run against staging, inside `BEGIN … ROLLBACK` transactions (read-only; nothing written; `SET
LOCAL role` + `SET LOCAL request.jwt.claim.sub` reproduces the same `auth.uid()` a real PostgREST
request would present — `auth.uid()`'s own definition:
`coalesce(current_setting('request.jwt.claim.sub'), (request.jwt.claims->>'sub'))::uuid`).

Three real, distinct member owners with a published-round `judge_decisions` row were found live
(1 row each):

| caller | `judge_decisions_owner_safe` rows visible | entry_id returned |
|---|---|---|
| user A (`56cd3948-…`) | **1** | `0cdcdfca-14a7-4afb-9bf9-99b3f5f92db4` (A's own entry) |
| user B (`7f10c143-…`) | **1** | `b2acf0e8-5bb2-4beb-9aee-3823437c8eb0` (B's own entry — **not** A's) |
| anon (no claim) | **0** | — |

**This is the gate's required shape**: each member sees exactly their own row, zero of another
member's, and anon sees none. `judge_comments_owner_safe` and `judge_tag_assignments_owner_safe`
share byte-identical scoping logic (same `ce.user_id = auth.uid()` + publish-gate join shape,
verified in §3), but **could not be positively exercised with real data**: the base tables
currently hold zero published-round rows for either (`total_comments_published = 0`,
`total_tags_published = 0`, measured live) — there is nothing to leak today, so a zero-rows reading
from either view is vacuously correct, not a demonstrated proof the way judge_decisions' is.

### What is NOT done, stated rather than left implicit

No automated, CI-running, live-database cross-member test was added this session — only a static
regression test (`src/__tests__/p33DefinerViewPredicates.test.ts`) that pins each view's
scoping-predicate text against the committed snapshot below, so a future edit that weakens or
removes `ce.user_id = auth.uid()` (or `entry_public_status`'s publication gate) fails CI. That is a
real, valuable control — it is the "not fixed by flipping security_invoker" guard made mechanical —
but it is not the same instrument as the live proof in this section, and it cannot catch a defect
that keeps the predicate text but breaks its logic (e.g. an `OR` where an `AND` belongs). A live
cross-member CI test, in the shape of `src/test/judging-invariants.test.ts` (skip-if-no-creds,
using two seeded test member accounts with real JWTs — `SET LOCAL request.jwt.claim.sub` is not
reachable from a `supabase-js` client, only from a direct Postgres connection this repo's test
suite does not currently have), is real, scoped follow-up work, not built in this session, and is
listed as such in the SESSION B deliverable report rather than silently left undone.

View definitions as read live 2026-09-21, for the static test to pin against, are committed at
`docs/evidence/d1/P33/view-definitions-snapshot-20260921.sql`.

---

## 5 · Clause 1 — leaked-password protection — decision-ready evidence, not a ruling

**This document does not decide this clause.** `docs/gates/P1-revocation-list.md` and
`docs/gates/GATE_REGISTER.md` are Auditor-owned (`docs/ADDENDUM_A_EXECUTION_MASTER.md` §3.1/§3.2,
restated in `docs/gates/GOVERNANCE.md` §2.2); this session's ownership is `docs/evidence/d1/**`
only, and no file outside it is touched for this clause.

**The substantive question is already settled, by the Owner, on the record — what is missing is
where it is recorded.** `claude/2026-09-17-P33-leaked-password-accepted-risk-ruling-request.md`
(this Project) laid out exactly this gap on 2026-09-17. Separately and independently, the Owner has
stated the same position in this Project's own durable memory of the project (`overview.md`,
"Lanes and execution" section): *"Will not upgrade Supabase to the Pro plan — both projects stay on
Free, so Pro-only features (e.g. leaked-password protection) are out of scope rather than
pending."* That is the Owner's own stated decision, not this session's inference.

**Recommended disposition** (a recommendation, not a ruling this session is entitled to make): the
correct register status, per the project's own status vocabulary
(`VERIFIED · OWNER-ATTESTED · INFERRED · BLOCKED · N/A · DEFERRED`), is **`DEFERRED`** — not
`VERIFIED`, and not silently dropped from the register — with the reason recorded as: *the feature
requires a Supabase Pro-plan upgrade; the Owner has declined that upgrade for both lanes; the
residual risk (compromised-password reuse is not screened at signup or password-reset) is accepted
on that basis.* This session leaves the actual edit to `docs/gates/P1-revocation-list.md` /
`GATE_REGISTER.md` to the Auditor, per ownership.

---

## 6 · What this session did not do, and why

- **No P32 object was read, reserved, or touched.** `increment_managed_page_view` was re-verified
  live (still anon-executable, `provolatile=v` — squarely a P32 object, not P33's) only because the
  task's re-check list named it; nothing about it was changed.
- **No SQL was applied to staging or production.** `mcp__Supabase__execute_sql` was used only for
  `SELECT`/read-only probes, each wrapped in `BEGIN … ROLLBACK`, and `mcp__Supabase__apply_migration`
  was not called at all this session. The two new migrations are committed as files and left for
  dispatch through `apply-migration.yml`, per `CLAUDE.md` §2 ("Security-relevant DB changes ship
  with migration + rollback + PROBE, and are applied only through the sanctioned
  `apply-migration.yml` workflow") and this project's own H-6 precedent (a D1 session correctly
  refusing a direct MCP DDL apply even when invited to).
- **No `docs/gates/**` or `docs/PROMOTION_LEDGER.md` file was edited.**
