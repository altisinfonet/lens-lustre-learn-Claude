# Addendum A — three corrections

Companion to *Independent measurement — 71 production edge-function bundles* (2026-08-30). Same session, same instrument, same constraints: read-only, no production write, no branch/commit/push/merge/tag/deploy/migration, no existing file modified, no secret reproduced. No other session's report, pack, or totals document was opened. No expected figure reached me.

Two of the three corrections change published claims. **One of them retracts a finding I made.**

---

## A1 · Endpoint labelling, and a search that does not need the owner's hash

You are right: `main` is the destination, not the candidate. My 55/16 is deployed-vs-**destination-branch** drift. Relabelled, definitions unchanged:

| # | endpoint | hash | role | deployed bundles matching, strict bytes | drifting |
|---|---|---|---|---|---|
| E1 | `refs/heads/main` | `b671e1fb0c5bcf145d442076c229eca888afd674` (tree `db8df567…`) | **destination** of the proposed promotion | **55 / 71** | 16 |
| E2 | `refs/heads/staging` @ RC | `25c0456011451f644def7ef5361904e4de25dd08` (tree `51616b21…`) | **candidate** `RC-20260829-01` | **21 / 71** | 50 |
| E3 | *(owner to supply)* | — | the ledger's endpoint | **DEFERRED** | — |

E3 is a one-command re-run: `REPO_ROOT=<worktree> python3 tool/run.py`. Give me the hash and it takes two minutes. I have changed no definition and will change none.

Two refinements that belong with these numbers:

**The deploy step rewrites one import prefix.** For bundles the deploy flattens — entrypoint at the bundle root rather than inside a `<slug>/` subdirectory — it copies `supabase/functions/_shared` in beside the entrypoint and rewrites `from "../_shared/` to `from "./_shared/`. That is packaging, not authored drift. Allowing exactly that one substitution and nothing else, **E1 explains 56 of 71 rather than 55**: `purge-s3-orphans/index.ts` moves from drift to match. Strict-byte figure stays 55; the allowance is stated separately, never folded in silently.

**A best-fit search, since E3 is not yet available.** I scored every distinct state the repository has ever had — 1,665 commits collapse to **103 distinct `supabase/functions` trees** — by how many of the 71 deployed bundles that state explains in full:

