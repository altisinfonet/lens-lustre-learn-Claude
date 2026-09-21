# Session C — Scale/Observation Clock + Parallel Preparation — Forensic Recheck

**Role:** Session C (Scale/Observation Clock + Parallel Preparation Owner), Workstream P.
**Date:** 2026-09-21. **Branch:** `d1/P-workstream-session-c-scale-20260921` (off `staging`).
**Baseline confirmed:** `main`@`96c9d91` · `staging`@`f0377af` — matches the dispatch instructions exactly.
**Nature of this document:** read-only forensic findings + a dependency map + a clock tracker. **No SQL was applied, no seed was run, no other session's files were touched.**

---

## 1 · Forensic re-check — the ten questions asked

1. **Current staging project reference.** `fpszggreishhuvdpkmdr` (confirmed live via Supabase MCP `list_projects`: `ACTIVE_HEALTHY`, Postgres 17.6, region `ap-northeast-2`, created `2026-09-11T06:14:05Z`). `scripts/db-lane-guard.mjs` was already re-pointed at this ref on **2026-09-12** (`system_identifier 7678069749886157684`); the old ref `ztzutckwdhetphwghuzj` is documented in the file header as **retired 2026-09-12**. The old production ref `jtdtehuqtinjxropkkcn` is unchanged and still refused by construction. **This dependency is already satisfied — no work needed here.**

2. **Current seeder implementation.** `scripts/db-seed-staging.mjs` + `scripts/db-lane-guard.mjs` + `.github/workflows/d1-seed-staging.yml` all exist on `staging`, targeting the current ref. The workflow supports `plan` / `status` / `seed` / `teardown` modes via `workflow_dispatch`, requires the row count typed twice, requires `SUPABASE_DB_URL` from the `staging` GitHub Environment, and requires an explicit `acknowledge_enqueue_jobs` checkbox for `seed` mode. **It currently seeds `public.posts` only** (per its own reservation and per `GATE_REGISTER.md` row `0.3`).

3. **Seed count supported by code.** The script's default and every documented invocation is `--rows 1000000`; it also ran successfully at 100,000 (2026-09-04) and at 300 (teardown proof, F-79/F-80). It is generic over row count via ordinal-derived deterministic UUIDs (`md5('50mm-seed-v1:post:' || n)::uuid`), so `--rows 1000000` is the intended target, not a hypothetical.

4. **Previous 100k evidence.** `docs/evidence/d1/baseline/staging/100k-seed-2026-09-04.md` exists and is fully instrumented (before/after censuses, run IDs, UTC timestamps) — but it ran against **`ztzutckwdhetphwghuzj`**, the now-retired project. **This evidence does not describe the current staging database and cannot be reused as "current seeded state."** No seed evidence file of any size exists yet for `fpszggreishhuvdpkmdr`.

5. **Whether current staging is empty.** **No.** Live read (Supabase MCP, SELECT-only, `fpszggreishhuvdpkmdr`, 2026-09-21T12:xx UTC): `posts=10,913` · `profiles=50` · `user_roles=50` · `follows=512` · `user_notifications=51` · database size `207 MB`. This is neither the pre-seed baseline (17 posts) nor a 100k or 1M seed — it looks like organic/dev data on the rebuilt project, not a seeded-and-torn-down state. **Any 1M seed run now would seed on top of these 10,913 real-looking rows, not into an empty table**; the guard SQL only protects against re-inserting the same deterministic ordinals (`ON CONFLICT DO NOTHING`), it does not care about pre-existing organic rows.

