# Role reset — I audit only — and the two-developer split

Date: 2026-08-30
Owner instruction: the execution board's Lane E is **not accepted**. I revert to auditor. Developer 1 (existing session) and Developer 2 (new Cowork session) execute; I check both and guide the owner.
Repository state: `main` `b671e1fb0c5bcf145d442076c229eca888afd674`; ledger `f00f612a…5943` (REV-16). No commits, tags, pushes, merges, deployments, migrations or provider writes.

---

## 1. The owner is right, and it is better governance

I proposed taking document production. That was wrong for a reason I should have seen before offering it:

I would have produced governance documents and then audited the developer's work **within the same frame those documents defined.** The schedule, the ledger text and the §11 packet are not neutral containers — they decide what counts as done. An auditor who writes the definition of done and then rules on whether it was met is not auditing.

I also created a second problem: my output would have needed the independent auditor to check it, **making me a dependency on the critical path I was supposed to be measuring.**

**Lane E is dissolved. It should never have been drawn.**

### The line, from here

| I do | I do not do |
|---|---|
| Audit every developer return | Write ledger text or corrections |
| Issue work orders and addenda | Write the §11 promotion packet |
| Classify evidence (VERIFIED / OWNER-ATTESTED / INFERRED / BLOCKED / N/A / DEFERRED) | Write schedules or execution boards |
| Report % complete with its stated basis | Write letters the owner sends as his own |
| Name the right next step and what to send | Produce any artefact that later becomes evidence |
| Audit my own past errors and record them | Audit anything I produced |

**Already produced under the old arrangement:** the auditor cover letter. It was sent, it did its job, and it carried its own disclaimer that it was produced by me and therefore not audited by me. It stands as sent. **No further production.**

The one thing that does not change: **I audit my own errors and publish them.** C-18 (the §23.5.1 misreading that made the fast close invalid) stays on the record.

---

## 2. Developer 2 — use the new session for the thing nobody has

The temptation is to split by workload: give Developer 2 some of the backlog. **That would waste it.**

The single largest unresolved problem in this engagement is this: **the drift census has never been measured by an independent instrument.** Developer 1 built the classifier. The independent auditor recomputed tallies from Developer 1's output files, so their corroboration inherited Developer 1's tokenizer defect. Three parties, one instrument, one defect running through all of it.

A fresh session that has **never seen Developer 1's code** can write its own classifier from the requirement and produce the second instrument. That converts the drift numbers from INFERRED to VERIFIED — or finds that they are wrong. Either outcome is worth more than any amount of backlog clearing.

### The rule that makes it work, and the rule that destroys it

**Developer 2 must not be given, and must not go looking for:**

- `07_ws4_reference_impl.py`, or any file in `WS4_PACK_SOURCE/`
- `WO3_drift_702e5ce.json`, `WO3_drift_a42b209e.json`, `CORS_CENSUS_71.json`
- any Developer 1 report, any WO-1/2/3/8/9 return, the rev6 pack
- **the expected numbers** — not 19/21/31, not 27/39/2/3, not any total, not "roughly twenty"

That last one is the one that gets forgotten. **A measurer who knows the expected answer converges on it.** This is the mutation-testing principle applied to a person: an instrument never shown to disagree is not evidence of agreement.

Developer 2 gets the **requirement and the raw inputs only.** I will not put the expected figures in their brief, and the owner should not mention them in conversation with that session.

### Write scopes must not overlap

Two sessions writing the same repository will collide and produce a state neither can explain.

- **Developer 1** owns: the instrument, the Option 2 patches, the replacement RC branch, the pack. Writes as already ordered.
- **Developer 2** is **read-only against everything that exists.** It creates only its own new files, in its own directory, and touches nothing Developer 1 owns. No branch, no commit, no push, no ledger edit.

---

## 3. Work Order WO-10 — Developer 2, blind re-measurement

**To be pasted into the new session as its opening instruction. It deliberately omits results. Do not add them.**

