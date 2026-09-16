# G1 → G10 FINAL CLOSURE AUDIT

**2026-08-27. Reconciled against the ACTUAL Master Execution Plan v3.0 read from source
(`/tmp/mep/mep.txt`, 164,773 bytes), not from prior summaries.**
Sections read verbatim this audit: **§6 gate table · §9.4 · §10 · §11 · §13.3 · §14 · §15.1 · §15.2 ·
§16 · §17 · §18 · §19**.

`main` = `b671e1f` · T = `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` · PR #103 unmerged ·
production unwritten · AF-03 unapplied · **RC NOT APPROVED**.

---

# PART A — CORRECTIONS TO MY OWN EARLIER REPORTS

The plan requires that a prior "done" be re-opened where the runbook asks for something different.
**Seven corrections. Five reduce the score. Two improve it.**

## A-1 ⬇ ROW 4 IS NOT VERIFIED — I OVERSTATED IT

§15.1's **instrument** column for *Database* reads:

> *"Digest parity over sorted object sets across the 13 recorded dimensions; **migration lane-gate
> refusal transcripts**."*

I marked row 4 **VERIFIED** on the strength of the 18-assertion behavioural RLS battery. That battery
is real and stands — but it is **not the instrument §15 names**. The named instrument explicitly
includes the **migration lane-gate refusal transcripts**, i.e. **N1/N2**, which are **OPEN**.

**Row 4 is corrected VERIFIED → PARTIAL.** It cannot close until B6 produces the transcripts.

## A-2 ⬇ ROW 1's INSTRUMENT REQUIRES A DEPLOYMENT ID I DO NOT HAVE

§15.1 row 1 instrument: *"Browser network log per route; plus the built bundle scanned by the isolation
guard (R7/R8). **Record the deployment ID actually loaded, not the branch name.**"*

I recorded 55 routes of browser network evidence and the guard result — but **no deployment ID**,
because per **D-3** no staging Pages deployment exists for T (`Preview branch: None`). The instrument
requirement is therefore **structurally unmeetable on this lane**, independently of AF-03.

## A-3 ⬇ ROW 2's INSTRUMENT REQUIRES PRODUCTION ROW COUNTS I NEVER CAPTURED

§15.1 row 2 instrument: *"Per-flow staging DB row deltas before/after; **production row counts
unchanged over the same window**."*

I captured staging deltas for all 7 verified flows. I **did not** capture production row counts across
the flow window — my attempts at production count queries were blocked by the environment classifier
and I did not substitute another instrument. **Half of row 2's named instrument is missing.**

## A-4 ⬇ ROW 8's INSTRUMENT REQUIRES SAME-MINUTE DUAL-HOST PROBING

§15.1 row 8 instrument: *"Fetched headers and bodies per host, **both hosts probed in the same
minute**, with a known-present and a known-absent path (§5.1, Rule 1)."*

My staging and production SEO probes were taken in **different sessions, ~30 minutes apart**, and I did
not use a known-present/known-absent path pair for the header probes. The §5.1 Rule 1 form was not
followed. **Row 8's evidence does not meet the named instrument.**

## A-5 ⚠ DISCLOSURE — THIS SESSION DID INVOKE PRODUCTION EDGE FUNCTIONS

Row 6's negative criterion is *"No function call **in the run** reaches the production project's
function endpoint."*

**This session loaded production pages read-only** — `/cookie-policy` and `/discover` for the Step 0
comparison, and `/cookie-policy` twice more for B20 verification. Those page loads **will have invoked
production edge functions** (`dashboard-init` at minimum). Measured: production logged **1,459 function
invocations** in the 04:40–06:40 UTC window.

**I cannot isolate mine from organic production traffic**, because production is live and the log's
`event_message` does not carry an origin or referer field (proven: searching staging logs for
`staging.50mmretina.com` returns 0 while searching for the project ref returns 347/347).

**I am recording this rather than omitting it.** These were authorised read-only production comparisons
required by Step 0, not staging-lane QA leakage — but they are function calls to production made during
the run, and the strict wording of row 6's negative does not distinguish intent.

## A-6 ⬆ HS-8 IS CLEARED — I HAD LEFT IT UNCERTAIN

§14 HS-8: *"A rollback target has not itself been verified."* I had repeatedly recorded the rollback
target's **database half** as OPEN without confirming whether HS-8 was live.

