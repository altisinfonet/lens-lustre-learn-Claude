# Phase 11 — Visibility Matrix Conformance (SOW Appendix F)

**Risk:** CRITICAL · **Rule IDs:** SOW v2 FINAL — Appendix F (all cells)
**Scope Lock (read-only audit):** RLS policies, edge fn response shapers, UI conditional renderers
**Mode:** Pre-Fix Forensic Audit. **No** mutation was performed. Any loosening requires written user sign-off.

---

## 1 · Authoritative Matrix (verbatim from SOW Appendix F, Page 20)

| Phase | All Users | Photo-Competitor | Judge | Admin |
|---|---|---|---|---|
| **Submission** | Vote · No engagement · No counts | Vote (not own) · No engagement · No counts | View only · No "Start Judging" | Photos + Vote Audit |
| **Round 1** | Banner · No vote · No counts · No marks | Same · No own status yet | Decision UI (no marks, no tags) | Full read + Vote Audit |
| **Round 2** | Banner · No vote · No counts · No marks | Same · status after declare | Score 10 criteria + tags | Full read + Vote Audit |
| **Round 3** | Banner · No vote · No counts · No marks | Same · status after declare | Score 10 criteria + tags | Full read + Vote Audit |
| **Round 4** | Banner · No vote · No counts · No marks | Same · status after declare | Score + assign awards | Full read + Vote Audit |
| **Result** | Per-judge per-criterion table (anonymized) · Final vote totals visible | Same + own certificates | Read-only grid | Full read + can re-open round |

**Platform phase mapping used for probes:**
- Submission → `competitions.phase = 'submission_open'`
- Round 1/2/3/4 → `competitions.phase = 'judging'` with `current_round ∈ {round1..round4}`
- Result → `competitions.phase = 'result'`
- Interim `phase = 'voting'` (post-submission, pre-judging) = treated as "Banner · No counts" per Phase 7 memory.

---

## 2 · Forensic Audit Grid (24 cells)

Legend: ✅ PASS · ⚠ PARTIAL · ❌ FAIL · Evidence: RLS = `pg_policies`, FN = edge fn, UI = client gate.

### Submission (phase = submission_open)

| Role | SOW Expectation | Observed | Evidence | Status |
|---|---|---|---|---|
| All Users | Vote · No engagement · No counts | Vote allowed; counts hidden in judging only, not submission_open | RLS `competition_votes."View vote counts (phase-gated)"` calls `is_vote_phase_locked` which returns `true` only when `c.phase='judging'`. Counts are therefore **readable during submission_open**. | ⚠ PARTIAL (counts readable during submission_open — pre-existing; covered by Phase 7 memory `voting-phase-engagement`) |
| Photo-Competitor | Vote (not own) · No engagement · No counts | Enforced | RLS `no_self_vote` blocks `INSERT` where `e.user_id = auth.uid()` (seen in `competition_votes` policies). Counts same caveat as above. | ⚠ PARTIAL (same count caveat) |
| Judge | View only · No "Start Judging" | Enforced | `src/pages/JudgePanel.tsx:155-161` sets `phaseViewOnly=true` when `phase !== 'judging' && phase !== 'result'`; lines 651-655 toast and return if user forces Start. | ✅ PASS |
| Admin | Photos + Vote Audit | Enforced | RLS `competition_entries."Admins can manage entries"` + `admin_vote_adjustments` admin-only SELECT/INSERT/DELETE. | ✅ PASS |

### Round 1 (phase = judging, current_round = round1)

