# Normal close, run in parallel — execution board

Date: 2026-08-30
Owner decision: **NORMAL CLOSE.** All 15 steps completed before the merge. No deviation. Clean ledger entry. Parallelised, not shortened.
Repository state: `main` `b671e1fb0c5bcf145d442076c229eca888afd674`; ledger `f00f612a…5943` (REV-16). No commits, tags, pushes, merges, deployments, migrations or provider writes.

---

## 1. My role change, and the independence cost — read this first

The owner has asked me to **work alongside the developer**, not only audit. I accept, with one rule that cannot bend:

> **I will not audit anything I produce.**

Anything I write goes to the **independent human auditor** for checking, exactly like the developer's work. If I both build and check a thing, that thing has no check at all — that is the same defect as LG-05-DEF-1 (a check sharing its exclusion rule with the thing it checks is not a check).

**Therefore the split is by kind, not by convenience:**

| Work | Owner of it | Checked by |
|---|---|---|
| **All measurement, all code, all instruments** | developer session | **me** (unchanged) |
| **All governance documents, ledger text, auditor packets, schedules** | **me** | the independent auditor |
| The final promotion decision | owner | — |

I take **no measurement task.** Measurement is precisely what needs an independent check, and I am the check.

---

## 2. The one task that must run first — it resizes everything else

**A11 — instrument lineage.** Ten minutes of work. Answer: does the drift census / CORS census / credential scrub / 71-function re-measurement share the defective lexer?

- **If NO** — the defect is confined to the closure step. Steps 5 and 6 are small. The corroborated totals stand.
- **If YES** — every one of those censuses must be re-run after the repair, and the owner's auditor's corroboration of them is worth nothing unless they used their own instrument.

**Everything downstream is sized by this answer. It goes first, ahead of the lexer repair itself.**

---

## 3. Four lanes, running at once

### LANE A — SAFETY (developer) · the fix

| Step | Depends on | Note |
|---|---|---|
| A-1 · WO-8 B1, B2 | — | **sets the file count: 3 or 4** |
| A-2 · Produce Option 2 patches | A-1 | 2 YAML quoting fixes + 1–2 TS escapes |
| A-3 · Cut replacement RC branch off `staging`, apply patches | A-2 + **owner authorisation** | no merge, no tag, no deploy |
| A-4 · Re-declare RC identity: new head sha, new 138-file scope, line counts | A-3 | every figure carries its basis (§3.5 rule 5) |

### LANE B — INSTRUMENT (developer) · the lexer

| Step | Depends on | Note |
|---|---|---|
| **B-0 · A11 lineage** | — | **DO THIS FIRST. Sizes lanes B and C.** |
| B-1 · A8 apostrophe census, all files | — | odd / even-nonzero / zero, with counts |
| B-2 · A9 repair the tokenizer | — | JSX text, comments, template literals |
| B-3 · A10 planted-defect proof | B-2 | old instrument misses it, new one catches it |
| B-4 · Re-run closure across all 71 | B-2, B-3 | report every changed result, before → after |
| B-5 · Re-run any census A11 says is affected | B-0, B-4 | skip entirely if A11 returns NO |
| B-6 · A12 silent-field sweep + fail-loud exit | — | independent, can run any time |

### LANE C — EVIDENCE (developer) · the remaining rows

| Step | Depends on | Note |
|---|---|---|
| C-1 · A5 credential scrub re-run, full transcript | — | already running |
| C-2 · WO-8 B3, B4 | — | **captured deployed source only, no secret read** |
| C-3 · **State exactly what blocks §25.3 rows 1.4, 1.5, 1.6b, 1.6c** | — | **do this today** — one line each; we have never had it, and it is on the critical path |
| C-4 · A6, A7 pack corrections | — | plan file in; "Track R not started" out |
| C-5 · Rebuild pack rev7, full-depth walk | all lanes | last developer step |

### LANE D — AUDITOR (human) · **the long pole — starts today on rev6**

The auditor does **not** wait for rev7. Their work splits into what is already stable and what must wait.

**Can start now, from rev6:**
- the 138-file review — 134–136 of the 138 files are untouched by Option 2; review them now, delta the 2–4 later
- the eight §25.3 infrastructure rows — infrastructure, not RC-dependent
- the lineage question (A13)

**Must wait:**
- the independent test-suite run — wait for C-1's transcript
- the 71-function re-measurement — wait for B-4; it is tainted by the lexer defect until then

**This split is the whole parallelisation.** It starts the longest pole today instead of in two weeks.

### LANE E — ME (Claude, auditor + document production)

| Step | Output |
|---|---|
| E-1 · Auditor packet cover letter | **drafted, ready to send** — see `claude/AUDITOR_PACKET_COVER_LETTER_2026-08-30.md` |
| E-2 · REV-17 ledger correction set text | corrections beside originals, never over them |
| E-3 · §11 promotion packet, deviation-free | assembled as lanes close |
| E-4 · Audit every developer return | unchanged, and my primary duty |
| E-5 · §5.3 probe procedure checklist | for the owner to execute |

---

## 4. Sequence — what finishes when

| Day | Lane A | Lane B | Lane C | Lane D (auditor) |
|---|---|---|---|---|
| **0** | A-1 | **B-0 lineage**, B-1, B-2 | C-1, C-2, **C-3** | packet sent; 138-file review + §25.3 rows begin |
| **1** | A-2, A-3 | B-3, B-4, B-6 | C-4 | continues |
| **2** | A-4 | B-5 (if needed) | — | test run + 71-function re-measurement begin |
| **3** | — | — | C-5 rev7 pack | delta review of the 2–4 changed files |
| **4–5** | — | — | — | **all §25 closures returned** |
| **6** | §5.3 probe (owner) | | | |
| **7** | **§11 signature → tag → merge** | | | |

Critical path is **Lane D**. Lanes A, B and C all fit inside it. If the auditor turns work around in three to four days, normal close lands in about a week — not two to three.

**That is the entire gain: same 15 steps, same standard, clean record, ~1 week instead of ~3.**

---

## 5. What must not slip

- **A11 first.** Without it, Lane B is unsized and Lane D's corroboration is unverified.
- **C-3 today.** We have never known what actually blocks the four §25.3 rows. It is on the critical path and has never been asked.
- **Auditor packet out today.** Every hour it sits is an hour off the critical path, and it is the only lane nothing else can compress.
- **Owner authorisation for A-3.** Lane A stalls at the branch without it.

---

## 6. Standing constraints — unchanged, all in force

Do not expose secrets, tokens, cookies or credentials. Do not perform unsafe production writes. Do not execute financial transactions. Do not modify the frozen RC merely to manufacture a passing result. Do not run an unsafe N1/N2 configuration. Before any high-impact action, verify the actual workflow and branch being executed. Do not try to make the ledger look green — make it accurate. Do not overwrite previous conclusions; preserve the original and record the correction separately.

**Prohibited until §11 signs:** merge, tag, deploy, migrate, §5.3 probe, production write.
**Permitted on owner authorisation only:** cutting the replacement RC branch and applying the Option 2 patches to it.

Evidence standard, every row: `Requirement → Instrument → Evidence → Result → Status` · VERIFIED / OWNER-ATTESTED / INFERRED / BLOCKED / N/A / DEFERRED. Anything not personally run is RELAYED.
