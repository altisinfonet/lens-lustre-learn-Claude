# Path to merge — the gate list, and where WO-9 lands on it

Date: 2026-08-30
Question answered: *"After WO-9, can I merge?"*
Answer: **No.** WO-9 ends at an owner decision point, not at a merge.

Repository state: `main` `b671e1fb0c5bcf145d442076c229eca888afd674`; ledger `f00f612a…5943` (REV-16). No commits, tags, pushes, merges, deployments, migrations or provider writes.

---

## 1. Why WO-9 cannot end in a merge

WO-9 is **measurement and preparation**. It writes no code onto the release candidate. Specifically:

- Group A corrects records and re-runs four failed closures — it changes documents, not the RC.
- Group B answers four open questions — it changes nothing.
- Group C produces the Option 2 fix **as patch files that are deliberately not applied**, so the owner can rule before anything moves.
- Group D rebuilds the evidence pack.

After all of WO-9 is complete, `apply-migration.yml` and `verify-schema-dependencies.yml` still carry the shell-injection construct, and they are still inside the 138-file application scope. Their lane gate requires the workflow to be **on `main`** before a production dispatch is possible.

**Therefore the merge is still the action that arms the injection**, in a job that holds the production database URL. That is unchanged by anything WO-9 does.

---

## 2. The nine release gates — the stated basis for every percentage in this engagement

| # | Gate | Status now | After WO-9 (projected) |
|---|---|---|---|
| G1 | Application RC free of known-armed defects (the two workflows, `_seo.ts`, possibly `worker.js`) | **0** — injection present and armed by merge | **0** — patches prepared, not applied |
| G2 | §25.3 infrastructure rows 1.1–1.6 closed (1.4, 1.5, 1.6b, 1.6c BLOCKED) | 0.25 | 0.25 |
| G3 | 138-file review closed by an **independent human auditor** (§25.4) | 0.5 | 0.5 |
| G4 | Independent test-suite run with full run conditions | 0.25 | **0.75** if A5 returns a complete transcript |
| G5 | 71-function re-measurement complete | 0.5 | **0.75** if A1 re-closes the four cleanly |
| G6 | Drift / closure records complete and free of statuses derived from failed instruments | **0** — four records BLOCKED | **1.0** if A1 re-closes clean; 0 if it does not |
| G7 | Runbook §5.3 probe executed | 0 | 0 |
| G8 | §11 owner/auditor signature obtained | 0 | 0 |
| G9 | Tag applied and merge executed | 0 | 0 |
| | **Credited** | **1.75 / 9 ≈ 20%** | **≈ 3.25 / 9 ≈ 36%** |

Classification of these projections: **OWNER-ATTESTED estimate, basis stated above.** Not VERIFIED. G4/G5/G6 move only if the re-runs succeed; if A1 fails again they stay at 0 and the figure stays near 20%.

**But the current RC path is closed.** G1 cannot be credited on this RC without modifying the frozen RC, which the standing constraints forbid. So the 36% figure describes a route that does not lead anywhere.

---

## 3. The number that actually matters — the replacement RC

Under Option 2, a new RC is cut with 2–4 files changed.

**Carries over** (measured against files Option 2 does not touch): drift census, CORS census, function inventories 71/74, RLS states, R2 bucket facts, the WS4 harness, the ledger guard work, the post-promotion plan.

**Resets** (bound to RC identity): G1 must be re-proved against the new RC; G3's 138-file review scope changes and must be re-declared; G4's test run must be re-identified at the new head; G8 signature; G9 tag and merge. G2 is unaffected (infrastructure, not RC-bound).

Estimated credit against a replacement RC after WO-9: **≈ 1.5 / 9 ≈ 15%**, rising as the carried-over evidence is re-declared against the new endpoint rather than re-measured.

---

## 4. The actual sequence from here to merge

1. **WO-9 completes.** ← you are here after the next developer run
2. **Owner rules on Option 2.** Reads Group C's patches and the residue statement in C3, then says build it or don't. **No AI decision substitutes for this.**
3. **WO-10 — build the replacement RC.** Apply the patches on a branch off `staging`. Do not merge.
4. **Re-measure against the new head.** New RC hash, new 138-file scope declaration, new test-run identity, re-run the drift and CORS censuses against the changed files only.
5. **Independent human auditor closes the §25 rows.** §25.4 is explicit: owner or compiler re-measurement is OWNER-ATTESTED and **cannot close a §25 audit row**. This step cannot be done by me, by the developer session, or by the owner.
6. **Unblock §25.3 rows 1.4 / 1.5 / 1.6b / 1.6c**, or record a formal deviation for each.
7. **Run the runbook §5.3 probe.**
8. **§11 signature.**
9. **Tag, then merge.**

Steps 2 and 5 are **human**, and they are the two that no amount of further AI work shortens.

---

## 5. Separate and live today

**C-14-L**: `assertStorageLane` appears in **zero of 71 deployed production bundles**. Production has no storage-lane guard at all, including in `purge-s3-orphans` (destructive) and `detect-orphan-files` (read-only, safety-critical input to it). This is a production condition **now**, independent of the release. It should be tracked on its own line and not held behind the promotion.

---

## 6. Standing constraints — unchanged

Do not expose secrets, tokens, cookies or credentials. Do not perform unsafe production writes. Do not execute financial transactions. Do not modify the frozen RC merely to manufacture a passing result. Do not run an unsafe N1/N2 configuration. Before any high-impact action, verify the actual workflow and branch being executed. Do not try to make the ledger look green — make it accurate. Do not overwrite previous conclusions; preserve the original and record the correction separately. Do not merge, tag, deploy, migrate, run the runbook §5.3 probe, or perform any production write.