| rank | functions-tree | newest commit using it | bundles explained |
|---|---|---|---|
| 1 | `2040d89345a4` | `da0184a` / `03ba3cf` · 2026-08-24 · branch `origin/gift-credit-user-lookup` | **57 / 71** |
| 2–7 | six trees dated 2026-08-20 → 2026-08-26 | incl. `704ad57` (PR #103) | 56 |
| — | `a5528524a521` | **= `main` `b671e1fb`** | **56** |
| — | `c7876a89b31a` | **= RC `25c0456`** | **21** |

**No committed state anywhere in this repository's history explains more than 57 of the 71 deployed bundles**, and 10 bundles are explained by no committed state at all. Whatever E3 turns out to be, it is bounded above by 57.

---

## A2 · F-32 — the boring explanations, excluded one at a time

You were right to hold this. I have now excluded staleness, and two other boring explanations I had not thought of. The finding survives, smaller and sharper.

### Was the clone stale or shallow?

**Partly stale, and it did not matter.** Local checks first: `is-shallow-repository` → `false`; no `.git/shallow`; no partial-clone filter; no alternates; `git fsck --connectivity-only` clean.

Then the network. The GitHub **REST** API is still 403 for this token — but the **git protocol is not**, which I had not tried:

```
$ git ls-remote <origin> refs/heads/main refs/heads/staging
b671e1fb0c5bcf145d442076c229eca888afd674   refs/heads/main
9ac4524d703035e6d2debd9e97ab9a0e73de3bc9   refs/heads/staging
```

Two consequences. **First, ledger row 14 is no longer BLOCKED: `origin/main` is confirmed live at `b671e1fb`, so E1's hash is current, not a stale local guess.** (`staging` has moved past the RC to `9ac4524d`.) Second, I fetched everything — 119 heads, 106 `refs/pull/*/head`:

| | before fetch | after fetch |
|---|---|---|
| refs | 122 | **226** |
| commits | 1,663 | 1,665 |
| named objects | 9,265 | **9,270** |

So the clone **was** stale — it was missing all 106 PR refs. Re-running the blob check against the complete object database: **167 of 183 files corroborated, 16 not found. Identical to before.** The 104 new refs contributed 5 named objects and explained nothing. Staleness is excluded, and it is excluded by measurement rather than by argument.

### Two further boring explanations, also excluded

* **Deploy-time import rewrite.** `purge-s3-orphans/index.ts` differs from a committed version by exactly one character — `../_shared/` → `./_shared/`. Packaging, not drift. **Removed from the finding.**
* **Decorative run length.** `backfill-image-dims/index.ts` matches a committed version exactly once runs of repeated filler characters are collapsed. The deployed copy carries two runs of **71** `═` where the committed file has **75**. Repeated-character runs are the classic transcription failure mode, and three couriers agreeing does not exclude *correlated* error on exactly that construct. **Removed from the finding and carried as INFERRED — transcription-suspect.** No other file in the corpus has this property.

### Transcription re-tested where it matters

I re-fetched all ten affected functions **twice more**, with four fresh couriers instructed not to look at any existing transcription and specifically warned about long filler runs. Three independent transcriptions, compared file by file:

> **45 files compared across independent transcriptions; unanimous: 45; disagreements: 0.**

One courier reported a detail that raises this from agreement to an anchor: the `process-email-queue` response exceeded its tool-output limit and was written to disk by the harness, so it decoded those 21 files **programmatically** rather than by retyping — byte-exact by construction. That programmatic decode is byte-identical to the original hand transcription, including a sequence of mojibake em dashes (`U+00E2 U+0080 U+0094`) that retyping would have been expected to normalise to `—`. Testimony, so **RELAYED** — but it is the closest thing to ground truth this channel affords.

### The corrected finding

**F-32 (revised): 14 files across 9 functions carry deployed content that exists in no commit on any of the 226 refs of a fully-fetched clone.**

| function | files with no committed origin |
|---|---|
| `auth-email-hook` | `_shared/email-templates/signup.tsx` |
| `delete-my-account` | `index.ts` |
| `delete-user` | `index.ts` |
| `measure-post-media` | `index.ts`, `_shared/imageDims.ts` |
| `media-register-upload` | `index.ts`, `_shared/imageDims.ts`, `_shared/s3.ts` |
| `migrate-post-media` | `index.ts`, `_shared/imageDims.ts`, `_shared/manifestPlan.ts` |
| `process-email-queue` | `index.ts` |
| `purge-s3-orphans` | `_shared/s3.ts` |
| `send-reengagement-emails` | `index.ts` |

Removed since the first report: `purge-s3-orphans/index.ts` (deploy rewrite) and `backfill-image-dims/index.ts` (run length). Was 16 files / 10 functions; is 14 files / 9 functions.

These are not near-misses. Against the closest committed version of the same path, on any ref: `delete-user` and `delete-my-account` each differ by a **whole deleted statement** (`user_notifications.update({actor_id: null})`) — an intermediate state where the statement is gone but `main`'s replacement comment has not yet been written; `send-reengagement-emails` by a rewritten comment block; `process-email-queue` by a rewritten sender-address expression; `measure-post-media`, `media-register-upload` and `migrate-post-media` by 46–157 changed lines each.

**Status: VERIFIED** for the byte comparison and the exhaustive search; the transport underlying it is **RELAYED with three-way independent agreement**. The single residual risk is correlated transcription error on a construct that is not a repeated-filler run, for which I have no test.

---

## A3 · F-31 — retracted, and replaced by a stronger test

**I was wrong.** I called `send-gift-credit` a hybrid — RC `index.ts` plus `main` `secureHeaders.ts` — and inferred non-atomic deployment. That inference came from comparing against only two reference points. It does not survive comparison against all of them.

### The proper test

A bundle is **atomic** if there exists *any* single commit, on any ref, whose tree contains every file of the deployed bundle exactly as deployed. I built the index once — 1,665 commits → 103 distinct `supabase/functions` trees → `{repo path → blob}` for each — then intersected, per bundle, the set of trees compatible with each of its files.

| result | n |
|---|---|
| **ATOMIC** — a single committed state contains the whole bundle | **61 / 71** |
| **NON-ATOMIC** — no single committed state does | **10 / 71** |
| of those 10: every file individually committed but never together (**provable hybrid**) | **0** |
| of those 10: at least one file committed nowhere (**undecidable**, not disproven) | 10 |

**Answer to your question: zero bundles are provable hybrids.** For the ten that fail the whole-bundle test, I ran the test again over their *committed subset* only. Every one is still consistent with a single state:

```
auth-email-hook           7/8  committed  -> consistent with 1 state  (2026-07-09)
backfill-image-dims       2/3  committed  -> consistent with 6 states (2026-08-15)
process-email-queue      20/21 committed  -> consistent with 14 states (2026-07-25)
purge-s3-orphans          1/2  committed  -> consistent with 29 states (2026-08-29)
delete-my-account, delete-user, measure-post-media,
media-register-upload, migrate-post-media, send-reengagement-emails
                          0 committed files -> undecidable
```

Not one bundle produces an empty intersection over its committed files. **There is no evidence of non-atomic assembly anywhere in the 71.** The correct reading of these ten is not "mixed sources" but "deployed from a working tree whose contents were never committed" — which is a different problem, and the one F-32 names.

### What `send-gift-credit` actually is

Exactly **one** state in the entire history is compatible with it: functions-tree `2040d89345a4`, carried by two commits dated 2026-08-24 —

```
03ba3cf 2026-08-24 (origin/gift-credit-user-lookup) fix: lookup migration (2 of 2)
da0184a 2026-08-24                                  fix: gift-by-email indexed lookup (1 of 2)
```

Production `send-gift-credit` was deployed from a **feature branch**, `gift-credit-user-lookup`, not from `main` and not from `staging`. That is a cleaner and more serious statement than "hybrid": the bundle is internally consistent, and its source is a branch that was never promoted. `analyze-gallery-image` and `detect-ai-image` are the same shape — both atomic, both from `50a11959` (2026-07-13), which is an ancestor of neither `main` nor the RC.

### Per-file provenance, all 183 files

| the deployed file is byte-identical to the repository at… | files |
|---|---|
| both `main` and the RC (paths unchanged between them) | 67 |
| `main` only | 88 |
| the RC only | **1** (`send-gift-credit/index.ts`) |
| some other committed state, neither `main` nor RC | 12 |
| no committed state anywhere | 15 (14 after removing the run-length case) |

The full per-bundle table — atomic yes/no, number of compatible states, newest compatible commit date, per-file origin breakdown — is in `out/atomicity_report.txt`.

---

## A4 · Ledger rows changed by this addendum

| # | Requirement | Instrument | Result | Status |
|---|---|---|---|---|
| 7 (rev) | Task 1 vs endpoint **E1 `main` `b671e1fb`** — relabelled as *destination*, not candidate | `tool/run.py` | 55 / 71 strict bytes; 56 with the stated deploy-rewrite allowance | **VERIFIED** |
| 8 (rev) | Task 1 vs endpoint **E2 RC `25c0456`** — the *candidate* | same | 21 / 71 | **VERIFIED** |
| 8b (new) | Task 1 vs endpoint **E3**, the ledger's endpoint | not yet run — hash not supplied | — | **DEFERRED** (owner: Neil Basu) |
| 8c (new) | Upper bound on any endpoint: best-fitting committed state in all history | `tool/atomicity.py`, 103 distinct trees | **57 / 71** max; 10 bundles explained by no state | **VERIFIED** |
| 14 (rev) | Confirm the clone is current with `origin` | `git ls-remote` over the git protocol (REST still 403) | `origin/main` = `b671e1fb`, confirmed live; clone was missing 106 PR refs, now fetched | **VERIFIED** (was BLOCKED) |
| 18 (new) | Does clone staleness explain the uncorroborated files? | full fetch, then re-run the blob check | **No.** 167/183 before and after; the 104 new refs added 5 objects and explained nothing | **VERIFIED** |
| 19 (new) | F-32 after excluding deploy rewrite and filler-run length | `tool/atomicity.py` + run-length probe | **14 files / 9 functions** (was 16 / 10) | **VERIFIED**; transport **RELAYED**, three-way unanimous |
| 20 (new) | Transcription re-test on the affected functions | 4 fresh independent couriers → `deployed_v3/`, `deployed_v4/` | **45 files, 45 unanimous, 0 disagreements** | **VERIFIED** |
| 21 (new) | `backfill-image-dims/index.ts` | filler-run collapse | matches a committed version but for two `═` runs (71 vs 75) — removed from F-32 | **INFERRED** — transcription-suspect |
| 22 (new) | F-31 — are bundles assembled from more than one source version? | `tool/atomicity.py`, whole-history intersection | **0 provable hybrids.** 61 atomic; 10 undecidable because content is uncommitted, none mixed | **VERIFIED** |
| 23 (new) | `send-gift-credit` provenance | intersection = exactly one state | deployed from branch `gift-credit-user-lookup` (`03ba3cf`, 2026-08-24), promoted to neither lane | **VERIFIED** |
| 24 (rev) | F-31 as first published ("hybrid, deployments not atomic") | — | **RETRACTED.** The two-reference-point comparison that produced it was insufficient; the whole-history test refutes it | **CORRECTED** |

Unchanged by this addendum: Task 2 (39 W · 27 G · 5 N, identical class deployed vs repository for all 71), Task 3 (15/15), Task 4 (JSX text child, comment, template literal all inert; 393/393 files lex clean).
