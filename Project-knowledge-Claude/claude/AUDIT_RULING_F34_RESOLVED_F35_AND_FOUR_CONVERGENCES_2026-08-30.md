# Audit ruling — F-34 resolved, F-35 bounded, four independent convergences, and my error propagating into a developer document

Date: 2026-08-30
Role: auditor. I produced none of the work ruled on here.
Repository state: `main` `b671e1fb0c5bcf145d442076c229eca888afd674`; ledger `f00f612a…5943`. No commits, tags, pushes, merges, deployments, migrations or provider writes.

---

## 1. F-34 — RESOLVED. **B13 does not need to be re-taken.** The suspended warning is cancelled.

Two sessions measured this with constructs they each chose and stated **before** counting.

| | Developer 1 (G1–G3v, four literals) | Developer 2 (D1/D2, blind, own constructs) |
|---|---|---|
| Guard in RC source | **10** of 71 | **12** of 73 |
| Guard in deployed bundles | **0** | **0** |
| Positive control at `main` | — | **0** of 73 |
| Functions touching the object store, deployed | — | **10** |

**The 10-vs-12 is not a disagreement.** Developer 2 states the reconciliation itself: *"those ten are exactly the deployed subset of the RC's twelve."* The RC guards twelve functions; two of them are not deployed; the ten that are deployed are **exactly** Developer 1's ten — which are **exactly** the ten §23.5.1 risk 3 names. No additions, no omissions, on all four of Developer 1's constructs and on Developer 2's two.

### The ruling, and it is the opposite of what I feared

**The owner's auditor was right, and their population hypothesis is now measured.** Only **ten deployed functions reference the object store at all.** A function that never touches storage does not need a storage-lane guard. So *"absent in ten functions"* is **materially accurate as a statement of exposure**, and my withdrawn "seven times smaller" (C-24) was withdrawn correctly.

**B13's risk acceptance is substantively sound. It does not have to be re-taken. That gate does not open.**

### What is left is a wording defect, and Developer 1 states it better than I would

> *"'Absent in ten functions' implies the other 61 have it… the ten named are **the ten the release fixes, not the ten it leaves behind**. The sentence is literally defensible; its implicature is not, and a risk acceptance is read for its implicature."*

Correct, and important. The sentence is true and points the wrong way. A reader concludes coverage exists in 61; in fact coverage exists nowhere in production, and the ten named are precisely the ten the RC would repair — except B13 condition 2 excludes function deployment, so none of them is repaired by this release.

**Ruling: §28.3 tidy-list item, or a correction entered at promotion. Not a re-take.** Proposed replacement text for risk 3, for the owner and auditor to rule on:

> *Ten deployed functions reference the object store. **None of the 71 deployed functions carries a lane assertion** — not the ten, and not any other. The RC adds the assertion to twelve functions in source, ten of which are deployed; B13 condition 2 excludes function deployment from this release, so the exposure persists in full until a separate G9 deployment.*

That says the same thing forwards.

### F-34a — NEW, accepted, and it invalidates a whole class of census

`hard-delete-competition` deploys one file and declares its own inline `async function getS3Settings(...)` — **a fifth variant of the storage-settings loader, invisible to any census that counts copies of `_shared/s3.ts`**, and guardless. The other four `G3` callers bundle four distinct `s3.ts` variants (`387888af`, `20d1c34f`, `edc0a48a`, `75657bd8`), none containing the guard. **One of them is `purge-s3-orphans`** — the destructive function.

**Standing rule 6, adopted:** *counting copies of a shared module does not find reimplementations of it. A census keyed on a filename measures the filename, not the behaviour.*

---

## 2. F-35 — BOUNDED, and independently confirmed to the byte

| | Developer 1 | Developer 2 (blind) |
|---|---|---|
| Distinct md5 values across deployed | **1** | **1** |
| The value | `58b9f45d5200a9b19f1b24011dfc3511` (1,507 B) | `58b9f45d5200a9b19f1b24011dfc3511` |
| Bundles carrying the file | **27 of 71** | **27 of 71** |
| Whose version it is | — | **`main`'s** |
| RC's version deployed anywhere | — | **zero bundles** (RC = `9e89d6fa…`) |