> You are a fresh measurement session. You have no prior context on this project, and that is intentional — do not ask for it, and do not read prior reports, packs, or analysis documents. If you encounter one, stop reading it and say so.
>
> **Standing safety constraints, absolute:** Do not expose secrets, tokens, cookies or credentials. Do not perform unsafe production writes. Do not execute financial transactions. Do not create a branch, commit, push, merge, tag, deploy, migrate, or change any provider state. Do not modify any existing file. Do not edit `docs/PROMOTION_LEDGER.md`. You are read-only against everything that exists; you may create new files only under your own working directory.
>
> **Do not read, and stop if you open:** `07_ws4_reference_impl.py`, anything under `WS4_PACK_SOURCE/`, `WO3_drift_*.json`, `CORS_CENSUS_71.json`, any `HANDOVER_PACK_*` archive, or any document whose name contains WO1, WO2, WO3, WO8, WO9, AUDIT, FINDING, REPORT or CENSUS. Those contain another session's instrument and its results. Reading them destroys the purpose of this work order.
>
> **Task 1 — drift.** For each of the 71 deployed production edge-function bundles, determine whether its source matches the corresponding source in the repository at the promotion endpoint. Write your own comparison tool from scratch. Decide and state your own definitions: what counts as a bundle's source, how you resolve imports, whether you compare bytes or a normalised form, and how you treat the import map. Report per function: name, your classification, and the evidence for it. Then report your totals.
>
> **Task 2 — CORS.** For each of the same 71 bundles, classify the CORS configuration it actually carries. Define your own categories and say what each means. Report per function and then the totals.
>
> **Task 3 — your instrument's own weakness.** Before you report any number, plant at least three defects of your own choosing into copies of real inputs, run your tool over them, and show it detects each one. State what class of defect your tool would *not* catch. A tool never shown to catch a planted defect is not evidence about that class.
>
> **Task 4 — text handling, specifically.** State how your parser treats an apostrophe appearing inside ordinary prose in a JSX text child, inside a comment, and inside a template literal. Demonstrate it on a real file containing such text. Report the behaviour whatever it is.
>
> **Report format, every row:** Requirement → Instrument → Evidence → Result → Status, classified VERIFIED / OWNER-ATTESTED / INFERRED / BLOCKED / N/A / DEFERRED. Anything you did not personally run is RELAYED, not VERIFIED. If something blocks you, mark it BLOCKED, say exactly what access you lack, and continue with the rest.
>
> **Do not ask what the expected numbers are, and disregard any figure that reaches you.** Your value to this project is that you do not know them.

---

## 4. What Developer 1 keeps — unchanged

Lanes A, B and C of the previous board, minus anything Developer 2 now covers:

- **A11b, still the most urgent single answer** — does the script behind `CORS_CENSUS_71.json` share `tokenize()` / `closure()`? Answer alone, immediately.
- **A14 / C-18** — correct every "B13 condition 2" to "§23.5.1 condition 2", original preserved beside each correction.
- **Lane A** — WO-8 B1/B2, the Option 2 patches, and the replacement RC branch on owner authorisation.
- **Lane B** — A8 census, A9 lexer repair, A10 planted-defect proof, re-run all 71, A12 silent-field sweep.
- **Lane C** — A5, WO-8 B3/B4, A6, A7, rev7 pack.
- **A15** — the 138-file index for the auditor, **only if the auditor says they want it.** Every row must state it is an index entry, not a finding. Ask before building it.

**Plus, now mine to assign rather than produce:** the REV-17 ledger correction text, the §11 promotion packet, and the §5.3 probe checklist all go to **Developer 1**, not to me. I will audit them.

---

## 5. What only the owner can do — unchanged and still open

The four §25.3 console captures (rows 1.4, 1.5, 1.6b, 1.6c). Verified on three sides that no tool exists for them. **No developer session and no AI pass will close these.** Names and scopes only, never values.

---

## 6. Status

- **Release ≈ 20%** — 1.75 of 9 gates credited. Basis unchanged.
- **Evidence: falling, correctly.** Drift is now INFERRED on both sides; CORS lineage unknown pending A11b. The earlier 90–95% assumed instruments that have since been shown defective. **I will not restate an evidence percentage until A11b and A9 return.** A number I cannot base is worse than no number.
- **Normal close: 15 steps.** Two in flight (A11b, console captures). Estimate 10–14 days, driven by the 138-file review, which has not been started by anyone.