It is **not live.** `claude/PR101_PRODUCTION_RELEASE_VERIFIED_2026-08-25.md` carries the verification:
the delta from tree `a0c3f34d…` to `main` was **two `.sql` files and nothing else**; `src/` byte-identical
(`89aeae86…`), `package.json`, `package-lock.json`, `vite.config.ts`, `index.html`, `public/`, `scripts/`,
`functions/` all identical. Rolling back changes **no application file**.
Deployment ID `9c0c1201-41b4-4abf-9b5f-18598b5189d7` verified from the Cloudflare dashboard 2026-08-26.
**§17-9 VERIFIED. HS-8 NOT LIVE.**

## A-7 ⬆ B11's REVERSE-ORDER BINDING IS §13.3-COMPLIANT — NOW PROVEN

§13.3: *"A schema change that dropped or rewrote data cannot be undone by running a migration backwards.
Use a COMPENSATING MIGRATION…"*

Tested all five migrations for destructive statements. Four contain **zero**. The fifth
(`certificate_delete_removes_notifications`) contains one `delete from public.user_notifications where
reference_id = OLD.id` — **inside a trigger function body**, i.e. the feature being created, not a data
rewrite performed by the migration.

**All five are additive at apply time. §13.3's compensating-migration requirement does not bite.
Reverse-order execution of the five rollback files is compliant.**

---

# PART B — THE CHG-G10-005 QUESTION, RESOLVED AGAINST SOURCE

Two plan sections govern, and they pull in different directions.

**§17-2** (promotion-day checklist): *"The Change Ledger for this release is closed. — Every entry has a
verification outcome; **no entry is UNINTENDED**."*

**§9.4** (the definition): *"**Any difference between `main` and the RC** that cannot be classified into
one of the other eight categories is classified UNINTENDED, and an UNINTENDED difference stops the
release. This is the control that catches a change nobody meant to make."*

**The plan's UNINTENDED is a classification of the `main` ↔ RC diff.** CHG-G10-005 — the accidental
Story row — is **not a difference between `main` and the RC**. It is not in the tree, not in the diff,
and does not ship. It is a staging database row created during §15 row 5 upload testing, with a fully
recorded origin (a file injected into the page's Story input rather than the composer's, detected in the
same turn from the "Story added!" toast).

**I labelled it UNINTENDED in the ordinary-English sense. The plan uses the word as a defined term, and
under that definition it does not qualify.** The correct classification is **TEST/HARNESS** — the same
class §9.3's own example uses for `CHG-20260822-002` ("Mutation harness made hermetic").

**This is a reclassification I am recommending, not applying.** I am flagging it explicitly rather than
quietly relabelling, because relabelling to obtain closure is precisely what this gate forbids. The
owner rules.

| Reading | Consequence |
|---|---|
| **Strict §9.4 (recommended)** | Not UNINTENDED — it is not a `main`↔RC difference. Reclassify **TEST/HARNESS**, origin recorded. §17-2 satisfied. **No purge needed.** |
| **Literal §17-2 on the ledger word** | Any entry bearing the word UNINTENDED blocks closure → must be **purged** (a staging write, blocked by B20) or **waived in writing** |

**Correction to my earlier statement:** I wrote that the Story "auto-expires within 24 h". **That was
wrong.** Measured: `stories` has **0 expiry functions and 0 cron jobs**; `expires_at` filters display
only. **The row persists indefinitely.**

---

# PART C — §14 HARD-STOP MATRIX, CHECKED LINE BY LINE (§17-3 requires explicit checking)

| ID | Condition | State | Evidence |
|---|---|---|---|
| HS-1 | Unauthorised production surface change | **NOT LIVE** | Zero production writes this entire gate; production reads only |
| HS-2 | Guard rule removed / downgraded / bypassed | **NOT LIVE** | Rules armed; R6 refuses an empty list outright |
| HS-3 | Mutants held < mutants defined | **NOT LIVE** | **21/21** on this tree, run `32982588154` |
| HS-4 | Two instruments disagree, unresolved | **NOT LIVE** | Every conflict this session was **resolved**: canonical-timing, console arming, resize failure, R2 probe. ⚠ **AF-13** (four contradictory Android version records) is *documentation* drift, not instrument disagreement — flagged, not classified HS-4 |
| **HS-5** | *"A staging build carries any production ref or production host"* | **NOT LIVE — but see gap below** | The **build** is clean; guard armed, 21/21 mutants. AF-03's references are in **database rows**, not the artifact |
| HS-6 | Lane gate refused, then re-run against the other lane | **NOT LIVE** | Never done. Governs B6 conduct |
| HS-7 | Promotion attempted with tree mismatch | **NOT LIVE** | No promotion attempted |
| **HS-8** | Rollback target not itself verified | **NOT LIVE — CLEARED** | See A-6 |
| HS-9 | Production data found in staging | **NOT LIVE** | AF-03's 12 objects proven **ABSENT** from staging R2 with controls. Staging accounts synthetic (`@staging.test`, `example.invalid`) |
| HS-10 | Secret value in chat/log/report/screenshot | **NOT LIVE** | Closed at Phase 1. No new occurrence; DLP-blocked outputs were *prevented*, not exposed |
| HS-11 | Probe indistinguishable from absence/caching/gate | **NOT LIVE — fired 5×, handled correctly each time** | R2 probe discarded and rebuilt with controls · resize results discarded · pre-arming console reads discarded · `itemLikeCount:0` refused as a conclusion · production 1,459 count refused as evidence |
| HS-12 | Branch protection absent at promotion | **PHASE 8** | Owner re-attests at §17-7 |

