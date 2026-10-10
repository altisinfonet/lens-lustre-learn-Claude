# Corrections C-23 and C-24 — the independent auditor was right on both, and both errors are mine

Date: 2026-08-30
Issued by: the compiler/audit session, against its own prior ruling `claude/AUDIT_RULING_A14_A16_A17_AND_TWO_CONTRADICTIONS_IN_B13_2026-08-30.md`.
Prior wording is preserved there and is **not** edited. Corrections are recorded here beside it, per the standing rule.

Ledger re-verified in this container before writing: `sha256 f00f612a057477146f4047f5af9235337f857d31887bb10e5bb56c98a9cd5943`, 182,502 bytes.

---

## C-23 — `702e5ce` is on staging's line. My "parallel to main" framing was wrong.

**What I wrote (preserved):**

> "Developer 1 established that `702e5ce` is **not on the same line of development as `main`** … What the ledger does **not** know is that the baseline may not have been `staging` at all, but a branch parallel to it."
> Ruling: "§23.5.3's class `VERIFIED (as of that date)` is **DISPUTED** pending measurement."

**The auditor's finding, independently measured against the repository:** `702e5ce` is an ancestor of `a42b209e` through **staging's own first-parent branch (`fe4505aa`)** — never through `main`.

**I checked this against the frozen ledger myself rather than relaying it.** §5.4 is the commit manifest, explicitly reproducible by `git log --oneline origin/main..origin/staging`. `702e5ceb` appears there as rows **9–12**, dated 08-26, "Add files via upload ×4 (part of #102)".

**So `702e5ce` is on staging's line, and is an ancestor of the release candidate.** The ledger's label *"staging @ 702e5ce"* is **accurate**. It was staging's state on that date, which is exactly what §23.5.3 says it was.

**Corrected ruling:**

- §23.5.3's class `VERIFIED (as of that date)` — **DISPUTE WITHDRAWN. The classification stands as written.**
- The real defect is narrower and is the auditor's, stated precisely: `WO3_drift_702e5ce.json` measures **deployed vs staging-as-of-2026-08-26**. It is not "repo state before this release", and must be **re-labelled or dropped** wherever it has been presented that way.
- The ledger was right. The artefact's description was wrong. Those are different documents and I merged them.

**Where my error came from:** Developer 1 reported a merge-base and a later join commit. From "not an ancestor of `main`" I concluded "not on the same line of development" — but the relevant line for a staging measurement is **staging's**, not `main`'s. I substituted the wrong reference branch and then ruled on it.

---

## C-24 — F-34's "seven times smaller" was my inference, not the ledger's statement

**What I wrote (preserved):**

> "Naming ten implies the other sixty-one have it."
> "the owner signed a risk acceptance describing an exposure roughly **seven times** smaller than the measured one."

**The auditor's correction:** the storage-lane magnitude question is **open, not resolved** — because it is not yet known whether the ledger's "ten" and the "zero of 71" are counting **the same population** (functions that actually touch S3 storage) or different ones.

**They are right, and the error is precisely located.** §23.5.1 risk 3 asserts:

> "The storage-lane guard is absent in ten functions: …"

That sentence asserts **absence in ten**. It does **not** assert **presence in sixty-one**. "Naming ten implies the other sixty-one have it" is an implicature I supplied. No sentence in the ledger carries it.

**And the ledger's own commit manifest points the other way.** §5.4, staging's commit line:

- row 22 — `87aa5eac`, 08-23: *"G9: **assert the storage lane** where the credentials are loaded (#92)"*
- row 21 — `a8c595d2`, 08-23: *"G9: the email layer gets a lane, **six signing paths assert**, CORS stops matching a prefix (#93)"*

*"Where the credentials are loaded"* and *"six signing paths"* both describe a **bounded set of storage- and signing-touching functions**, not all 71. If the guard was only ever written into roughly those ten, then *"absent in ten"* and *"absent in 0 of 71"* are **the same fact measured over two different denominators, and there is no contradiction at all.**

**Corrected ruling:**

- **F-34 is DOWNGRADED** from "contradiction inside a signed owner ruling" to **an open population question**, exactly as the auditor framed it.
- The "seven times" figure is **WITHDRAWN**. It was never measured.
- The "B13 may have to be re-taken" warning is **suspended**, not cancelled — it revives only if the source check shows the guard present in functions the ledger implies are covered and absent from deployment in a way the ledger does not record.
- Classification of the commit-subject evidence above: **INFERRED**. Commit subjects describe intent, not code. The source check still decides.

**The measurement that decides it, restated correctly:** how many of the 71 RC-source functions **reference S3 storage or signing credentials at all**? That is the denominator. Then, within that set, how many carry the guard in RC source, and how many carry it in the deployed bundle? Report both counts against **that** denominator, not against 71.

---

## The pattern, stated plainly

C-12, C-18, C-19, C-22, and now C-23 and C-24 are one error repeated six times: **a plausible completion written in place of a measurement.** Every one of them was me finishing a sentence the evidence had not finished.

The engagement's parent rule already names it — *compression is where scope falls off* — and I have been the most frequent offender against my own rule.

**Standing rule for me, effective now:** *I do not state an implication of ledger text as a finding without quoting the sentence that carries it. If no sentence carries it, it is my inference, and it is labelled INFERRED or it is not written.*

Both of today's corrections were caught by the owner's independent auditor before they reached the ledger. That is the system working. It is also the third round in which the auditor has caught me and I have not caught them.

---

## Effect on completion

| Gate | Before | Now |
|---|---|---|
| G5 — 71-function re-measurement | 0.75 | 0.75 |
| G1 | 0.25 | 0.25 |
| **Credited** | 2.25 / 9 ≈ 25% | **2.25 / 9 ≈ 25%** |

Unchanged. Neither correction adds or removes measured evidence — both remove a claim I should not have made. **The suspended B13 re-take is the item to watch; if the population check goes the other way, it returns.**
