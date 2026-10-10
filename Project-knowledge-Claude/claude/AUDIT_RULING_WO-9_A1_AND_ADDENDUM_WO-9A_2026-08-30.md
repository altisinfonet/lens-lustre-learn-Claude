# Audit ruling on WO-9 Group A first return, and Addendum WO-9A

Date: 2026-08-30
Role: compiler/auditor ruling on the developer session's A1–A4 return.
Repository state: `main` `b671e1fb0c5bcf145d442076c229eca888afd674`; ledger `f00f612a…5943` (REV-16). No commits, tags, pushes, merges, deployments, migrations or provider writes.

---

## 1. What was returned, and what I accept

**ACCEPTED — the diagnosis.** The developer established that:

- the harness recorded `closure_problems: True` for exactly the four functions and never surfaced it;
- re-running each closure gives **exit 3, deterministic, identical stderr**;
- the flagged line 23 is `<Preview>It's been a month — here's what you've missed.</Preview>`;
- the apostrophes in `It's` / `here's` / `you've` are consumed as string delimiters;
- therefore **the RC source is not malformed — the instrument cannot lex it.**

This is a good piece of work. It is the correct question ("is the source bad or is the tool bad?"), asked before the totals were touched, and answered with a deterministic re-run and an inspection of the actual line. **Recorded as VERIFIED.**

**ACCEPTED — R3.** 121 = 71 `raw/` + 50 `raw_full/`. Matches the independent auditor exactly. **VERIFIED.**

---

## 2. What I reject

### RULING 1 — the four records stay **BLOCKED**. Do not reclassify them.

The return says *"Recomputing the totals with the four correctly classified."* **That step is not authorised and must be withdrawn.**

Diagnosing why an instrument failed is not the same as obtaining a measurement. An instrument that could not read the file **did not read the file**. Knowing the reason changes the *explanation* of the gap; it does not fill the gap.

This is the exact conversion the standing evidence rule forbids: *"Never silently convert one category into another."* BLOCKED → DRIFT (or → NO-DRIFT) on the strength of a root-cause finding is that conversion.

The four move out of BLOCKED **only** when a working instrument reads those four files and returns a result. Not before.

### RULING 2 — do not republish the drift totals yet.

Totals recomputed from an instrument now known to be defective are not evidence. Republishing them before the instrument is repaired is, in the owner's words, making the ledger look green rather than accurate. The existing 19/21/31 and 19/22/30 figures stand **as published, with the four rows marked BLOCKED**, until WO-9A returns.

---

## 3. New finding raised by this return — **F-27, and it is larger than A1**

The developer found the four functions that **errored**. The question not asked is: **what did this lexer do to the files that did not error?**

If `'` opens a string literal, then:

- **odd** apostrophe count → unterminated string → the parse fails → **exit 3** → visible;
- **even** apostrophe count → the lexer treats everything between the first and second apostrophe as a string literal → **it parses "successfully" and exits 0** → invisible.

Line 23 contains **three** apostrophes (`It's`, `here's`, `you've`) — odd. That is precisely why these four surfaced and others did not.

**Consequence:** any function whose source contains an even number of apostrophes in prose or comments was **silently mis-lexed**. Whatever fell between two apostrophes was invisible to the instrument. If the instrument was looking for anything — a lane assertion, a CORS header, a credential pattern, an import — text swallowed into a phantom string literal was never examined.

**The four exit-3 failures are not the population of affected files. They are the subset where the defect was loud.**

This must be measured before any total derived from this instrument is trusted.

### F-27a — is this lexer shared?

The decisive follow-up: **does the same lexer underlie the drift census, the CORS census, the credential scrub, or the 71-function re-measurement?**

- If **yes**, then those totals inherit the defect, and the fact that the owner's independent auditor corroborated the drift numbers only tells us the auditor's instrument agreed — which is reassuring if their instrument is different and worthless if it is the same. **This must be asked of the auditor directly.**
- If **no**, the blast radius is confined to the closure step and F-27 is bounded.

Until F-27a is answered, the corroborated totals are **INFERRED**, not VERIFIED.

---

## 4. Second new finding — **F-28, the silent-field defect**

The developer's own words: *"my harness recorded `closure_problems: True` for exactly those four and I never surfaced it."*

That is a **reporting suppression defect**, independent of the lexer. The harness knew and did not say. The right question is not "why did it miss these four" but **"what else does the harness record internally and never print?"**

