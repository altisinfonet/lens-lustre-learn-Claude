# G10 — OWNER SIGNING PACK

**Everything left that requires your signature, in one document. Pre-filled from measured evidence.
Blanks are only where a name, a date, or a decision is genuinely yours.**

> ## ⚠ SUPERSESSION NOTICE — 2026-08-27
> **All earlier G8 and §15 Storage conclusions in this pack that said *closed*, *green*, *verified* or
> *satisfied* are SUPERSEDED.** They are **retained below, struck through, for audit history** — nothing
> has been deleted or silently rewritten.
>
> | Item | Superseded conclusion | **Current** |
> |---|---|---|
> | **G8** | CLOSED WITH DOCUMENTED DEVIATION / parts 2 and 3 satisfied | **Status: BLOCKED · Outcome: NOT ESTABLISHED** |
> | **§15 row 5 Storage** | ✅ now closed | **Status: BLOCKED · Outcome: NOT ESTABLISHED** |
> | **B5** | ✅ closed by run `33079091310` | **BLOCKED** |
>
> **Reason:** run `33079091310` provides a **narrow credential-scope observation only**. The required
> control/disposition and the production `isolation-probe/` prefix **before-and-after** evidence remain
> **incomplete**.
>
> **Promotion verdict: NOT READY — unchanged.**

**Candidate:** `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` · **RC-20260826-01**
`main` = `b671e1fb` · tags = **0** · PR #103 **open and out of scope** (its head `704ad57` is not an
ancestor of `staging`, so it is not in the candidate tree)

---

## A · WHAT TODAY CLOSED — no signature needed on these

| Item | Previously | Now |
|---|---|---|
| **G5b** | "code half needs a new candidate" | ✅ **GREEN** — defaults already removed, guard already scans `functions/`, all three Pages variables verified present |
| **HS-12** branch protection | "never configured" | ✅ `protect-main` **Active**, targets `main`, bypass list empty, 3 rules |
| **D-3** staging deployment ID | "N/A — no deployment exists" | ✅ **VOID** — deployment **`3a6f3df9-639b-444f-846a-b17be22cde73`** exists, serves `staging.50mmretina.com`, built from `staging b8535fe` |
| ~~**B5** R2 write refusal~~ **[SUPERSEDED]** | ~~BLOCKED on credentials~~ | **BLOCKED / NOT ESTABLISHED.** Run `33079091310` **concluded failure**; it yields a narrow credential-scope observation only. Superseded conclusion retained: *"✅ run 33079091310 — TEST OK: write to 50mm refused with AccessDenied"* |
| **B6 / N1** | not dispatched | ✅ run **`33072738875`** — `secret points at 'jtdtehuqtinjxropkkcn', target is 'staging' — refusing`, `Run it` skipped |
| **B-1.4** probe branch deletion | REQUIREMENT NOT MET | ✅ all 7 scratch branches deleted |
| **§8.10** production unchanged | — | ✅ re-verified 12:02Z, all 7 fingerprints identical, zero drift |
| Repo secret hygiene | — | ✅ R2 test secrets removed; only 4 `ANDROID_*` remain |

---

## B · THE ONE LIVE BLOCKER — CHG-G10-005

§11 requires the Change Ledger **closed with no entry UNINTENDED**. One entry is UNINTENDED: a Story row
created in **staging** when a test upload landed in the page's Story input during QA.

**Measured:** `stories` rows = 1 · `expires_at` = 2026-08-28T05:19:25Z · **expiry function = 0 · cron
referencing stories = 0**. `expires_at` filters display only. **There is no reaper — the row persists
until deleted.**

**☐ PURGE** — delete the staging row. One `delete` against the **staging** database. Say the word and I
will execute it; it is a staging write and I will not do it unaccounted.
**☐ WAIVE** — reclassify **TEST/HARNESS** on the grounds that §9.4 defines UNINTENDED as *"any difference
between `main` and the RC"*, and a staging QA artefact is not such a difference. **Recommended** — it is a
definitional correction, not a waiver of substance.

Ruling: ______________________________  Signed: ____________________  Date: ____________

---

## C · RULINGS TO SIGN

### C-1 · G8 — **BLOCKED**, ruling not yet available *(superseded 2026-08-27)*

> **STATUS: BLOCKED · OUTCOME: NOT ESTABLISHED**
> **Reason:** run `33079091310` provides a **narrow credential-scope observation only**; the required
> control/disposition and the production `isolation-probe/` prefix **before-and-after** evidence remain
> **incomplete**.

