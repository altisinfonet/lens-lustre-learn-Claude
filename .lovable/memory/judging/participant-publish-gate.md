---
name: Participant submission detail + certificate publish-gate (Audit v6 P-01/P-02/P-06)
description: SubmissionDetail tags/decisions/scores/placement/status AND Certificates "Available to Request" are gated on competition_round_publish.published_at, NEVER on judging_rounds.status='completed' or competition_entries.certificate_ready alone.
type: feature
---
The participant view at /dashboard/submission/:competitionId loads:
- judge_tag_assignments
- judge_scores, judge_comments
- judge_decisions (R1 raw)
- entry.status / entry.progression_decision / entry.placement

EVERY one of those fields must be hidden until the matching round is PUBLISHED via the publish-round edge function (competition_round_publish.published_at IS NOT NULL).

Round → reveal mapping:
- R1 published → round1_qualified, rejected, R1 raw decisions, scoped tags
- R2 published → round2_qualified
- R3 published → shortlisted
- R4 published → winner / runner_up_* / honourable_mention / special_jury / finalist / placement / scores / comments

`judging_rounds.status='completed'` is a JUDGE-side signal (round closed for judging) and must NEVER be used to gate participant visibility — that was the v6 P-01/P-06 leak.

## P-02: Certificate eligibility (Certificates.tsx)
`competition_entries.certificate_ready` is set to `true` by the `complete-round` edge function as soon as R1/R2/R3 close for judging. That is a JUDGE-side signal too — it is correct for admin drift audits (AwardsIntegrityAudit, CertificateDriftAudit) but MUST NOT be used by itself to surface "Available to Request" cards to participants.

The participant query in `src/pages/Certificates.tsx` filters readyEntries by `certificate_ready=true` AND then intersects with `competition_round_publish` rows where `round_number=4 AND published_at IS NOT NULL`. Only competitions with R4 published may appear in the eligible-to-request list. This guarantees no certificate can be requested before final awards are publicly released.
