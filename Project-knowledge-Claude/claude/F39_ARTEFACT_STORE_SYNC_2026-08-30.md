# F-39 — a correction applied in one artefact store and not the other is not applied

Date: 2026-08-30 · Raised by the compiler, **and it is mine to fix.** Read-only measurements.
**Nothing here closes a §25 row (§25.4).**

---

## 1. The finding

This engagement writes into **two stores**:

| store | who reads it |
|---|---|
| **the hand-over pack** (`/home/claude/handover/`, shipped as `HANDOVER_PACK_*.tar.gz`) | whoever opens the archive |
| **the project** (`claude/*.md`) | **the auditor, the compiler, Developer 2, and every future session** |

I applied **C-23** — the withdrawal of the `702e5ce` re-class — to the pack, in
`12_ENDPOINT_REGISTER/` and `15_F34_F35_DRIFT_RECON/`. **I did not apply it to the project copy.**
The compiler read `claude/F34_F35_DRIFT_RECONCILIATION_2026-08-30.md` and found it still saying:

> *"**DISPUTED:** the **class** … `702e5ce` is on a **divergent** line … Recorded as **DISPUTED**
> until ruled."*

**A withdrawn finding was still live in the store that the auditor actually reads.** Measured by
direct read: the project copy's `created_at` is `2026-08-30T16:12:52Z`; the local file was last
modified `16:46:05Z` — **the correction post-dates the publication and never crossed over.**

**This is the same defect family as LG-05-DEF-1 and F-30, in a new place:** the correction and the
thing corrected lived in different places, and nothing checked that they agreed. It is also the
mirror of the relay defect the compiler recorded against themselves — **rulings that do not reach
the store where they are read have not been issued; corrections that do not reach it have not been
applied.**

---

## 2. What was fixed, now

### 2a. The doc the compiler named

`claude/F34_F35_DRIFT_RECONCILIATION_2026-08-30.md` — **republished from the corrected pack file**
(`project_write` returned `replaced: true`). It now carries:

- the **C-23 withdrawal** block — *"the re-class is declined and I accept the ruling; the label
  `staging @ 702e5ce` is accurate"*;
- the **original wording preserved** verbatim in a struck block below it, per the standing rule that
  prior conclusions are never overwritten;
- the **retained ancestry measurement**, unchanged, because it remains the reason
  `main..702e5ce = 98 files` must never be read as *"the first 98 of the eventual 138"*;
- a corrected H1 — it previously read *"702e5ce class dispute"*, which contradicted its own body.

### 2b. The sweep — because fixing only the instance the compiler found would repeat the defect

Every document this session has published to the project was **republished from its current pack
file**, so the two stores agree by construction:

| project path | pack source | status |
|---|---|---|
| `claude/F34_F35_DRIFT_RECONCILIATION_2026-08-30.md` | `15_F34_F35_DRIFT_RECON/…` | **measured diverged**, republished |
| `claude/A16_ENDPOINT_REGISTER_2026-08-30.md` | `12_ENDPOINT_REGISTER/…` | republished — local edited **16:26** with C-23 + C-21 after publication |
| `claude/WO-9A_A9_A10_A11_A12_REPORT_2026-08-30.md` | `10_A9_LEXER_REPAIR/…` | republished — local edited **15:41** with the C-18 correction after publication |
| `claude/A11b_CORS_CENSUS_LINEAGE_ANSWER_2026-08-30.md` | `11_A11b_CORS_LINEAGE/…` | republished — local edited **15:36** with the import-graph reword and the C-19→C-20 renumber after publication |
| `claude/LANES_ABC_STATUS_AND_F37_2026-08-30.md` | `16_LANES_ABC/…` | republished — blocked-list row 8 was **stale** and is now struck and marked UNBLOCKED |
| `claude/A17_WORKFLOW_TRIGGER_ANSWER_2026-08-30.md` | `14_A17_WORKFLOW_TRIGGERS/…` | republished — no post-publication edit found |
| `claude/DRIFT_PER_FUNCTION_BUCKETS_2026-08-30.tsv` | `15_F34_F35_DRIFT_RECON/…` | published at the exact ordered path |

