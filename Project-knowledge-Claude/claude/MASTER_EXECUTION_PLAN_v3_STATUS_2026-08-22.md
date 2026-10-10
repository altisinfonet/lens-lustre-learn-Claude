# MASTER EXECUTION PLAN v3.0 — CONSOLIDATED (2026-08-22)

The consolidated authoritative plan was delivered as a 47-page DOCX
(`50mm_Master_Execution_Plan_v3.docx`) plus a PDF rendering. It supersedes the
2026-08-21 Master Execution Plan and the 2026-08-22 Addendum in full.

Sections: 1 exec summary · 2 governing rules (incl. Standing Rule 12) ·
3 evidence classification · 4 verification record schema · 5 probe discipline ·
6 release architecture + lane diagram · 7 gate map G0–G10 · 8 gate procedures
(8.1–8.10) · 9 Change Ledger schema · 10 RC record · 11 Release Approval ·
12 promotion · 13 rollback · 14 hard-stop matrix (HS-1…HS-12) · 15 testing
matrix + mandatory cross-lane refusals N1–N8 · 16 environment impact matrix ·
17 final G10 checklist · 18 post-production checklist · 19 owner actions ·
20 current status · Appendices A–D.

## State captured 2026-08-22 16:45 UTC

```
main         32930e75b1d87d361f44e4b4f90dabf9deeda3e1  tree a0c3f34d724867f0a10fc768f6987e21fd4ddbfa
staging      9aea8a30916fee06a741c52ef34914e4a2788f96  tree aa877b50d3ca329aa0c169a150700fd9887a7d9a
divergence   7 commits ahead, 0 behind, 43 files changed
remote refs  192 · scratch/* 1 (scratch/lane-check-g3)
```

## Gate status

| Gate | Status | Note |
|---|---|---|
| G0 | GREEN | capability limits established by test |
| G1 | GREEN | preview=None + Access; owner-attested, host-probed |
| G2 | GREEN | D/F ref conflict resolved via `tool/*` rename |
| G3 | **AMBER** (was GREEN) | §5.3 secret-isolation negative test not executed under the current configuration; environments/secret deletion owner-attested |
| G4 | GREEN | production `_headers` byte-identical |
| G5a | **GREEN** (new) | host rules R7–R10 landed at `9aea8a3`; harness re-run independently: 33 results, 0 failures, 12/12 mutants held |
| G5b | OPEN | blocked on owner adding `SUPABASE_PROJECT_REF` / `SUPABASE_ANON_KEY` to production Pages |
| G6 | PARTIAL | production-lane R3 refusal still to be executed |
| — | DONE | staging schema baseline (schema-baseline property of §8.10 only) |
| G7 | OPEN | both staging hosts NXDOMAIN — owner DNS action |
| G8 | OPEN | depends on G7 |
| G9 | OPEN | CORS allow-list holds 5 origins, staging absent; 17 email templates hardcode production origin |
| G10 | OPEN | hard-stopped by HS-12 — no branch protection on `main` |

## Two status corrections recorded

1. **G3 downgraded GREEN → AMBER.** §8.1's exit condition requires the §5.3
   negative test (throwaway workflow on a non-lane branch showing the production
   DB secret resolving empty). No evidence it ran under the current environment
   configuration. By the plan's own definition of AMBER this cannot be GREEN.
   It must be re-taken at G10 step 7 regardless, never inherited.
2. **CORS allow-list count corrected.** Earlier text said "the two production
   origins". `supabase/functions/_shared/secureHeaders.ts` holds **five**:
   apex, www, and three legacy `*.lovable.app` preview origins.

## Verification of the document itself

Two independent internal-consistency audits were run against the extracted text
by a separate agent, against seven criteria: step contradictions, undefined
instruments, impossible verifications, gate-status agreement across §7/§8/§19/§20,
owner-only actions presented as verified, commit-SHA promotion identity, and
cross-reference/numeric integrity. Pass 1 returned 13 findings, pass 2 returned
9 (1 residual + 8 new or previously missed). All 22 were corrected. Criteria 2,
5 and 6 are clean.

## Open owner actions

- DNS for `staging.50mmretina.com` and `cdn-staging.50mmretina.com` (both NXDOMAIN)
- Branch protection on `main` (never configured — hard stop HS-12, gates G10)
- `SUPABASE_PROJECT_REF` / `SUPABASE_ANON_KEY` on production Pages (gates G5b)
- Push (and afterwards delete) the §5.3 probe branch, or authorize a session that can
- Delete `scratch/lane-check-g3`, close PR #88
- Decide the staging email policy (three options in §8.8)