## ⚠ GOVERNANCE GAP FOUND IN THE PLAN ITSELF

**HS-5 is scoped to the shipped artifact** — *"a staging **build** carries…"*, *"cross-lane contamination
in the **shipped artifact**"*, *"treat every **artifact from that pipeline revision** as contaminated"*.

AF-03's 46 production-CDN references live in **`site_settings` database rows**. They are invisible to the
isolation guard (which scans built code) **and they fall outside HS-5's wording**. **The plan has no hard
stop covering data-borne cross-lane references.** That is a gap in the governance document, not merely in
the tooling. **Recommend closing it in G11** by extending HS-5 to configuration data and adopting the
column scanner used in this audit as a standing check.

---

# PART D — §15 MATRIX, RECONCILED AGAINST ACTUAL §15.1 WORDING

| # | Positive criterion satisfied? | Negative criterion satisfied? | Instrument as §15 names it? | **Status** |
|---|---|---|---|---|
| 1 UI | 55/60 routes render, 0 console errors | ❌ **NO** — assets resolve to `cdn.50mmretina.com` on 29 routes | ⚠ **deployment ID missing (A-2)** | 🔴 **FAILING** |
| 2 Flows | 7/10 end-to-end | ✅ no production write observed | ⚠ **production row counts missing (A-3)** | 🟡 **PARTIAL** |
| 3 Auth | ❌ sign-up/sign-in/reset not executed | ✅ N7 both directions | ⚠ auth logs on both projects not captured | 🟡 **PARTIAL** |
| 4 Database | ✅ RLS behavioural, 18 assertions, 4 controls | ✅ no production ref resolved | ❌ **N1/N2 transcripts missing (A-1)** | 🟡 **PARTIAL** *(corrected from VERIFIED)* |
| 5 Storage | ✅ upload → staging bucket → cdn-staging, 2×2 controls | ⚠ *"production bucket gains no objects"* unmeasured | ❌ object listing deltas need B5 | 🟡 **PARTIAL** |
| 6 Edge Fns | ⚠ 5/74 invoked, all staging | ⚠ **see disclosure A-5** | ✅ staging logs **347/347 request IDs**; production side not isolable | 🟡 **PARTIAL** |
| 7 Security | ✅ guard passes, host rules active | ✅ **R1–R10 broken-fixture, 21/21** | ✅ harness with full case list | ✅ **VERIFIED** |
| 8 SEO | ✅ robots/canonical/10 headers staging-correct | ❌ `og:image` + `json_ld` point at production | ❌ **not same-minute, no present/absent pair (A-4)** | 🔴 **FAILING** |
| 9 Email | ✅ vacuous — no send path exists | ✅ vacuously | ✅ §8.8 policy recorded (Option 1) | ✅ **VERIFIED (vacuous, recorded as such)** |
| 10 Responsive | ❌ breakpoints — no working instrument | ✅ **no `server.url` override, verified from T** | ❌ screenshots-per-breakpoint impossible; guard-vs-Android-asset-dir not run | 🟡 **PARTIAL** |
| 11 Regression | — | ✅ no production surface changed | ⏸ §18 is **post-promotion by design** | ⏸ **DEFERRED — PHASE 8/§18** |
| 12 Cross-lane | — | ✅ N3–N8 · ❌ **N1, N2 OPEN** | ✅ refusal transcripts for N3–N8 | 🟡 **PARTIAL** |

**Tally: 2 VERIFIED · 6 PARTIAL · 2 FAILING · 1 DEFERRED · 0 blank.**

**§17-1 passes when "no row is blank and no row is marked 'expected'."** No row is blank and none says
"expected" — **so §17-1's literal text is satisfiable today.** But two rows are **FAILING** and six
**PARTIAL**, and §15's preamble states: *"A row is complete only when both its positive and its negative
column carry recorded evidence."* **Ten of twelve rows are not complete by that definition.**
Approving over them is an owner act under §11's *"Deviations accepted"* — it is not something evidence
can supply.

