# VERIFY — Report inconsistencies across R9 / R10 / R11 / HOTFIX package / artifact reports

**Mode:** READ-ONLY. Contradictions surfaced strictly from prior in-session reports vs. live DB facts re-collected this session. No claim is included without a source.

---

## C-1 — "Private score columns on `judge_decisions`"  ❌ FALSE

- **Claimed by:** original HOTFIX-F spec and `50mm-7Point-Pending-Items-Evidence-Report.docx` (Item 1).
- **Live truth (this session, `information_schema.columns`):** `judge_decisions` has 9 columns; none are score/criteria/notes/feedback. Scores live on `judge_scores`.
- **Status:** Stale assumption. Corrected in VERIFIED report and HOTFIX-F precheck.

## C-2 — "HOTFIX-A fully closes wallet_transaction"  ❌ PARTIAL

- **Claimed by:** HOTFIX-A post-apply summary (any "GREEN" label).
- **Live truth:** `anon`+`PUBLIC` revoked, but `authenticated:EXECUTE` still present (`pg_proc.proacl` aclexplode this session).
- **Status:** Inconsistent. Re-classify as PARTIAL.

## C-3 — "HOTFIX-E fully closes backfill_judging_notifications"  ❌ PARTIAL

- **Claimed by:** HOTFIX-E post-apply summary.
- **Live truth:** `authenticated:EXECUTE` still present (this session).
- **Status:** Inconsistent. Re-classify as PARTIAL.

## C-4 — "`photo_verification_requests` exists in public schema"  ❌ FALSE (as of prior live check)

- **Claimed by:** Item 6 in Pending-Items-Evidence-Report.docx; implied by Verification Workflow Phase E/F/G/H memory entries.
- **Live truth (prior session):** table not present in `public`; cron job still scheduled.
- **Status:** Stale memory vs. live schema. Either the table moved/renamed or memory is outdated. Requires investigation, not auto-fix.

## C-5 — "Only 2 ERROR + a handful of WARN findings in linter"  ❌ UNDERSTATED

- **Claimed by:** earlier triage summaries.
- **Live truth (VERIFIED report):** 374 findings total (2 ERROR, 372 WARN). 191 of those are `authenticated`-executable SECURITY DEFINER functions (WARN 0029).
- **Status:** Inconsistent magnitude.

## C-6 — "Judge identity is fully protected"  ❌ INCOMPLETE

- **Claimed by:** general references to `mem://security/judge-privacy-phase2`.
- **Live truth:** `judge_decisions` RLS still lets entry owners read `judge_id` (this session).
- **Status:** Memory describes intent; live schema/policy does not fully enforce it.

## C-7 — Score-leak claim used as a justification for HOTFIX-F

- **Claimed by:** HOTFIX-F draft spec.
- **Live truth:** no score columns on this table. The real (and still valid) reason is `judge_id` exposure.
- **Status:** Reasoning chain was guesswork; the underlying fix recommendation (mask owner-side reads) is still valid for a different reason.

## C-8 — Inconsistent "ALL CLEAR" framing across hotfix reports

- Multiple post-apply notes used GREEN/ALL CLEAR phrasing without distinguishing `anon` vs `authenticated` containment. This precise distinction is what flips A and E from GREEN to PARTIAL.

---

## Items where prior reports were correct

- HOTFIX-B (DELETE policy removed): re-verified — no DELETE policy exists. ✅
- HOTFIX-C (emit_notification): re-verified — only postgres/service_role/sandbox. ✅
- HOTFIX-D (send_notification_email): re-verified — same. ✅
- Identification of 173 anon-executable DEFINER functions (Item 3): supported by live count (prior session); no contradiction.

---

No fixes proposed. This report lists contradictions only.