| Role | SOW Expectation | Observed | Evidence | Status |
|---|---|---|---|---|
| All Users | Banner · No vote · No counts · No marks | Vote blocked, counts blocked, marks not exposed | RLS `competition_votes`: INSERT ok only while `c.phase='submission_open'` (policy `no_self_vote` checks `NOT EXISTS(… competition_entries e …)` structure — votes are also blocked via `cast-photo-vote` edge function which gates on phase. Counts: `is_vote_phase_locked` = true. Marks (`judge_scores`, `judge_decisions`, `judge_comments`) RLS restricts SELECT to judge/admin only (confirmed below). | ✅ PASS |
| Photo-Competitor | Same · No own status yet | Enforced; own entry SELECT allowed but `current_round` + `placement` not leaked as "status" in UI during judging. | UI `CompetitionLightbox.tsx:195,260` gates vote button on `voting` and count display on `result` only. RLS on `competition_entries` SELECT permits owner read. | ✅ PASS |
| Judge | Decision UI (no marks, no tags) | Enforced | `MobileJudgeView.tsx` & `CinemaJudgeView.tsx` render decision buttons for R1 only; the 10-criteria accordion is gated on round ≥ 2 (verified in Phase 5 report). Tag palette `visible_in_round` excludes 1 for standard tags (`judging_tags.visible_in_round`). | ✅ PASS |
| Admin | Full read + Vote Audit | Enforced | Admin RLS covers all judging tables (below). | ✅ PASS |

### Round 2 (phase = judging, current_round = round2)

| Role | SOW Expectation | Observed | Evidence | Status |
|---|---|---|---|---|
| All Users | Banner · No vote · No counts · No marks | Enforced | Same vote/count/marks gates as R1. `PhaseWatermark` (CompetitionLightbox:150) renders during judging. | ✅ PASS |
| Photo-Competitor | Same · status after declare | Enforced | `complete-round` edge fn updates `current_round`/`status`/`placement` only on declaration; photographer sees via `competition_entries` owner SELECT. | ✅ PASS |
| Judge | Score 10 criteria + tags | Enforced | Phase 5 locked the criteria set to 10 SOW keys; tag palette filtered by `visible_in_round @> ARRAY[2]`. | ✅ PASS |
| Admin | Full read + Vote Audit | Enforced | Admin bypass on all judging tables. | ✅ PASS |

### Round 3 (phase = judging, current_round = round3)

| Role | SOW Expectation | Observed | Evidence | Status |
|---|---|---|---|---|
| All Users | Banner · No vote · No counts · No marks | Enforced | Same gating as R2. | ✅ PASS |
| Photo-Competitor | Same · status after declare | Enforced | Same path as R2 via `complete-round`. | ✅ PASS |
| Judge | Score 10 criteria + tags | Enforced | Same as R2; Top-50 tag becomes meaningful via tag palette. | ✅ PASS |
| Admin | Full read + Vote Audit | Enforced | Admin bypass. | ✅ PASS |

### Round 4 (phase = judging, current_round = round4)

| Role | SOW Expectation | Observed | Evidence | Status |
|---|---|---|---|---|
| All Users | Banner · No vote · No counts · No marks | Enforced | Same as R1–R3. | ✅ PASS |
| Photo-Competitor | Same · status after declare | Enforced | `competition_entries."Users can update own metadata only"` explicitly blocks self-update of `status` and `placement` (seen in qual). | ✅ PASS |
| Judge | Score + assign awards | Enforced | Phase 8 locked mandatory Winner/RU1/RU2 gate in `complete-round` R4 branch. | ✅ PASS |
| Admin | Full read + Vote Audit | Enforced | Admin bypass; `admin_vote_adjustments` admin-only. | ✅ PASS |

### Result (phase = result)

| Role | SOW Expectation | Observed | Evidence | Status |
|---|---|---|---|---|
| All Users | Per-judge per-criterion table (anonymized) · Final vote totals visible | Enforced (anonymization via Phase K memory `judge-privacy-phase2`); vote totals visible because `is_vote_phase_locked` returns false when `phase='result'` | RLS policy text; Phase J memory. | ✅ PASS |
| Photo-Competitor | Same + own certificates | Enforced | `certificates` table RLS restricts SELECT to owner + admin (confirmed in Phase L memory). | ✅ PASS |
| Judge | Read-only grid | Enforced | `MobileJudgeView` / `CinemaJudgeView` lock controls when `phase==='result'` (action buttons hidden; grid read-only). | ✅ PASS |
| Admin | Full read + can re-open round | Enforced | Admin RLS bypass; `complete-round` accepts admin re-open path. | ✅ PASS |

---

## 3 · Table-by-Table RLS Conformance (judging tables)

| Table | Public/All Users SELECT | Photo-Competitor SELECT | Judge SELECT | Admin | SOW Alignment |
|---|---|---|---|---|---|
| `competition_entries` | Allowed for status ∈ {submitted, approved, rejected, round1_qualified, shortlisted, round2_qualified, finalist, winner, needs_review} | Own rows always | All rows (judge role) | Manage all | ✅ matches Appendix F |
| `competition_votes` | Counts gated by `is_vote_phase_locked` (only `judging`) | Own vote always; no self-vote INSERT | (same as public) | Manage | ⚠ Counts readable during `submission_open` and `voting` — pre-existing; NOT in Phase 11 scope to tighten without sign-off |
| `judge_scores`, `judge_decisions`, `judge_comments`, `judge_tag_assignments` | No public SELECT | No public SELECT | Judge own rows | Manage | ✅ marks hidden from All Users and Competitors during R1–R4 |
| `judging_tags` | Public SELECT (definitions) | Public | Public | Manage | ✅ palette definitions OK |
| `admin_vote_adjustments` | Deny | Deny | Deny | Admin only | ✅ |
| `competition_judges`, `judge_entry_assignments`, `judge_entry_locks` | Deny public | Deny public | Judge own | Admin | ✅ |
| `judging_rounds`, `judging_config` | Public read (round metadata) | Public | Public | Manage | ✅ round metadata non-sensitive |

---

## 4 · Edge Function Response Shapers (judging scope)

| Function | Role gate | Phase gate | SOW cell | Status |
|---|---|---|---|---|
| `submit-judge-decision` | Requires judge role | Requires `phase='judging'` | Judge R1–R4 | ✅ |
| `submit-judge-score` | Requires judge role | Requires `phase='judging'` & round ≥ 2 | Judge R2–R4 | ✅ |
| `complete-round` | Requires admin | Requires `phase='judging'` | Admin | ✅ |
| `cast-photo-vote` | Requires authenticated non-owner | Requires `phase='submission_open'` (voting disabled post-submission) | All Users / Competitor Submission cell | ✅ |
| `entry-final-votes` | Public | Returns totals only when `phase='result'` | Result cell | ✅ |
| `evaluate-round2` | Judge | `phase='judging'` | R2 | ✅ |
| `judge-session-resume` | Judge own session | any judging | Judge cross-round | ✅ |

---

## 5 · Summary

| Matrix cell status | Count |
|---|---|
| ✅ PASS | 22 / 24 |
| ⚠ PARTIAL | 2 / 24 — both under the **Submission** row (All Users + Photo-Competitor), re: **count readability during `submission_open`/`voting`** |
| ❌ FAIL | 0 / 24 |

### Broken · Root Cause · Change · Evidence · Residual Risk

**Broken:** Vote counts readable during `submission_open` and `voting` phases.
**Root Cause:** `public.is_vote_phase_locked(_entry_id)` returns `true` only when the competition phase is `'judging'`. During `submission_open` and `voting`, the helper evaluates to `false`, letting the RLS SELECT policy expose raw vote rows (and therefore counts) to any authenticated reader.
**Change proposed (NOT applied — requires user sign-off per Scope Lock):** Extend the helper to also lock during `submission_open` and `voting`, keeping totals visible only when `phase='result'` OR the reader is owner/admin. This matches Appendix F literally ("No counts" in every non-result row).
**Evidence:** `pg_get_functiondef` for `is_vote_phase_locked`; Appendix F rows 1–5 of SOW page 20; memory `features/voting-phase-engagement`.
**Residual Risk (if not tightened):** Vote-count leakage on gallery components during submission/voting, enabling coordinated voting and leaderboard manipulation. Severity: MEDIUM. Impact contained to read-only counts — no write path affected.

**Sign-off line:** All other cells PASS. Phase 11 blocks on user decision for the two PARTIAL cells:
- Option A (tighten): approve helper change so `is_vote_phase_locked` returns `true` for `phase IN ('submission_open','voting','judging')`. Requires explicit **APPROVED — Tighten Phase 11 counts** in chat.
- Option B (document exception): sign off the two cells as accepted product behavior (counts visible during submission/voting for social-proof UX). Requires explicit **APPROVED — Accept Phase 11 exception** in chat.

Per mandate Rule 2 (No Guesswork) and Scope Lock ("Forbidden: loosen any cell without explicit user sign-off in writing"), I am not selecting either option unilaterally.

---

**Deliverable:** this file (`Phase11_VisibilityMatrix_Report.md`).
**Next phase cannot start until the user types `APPROVED — Phase 11 <Option A | Option B>` in chat.**

---

## 6 · Post-Fix Forensic Audit (Option A applied)

**Change applied:** `public.is_vote_phase_locked(_entry_id)` now returns `true` for `phase IN ('submission_open','voting','judging')`. Only `phase='result'` (OR owner, OR admin via the existing RLS disjunction) exposes vote rows.

**Re-run of the two PARTIAL cells:**

| Phase | Role | Before | After | Evidence |
|---|---|---|---|---|
| Submission | All Users | ⚠ counts readable | ✅ counts hidden | helper returns `true` for `submission_open` |
| Submission | Photo-Competitor | ⚠ counts readable | ✅ counts hidden (own votes still visible via `user_id = auth.uid()` disjunction) | same helper + existing RLS disjunction |

**Full matrix re-run:** 24 / 24 ✅ PASS · 0 PARTIAL · 0 FAIL.

**Residual Risk:** None introduced. Owner and admin continue to see totals (unchanged). No write path touched. Linter warnings surfaced (7 × public-bucket-listing) are pre-existing storage policies unrelated to Phase 11 scope.

**Sign-off line:** Phase 11 Option A — COMPLETE. User approved via chat: "Approved Phase 11 Option A".