**~~SUPERSEDED RULING, retained for audit history:~~** *~~"A.5's known-absent control is unexecutable on R2
and is replaced by the known-present control. §8.6 parts 2 and 3 are satisfied. G8 — CLOSED WITH
DOCUMENTED DEVIATION."~~* **That ruling is withdrawn and must not be signed as written.**

**What run `33079091310` did and did not establish.** It **concluded FAILURE**. Control 3 returned
`AccessDenied` rather than `NoSuchBucket`, so the specified test did not discriminate. The run executed on
commit `ca95f500…` / tree `bfac3846…` — **not** the candidate, and neither ancestor nor descendant of
`staging` (the workflow performs no repository checkout, so this is provenance only, not the reason for
BLOCKED).

**The one valid narrow fact:** the same credential, in one run seconds apart, **succeeded** writing and
reading back a zero-byte object in `50mm-staging` and was **denied** writing to `50mm`. **This supports a
credential-scope observation. It does not close G8.**

**Appendix A.5 observations — scope-bound, not universal.** On the tested credential and the tested
endpoint, the known-absent control returned `AccessDenied` instead of `NoSuchBucket`, **so it did not
discriminate in this run**. One credential, one endpoint, one run. **No claim is made that the control
cannot work on R2** — that is untested, not disproved.

**§8.6 part 3 — NOT ESTABLISHED.** No `isolation-probe/` prefix search was executed on `50mm` before or
after. Absence of a written object was **inferred**, not measured. Bucket size is displayed rounded and
cannot detect a zero-byte object.

**Before any substitution ruling is drafted or signed, do this first:**

> Re-run A.5's known-absent control using **an owner-controlled, minimum-permission credential capable of
> executing the specific test, used locally only and never supplied to Claude or chat.** If it returns
> `NoSuchBucket`, **A.5 works as written, no substitution is needed, and no deviation is signed.**
>
> **Do not create, request, expose, or transmit any credential in this pack, in chat, or to any session.**
> No credential value, prefix, length, hash or derived form belongs anywhere in this document.

**Then** capture the `isolation-probe/` prefix search on `50mm` **before and after**. Only when both exist
may G8 move off BLOCKED.

**Nothing to sign here yet.** ☐ *(intentionally left unsignable)*

---

### C-2 · G9 — 71-function EXCLUDED countersignature

Countersign the existing G9 EXCLUDED ruling together with its four recorded residual risks, as drafted in
`claude/G10_S14_G9_EXCLUSION_RULING_AND_EXECUTION_2026-08-26.md`. **Read that document before signing —
this pack does not restate the four risks, and signing without reading them makes the signature worthless.**

Signed: ____________________  Date: ____________

### C-3 · B11 — database rollback binding

Five files, reverse order 5→1, orphan `classF_repoint_originals_ROLLBACK` excluded.

Signed: ____________________  Date: ____________

### C-4 · D-2 — nine `UNAPPLIED_` files

**Measured:** 9 files = 4 migrations + 5 rollbacks; `UNAPPLIED_20260820140000_classF_repoint_originals_ROLLBACK.sql`
has no matching migration (the orphan). All five corresponding migrations are **already applied to
production** under different version stamps, so §12.4 step 12 is a genuine no-op — **the approved manifest
must be explicitly empty, not assumed.**

> **RULING:** accepted as documented deviation for RC-20260826-01; rename deferred to G11.

Signed: ____________________  Date: ____________

### C-5 · §15 dispositions

| Row | State | Disposition |
|---|---|---|
| **1 · UI** | 🔴 **FAILING** | **Approving over a known-failing row** under D-5. Deployment ID `3a6f3df9-639b-444f-846a-b17be22cde73` now supplies the instrument. **Not a pass.** |
| **2 · Flows** | 7/10 | 2 blocked on the production-authenticated QA profile, 1 structurally untestable (0 journal articles). Scope to the flows exercisable. |
| **3 · Auth** | partial | **N/A with reason** — no staging mail path (§8.8 Option 1); `/login`+`/signup` need an anonymous context. |
| **5 · Storage** **[SUPERSEDED]** | **BLOCKED / NOT ESTABLISHED** | ~~*"✅ now closed — run 33079091310"* — retained for audit history, withdrawn.~~ Positive half (upload chain, 2×2 controls) stands; negative half depends on run `33079091310`, which **concluded failure**. Production `isolation-probe/` before-and-after evidence **incomplete**. **Disposition: as C-1** |
| **6 · Edge functions** | 5/74 | Scope to functions reachable by the ten §15 flows. **The 5 financial functions recorded NOT TESTABLE — POLICY EXCLUSION, displayed, never folded into a coverage ratio.** |
| **8 · SEO** | 🔴 **FAILING** | Approving over a known-failing row under D-5. Instrument closed 07:26Z. |
| **10 · Responsive** | blocked | **N/A with reason** — `resize_window` reported success 3× while `innerWidth` never moved. No substitute accepted. → G11 |
| **11 · Regression** | deferred | §18 is post-promotion by construction (§17-12). Phase 8 dependency. |
| **12 · Cross-lane** | N1 ✅ | N2 **cannot** run before promotion — `main` has no gate, so a pre-promotion N2 tests nothing (§14 HS-11). Phase 8. |

