# Session C — 1M-Seed Pre-Flight Package, Clock Readiness, Phase-2 Prep, Blocker Analysis

**Continues from:** `2026-09-21-scale-observation-forensic-and-clocks.md` (same branch, same findings accepted, not repeated here).
**Nature of this document:** non-mutating preparation only. No SQL applied, no workflow dispatched, no seed run, no clock started, no governance file touched.
**Re-inspected at this checkpoint:** `HEAD` was `8f12fbd` (Session C's forensic commit) on `d1/P-workstream-session-c-scale-20260921`, tracking `origin/staging`@`f0377af` — unchanged since the last push. `git status` was clean (no local drift). No new commits found on `staging` since the checkpoint.

## 0 · Parallel-safety re-check at this checkpoint

Two new session branches now exist on origin: `d1/P32-session-a-complete-20260921` and `d1/P1-session-b-p30-p31-p33-20260921`.

- **Session B's branch has zero commits ahead of `staging`** — nothing to check for collision.
- **Session A's branch's real diff against current `staging`** (two-dot, not the misleading three-dot ancestor diff) is **17 new files, 3,723 insertions, 0 deletions, 0 modifications to any existing file** — all under `docs/evidence/d1/P32-session-a/**`, `src/__tests__/**`, and new `supabase/migrations/**` + `supabase/rollback/**` files. I checked `scripts/db-lane-guard.mjs`, `docs/PROMOTION_LEDGER.md`, and every `docs/gates/**` file individually with a direct two-dot diff against `staging`'s current tip: **all are byte-identical to what's already on `staging`.** The large diffs an ancestor-relative (`...`) comparison shows for those files are an artifact of Session A's branch point predating when those files reached their current state on `staging` — not new edits Session A is making.
- **No file under `docs/evidence/d1/workstream-p-session-c/**` is touched by either session.**
- **Conclusion: no collision with Session A or Session B, at either the ancestor-diff or the real-content level.**

---

## TASK 1 · 1M-SEED PRE-FLIGHT CHECKLIST (deterministic, not yet satisfied)

☐ **Blocker A cleared** — a CI run of the production-ref refusal (the actual Phase-0 gate text for register item `0.3`) has executed and its run ID + quoted refusal is committed as evidence. A local reproduction is explicitly **not** the gate per the register's own words.
☐ **Blocker B cleared** — an Owner ruling exists (with a `docs/DECISIONS.md` entry — none currently exists) on whether the seed must extend past `public.posts` to `auth.users`-linked members/roles/votes, since P34 needs `user_roles` at 1M-row scale and the seeder as built does not touch that table.
☐ **Blocker C cleared** — the Owner has made, and someone with dispatch access has recorded, the decision behind `acknowledge_enqueue_jobs` (accepting ~1,000,000 `trg_enqueue_post_created` job enqueues, the realtime decode load, and the follower fan-out into `user_notifications`).
☐ **Fresh pre-seed census taken same-day** — the last live read (this session, 2026-09-21) showed staging at `posts=10,913 / profiles=50 / user_roles=50 / follows=512 / user_notifications=51`; that number will drift and must be re-read with `--status` immediately before any seed dispatch, not assumed from this document.
☐ **No concurrent DDL/migration window** — confirm no Session A/B (or other) `apply-migration.yml` run is in flight against staging at seed time; a 1M-row write and a concurrent schema change on the same lane is exactly the kind of collision the plan's object-reservation discipline exists to prevent.
☐ **Branch discipline** — the workflow only runs from `staging` (hard-checked in its first step); dispatch from any other branch is refused by construction.
☐ **Row-count confirmation** — `rows` and `confirm_rows` inputs must be typed identically (`1000000` / `1000000`); the workflow refuses on mismatch or non-integer input.
☐ **Credential presence** — `SUPABASE_DB_URL` must exist in the `staging` GitHub Environment. I did not and cannot verify its current value or even its presence from this session (no GitHub Actions/secrets API access here); the last committed signal is indirect — the 2026-09-04 100k seed run required this credential to succeed, so it worked as of that date. Its current state is unverified by me at this checkpoint.

### Exact command / workflow

- Local equivalent: `node scripts/db-seed-staging.mjs --rows 1000000 --yes --ack-enqueue-jobs`
- Actual sanctioned path: `.github/workflows/d1-seed-staging.yml` via `workflow_dispatch`, inputs `mode=seed`, `rows=1000000`, `confirm_rows=1000000`, `acknowledge_enqueue_jobs=true` (only once Blocker C is actually resolved), dispatched with `ref=staging`.
- Prescribed order: dispatch `mode=plan` first (writes nothing, prints the full consequence list) → read it → then `mode=seed`.

### Target

- Project: `fpszggreishhuvdpkmdr` ("Staging - 50mm Retina World", `ACTIVE_HEALTHY`, Postgres 17.6, `ap-northeast-2`) — enforced twice, by `LANES.staging.ref` in `scripts/db-lane-guard.mjs` and by a live `system_identifier` check against the running cluster; both already correctly point at this project (re-targeted 2026-09-12).
- Objects: `SEED_TABLES = ['posts']` (line 150, `scripts/db-seed-staging.mjs`) — **`public.posts` only.** No row is written to `profiles`, `follows`, `user_roles`, or any `auth.*` table by the script as it exists today. This is the exact substance of Blocker B.
- Row count: `1,000,000`, deterministic ordinals `1..1,000,000`, `id = md5('50mm-seed-v1:post:' || n)::uuid`, re-entrant (`ON CONFLICT (id) DO NOTHING`, so a partial/failed run can be resumed rather than restarted — proven by the 100k run's 80,200-row partial failure and clean resume).

### Verification queries (the instrument itself — `CENSUS_SQL`, `scripts/db-seed-staging.mjs`)

One query, run before and after (and used for `--status`), returning: `posts_total`, `posts_marked_seed` (via the seed content marker), `profiles`, `follows`, `user_notifications`, `post_hashtags`, `hashtags`, `feed_events`, `album_photos`, `post_reports`, `post_media`, `posts_size` (`pg_total_relation_size`), `database_size` (`pg_database_size`), and a UTC timestamp column. This is the same instrument the 100k run used; reusing it verbatim is what makes a 1M reading comparable to it.

### Cleanup / rollback

`node scripts/db-seed-staging.mjs --teardown --yes --rows <n>` removes exactly the deterministic id set and the `user_notifications` rows it fanned out (reachable via `reference_id`), additionally guarded by `TEARDOWN_ALBUM_GUARD_SQL`, which refuses the teardown if a real member has since attached one of the seeded posts to their own `album_photos` — i.e., it will not silently delete something a member did with seeded content in the meantime.

### Runtime / resource recording convention (precedent: `docs/evidence/d1/baseline/staging/100k-seed-2026-09-04.md`)

PRE-SEED `--status` (run ID + UTC) → every seeding attempt including a failed/resumed one, each with its own run ID and UTC start/end, recorded rather than smoothed over → POST-SEED `--status` (run ID + UTC) → a before/after table across every `CENSUS_SQL` column → narrative notes on anything unexpected → the workflow's own artifact upload of `docs/evidence/d1/baseline/**/seed-*.json` under `d1-seed-staging-${{ github.run_id }}`.

**Net: everything on this list is either already-built tooling or an Owner/Auditor action. There is nothing left for a developer session to build before the seed can run — only decisions and one CI-evidence gap to close.**

---

## TASK 2 · ELAPSED-TIME CLOCKS

| CLOCK | PREREQUISITE | EARLIEST LEGITIMATE START | DURATION | MEASUREMENT | EVIDENCE | CONSUMING GATE |
|---|---|---|---|---|---|---|
| **P1 — `profiles` dead-row window** | Phase 2 kickoff + `P1-interface.md` frozen + D1 presence-SQL and D2 client cut-over live on staging (none exist yet) | Day A-2 + client cut-over land | 7 consecutive days, restarts on any day ≥10% | Daily dead-row ratio read, same instrument as `scripts/db-baseline.mjs`'s existing dead-row computation (already built, Phase 0, merged) | `docs/evidence/d1/phase2/profiles-deadrows-7day.md` (not yet created — Phase 2 hasn't opened) | P1 → P-2 promotion |
| **P8 — 4-table dead-row window** | Phase 4 entry, A-4a (expand) live and stable; explicitly reuses P1's instrument for comparability | Phase 4, after A-4a | 7 consecutive days | Daily dead-row ratio for `profiles`, `user_devices`, `user_notifications`, `activity_logs` | `docs/evidence/d1/P8/` | P8 → proves P1 held over a full week |
| **Phase 4: 48h wait (A-4a→A-4b)** | Phase 4 kickoff, A-4a applied | Phase 4 start | 48 hours | Health workflow + error logs quiet | `docs/gates/phase-4-kickoff.md` (not yet created) | Authorizes A-4b |
| **Phase 4: 7-day wait (P-4→A-4c)** | P-4 promoted and stable | After P-4 | 7 days | Production stability (health/error logs) | Ledger entry per dropped object | P27, P33's drop clause, P35's drop clause |
| **P34 — 1M-row re-measurement** | The seed (blocked, Task 1) **and** H-2 (X1/X2 policy consolidation — not yet scheduled by the Owner, task `4-OW-01`) | After both land | One-shot at scale, not multi-day itself | Sequential-scan count on `user_roles`; index usage on every role-check policy/helper | `docs/evidence/d1/P34/` | P34 (also hard-blocked by H-2 independent of seeding) |
| **P20 — 1M-row latency budget** | The seed (blocked) + Phase 7 entry (Phases 1–6 closed) | Phase 7 | One-shot at scale | Search engine's C4 latency budget under load | `docs/evidence/d1/P20/` · `docs/evidence/d2/P20/` | P20 → P-7 |
| **P29 — N+1 trace at 1M rows** | Same as P20 | Phase 7 | One-shot at scale | `EXPLAIN ANALYZE` / N+1 trace | Named alongside P19/P20 | P-7 |
| **P10 — real-device before/after** | Baseline inventory (done, Phase 0) + timer-discipline fixes (Phase 2 D2 work, not yet landed) | Phase 2 | One-shot before, one-shot after — **not** a multi-day clock, listed because Task 2 named "real-device testing" explicitly | Battery drain, jank, Web Vitals on a real mid-range Android, Owner-executed runbook | `docs/evidence/d2/phase2/p10-before.md` / `p10-after.md` | P10 |

**No clock is eligible to start today.** Every row's prerequisite is either unmet (Phase 2 hasn't opened; the seed hasn't run) or, for P34, doubly unmet (seed **and** H-2).

---

## TASK 3 · PHASE-2 PREPARATION

Checked against the five safety conditions (no Session A/B file touched, no gate bypassed, no migration/DB collision, no false implication of completion, plus a sixth I'm holding myself to: not duplicating work that already exists).

**What exists already and needs no re-building:** `scripts/db-baseline.mjs` (Phase 0, merged) already computes dead-row ratios generically — it is, by the plan's own cross-reference (Phase 2's note: *"keep the same query and the same instrument"* as Phase 4's P8), the intended instrument for both P1's and P8's seven-day windows. Building a parallel dead-row query now would duplicate existing, already-landed tooling — the exact "casual shortcut" risk flagged in the prior checkpoint.

**What would be premature to create:** evidence-template files under `docs/evidence/d1/phase2/**` or `docs/gates/phase-2-kickoff.md` / `docs/gates/P1-interface.md`. These sit in D1's and the Auditor's owned paths for a phase that has not been kicked off; pre-populating them — even as empty templates — risks exactly the "falsely imply the gate is complete" failure mode, and the interface file specifically must not be written by anyone but the Auditor (§3.1 ownership map; §2.5: *"If it does not exist, the straddling unit has not started; stop and report"*).

**What is genuinely safe and was done:** this document's Task 1 and Task 2 sections themselves — a readiness index naming, by file and line, exactly which existing instruments Phase 2 and Phase 4 will reuse (`db-baseline.mjs`'s dead-row computation, the seeder's `CENSUS_SQL`) so that once `P1-interface.md` is frozen, no session has to rediscover them. That is preparation without implementation, additive-only, and it does not touch a file owned by D1, D2, the Auditor, Session A, or Session B.

**No test fixtures, scripts, measurement queries, harnesses, or non-production tooling were created**, because none exist that clear all the conditions above without duplicating Phase 0's already-landed instruments or squatting on another role's evidence path.

---

## TASK 4 · BLOCKER ANALYSIS

### A. Unclosed CI gate

- **Exact source:** `docs/gates/GATE_REGISTER.md`, row `0.3` (Revision 7, 2026-09-03): *"the Auditor reproduced the production-ref refusal locally (exit 1, message quoted), but the gate requires it demonstrated failing in a CI run, and that run has not happened. A local reading is not the gate."*
- **Exact workflow:** `.github/workflows/d1-seeder-guard-check.yml`.
- **Can Session C resolve it?** No. I have no GitHub Actions dispatch access in this session (confirmed earlier: GitHub API calls are refused — *"GitHub access to this repository is not enabled for this session"*), and even with access, only the Auditor can move a register row to `VERIFIED` (Gate Register's own rule 1).
- **Requires Owner action?** Not directly — this is a CI-mechanics gap, not a judgment call.
- **Requires Auditor action?** Yes — to read the run and record it `VERIFIED`.
- **Requires another session?** Yes — whichever session holds push/Actions-dispatch authority (a D1 session) needs to trigger `d1-seeder-guard-check.yml` on `staging` and hand the run ID to the Auditor.
- **Scope of block:** Blocks the seeder's own Phase-0 gate (`0.3`) specifically, which gates the seed itself, which in turn gates P34/P20/P29. Does **not** block Phase 2's P1 window (unrelated dependency chain).

### B. Owner ruling on seeding scope

- **Exact source:** Same register row `0.3`: *"Members, roles and votes need auth.users rows — Owner ruling still pending, and P34's scale clause depends on it."*
- **Exact decision artifact:** None yet — `docs/DECISIONS.md` has no entry for this (checked; no D-number covers it).
- **Can Session C resolve it?** No — explicitly named as an Owner ruling by the plan's own text, and it is a real product/cost/scope tradeoff (whether to fabricate `auth.users` rows at scale, which touches Supabase Auth, not just `public` tables), not a technical inference.
- **Requires Owner action?** Yes — this is the decision itself.
- **Requires Auditor action?** Recording it once made (typically as a new `docs/DECISIONS.md` entry and a register update) — but not making it.
- **Requires another session?** No AI session can substitute for this; it needs Neil.
- **Scope of block:** Blocks P34's clause 3 specifically (`user_roles` at 1M-row scale). Does **not** block P20 or P29, which only need `posts` volume — already what the current seeder produces.

### C. Workflow owner-decision checkbox (`acknowledge_enqueue_jobs`)

- **Exact source:** `.github/workflows/d1-seed-staging.yml`, input `acknowledge_enqueue_jobs`: *"a 1M-row seed enqueues ~1M jobs for the 5-second cron to drain. The Owner decides. Tick only if that decision has been made."*
- **Can Session C resolve it?** No.
- **Requires Owner action?** Yes, by the workflow's own text.
- **Requires Auditor action?** Not to make the decision; the Auditor's normal role (authorizing/verifying the run afterward) still applies once dispatched.
- **Requires another session?** The actual dispatch requires GitHub Actions write access, which this session does not have.
- **Scope of block:** Blocks `mode=seed` specifically. `mode=plan` and `mode=status` do **not** require this input, so read-only investigation of current staging state remains available at any time without this decision.

---

## Summary — nothing here changes the checkpoint's conclusion

All three blockers stand exactly as before. No clock was started. No file owned by D1, D2, the Auditor, Session A, or Session B was touched. This document is additive-only, on the existing branch, and its purpose is that the moment Blockers A–C clear, dispatch is a checklist, not an investigation.