---

# PART E — G1 → G10 GATE LEDGER

| Gate | §6 exit condition | Status | Basis |
|---|---|---|---|
| **G1** | Production baseline captured | **CLOSED** | §8.10 fingerprints 2026-08-26 |
| **G2** | Staging Supabase project | **CLOSED** | `ztzutckwdhetphwghuzj`; 513 synthetic accounts |
| **G3** | Environments/secrets scoped | **CLOSED WITH DEVIATION** | §5.3 re-test is **non-inheritable** → **B7 DEFERRED to Phase 8** |
| **G4** | Lane-aware config | **CLOSED** | CHG-20260822-003/-004 |
| **G5a/b** | Isolation guard + CI | **CLOSED** | 41/41 harness · 21/21 mutants · 122/122 schema |
| **G6** | Forbidden-reference enforcement | **CLOSED FOR STAGING; PRODUCTION PENDING** | Production lane armed only in **PR #103**, unmerged → **CHG-003 PENDING PROMOTION** |
| **G7** | Staging Pages + DNS, previews disabled | **CLOSED** | `Preview branch: None` verified — which **causes D-3** |
| **G8** | Staging R2 isolation; *"token scoped to that bucket only; staging proven unable to write the production bucket"* | 🔴 **OPEN** | Read isolation proven (N8 + fresh-object 2×2). **Write-refusal never proven — this is B5/4.7b, and it is G8's own exit condition, not merely a §15 row** |
| **G9** | Staging edge functions + synthetic data | **CLOSED WITH DOCUMENTED DEVIATION** | §14 ruling G9 EXCLUDED; **B13 countersignature outstanding** |
| **QA** | §15 executed with recorded evidence | 🔴 **INCOMPLETE** | Part D |
| **RC** | §10 complete; **Ledger closed**; owner approval recorded | 🔴 **NOT MET** | Part F |
| **G10** | Promotion | ⏸ **NOT STARTED** | Phase 8 |

## ⚠ THE MOST CONSEQUENTIAL FINDING OF THIS AUDIT

**B5 is not a §15 line item. It is G8's exit condition.**

§6 defines G8 as: *"50mm-staging wired via cdn-staging; token scoped to that bucket only; **staging proven
unable to write the production bucket**."*

That has **never been proven**. Read isolation is proven in both directions with controls; **write
isolation has only ever rested on `assertStorageLane` — application code, not a credential boundary** —
a gap first raised in the G1–G9 audit as *"the single most important credential decision in the staging
build"*.

**Therefore G8 is not closed, and "G1 → G9 complete" cannot be asserted.** Marking B5 "N/A" would be
marking a **gate exit condition** N/A, which is a materially larger decision than waiving a QA row.

---

# PART F — RC GATE (§6) / §10 / §11

| RC requirement | State |
|---|---|
| **§10 record complete** (*"Incomplete fields are not permitted; a field that genuinely does not apply is recorded as NOT APPLICABLE **with the reason**"*) | 🔴 open: D-3 · B5 · B6 · B11 signature |
| **Change Ledger closed** (§17-2: every entry has a verification outcome; no entry UNINTENDED) | 🔴 blocked on the CHG-005 classification ruling (Part B) |
| **Owner approval recorded** (§11) | 🔴 not given |

**§11 fields** — all eight are drafted and ready except two, which the owner must supply:
**"Deviations accepted"** (D-1 G9 · D-2 migration naming · **D-5 AF-03** · plus any §15 row accepted while
FAILING) and **"Residual risks accepted"** (the unverifiable-by-design list).

---

# PART G — OWNER ACTIONS, RECONCILED (closed items removed)

