# G10 — HANDOVER STATE

**2026-08-27. All read-only work complete. G8 deliberately left OPEN by owner decision, to be tested
later. Nothing below requires further work from this session.**

`main` `b671e1fb` · candidate **`b8535fe7c9f2c7f604347ba849ac579bf4946d23`** / tree
**`e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`** · tags **0** · scratch branches **0** · production
**unwritten** · **RC NOT APPROVED**

---

## 1 · WHERE EACH GATE STANDS

| Gate | Status | Outcome | Waiting on |
|---|---|---|---|
| **G1** | VERIFIED | **SATISFIED** | — |
| **G2** | VERIFIED | **SATISFIED** | — |
| **G3** | NOT YET VERIFIED | NOT ESTABLISHED | §5.3 re-run, promotion day only |
| **G4** | VERIFIED | **SATISFIED** | — |
| **G5a** | VERIFIED | **SATISFIED** | — |
| **G5b** | VERIFIED | **SATISFIED** | — |
| **G6** | NOT YET VERIFIED | NOT ESTABLISHED | structurally post-promotion |
| **G7** | VERIFIED | **SATISFIED** | — |
| **G8** | **BLOCKED** | **NOT ESTABLISHED** | **OPEN BY DECISION — test later** |
| **G9** | NOT YET VERIFIED | NOT ESTABLISHED | owner countersignature |
| **G10** | NOT YET VERIFIED | NOT ESTABLISHED | approval, tag, merge, §18 |

**Six gates satisfied on independent evidence.**

---

## 2 · G8 — PARKED OPEN, DELIBERATELY

**Status: BLOCKED · Outcome: NOT ESTABLISHED. Owner has elected to defer the remaining test.**

**What is established:** the same credential, in one run seconds apart, wrote and read back a zero-byte
object in `50mm-staging` and was denied writing to `50mm` with `AccessDenied`. Token `staging-upload` is
configured Object Read & Write, scoped to exactly `50mm-staging`. Production prefix `isolation-probe/`
returns **no objects**, with a known-present control (`avatars/` → 25 matches) proving the search
discriminates.

**What is not established:** run `33079091310` **concluded failure** — control 3 returned `AccessDenied`
rather than `NoSuchBucket`, so the specified test did not discriminate **on the tested credential and
endpoint in that run**. No universal claim is made about R2. The *before* prefix reading was never
captured and cannot be captured retrospectively.

**To close later, in this order:**
1. Capture the `isolation-probe/` prefix reading on `50mm` **before** the run.
2. Re-run A.5's known-absent control using **an owner-controlled, minimum-permission credential capable of
   executing the specific test, used locally only and never supplied to Claude or chat.**
   - Returns **`NoSuchBucket`** → A.5 works as written. **No deviation, no ruling, no signature.**
   - Returns **`AccessDenied`** → sign the control-substitution ruling in the Owner Signing Pack §C-1.
3. Capture the prefix reading **after**.

**Do not create, request, expose or transmit any credential to this session at any point.**

---

## 3 · WHAT REMAINS FOR THE OWNER

| # | Item | Type |
|---|---|---|
| 1 | **G8 test** (§2 above) | deferred by decision |
| 2 | **G9 countersignature** — read the four residual risks first | signature |
| 3 | C-3 rollback binding · C-4 D-2 · C-5 §15 dispositions · CHG-005 waive | signature |
| 4 | **§17-9 rollback target** — verify one, or knowingly accept "roll forward under pressure" | **decision** |
| 5 | §5.3 re-run + branch delete | promotion day only |
| 6 | §11 approval → tag → merge → assert tree → deploy → §18 | promotion |

**Item 4 is the one to decide deliberately.** §17: *"If the honest answer is that no recent production
state has been verified to the standard of this document, then the rollback plan is 'roll forward under
pressure', and the owner should decide that knowingly rather than discover it during an incident."*
**That is the current position.**

**The §11 approval is intentionally unsignable while G8 is BLOCKED** — it would otherwise have to accept a
G8 deviation that does not yet exist.

---

## 4 · PROMOTION ORDER — corrected, §17-11

1. §5.3 probe — same day, then delete the branch
2. **Sign the §11 approval, then create the tag** — both **before** the merge
3. **Merge** `staging` → `main`; one conflict, `src/lib/generateCertificatePdf.ts` → take the candidate's version
4. **After the merge, assert the resulting `main` tree equals `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`**, against the tag from step 2. **If it does not match: STOP. Do not migrate, do not deploy.**
5. Only then MIGRATE — approved manifest **empty**, expected no-op
6. DEPLOY — the guard must print its `ISOLATION-GUARD PASS` line
7. Capture the deployment ID
8. Immediately after: N2 from `main` · §18 checks · auditor re-runs P1–P6

> An earlier version of the signing pack said *"assert … before committing"*. **Superseded.** The assertion
> follows the merge.

---

## 5 · CLOSED TODAY — for the record

| Item | Result |
|---|---|
| G5b | code half already in the candidate; all three Pages variables verified present |
| HS-12 branch protection | `protect-main` Active, 3 rules, bypass empty — **and observed blocking a live write** |
| D-3 | **void** — deployment `3a6f3df9-639b-444f-846a-b17be22cde73` exists, serves `staging.50mmretina.com` |
| §15.2 N1 | run `33072738875` — refused at the lane gate; `Run it` skipped |
| §5.3 branch deletion | 7 scratch branches deleted, 0 remain |
| Change Ledger | closed — nine entries, zero UNINTENDED |
| §8.10 | re-verified 12:02Z, all seven fingerprints identical, zero drift |
| **G7 previews** | **disabled at source** — Preview branch = None |
| §8.6 part 3 | *after* reading captured with a working control |
| Repo secret hygiene | R2 test secrets removed; only four `ANDROID_*` remain |

**Defects found in the runbook itself:** §8.10 does not specify its queries (produced a false hard-stop
signal); Appendix A.5's `--body /dev/null` is rejected by AWS CLI v2; A.5's known-absent control did not
discriminate on the tested credential and endpoint; §8.6's claim that token scope is unreadable is false;
§17-7's claim that branch protection cannot be read by any session is false. **New finding AF-16:** `svgo`
missing from the build environment, ~10 SVGs ship unoptimised and every build log carries red errors.

---

# VERDICT: **NOT READY**

Tag count **0** — no signed approval, no tag, no tag resolving to the candidate tree. **G8 open by
decision.** G9, C-3, C-4, C-5, CHG-005 and §17-9 unsigned. §5.3, G6, G10 and §18 are promotion-day or
post-promotion by construction.

**Ceiling: 6 GREEN confirmed + up to 5 closed with documented deviation. Not 11 GREEN.**

*Production untouched · candidate tree unchanged · no credential handled, requested or exposed at any
point.*
