---
name: Ruleset v4 — R4-Only Certificates (TOP PRIORITY)
description: Certificates are issued ONLY in Round 4, ONLY for photos carrying one of the 7 R4 award tags. R1/R2/R3 issue NO certificates. The 'Stay' bucket is REMOVED entirely. R2/R3 are binary (advance / not selected) by 10-criteria score (avg ≥7 advances). All previously issued R1/R2/R3 certificates are revoked.
type: constraint
---

# Ruleset v4 (ratified 2026-04-29) — TOP PRIORITY

User explicit override of Spec v3 three-bucket policy. This rule supersedes
[mem://judging/r2-r3-three-bucket-policy] in every conflict.

## Rule 1 — Certificates are R4-only, tag-only

- Certificates are issued **ONLY in Round 4**.
- Within Round 4, a certificate is issued **ONLY** to photos carrying one of these 7 tags:
  1. Winner
  2. 1st Runner-Up
  3. 2nd Runner-Up
  4. Honorary Mention
  5. Special Jury Award
  6. Top 50
  7. Top 100
- R1, R2, R3 issue **NO certificates** under any condition.
- Any code path that sets `competition_entries.certificate_ready=true` for an entry whose `current_round` is not 4 OR which lacks one of the 7 R4 tags is a **violation**.

## Rule 2 — R2/R3 are binary (no Stay bucket)

- R2 outcomes: **Qualified for R3** (advance) | **Not Selected for R3** (terminate).
- R3 outcomes: **Shortlisted for Final** (advance) | **Not Selected for Final** (terminate).
- Bucket derivation: 10-criteria average **≥ 7** ⇒ advance; otherwise ⇒ not selected.
- Submit still gated to all 10 criteria scored.
- The **'stay' decision and 'Stayed at RN' tags are removed entirely** — no UI, no DB value, no email, no participant label.

## Rule 3 — R1 / R4 unchanged

- R1: Accept / Shortlist for R2 / Needs Review / Reject (decision-only, no sliders, no certs).
- R4: 10 mandatory criteria + the 7 award tags (the only cert-eligible surface).

## Rule 4 — Retroactive cleanup

- All certificates previously issued for entries with `current_round ∈ {1,2,3}` are **revoked** (`certificates.is_revoked=true`).
- All `judge_decisions.decision='stay'` rows are soft-marked invalid; the CHECK constraint drops `'stay'`.
- All `progression_decision='stay'` rows are migrated to `'reject'` (per Rule 2 binary model) with audit log.
- The 2 system tags "Stayed at R2" / "Stayed at R3" are soft-deleted (`is_active=false`).

## Source

User chat 2026-04-29: "FROM R1 TO R3 REMOVE CERTIFICATE ISSUES POLICY AUTOMATICALLY. KEEP IT ONLY FOR ROUND 4 THOSE WHO ARE TAGGED WITH WINNER, 1ST RUNNER UP, ETC..."
Sign-off: `sign v4 execute` (pending).