6. **Prerequisites for 1M seeding — status.**
   - Lane retarget: **done** (item 1).
   - Guard's *production-ref refusal demonstrated in a CI run* (the actual Phase-0 gate text for item `0.3`): **NOT closed.** `GATE_REGISTER.md` (last touched 2026-09-03, Revision 7) states in terms: *"the Auditor reproduced the production-ref refusal locally... but the gate requires it demonstrated failing in a CI run, and that run has not happened. A local reading is not the gate."* I could not check whether this has since happened — GitHub Actions run history is not reachable from this session (the GitHub API call was refused: *"GitHub access to this repository is not enabled for this session... call add_repo"*; only git clone/fetch over the token works here). No newer evidence file supersedes this statement, so per the plan's own evidentiary rule (`docs/gates/GATE_REGISTER.md` §"five rules," rule 1 — nothing is VERIFIED without the Auditor's own instrument run, committed) **this gate reads NOT MET on the committed record.**
   - Scope gap: the same register row states *"Members, roles and votes need `auth.users` rows — Owner ruling still pending, and P34's scale clause depends on it."* **P34 needs `user_roles` at scale; the seeder as built only writes `public.posts`.** Seeding 1M posts alone does not produce the `user_roles` volume P34's gate names. This Owner ruling has not been made (nothing in `docs/DECISIONS.md` resolves it; grep found no D-number for it).
   - `acknowledge_enqueue_jobs`: the workflow's own text says *"The Owner decides. Tick only if that decision has been made."* A 1,000,000-row seed on `public.posts` (9 triggers, realtime-published, `trg_enqueue_post_created` fan-out) is a real load event against a shared staging database that other sessions' evidence (row counts, latency baselines) may currently assume is small. This is a genuine owner-level decision, not a developer inference.

7. **P20 requirements.** Phase 7 unit, `SPLIT` (D1 engine+index / D2 client). Gate: *"the search technology chosen and its index built; C4's latency budget met at 1 million seeded posts, not at today's volume."* Register: `NOT STARTED`, explicitly *"Unprovable without the Phase 0 seeder."* Phase 7 is the last phase in the plan; P20 cannot close until then regardless of seed timing — but the **seeded dataset itself** is the long-lead artifact P20 will eventually measure against, which is exactly why Owner ruling D-16 (Phase 0) authorized building it early.

8. **P34 requirements.** Phase 4 unit. Gate has three clauses; clause 3 is *"the measurement repeated on seeded data at 1 million rows."* Register: `NOT STARTED`, and separately hard-blocked by **H-2** (*"X1/X2... P34 cannot close"* — 384 duplicate permissive RLS policies / 29 `auth.uid()` per-row re-evaluations, an item from the original Master Plan, outside Addendum A, not yet scheduled). **P34 cannot close even with a perfect 1M seed** until X1/X2 land, which the Owner has not yet scheduled (task `4-OW-01`, "before Phase 4").

9. **P1 seven-day observation requirement.** Phase 2 unit. Gate: *"`profiles` dead-row ratio measured below 10% for seven consecutive days."* This window starts only *"after A-2 and the client cut-over are live on staging"* (task `2-D1-04`), which requires: `docs/gates/phase-2-kickoff.md` committed, `docs/gates/P1-interface.md` frozen, D1's presence-endpoint SQL merged, D2's client cut-over (`useLastActive.ts`) merged. **None of these exist yet** — no `phase-2-kickoff.md`, no `P1-interface.md` in `docs/gates/`, and `GATE_REGISTER.md` reads P1/P2/P10 all `NOT STARTED`. **This clock cannot start now; it is gated on Phase 2 actually opening,** which is itself gated on Phase 1 fully closing (see §3).

10. **Every other Workstream-P elapsed-time measurement.** See the clock table in §2. In summary: a 48-hour wait (Phase 4, A-4a→A-4b) and a 7-day wait (Phase 4, P-4→A-4c) are both downstream of Phase 4, which is downstream of Phases 1–3 all closing; P8's 7-day window (Phase 4) reuses the same instrument as P1's Phase-2 window and is explicitly "what proves P1 worked over a full week," so it cannot start before Phase 2's own window has even run once. No other calendar-real clocks exist in Phases 0, 1, 3, 5, or 6 per the plan text (Phase 6/P25's R2 migration and Phase 5's device measurements are one-shot readings, not elapsed windows).

### Important cross-cutting finding: the Gate Register is 18 days stale against the visible commit history

`docs/gates/GATE_REGISTER.md` is at **Revision 7, dated 2026-09-03**, and lists **P1, P2, P8, P10, P20, P30, P31, P32, P33, P34 all as `NOT STARTED`**. But `staging`'s own commit log shows substantial, apparently-landed work well past that date: P30's `email_exists` revocation migration (`20260910_0001_p30_email_exists_revoke.sql`) **is live** — confirmed by a direct read-only query against `fpszggreishhuvdpkmdr` (`EXECUTE` on `email_exists` is `false` for both `anon` and `authenticated`, `true` only for `service_role`) — plus P31/OI-2/F-96/F-98 revoke migrations, P32 mail-group and media-pipeline ACL PRs (#258, #260, #262), and a large body of GOV-1..GOV-5 governance work (PRs #263–#271), all merged to `staging` after the register's last revision. **The committed Gate Register — the plan's sole named source of truth for "is unit P-n done?" — does not reflect the live state of the database it is supposed to govern.** I did not edit `GATE_REGISTER.md` (Auditor-only, per the ownership map, and I was told not to touch governance). I am flagging this rather than resolving it, per instructions.

One plausible explanation, from project memory: this project's Claude-session history for the last two weeks lives mostly as narrative documents in the attached claude.ai Project (55+ files titled `GOV-*`, `P32-*`, `P1-reconciliation-*`, etc.) rather than as `GATE_REGISTER.md` revisions on `staging`. If so, the actual phase status needs reconciling from those documents plus the live database, not from the committed register alone — a gap that itself may be worth an Auditor-owned pass, but is out of this session's lane.

---

## 2 · Elapsed-clock inventory

| Clock | Prerequisite | Can start now? | Earliest start | Owner | Evidence | Gate consumed |
|---|---|---|---|---|---|---|
| **1M-row staging seed itself** (not a measurement window, but the long-lead artifact P20/P29/P34 depend on) | (a) CI-demonstrated production-ref refusal for item 0.3, currently NOT MET on the committed record; (b) Owner ruling on whether members/roles/votes are seeded alongside posts (P34 needs `user_roles` scale); (c) Owner's `acknowledge_enqueue_jobs` decision, since staging is not empty (10,913 real-looking posts already present) | **NO** — blocked on two Owner-level decisions and one unclosed CI gate, not on anything a developer session should infer | As soon as the Owner rules on (b)/(c) and the CI demonstration is (re-)run and committed | Owner + D1 | This document, §1.6 | Feeds P20 (Ph.7), P34 clause 3 (Ph.4) |
| **P1 `profiles` dead-row 7-day window** | Phase 2 kickoff, `P1-interface.md` frozen, D1 presence-SQL + D2 client cut-over live on staging | **NO** | Day Phase 2's A-2 + client cut-over land | D1 (readings), Auditor (verification) | None yet — no `phase-2-kickoff.md` exists | P1, feeds P-2 promotion |
| **P8 `profiles`/`user_devices`/`user_notifications`/`activity_logs` 7-day window** | Phase 4 entry (A-4a expand live); explicitly reuses P1's instrument, so is only meaningful after P1's own window has run once | **NO** (twice removed — needs Phase 2 closed, then Phase 4 opened) | Phase 4, after A-4a | D1 | None | P8, feeds P-4 |
| **Phase 4: 48h wait, A-4a → A-4b** | Phase 4 kickoff, A-4a (expand) applied and stable | **NO** | Phase 4 start | D1/Auditor | None | Feeds A-4b authorization |
| **Phase 4: 7-day wait, P-4 → A-4c** | P-4 promoted and stable | **NO** | After P-4 | Auditor | None | P27, P33's drop clause, P35's drop clause |
| **P34 1M-row-scale re-measurement** | The seed (blocked, above) **and** H-2 (X1/X2 policy consolidation, not yet scheduled by the Owner — task `4-OW-01`) | **NO** — double-blocked | After both land | D1 | None | P34 |
| **P20 1M-row latency budget** | The seed (blocked, above); Phase 7 entry (Phases 1–6 closed) | **NO** | Phase 7 | D1 (engine) / D2 (client) | None | P20 |
| **P29 (N+1 trace at 1M rows, named alongside P19/P20 in Phase 7)** | Same as P20 | **NO** | Phase 7 | D1 | None | P29, feeds P-7 |
| **Phase 5/6 device & R2 readings** | Not elapsed-time clocks — one-shot measurements, not multi-day windows | N/A | N/A | D2/Auditor | — | — |

**No clock was started by this session.** Starting the P1 window, or seeding 1M rows, without the named prerequisites would produce a reading the plan itself would have to discard (P1's own R2 note: *"a single reading... is noise, which is what the seven-day window is for"* — the same logic makes a seed run before its gates close a data point nobody can cite later without an asterisk).

---

## 3 · Phase 2 preparation — what was checked, what is safe to prepare

Inspected: Phase 1 exit criteria (P30/P31/P32/P33 all VERIFIED, `A-1` green both lanes, `P-1` promoted, `compare/main..staging` zero) and Phase 2 entry conditions (`P1-interface.md`, migration block `20260920_0001-0099`, `docs/gates/phase-2-kickoff.md`).

- `compare origin/main..origin/staging` is **not** zero right now (`git diff --stat` shows 8 files / 2,369 deletions between them — staging is missing several `f105de` referral-reward migration/rollback files that `main` has). Standing Rule 20 requires this to read 0/0/0 after every promotion; it does not right now, which is either a promotion in flight or an unreconciled gap. Not this session's lane to fix (D1/Auditor own reconciliation), but material to record since it bears on whether Phase 1 can be called "closed."
- No `docs/gates/phase-2-kickoff.md` and no `docs/gates/P1-interface.md` exist on `staging`. Per the plan's own rule (§2.5 session startup: *"If it does not exist, the straddling unit has not started; stop and report"*), **Phase 2 has not formally started**, whatever the informal state of P30–P33 in the live database.
- I did not create `phase-2-kickoff.md` or `P1-interface.md` myself — both are Auditor-owned (`docs/gates/**`) per the binding ownership map in §3.1 of the plan, and the task explicitly forbids governance modification.
- What *is* safe and was left unwritten, deliberately, rather than fabricated: instrumentation that could exist ahead of Phase 2 without pre-empting the interface freeze — e.g., a script that reads the current `pg_stat_statements` fingerprint for the two presence-write variants (12,740/843,574ms baseline cited in the plan) so Phase 2 has a same-instrument comparison ready. I did not write this, because it duplicates part of `0-D1-02`'s baseline work (already done per Phase 0) and because writing new D1 scripts pre-emptively, before the interface is frozen, risks exactly the "casual shortcut" the plan's §3.7 forbids. Flagging it as available prep work rather than doing it.

**No Phase-2 gate is claimed closed. No governance file was touched.**

---

## 4 · Parallel safety

`git status` / `git diff` from this branch touch **only** this new file. No file under Session A's or Session B's ownership (P32 objects/migrations, P30/P31/P33 objects/migrations, or any file already modified on another open branch) was read for the purpose of editing, and none was edited. Migration ordinal `20260910_0024` was not created or inspected for competing use — no new migration was written at all, since nothing here required SQL.

---

## 5 · Deliverable summary

1. **1M seed eligibility:** NOT eligible yet — see §1.6 for the exact three blockers (CI-gate not closed on the record; scope-ruling pending; enqueue-acknowledgement pending).
2. **Seed executed:** No.
3. **Exact staging project:** `fpszggreishhuvdpkmdr`.
4. **Exact row count:** Not run; current live count is `posts=10,913` (not empty, not seeded).
5. **Timestamps:** N/A (no seed run). Forensic reads taken 2026-09-21, ~12:00–12:15 UTC.
6. **Runtime:** N/A.
7. **Verification results:** See §1.5–1.6 (live SELECT-only reads against `fpszggreishhuvdpkmdr`).
8. **Elapsed-time clocks identified:** 8 (table in §2).
9. **Clocks started:** 0.
10. **Clocks blocked and exact prerequisite:** All 8; see §2 table's "Prerequisite" column.
11. **Phase-2 preparation completed:** Forensic check only (§3); no files created, since the qualifying prep work is Auditor-owned or would pre-empt an unfrozen interface.
12. **Exact files changed:** this document only (`docs/evidence/d1/workstream-p-session-c/2026-09-21-scale-observation-forensic-and-clocks.md`).
13. **Exact commits:** one, on `d1/P-workstream-session-c-scale-20260921` (see PR).
14. **PR(s) created:** see cover note — GitHub API was not reachable from this session to open one programmatically; branch was pushed for the Auditor/Owner to open against `staging`.
15. **What Sessions A/B must know:** current staging (`fpszggreishhuvdpkmdr`) already carries 10,913 posts / 50 profiles / 50 user_roles / 512 follows — if either session's evidence assumes a near-empty or specific row count, re-check against this live figure before citing it.
16. **Collision or dependency discovered:** the Gate Register / live-database drift in §1 (bold callout), and the non-zero `main..staging` compare in §3 — both reported, neither touched.