Rows **4, 7, 9** verified; nothing required.

Signed: ____________________  Date: ____________

---

## D · §11 RELEASE APPROVAL RECORD — all eight fields

> **1 · RC ID:** RC-20260826-01
> **2 · Approved commit / tree:** `b8535fe7c9f2c7f604347ba849ac579bf4946d23` /
> **tree `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`**
> **3 · Statement:** *I approve promotion of the tree named above to `main` and its deployment to production.*
> **4 · Deviations accepted:** D-1 (G9 EXCLUDED) · D-2 (nine `UNAPPLIED_` files) · D-5 (AF-03; §15 rows 1
> and 8 approved **while FAILING**) · AF-15 (`main` lacks §8.1's four clauses until promotion installs them)
> · ~~**G8 control substitution (C-1)**~~ — **REMOVED. G8 is BLOCKED; there is no ruling to accept. This approval cannot be signed while C-1 is unsignable.**
> **5 · Attested controls accepted:** GitHub Environments and repository-secret deletion; branch protection
> — OWNER-ATTESTED under §3.1 and **never recorded as independently verified**
> **6 · Residual risks accepted:** AF-04/05/07/08/09/10/11/12/13 (all pre-existing, none introduced by this
> candidate) · AF-16 missing `svgo` · §8.10 fingerprint definitions ambiguous · both lanes saturated on
> absent-path status codes
> **7 · Approver:** ______________________  **Timestamp (UTC):** ____________
> **8 · Validity:** *This approval covers exactly the named tree. Any further commit to `staging` voids it
> and requires a new RC.*

**§11: "Approval is a separate, explicit act. Reviewing evidence is not approval; a green pipeline is not approval."**

---

## E · PROMOTION SEQUENCE — §12.4, no reordering

1. **§5.3 probe** — push a fresh `scratch/g10-53-secret-isolation-*` branch, confirm the log prints the
   literal **EMPTY**, delete the branch. §5.3.6 requires this **immediately before** promotion.
2. **Record the signed §11 approval, then create the tag** on `b8535fe7…` — **both before the merge**
   (§17-10: *"Signed and dated before the merge, not after"*).
3. **Perform the merge** `staging` → `main`. Exactly one conflict: `src/lib/generateCertificatePdf.ts` →
   **take the candidate's version**.
4. **AFTER the merge, assert the resulting `main` tree equals the approved candidate tree**
   `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`, checked against the tag created in step 2.
   **§17-11: tree equality is asserted AFTER the merge, against the tag created BEFORE it — §12.4 steps
   9 to 11, in that order.** Pre-proven by trial merge 2026-08-27T11:07Z; must still be re-asserted live.
   **If it does not match: STOP. Do not migrate, do not deploy.**
   > **⚠ CORRECTION.** An earlier version of this pack said *"assert … BEFORE committing"*. **That was
   > wrong and is superseded.** The assertion follows the merge.
5. **Only then — Step 12 MIGRATE** — approved manifest **empty**; expected no-op.
6. **Step 13 DEPLOY** — the guard must print its `ISOLATION-GUARD PASS` line.
7. **Step 14** — capture the deployment ID.
8. **Immediately after:** N2 from `main` · §18 post-production checks · auditor re-runs P1–P6.

---

## F · HONEST CEILING

**7 GREEN + 4 CLOSED WITH DOCUMENTED DEVIATION.** Not 11 GREEN — G3's Environments and HS-12 are
OWNER-ATTESTED by construction and **may never be described as independently verified** (§3.1), and G10
cannot be GREEN before promotion occurs. Anyone reporting 11 GREEN is reporting something that does not exist.
