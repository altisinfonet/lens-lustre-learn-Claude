# Lanes A, B and C — status board, with the work that could be done and the gate that stops the rest

Date: 2026-08-30 · Read-only. **No branch, no commit, no push, no merge, no tag, no deploy, no
migration, no workflow dispatch, no §5.3 probe, no provider write, no ledger edit, no secret read.**
**Nothing here closes a §25 row (§25.4).**

Basis: `claude/NORMAL_CLOSE_PARALLEL_EXECUTION_BOARD_2026-08-30.md` §3.

---

## 0. Board

| Lane | Step | State | Evidence |
|---|---|---|---|
| **B** | B-0 · A11 lineage | **CLOSED** | `10_A9_LEXER_REPAIR/` §A11 + `11_A11b_CORS_LINEAGE/` |
| **B** | B-1 · A8 apostrophe census | **CLOSED** | 114 files: ODD 46 / EVEN-nonzero 41 / ZERO 27 |
| **B** | B-2 · A9 tokenizer repair | **CLOSED** | 107/107 files lexed, 0 regressions |
| **B** | B-3 · A10 planted defect | **CLOSED** | old misses silently, repaired catches; 2 discriminating controls |
| **B** | B-4 · closure re-run, all 71 | **CLOSED** | 4 changed, 67 unchanged, `+0/−0` paths |
| **B** | B-5 · re-run affected censuses | **CLOSED** | drift re-run both lanes (no verdict moved); CORS not shared (A11b) |
| **B** | B-6 · A12 silent-field sweep | **CLOSED** | 6 fields found; hardened harness exits 4 / 0 on its two controls |
| | **LANE B** | **✅ COMPLETE** | |
| **C** | C-1 · A5 credential scrub | **CLOSED** | `03_WO3/A5_CREDENTIAL_SCRUB_FULL_TRANSCRIPT.txt`, 584,360 B |
| **C** | C-2 · WO-8 B1–B4 | **CLOSED** | B1 negative (worker.js excluded); B2 `stripHtml` is **not** an escape, credit withdrawn; B3 bucket value = **database read** via `getS3Settings()`; B4 unclosable by construction |
| **C** | C-3 · what blocks §25.3 1.4/1.5/1.6b/1.6c | **CLOSED and SUPERSEDED** | access gap VERIFIED on all three sides; the owner has since captured all four rows |
| **C** | C-4 · A6/A7 pack corrections | **CLOSED** | recorded beside originals in `RESUME_HERE.md`, `00_INDEX.md` |
| **C** | C-5 · rebuild pack, full-depth walk | **CLOSED, re-run each revision** | rev10; coverage enumerated, not assumed |
| | **LANE C** | **✅ COMPLETE** | |
| **A** | A-1 · WO-8 B1, B2 → file count | **CLOSED** | **three files, not four** |
| **A** | A-2 · produce Option 2 patches | **CLOSED, then REOPENED and FIXED — see F-37** | `09_OPTION2_PATCHES/`, now with `16_LANES_ABC/patches_fixed/` |
| **A** | A-3 · cut replacement RC branch, apply patches | **🔒 BLOCKED — OWNER AUTHORISATION** | the only remaining gate on this lane |
| **A** | A-4 · re-declare RC identity | **PRE-MEASURED, see §2** | the numbers are ready; the declaration needs A-3 |

**Lanes B and C are closed. Lane A is one authorisation from done, and its numbers are already
measured.** The critical path is Lane D — the auditor.

---

## 1. F-37 — NEW, and it would have fired at exactly the wrong moment

**The three Option 2 patches, as shipped in `09_OPTION2_PATCHES/`, do not apply. By any invocation.**

I tested them rather than assuming, because A-3 is the step where they would first be used — and a
patch that fails at the moment the owner authorises a replacement RC fails under time pressure.

