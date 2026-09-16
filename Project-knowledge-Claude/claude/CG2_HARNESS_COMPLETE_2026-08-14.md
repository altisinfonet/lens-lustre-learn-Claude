# CG-2 Seeded Harness — COMPLETE (2026-08-14)

Commit: `audit(competition): CG-2 seeded harness…` (after c1ebc2d). Assets: `harness/cg2/` in repo (schema+seeds, probes, fix proof, both transcripts). Reconciler: READY / NEXT: F1_GO_OR_B3D4.

## What was tested and HELD (17 probes, non-superuser roles, faithful replica)
- **Judge authorization**: non-judge denied; judge of another competition denied; forged judge_id denied; distributed-mode judge without entry assignment denied; with assignment allowed; positive control committed (denials not vacuous).
- **Round protection**: judges cannot insert/update judging_rounds (0 rows / RLS error); members cannot touch round-publish; after a round completes, score INSERT/UPDATE/DELETE blocked at the RLS layer AND the trigger layer — the trigger even stops a superuser. A member setting `app.bypass_round_lock=on` themselves gains nothing.
- **Award write path**: judges cannot write `judge_award_tags` directly — the SECURITY DEFINER mirror is the only path; an uncatalogued tag mirrors to nothing and logs `noop_alias_miss` (fail-loud intact).
- **Spec guards**: needs_review outside Round 1 blocked even for superuser.

## Findings (all demonstrated on the harness, none exploitable by a plain member)
**F1 — a judge can judge their own entry.** If an admin assigns a participant as judge, nothing stops them scoring/award-tagging their own photo. Production pre-flight: **0 such judges exist today** — latent, not active. **Fix proven on harness** (one line in `judge_can_access_entry`: `ce.user_id <> _judge_id`; self-score and self-award now denied, normal judging untouched). Candidate migration + verbatim rollback staged at `harness/cg2/f1_candidate_*.sql`. **AWAITING OWNER GO** — it changes judging policy (judges could no longer enter competitions they judge).

**F2 — award stacking.** Same judge can give one photo both "Winner" and "1st Runner-Up"; both award rows persist (the schema must allow pairs like Winner+Top-100, so it can't tell sense from contradiction). The single placement decision stays deterministic (last-write-wins + verified aggregation) — only certificates/display could show a contradictory pair. Design question, not implemented.

**F3 — no one-Winner-per-competition constraint** at the award-tag layer. Bounded by the deterministic placement aggregation (separately verified). Same design question as F2.

## Owner decision needed (one question)
Apply F1 fix? Recommended YES (standard competition ethics; zero live conflict today). On GO: connector apply → verify → rename per protocol. F2/F3: recommend UI/ops discipline for now; DB-level exclusivity check can be a later cycle if wanted.

## Next per plan (no owner input needed)
B3d-4 encoder heaviness audit (~2× oversized originals), then EXIF remaining raw-caller pass.
