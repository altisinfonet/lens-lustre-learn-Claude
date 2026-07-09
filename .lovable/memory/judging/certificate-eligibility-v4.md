---
name: certificate-eligibility-v4
description: Certificates are eligible ONLY in Round 4 AND ONLY for the 7 award tags (Winner, 1st Runner-Up, 2nd Runner-Up, Honorary Mention, Special Jury, Top 50, Top 100). All other rounds and outcomes produce NO certificate.
type: constraint
---

# Certificate Eligibility — R4 + 7 Tags Only (Ruleset v4)

## The only 7 cert-eligible tags (all R4)

1. Winner
2. 1st Runner-Up
3. 2nd Runner-Up
4. Honorary Mention
5. Special Jury Award
6. Top 50
7. Top 100

## Code contract

- `competition_entries.certificate_ready=true` is legal **only** when:
  - `current_round = 4`, AND
  - the entry carries at least one of the 7 tags above in `judge_tag_assignments`.
- `certificates` rows for any entry violating the above are flagged
  `is_revoked=true` (column added in STEP 2 migration).
- The certificate generator (`generateCertificatePdf.ts`) must short-circuit and
  return `null` if the entry fails the gate.
- The `/certificates` page filters out revoked rows.

## Backfill (executed STEP 7)

All historical certificates for entries with `current_round ∈ {1,2,3}` are
revoked. Participants receive a `certificate-revoked` email explaining the
policy change.

## See also

- [mem://judging/ruleset-v4-r4-only-certs] — the parent rule
- [mem://judging/tags-only-in-r4] — tag UI is R4-only