```
01-apply-migration.yml.patch            git apply -p1 : error: tmp/p1.yml: No such file or directory
                                        patch -p0     : Ignoring potentially dangerous file name /tmp/p1.yml
                                        patch -p1     : can't find file to patch at input line 3
02-verify-schema-dependencies.yml.patch  (identical failure, /tmp/p2.yml)
03-functions-_seo.ts.patch               (identical failure, /tmp/p3.ts)
```

**Cause, and it is entirely mine.** The patches were produced by copying each file to `/tmp`,
editing the copy, and `diff -u`-ing against the original — the method recorded in the README's own
opening paragraph. That method puts the **scratch path** on the `+++` line:

```
--- .github/workflows/apply-migration.yml   2026-08-30 07:12:32 +0000
+++ /tmp/p1.yml                             2026-08-30 11:38:42 +0000
```

Every patch tool reads the target from that line. **The safety property that produced this — never
edit the RC worktree — was correct, and I would do it again. The defect is that I never tested the
artefact the method produced.** The README says *"Apply with review, not blindly"*; it does not say
*"these will not apply at all."*

### The fix, and its bound

`16_LANES_ABC/patches_fixed/` carries the same three patches with **only** the `---`/`+++` header
lines rewritten to `a/<path>` and `b/<path>`. **No hunk was touched.** Verified:

```
01-apply-migration.yml.patch                   git apply --check -p1  APPLIES CLEANLY
02-verify-schema-dependencies.yml.patch        git apply --check -p1  APPLIES CLEANLY
03-functions-_seo.ts.patch                     git apply --check -p1  APPLIES CLEANLY
```

**So the hunks were always correct against `a42b209e`; only the addressing was wrong.** The original
patches are retained unmodified in `09_OPTION2_PATCHES/` with a defect notice; the fixed set is the
one to use.

**The rule this belongs to, and it is the D+ rule again:** *a patch never shown to apply is not a
patch.* An artefact whose whole purpose is to be executed must be executed once before it ships.
Recorded alongside the four existing engagement rules and F-30.

---

## 2. A-4 pre-measured — what the replacement RC's identity would be

Done on **two scratch extractions of `a42b209e`** (`git archive | tar -x` into `/tmp`), one pristine
and one patched, compared with `diff -ru`. **The RC worktree was not touched, no branch exists, and
nothing was committed.**

| Measure | Frozen RC `a42b209e` | **Replacement RC, projected** |
|---|---|---|
| files changed vs `main` | **138** | **138 — unchanged** |
| lines vs `main` | **+9,060 / −1,293** | **+9,096 / −1,300** |
| commits vs `main` (incl · excl merges) | **39 · 37** | **40 · 38**, if the three patches land as **one** commit |
| paths added or deleted by the patches | — | **none** |

Per-file, measured:

| File | ± | already inside the 138? |
|---|---|---|
| `.github/workflows/apply-migration.yml` | **+18 / −5** | **YES** |
| `.github/workflows/verify-schema-dependencies.yml` | **+11 / −1** | **YES** |
| `functions/_seo.ts` | **+7 / −1** | **YES** |
| **total** | **+36 / −7** | |

**The single most useful consequence: the file count does not move.** All three patched files are
already in the 138, and the patches add and delete no paths. So the auditor's 138-file review — the
critical path — is **not invalidated** by a replacement RC. Only three files need a delta review,
totalling **43 changed lines**.

> ⚠ **Standing rule 5 applies to my own table.** "138 = 138" is a **matching total**, and a matching
> total is not evidence of agreement. The claim above is **not** derived from the counts: it is
> derived from the per-item check that all three patched paths are members of the 138 and that the
> patches create and delete no paths. **Per-item, not per-total.**

> **Classification.** Everything in this section is **VERIFIED** as a projection of applying these
> three patches to `a42b209e`. It is **not** a measurement of a replacement RC, because no
> replacement RC exists. The commit count is **INFERRED** and depends on how A-3 chooses to commit —
> one commit gives 40·38; three give 42·40. **Nothing here pre-empts A-3.**

---

## 3. What is blocked, on whom, and what unblocks it