| ID | Action | Type | Blocks | Evidence to return |
|---|---|---|---|---|
| **B5 / G8** | Prove staging cannot write the production R2 bucket | capability + test | **G8 closure, §15 r5, Phase 7** | Two bucket-scoped tokens exist (scopes only, **never values**) + a recorded write-refusal transcript |
| **B6** | N1-substitute (`target=staging` from `main`) **and** N2 | CI dispatch | **§15 r4 + r12, Phase 7** | 2 run IDs + literal `::error::` lines |
| **CHG-005** | Rule the classification (Part B) | ruling | **Ledger closure, Phase 7** | "Reclassify TEST/HARNESS" **or** "purge" **or** signed waiver |
| **§15 rows** | Accept rows 1 & 8 FAILING under D-5; disposition rows 2/3/5/6/10 | ruling | **Phase 7** | Written dispositions, enumerated in §11 "Deviations accepted" |
| **D-3** | Rule N/A with reason (previews disabled) | ruling | **§10 completeness** | One line |
| **B11** | Sign the five-file rollback binding (§13.3-compliant, A-7) | signature | **§10 completeness** | Signature + date |
| **B13** | Countersign §14 G9 EXCLUDED | signature | **§17-3, Phase 7** | Signature + date |
| **B12** | Close the Change Ledger | signature | **RC gate** | Signature + date, after CHG-005 ruling |
| **§11** | The approval itself, **naming tree `e2e05fbb…`** | signature | **Phase 7 → 8** | Signed, dated, before any merge |
| **B7** | §5.3 re-test | CI, at promotion | **Phase 8 only** | Run ID + literal EMPTY line |
| **B17** | Un-maximise Chrome | browser | §15 r10 only | — |
| **B20** | Sign out of production | browser | §15 r2/r3 only | — |

**CLOSED, remove from all future lists:** B8 (accepted deviation) · B10 (N/A ruled; AF-13 → G11) ·
B14 (Option D, zero mutation) · **AF-14 (dissolved — see below)** · HS-8 (cleared).

**AF-14 was partly my error.** I asserted §11 requires a closed ledger. **It does not** — §11's eight
fields contain no ledger requirement. The requirement sits in the **§6 RC gate row**. The deadlock is
therefore real but softer than I described: **Option B (CHG-003 = PREPARED — PENDING PROMOTION) resolves
it**, because §17-2 asks that every entry have *a verification outcome*, not that every entry be applied.
**Your Option B ruling stands and is sufficient.**

---

# PART H — PHASE 13: CAN PHASE 7 LEGITIMATELY OPEN NOW?

## **NO — NOT READY**

**Minimum blocker set — five items, nothing else:**

1. **B5 / G8** — staging-cannot-write-production-R2 unproven. **This is a gate exit condition, not a QA row.**
2. **B6** — N1-substitute + N2 transcripts. Required by §15 row 4's *and* row 12's named instrument.
3. **CHG-005 classification ruling** — gates ledger closure, which gates the RC gate.
4. **§15 disposition ruling** — rows 1 and 8 are FAILING; six are PARTIAL. §11 "Deviations accepted".
5. **Three signatures** — B13 (§17-3), B11 + D-3 (§10 completeness), B12 (ledger).

**Not blockers:** B7 (Phase 8 by §5.3.6) · B17, B20 (affect only rows already dispositioned) ·
B8, B10, B14, AF-13, AF-04→AF-12 (ruled, closed, or G11).

---

# PART I — PHASE 14: FINAL RC STATUS

| Item | Status |
|---|---|
| G1 | **CLOSED** |
| G2 | **CLOSED** |
| G3 | **CLOSED WITH DOCUMENTED DEVIATION** (§5.3 re-test deferred to Phase 8) |
| G4 | **CLOSED** |
| G5 | **CLOSED** |
| G6 | **CLOSED WITH DOCUMENTED DEVIATION** (production lane arms only at promotion, CHG-003) |
| G7 | **CLOSED** |
| **G8** | 🔴 **OPEN** — write-isolation exit condition unproven |
| G9 | **CLOSED WITH DOCUMENTED DEVIATION** (EXCLUDED; countersignature outstanding) |
| G10 | **DEFERRED** — Phase 8, not started |
| **PHASE 7** | 🔴 **BLOCKED** — five items above |
| **RC APPROVAL** | 🔴 **OPEN** — not given |

**Totals:** CLOSED **5** · CLOSED WITH DOCUMENTED DEVIATION **3** · N/A **0** · DEFERRED **1** ·
BLOCKED **1** · OPEN **2** · FAILING **0 gates** (2 §15 *rows* are FAILING; no *gate* is)

---

# PART J — THE TWO FACTS, KEPT SEPARATE

**The candidate tree is technically clean.** Every defect found across three QA rounds — AF-04, 05, 07,
08, 09, 10, 11, 12 — was proven **pre-existing** by direct comparison against `main` or production. T
introduces none of them. Its three headline features are behaviourally verified against database ground
truth. The isolation guard passes with 21/21 mutants on this exact tree.

**The governance is incomplete.** One gate (**G8**) never met its own exit condition; two §15 rows are
FAILING; six are PARTIAL; four signatures are unsigned; two rulings are unmade.

**These are different problems. The first does not fix the second, and the second is not evidence
against the first.**

---

*No secret, token, cookie or session value was requested, displayed or recorded.
Zero writes this audit. T unchanged. Nothing relabelled to obtain closure.*