**Ruling on §23.5.1 risk 1:** its inner clause is **TRUE** — the deployed `_shared/secureHeaders.ts` *is* byte-identical, and the ledger's md5 prefix matches in full (Developer 1 measured the whole value before comparing, which is rule 3 applied correctly). Its **"across production" scope is FALSE** — it describes **27** bundles; **44 carry no `secureHeaders.ts` at all**.

**Developer 1's cross-check is the model of rule 5.** Those 27 are the same 27 the CORS census calls `secureHeaders.ts (shared)` — **symmetric difference EMPTY**. Two instruments, different methods, identical *membership*, not merely identical count.

**Developer 2 supplies the mechanism:** the deployed version is `main`'s, the RC's is deployed nowhere — **that is the mechanical cause of the 27 gated bundles falling back to `*`.** C-20 now has a measured cause, not just an observation.

---

## 3. The two 21s — the trap was real, and rule 5 caught exactly what it was written for

**`MATCH(21)` and `HEADER-ONLY(21)` inside `21/21/29` are DISJOINT — overlap 0.** Two entirely different sets of functions that happen to total the same number.

Had we compared totals, we would have declared agreement between two sets sharing **not one member**. Rule 5 — *matching totals are never evidence of agreement* — was written the day before it caught this. **Recorded as the rule's first save.**

Separately measured, and the useful half: `MATCH(702e5ce)` and `MATCH(a42b209e)` **are the same 21** — measured, not inferred.

All four splits (`19/21/31`, `19/22/30`, `21/21/29`, `21/22/28`) reconstruct exactly from the per-function table; the two readings differ by exactly two functions (`handle-email-suppression`, `handle-email-unsubscribe`) and the two lanes by exactly one (`send-gift-credit`).

### Developer 1's self-reported error — and it is now a systemic finding, not an individual one

Developer 1's first draft said the two 21s *"share four members and differ on thirty-four."* Never measured. Real overlap: **0**. Recorded in the document rather than quietly fixed, with their own note: *"writing an unmeasured number into a paragraph about not trusting unmeasured numbers is the exact failure this engagement keeps finding, and it was mine."*

**Accepted, and I am promoting this from an incident to a finding.** Counting mine (C-12, C-18, C-19, C-22, C-23, C-24) and this one, the same error has now occurred **seven times across three different agents**. That is not carelessness by a person.

**F-37 — the format is the cause.** Every instance was a number written **inside a prose sentence**. Not one was in a table, a manifest, or a tool's output. Prose invites completion; a table row demands a value. **Standing rule 7: a figure that has been measured belongs in a table with its basis. A figure that appears only inside a sentence is treated as INFERRED until it is found in a table.**

---

## 4. Developer 2 — F-32 survives, narrowed and quotable. F-31 correctly retracted.

**F-32 — staleness excluded by measurement, not by assertion.** The clone was stale (missing all 106 `refs/pull/*`), never shallow. And the decisive detail: **the 403 is REST-only; the git protocol is not blocked**, so a per-ref comparison now shows all 119 remote heads matching sha for sha. **Ledger row 14 moves BLOCKED → VERIFIED.**

Re-check byte-identical: 167/183 corroborated, the same files. After Addendum A's two exclusions the finding stands at **14 files across 9 functions committed nowhere in any of 226 refs.** **Quotable.** Ceiling: *no committed state in the whole history explains more than 57 of 71.*

**Production is running fourteen files that exist in no commit anywhere.** That is now measured, with the benign explanation excluded by the person who raised it.

**F-31 — RETRACTED by Developer 2 itself.** Zero hybrids. 61 atomic, 10 non-atomic, and all ten fail only because a file is committed nowhere — never because their committed files are inconsistent. `send-gift-credit` has exactly one compatible state, on branch `gift-credit-user-lookup`. **My elevation of F-31 rested on the withdrawn claim; it is withdrawn with it.**

**Developer 2's D12 self-test is what makes the zero readable** — the same identifier planted in a comment, a template literal and a string must fire nothing, *"and this codebase's prose is full of the exact string."* 21/21. Without D12, "0 of 71" would be indistinguishable from a lexer that sees nothing. **This is the mutation-control rule doing its job for the third time.**

**And the method note that matters most:** Developer 2 verified my tree-hash claim rather than accepting it, then **ran Task 1 against E3 for real anyway instead of inferring the answer from the identical tree**. The inference would have been correct. Running it is still right, and it is the only reason "all 71 per-function verdicts identical between E2 and E3" is a measurement.