Every field the harness computes must be enumerated against every field it emits. Any recorded-but-unemitted field is a potential second F-27 sitting undiscovered.

---

## 5. Effect on completion — the projection goes **down**, not up

Basis: the nine release gates in `claude/PATH_TO_MERGE_GATE_LIST_2026-08-30.md`.

| Gate | Before this return | Now |
|---|---|---|
| G4 — independent test-suite run with full run conditions | 0.25, projected 0.75 | 0.25, **A5 still running** |
| G5 — 71-function re-measurement | 0.5, projected 0.75 | **0.5** — A1 did not close |
| G6 — closure records free of statuses from failed instruments | 0, projected 1.0 | **0** — instrument now known defective, and F-27 widens the affected set |
| **Credited** | 1.75 / 9 ≈ **20%** | 1.75 / 9 ≈ **20%** |
| **Projected on WO-9 completion** | ≈ 3.25 / 9 ≈ **36%** | ≈ **2.0 / 9 ≈ 22%** |

Classification: **OWNER-ATTESTED estimate, basis stated.** The projection fell because A1 returned a defect rather than a closure, and because F-27 puts previously-credited measurement back in question.

**This is the correct direction for the number to move.** A good day of audit work that finds a real instrument defect *lowers* apparent completion. A day that raised it would be the day to worry about.

---

## 6. Addendum WO-9A — issued now, runs alongside the rest of WO-9

All standing constraints remain in force, unchanged. Prepare only: no branch, no commit, no push, no merge, no tag, no deploy, no migration, no §5.3 probe, no provider write, no ledger edit, no guard install, no secret read.

**A1-R (replaces the withdrawn reclassification).**
Leave the four records **BLOCKED**. Publish the diagnosis as the *reason* for the BLOCKED status, not as a result. Do not recompute or republish any total that depends on them until A8 returns.

**A8 — measure the true blast radius of the lexer defect.**
For each of the 71 deployed bundles and each RC source file the instrument reads, report: file path, total count of `'` characters, and whether that count is odd or even. Produce three lists — odd (loud failures), even and non-zero (**silent mis-lex candidates**), zero (unaffected). Give the counts of each list. Do not assume the even list is clean; it is the population that needs re-measurement.

**A9 — repair the lexer, then re-run.**
Fix the tokenizer so apostrophes inside JSX/TSX text children, comments and template literals are not treated as string delimiters. Then re-run the closure across **all 71**, not only the four. Report: how many results changed, and for each change the before value, the after value, and the file. A repair that changes nothing but the four is itself a finding and must be reported as such — with the diff of results proving it.

**A10 — prove the repair with a planted defect.**
Plant a known finding inside text that the old lexer would have swallowed between two apostrophes. Confirm the old instrument misses it and the repaired instrument catches it. Without this, the repair is asserted, not demonstrated. *(A suite never shown to detect a planted defect is not evidence about that class.)*

**A11 — F-27a, instrument lineage.**
State plainly whether the drift census, the CORS census, the credential scrub, and the 71-function re-measurement share this lexer or any part of it. Show the import graph or the shared module path. If shared, re-run each affected census after A9 and report the deltas. If not shared, say so and show why.

**A12 — F-28, the silent-field sweep.**
Enumerate every field the harness computes and every field it emits. Report the set difference. For each recorded-but-never-emitted field, state what it holds and whether any current record depends on it. Then make the harness fail loudly — non-zero exit — on any internal problem flag, so this class cannot recur silently.

**A13 — external question for the owner's independent auditor.**
Ask, through the owner: *when you recomputed the drift and CORS totals, did you use your own instrument or the one shipped in the pack?* Their corroboration is independent only if the instrument is independent. Record the answer verbatim; do not infer it.

**Reporting rule, unchanged.** One report. Every row `Requirement → Instrument → Evidence → Result → Status`, classified VERIFIED / OWNER-ATTESTED / INFERRED / BLOCKED / N/A / DEFERRED. Anything not personally run is RELAYED. Preserve every prior conclusion; record corrections beside them, never over them. Blocked items are reported and skipped, not used to stop the order.

---

## 7. Note for the record

The developer session did the right thing twice in this return: it asked whether the source or the tool was at fault before touching any number, and it disclosed its own harness's suppression without being asked. Both are recorded.

The one error — reclassifying on the strength of a diagnosis — is the same error family as LG-05-DEF-1 and C-17, and belongs to the parent rule: **compression is where scope falls off.** "The tool was broken, so the four are fine" is the compressed form. What fell off it is that the four were never read.