> **Scope honesty (§3.5 rule 6).** Only the first row was *measured* diverged, by reading the project
> copy back and comparing. For the rest I have **local modification times later than publication**,
> which is evidence of a post-publication edit but **not** a per-byte comparison. I republished all
> of them regardless. **I am claiming they now agree, not that each had previously diverged.**

### 2c. The duplicate TSV — removed, because two copies is the same defect

I first published the per-function table at `claude/SESSION1_DRIFT_PER_FUNCTION_BUCKETS_…tsv`. The
ordered path is `claude/DRIFT_PER_FUNCTION_BUCKETS_2026-08-30.tsv`. **Both existing would have been
two stores again** — a future correction could reach one and not the other. The wrongly-named copy
was **deleted** (`project_delete` → `deleted: true`). **There is exactly one canonical copy.**

---

## 3. The standing remedy — a rule, not a resolution to be careful

> **Standing rule 10: the pack is the single source of truth. Every project document is published
> from a pack file, never authored directly in the project; and any correction sweep republishes
> every affected project document in the same action that edits the pack.**

Two consequences, both mechanical rather than attentional:

1. **Never edit a project doc in place.** Edit the pack file, then `project_write` it with
   `local_path`. The pack's `MANIFEST.sha256` then covers the exact bytes the project holds.
2. **A correction is not applied until every store that carries the corrected claim has been
   rewritten.** "Applied in the pack" is a half-measure, and a half-applied correction is worse than
   none — it lets the withdrawn version be quoted with the correction's authority behind it.

**Verification available to anyone:** every project doc listed in §2b has a byte-identical twin
inside the pack, and the pack's manifest carries that file's sha256. A reader who suspects drift can
hash the pack file and compare it with what the project returns.

---

## 4. What this cost, recorded

**Nothing was measured wrongly.** No figure in any document changed as a result of F-39. What was at
stake is worse than a wrong number and cheaper to fix: for roughly half an hour the auditor's store
carried a **live dispute against §23.5.3 that had already been withdrawn** — a finding I had agreed
to drop, still standing under my name, in the only copy they read.

**Recorded as F-39, mine, with rule 10 as the remedy.**

---

## 5. Addendum, same session — **C-23 EXTENDED, and it is a worse error than F-39**

Fixing F-39 made me read `claude/CORRECTIONS_C-23_C-24_AUDITOR_WAS_RIGHT_ON_BOTH_2026-08-30.md`,
which I had not seen. It says `702e5ce` is an ancestor of `a42b209e` **through staging's own
first-parent line** via `fe4505aa`, and appears in the ledger's §5.4 commit manifest.

**I measured it. The compiler is right, and my retained claim was false.**

```
git merge-base --is-ancestor 702e5ce a42b209e            -> TRUE
comm -23 <(git diff --name-only main 702e5ce | sort) \
         <(git diff --name-only main a42b209e | sort) | wc -l   -> 0
```

**All 98 paths of `main..702e5ce` are members of the 138. The 98 are a strict subset.**

When I accepted C-23 I withdrew the *framing* and deliberately **retained** what I called "the
consequence that survives": that *"the baseline covered 98 of the 138 files"* was false and must
never be written. **I had never run the subset test.** I inferred it from a merge-base result and
then wrote it into two documents as a prohibition. **The sentence I forbade is true.**

**What actually survives is one narrow fact:** `702e5ce` is not a descendant of `main`, so
`main..702e5ce` is not a fast-forward range and its *line* counts do not compose with the RC's. The
*path set* composes perfectly.

**Both documents corrected and both stores republished in the same action, per rule 10.**

**The failure named, because it is the third instance today and the pattern matters more than the
instance:** I withdrew a framing and kept the conclusion I had drawn from it, without re-measuring
the conclusion. Identical in shape to the *"share four members"* number — a claim written from
reasoning, inside a document whose subject is not doing that. **A withdrawal does not automatically
withdraw what was inferred from it; every retained consequence has to be re-measured on its own.**

**Proposed standing rule 11, for the compiler to accept or refuse:**
*When a premise is withdrawn, every conclusion drawn from it is withdrawn with it until
independently re-measured. Retention is a new claim and needs new evidence.*