---

## 5. `702e5ce` — RULED. Developer 1 is carrying **my** retracted error forward.

Developer 1 proposes a re-class of §23.5.3 on the ground that *"702e5ce is parallel to main."*

**That framing is mine, it is wrong, and I withdrew it in C-23 before this return was written.** The correction did not reach Developer 1 in time. Recording the propagation explicitly, because an error of mine that lands in a developer document and comes back as their finding is the worst failure mode this two-session structure has.

**The ruling:** the relevant line for a *staging* measurement is **staging's**, not `main`'s. Three sources now agree:

- the owner's independent auditor, measured: `702e5ce` is an ancestor of `a42b209e` through **staging's own first-parent branch (`fe4505aa`)**;
- the frozen ledger §5.4 — the commit manifest explicitly reproducible by `git log --oneline origin/main..origin/staging` — lists `702e5ceb` as rows **9–12**;
- Developer 1's own facts, read correctly: "two main commits absent from it, joined only later by `9faf5a17`" describes staging **before it merged main**, which is still staging.

**`staging @ 702e5ce` is an accurate label. §23.5.3's classification stands. The re-class proposal is DECLINED.**

**What survives is only the artefact-labelling point, which is the auditor's and which I adopt:** `WO3_drift_702e5ce.json` measures *deployed vs staging-as-of-2026-08-26*. It is **not** "repo state before this release" and must be re-labelled or dropped wherever it has been presented that way. And Developer 1's measurement stands regardless: `21/21/29/0` reproduces.

---

## 6. Housekeeping — accepted

- **rev9 coverage, enumerated not assumed:** on disk 132, manifest 131, difference 1, uncovered file printed as `['MANIFEST.sha256']`, reverse direction empty, both nested manifests covered. **Exactly what was ordered. Accepted.**
- **rev10:** 138 files, manifest 137, coverage PASS, round-trip 137/137, `82432eabd729703cf933d05c66bddc33bc5aa8cbd03fb60dd66694099ae6a431`, 1,383,008 bytes, measured twice. Full hash, rule 3 satisfied.
- **C-21 applied:** 11 occurrences, 6 files, originals preserved, B13 condition 4 left untouched as ruled. **And the discipline I want to name:** flagging in every C-21 block that the 15a rendering is *derived from my condition-4 statement, not separately ruled*. Marking which of the auditor's words were rulings and which were derivations is exactly right, and no one asked for it.

---

## 7. The Developer 1 ↔ Developer 2 join — blindness lifted, deliberately, and in this order

Developer 1 reports the comparison **BLOCKED**: it holds Developer 2's aggregates, not their per-function list, and *"under standing rule 5 an aggregate is not agreement."* **Correct, and the right call.** `DRIFT_PER_FUNCTION_BUCKETS.tsv` is published in the shape the join needs.

Developer 2's blind phase has now delivered everything blindness can buy: four convergences on instruments that share nothing. **The remaining value is in the join, and the join requires contact.**

**Order of operations, and it is not optional:**

1. **Developer 2 publishes its per-function verdict list first** — frozen, timestamped, hash published — **before seeing anything of Developer 1's.**
2. Only then is `DRIFT_PER_FUNCTION_BUCKETS.tsv` handed over.
3. The join is performed and the **set difference reported in both directions**, per function name.

Reversing steps 1 and 2 destroys retrospectively everything the blind phase produced. Publish, hash, then compare.

---

## 8. Completion

| Gate | Before | Now |
|---|---|---|
| G5 — 71-function re-measurement | 0.75 | **0.9** — CORS, secureHeaders membership, guard census and endpoint identity all independently converged; only the per-function drift join remains |
| G1 | 0.25 | 0.25 |
| **Credited** | 2.25 / 9 ≈ 25% | **2.4 / 9 ≈ 27%** |

**The threatened B13 re-take is cancelled.** The gate count does not grow.

Classification: OWNER-ATTESTED estimate, basis in `claude/PATH_TO_MERGE_GATE_LIST_2026-08-30.md`.

**Still standing, unchanged, and still the reason not to merge:** after the merge a `workflow_dispatch` on `main` with `target=production` reaches `SUPABASE_DB_URL` through an injectable job, with required reviewers off, wait timer off, and administrator bypass on.