| # | Item | Blocked on | What unblocks it |
|---|---|---|---|
| 1 | **A-3 / A-4** — replacement RC | **the owner** | one authorisation. Everything else on Lane A is done and measured |
| 2 | **Developer 2 drift join** | **Developer 2** | their per-function list — `slug → verdict`, plus **endpoint hash** and **reading**. Held per standing rule 5; **I will not report agreement from aggregates** |
| 3 | **A13 instrument lineage** | — | **ANSWERED.** The auditor disclosed they used our output files. Drift is INFERRED on both sides; CORS is independent (A11b) |
| 4 | **138-file review** | **the auditor** | the critical path. §2 shows a replacement RC costs them a 3-file, 43-line delta — not a re-review |
| 5 | **A15 index** | **the auditor** | offered, not produced. No index will be written unless asked |
| 6 | **§25.3 rows 1.4 / 1.5 / 1.6b / 1.6c** | **the auditor** | captured by the owner; **§25.4 — compiler capture is OWNER-ATTESTED and cannot close them** |
| 7 | **`ANDROID_*` secret scoping** | **the owner** | move them out of repository scope. Trigger analysis cannot close it (A17); only scope can |
| 8 | ~~**`SUPABASE_DB_URL` repository-secret check** — the owner~~ | **UNBLOCKED 2026-08-30** | **ANSWERED.** Repository secrets are exactly four `ANDROID_*`; `SUPABASE_DB_URL` is an **environment** secret on `production` only. **OWNER-ATTESTED.** A17 item 2 no longer conditional. *(This row was stale when written — the answer had already been given and had not reached this session. See F-39.)* |

---

## 4. The per-function drift baseline — published and hashed, per your instruction

Held open for Developer 2's list. So that their diff has a fixed baseline, mine is hashed now:

| File | sha256 | size |
|---|---|---|
| `DRIFT_PER_FUNCTION_BUCKETS.tsv` | `951a2cfd5658c7528bb4b40a079ff0815f4aecad0343e79bdc539709ad0559da` | 3,623 B, 72 lines (71 + header) |
| `DRIFT_PER_FUNCTION_BUCKETS.json` | `60ba263d2d6b379f0ac4a34fac1166d35c07f0fcf2e5d1b4a9d2b197c208fd17` | |
| `F34_guard_census.json` | `a30868ed8da3b1bac15cee021f847120a1bb33e4398a70e6be89ef42c865cb15` | |
| `F35_secureHeaders_md5.json` | `33b4cfe95e96aea6afa3645a8f4a430a0209d098ae2bac82d53238a49eb9185e` | |
| `f34_guard_census.py` | `56a5783227ff4c1f22b8b90755f6b6ea18cdf3d29f4d50546b53f603a88bf2d9` | |

**The join stays BLOCKED until Developer 2's list is published and hashed.** Aggregates are not
agreement.

---

## 5. C-23 applied

The `702e5ce` re-class is **withdrawn** and §23.5.3 **stands**. `staging @ 702e5ce` is an accurate
label — `702e5ce` is a commit on `origin/staging`, which I measured myself and then argued past. The
framing was wrong; the **ancestry measurement is retained**, because it is still the reason
`main..702e5ce` = 98 files must never be described as "the first 98 of the eventual 138". Recorded
beside the original in both `12_ENDPOINT_REGISTER/` and `15_F34_F35_DRIFT_RECON/`.

---

## 6. Standing

Lanes B and C complete. Lane A complete to its authorisation gate, with A-4's numbers measured in
advance. **Nothing here closes a §25 row.** The critical path is the auditor.

---

> ⚠ **F-39 NOTICE, 2026-08-30.** This document was published to the project at
> `claude/LANES_ABC_STATUS_AND_F37_2026-08-30.md` **before** row 8 was unblocked. The project copy
> has been **republished from this file** so the two stores agree. See
> `18_F39_STORE_SYNC/F39_ARTEFACT_STORE_SYNC.md` for the finding and the standing remedy.
